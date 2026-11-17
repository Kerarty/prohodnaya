/**
 * Сигналинг-сервер P2P-дуэлей (протокол PeerJS 1.5.x) + глобальный топ-50 рейтингов.
 *
 * Зачем свой: старый npm-пакет 'peer' (1.0.2, 2017) несовместим с heartbeat
 * клиента 1.5.x — клиенты отваливались через секунды. Облако 0.peerjs.com
 * остаётся дефолтом игры; этот сервер — для локальной отладки, для тех,
 * кто хочет свой сигналинг (?peer=host:port), и как источник топ-50.
 *
 * Запуск: node server/p2p-signal.mjs [--port 9100] [--key peerjs]
 *
 * Сигналинг (проверено по node_modules/peerjs/dist, версия 1.5.5,
 * дефолт path='/', key='peerjs'):
 * — GET  /peerjs/id     → 200, text: новый уникальный id
 * — GET  /peerjs/peers  → 200, JSON: [] (listAllPeers, deprecated)
 * — WS   /peerjs?key=…&id=…&token=…&version=…
 *      сервер → {type:'OPEN', peers:[id…]}      сразу после регистрации
 *      клиент → {type:'HEARTBEAT'}             каждые ~5 c
 *      сервер → {type:'HEARTBEAT'}             ответ на каждый
 *      пара   → {type:'OFFER'|'ANSWER'|'CANDIDATE', dst, …} — ретрансляция
 *      нет dst → {type:'ERROR', payload:{type:'peer-unavailable', …}}
 *      занят id → {type:'ID-TAKEN'} + close
 *      выход   → {type:'LEAVE', id} остальным
 *
 * Топ-50 (самоотчёт клиентов; рейтинги честно проверяются только хостингом —
 * для портфолио доверие на совести игроков):
 * — POST /top50/report  body {name, blitzRating, duelRating, blitzBest,
 *        duelWins, duelLosses, duelDraws} → upsert по имени + дамп в файл
 * — GET  /top50         → {blitz: топ-50 по blitzRating, duels: по duelRating}
 */

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { WebSocketServer } from 'ws';

const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1] ?? 9100);
const key = args[args.indexOf('--key') + 1] ?? 'peerjs';
const PATH = '/peerjs';
/** Сколько секунд ждать heartbeat, прежде чем считать клиента мёртвым. */
const EXPIRE_MS = 15000;

/** id → { socket, token, lastBeat }. */
const peers = new Map();

/* ——— ТОП-50: рейтинги блица и дуэлей (самоотчёт клиентов) ——— */

const TOP_FILE = new URL('./p2p-top50.json', import.meta.url);
const TOP_LIMIT = 50;

function loadTop50() {
  try {
    const data = JSON.parse(readFileSync(TOP_FILE, 'utf8'));
    if (data && typeof data.entries === 'object' && data.entries !== null) return data.entries;
  } catch {
    /* нет файла — стартуем с пустого */
  }
  return {};
}

/** name → профиль { blitzRating, duelRating, blitzBest, duelWins, duelLosses, duelDraws, ts }. */
const top50 = loadTop50();

function saveTop50() {
  try {
    writeFileSync(TOP_FILE, JSON.stringify({ entries: top50 }, null, 2));
  } catch {
    /* диск недоступен — топ живёт в памяти до рестарта */
  }
}

/** Число из недоверенного JSON: конечное, неотрицательное, ограниченное. */
function saneNum(v, max = 1_000_000) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), max) : 0;
}

/** Срезать контрольные символы и ограничить длину имени. */
function saneName(v) {
  if (typeof v !== 'string') return '';
  // контрольные символы вырезаем посимвольно (правило no-control-regex)
  return [...v]
    .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
    .join('')
    .trim()
    .slice(0, 24);
}

