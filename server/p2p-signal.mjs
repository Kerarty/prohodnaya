/**
 * Минимальный сигналинг-сервер для P2P-дуэлей (протокол PeerJS 1.5.x).
 *
 * Зачем свой: старый npm-пакет 'peer' (1.0.2, 2017) несовместим с heartbeat
 * клиента 1.5.x — клиенты отваливались через секунды. Облако 0.peerjs.com
 * остаётся дефолтом игры; этот сервер — для локальной отладки и для тех,
 * кто хочет свой сигналинг (?peer=host:port).
 *
 * Запуск: node server/p2p-signal.mjs [--port 9100] [--key peerjs]
 *
 * Протокол клиента (проверено по node_modules/peerjs/dist, версия 1.5.5,
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
 */

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';

const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1] ?? 9100);
const key = args[args.indexOf('--key') + 1] ?? 'peerjs';
const PATH = '/peerjs';
/** Сколько секунд ждать heartbeat, прежде чем считать клиента мёртвым. */
const EXPIRE_MS = 15000;

/** id → { socket, token, lastBeat }. */
const peers = new Map();

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
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
      console.info(`[signal] ${id}: нераспарсable сообщение (${String(raw).slice(0, 80)}…)`);
      return;
    }
    if (msg.type !== 'HEARTBEAT') {
      console.info(`[signal] от ${id}: ${msg.type} dst=${msg.dst ?? '—'} keys=${Object.keys(msg).join(',')}`);
    }
    if (msg.type === 'HEARTBEAT') {
      sendTo(socket, { type: 'HEARTBEAT' });
      return;
    }
    const dst = peers.get(msg.dst);
    if (!dst || dst.socket.readyState !== 1) {
      console.info(`[signal] релей: ${id} → ${msg.dst}: НЕ НАЙДЕН (${msg.type})`);
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
    console.info(`[signal] релей: ${id} → ${msg.dst}: ${msg.type}`);
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
  console.info(`P2P signaling на http://localhost:${port}${PATH} (key: ${key})`);
});