function upsertTop50(body) {
  const name = saneName(body?.name);
  if (!name) return null;
  top50[name] = {
    name,
    blitzRating: saneNum(body?.blitzRating),
    duelRating: saneNum(body?.duelRating),
    blitzBest: saneNum(body?.blitzBest),
    duelWins: saneNum(body?.duelWins),
    duelLosses: saneNum(body?.duelLosses),
    duelDraws: saneNum(body?.duelDraws),
    ts: Date.now(),
  };
  saveTop50();
  return name;
}

function top50List(field) {
  return [...Object.values(top50)]
    .sort((a, b) => b[field] - a[field] || a.name.localeCompare(b.name))
    .slice(0, TOP_LIMIT);
}

function otherIds(exceptId) {
  return [...peers.keys()].filter((id) => id !== exceptId);
}

function sendTo(socket, msg) {
  if (socket.readyState === 1) socket.send(JSON.stringify(msg));
}

function unregister(id, reason) {
  const peer = peers.get(id);
  if (!peer) return;
  peers.delete(id);
  for (const other of peers.values()) {
    sendTo(other.socket, { type: 'LEAVE', id });
  }
  console.info(`[signal] ${reason}: ${id} (осталось: ${peers.size})`);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  // CORS: страница игры может жить на любом домене
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  const segments = url.pathname.split('/').filter(Boolean);
  // /peerjs/id и /peerjs/peers (path клиента = '/', key = 'peerjs')
  if (segments[0] === PATH.replace(/^\//, '')) {
    if (req.method === 'GET' && segments[1] === 'id') {
      let id = randomUUID();
      while (peers.has(id)) id = randomUUID();
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(id);
      return;
    }
    if (req.method === 'GET' && segments[1] === 'peers') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(otherIds('')));
      return;
    }
  }
  // /top50/report (POST) и /top50 (GET) — рейтинги блица и дуэлей
  if (segments[0] === 'top50') {
    if (req.method === 'POST' && segments[1] === 'report') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 4096) req.destroy(); // щит от мусора
      });
      req.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'bad json' }));
          return;
        }
        const name = upsertTop50(parsed);
        if (!name) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'bad name' }));
          return;
        }
        console.info(`[top50] профиль: ${name}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }
    if (req.method === 'GET' && segments.length === 1) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          blitz: top50List('blitzRating'),
          duels: top50List('duelRating'),
        }),
      );
      return;
    }
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (socket, req) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const id = url.searchParams.get('id') ?? '';
  if (!id) {
    socket.close();
    return;
  }
  if (peers.has(id)) {
    sendTo(socket, { type: 'ID-TAKEN', payload: { message: `ID "${id}" уже занят` } });
    socket.close();
    return;
  }
  const peer = { socket, token: url.searchParams.get('token') ?? '', lastBeat: Date.now() };
  peers.set(id, peer);
  console.info(`[signal] подключился: ${id} (всего: ${peers.size})`);
  sendTo(socket, { type: 'OPEN', peers: otherIds(id) });

  socket.on('message', (raw) => {
    peer.lastBeat = Date.now();
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.type === 'HEARTBEAT') {
      sendTo(socket, { type: 'HEARTBEAT' });
      return;
    }
    const dst = peers.get(msg.dst);
    if (!dst || dst.socket.readyState !== 1) {
      sendTo(socket, {
        type: 'ERROR',
        payload: {
          type: 'peer-unavailable',
          message: `Could not connect to peer ${msg.dst}`,
        },
      });
      return;
    }
    // ретрансляция: клиент не кладёт src (OFFER идёт без него) — сервер обязан
    // подставить отправителя, иначе хост не знает, кому отвечать
    msg.src = id;
    sendTo(dst.socket, msg);
  });

  socket.on('close', () => unregister(id, 'вышел'));
  socket.on('error', () => unregister(id, 'ошибка'));
});

// реапер: клиенты без heartbeat отваливаются сами, чистим регистр
setInterval(() => {
  const now = Date.now();
  for (const [id, peer] of peers) {
    if (now - peer.lastBeat > EXPIRE_MS) unregister(id, 'таймаут');
  }
}, 5000).unref();

server.listen(port, () => {
  console.info(`P2P signaling + top50 на http://localhost:${port}${PATH} (key: ${key})`);
});
