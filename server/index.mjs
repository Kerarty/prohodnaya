/**
 * «Проходная» — минимальный сервер матчмейкинга дуэлей (фаза 2 плана мультиплеера).
 *
 * Чистый Node.js >= 18, только встроенные модули (http, crypto, fs), ноль npm-зависимостей.
 * Запуск: node server/index.mjs [--port 8787]
 *
 * Хранилище целиком в памяти; раз в 30 с best-effort дамп всего состояния в
 * server/data.json (атомарно: tmp + rename), загрузка при старте, если файл есть.
 *
 * Контракт API, правила рейтинга и допущения v1 — в server/README.md.
 * Анти-чит v1: 1 результат на игрока на матч; score > 400 отклоняется (HTTP 400);
 * POST .../result не чаще 1 раза в секунду на игрока (HTTP 429).
 * Проверка скорости набора очков не делается (решение v1, см. план, п. «пределы честно»).
 */

import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";

// ---------------------------------------------------------------------------
// Конфигурация — все подогнанные под фазу 2 числа живут здесь, не в логике.
// ---------------------------------------------------------------------------

const DEFAULT_PORT = 8787;
const COUNTDOWN_MS = 3000; // startAt = now + 3 c, назначается при полном составе
const DURATION_MS = 90000; // длительность забега (durationMs в контракте)
const FORFEIT_MS = 180000; // дедлайн результата: startAt + durationMs + 3 мин
const SCORE_CAP = 400; // потолок очков: 40 заявок × 10 очков
const RESULT_RATE_LIMIT_MS = 1000; // POST .../result: не чаще 1/с на игрока
const DUMP_INTERVAL_MS = 30000; // периодичность дампа в data.json
const START_RATING = 1000;
const WIN_DELTA = 8;
const LOSS_DELTA = -6;
const DRAW_DELTA = 0;
const PRUNE_AFTER_MS = 3600000; // завершённые матчи вычищаются из памяти через час
const MAX_BODY_BYTES = 65536;
const CODE_LENGTH = 6;
// Подмножество A-Z0-9: убраны визуально двусмысленные O/0/I/1.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const DATA_FILE = new URL("./data.json", import.meta.url);
const DATA_FILE_TMP = new URL("./data.json.tmp", import.meta.url);

const PORT = parsePortArg(process.argv);

function parsePortArg(argv) {
  const args = argv.slice(2);
  const fail = (raw) => {
    console.error(`[duel-server] invalid --port value: ${raw}`);
    process.exit(1);
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port") {
      const v = Number(args[i + 1]);
      if (!Number.isInteger(v) || v < 1 || v > 65535) fail(args[i + 1]);
      return v;
    }
    if (args[i].startsWith("--port=")) {
      const raw = args[i].slice("--port=".length);
      const v = Number(raw);
      if (!Number.isInteger(v) || v < 1 || v > 65535) fail(raw);
      return v;
    }
  }
  return DEFAULT_PORT;
}

// ---------------------------------------------------------------------------
// Состояние (в памяти)
// ---------------------------------------------------------------------------

/** playerId -> { playerId, name, rating, wins, losses, draws } */
const ratings = new Map();

/**
 * matchId -> match:
 * {
 *   matchId, kind: "quick" | "private", code: string | null,
 *   seed: number (uint32), durationMs, createdAt,
 *   startAt: number | null,            // назначается при полном составе
 *   players: [{ playerId, name, score, finished, outcome?, delta? }], // 1..2
 *   resolved: boolean, winner: string | null, resolvedAt: number | null
 * }
 */
const matches = new Map();

/** FIFO quick-очередь: matchId матчей с одним ждущим игроком. */
const quickQueue = [];

/** playerId -> ts последней попытки POST .../result (rate limit). */
const resultRate = new Map();

// ---------------------------------------------------------------------------
// Утилиты HTTP
// ---------------------------------------------------------------------------

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function send(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(),
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(httpError(413, "request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw httpError(400, "invalid JSON body");
  }
}

// ---------------------------------------------------------------------------
// Рейтинг (Elo-lite)
// ---------------------------------------------------------------------------

function ensureStats(playerId, name) {
  let s = ratings.get(playerId);
  if (!s) {
    s = { playerId, name: name || playerId, rating: START_RATING, wins: 0, losses: 0, draws: 0 };
    ratings.set(playerId, s);
  }
  if (name) s.name = name;
  return s;
}

function applyOutcome(stats, outcome) {
  if (outcome === "win") {
    stats.rating += WIN_DELTA;
    stats.wins += 1;
  } else if (outcome === "loss") {
    stats.rating += LOSS_DELTA;
    stats.losses += 1;
  } else {
    stats.rating += DRAW_DELTA;
    stats.draws += 1;
  }
}

// ---------------------------------------------------------------------------
// Логика матчей
// ---------------------------------------------------------------------------

const randomSeed = () => crypto.randomInt(0, 0x100000000); // uint32

function generateUniqueCode() {
  for (;;) {
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    }
    const taken = [...matches.values()].some(
      (m) => m.kind === "private" && !m.resolved && m.code === code
    );
    if (!taken) return code;
  }
}

function removeFromQueue(matchId) {
  const i = quickQueue.indexOf(matchId);
  if (i !== -1) quickQueue.splice(i, 1);
}

function dropMatch(match) {
  removeFromQueue(match.matchId);
  matches.delete(match.matchId);
}

/** Активный (не завершённый) матч игрока или null. */
function activeMatchOf(playerId) {
  for (const m of matches.values()) {
    if (m.resolved) continue;
    if (m.players.some((p) => p.playerId === playerId)) return m;
  }
  return null;
}

const resolveAt = (m) => m.startAt + m.durationMs + FORFEIT_MS;

/**
 * Завершает матч: определяет победителя и применяет Elo. Ровно один вызов
 * на матч (guard по resolved). Вызывается: при получении обоих результатов,
 * при дедлайне (sweep), при первом результате после дедлайна.
 */
function resolveMatch(m, now) {
  if (m.resolved) return;
  m.resolved = true;
  m.resolvedAt = now;
  removeFromQueue(m.matchId);

  const [a, b] = m.players;
  let winner;
  if (a.finished && b.finished) {
    winner = a.score > b.score ? a.playerId : b.score > a.score ? b.playerId : "draw";
  } else if (a.finished) {
    winner = a.playerId; // соперник не прислал до дедлайна — техпоражение
  } else if (b.finished) {
    winner = b.playerId;
  } else {
    winner = "draw"; // оба не прислали — ничья
  }
  m.winner = winner;

  const statsA = ensureStats(a.playerId, a.name);
  const statsB = ensureStats(b.playerId, b.name);
  for (const [p, stats] of [
    [a, statsA],
    [b, statsB],
  ]) {
    const outcome = winner === "draw" ? "draw" : winner === p.playerId ? "win" : "loss";
    p.outcome = outcome;
    p.delta = outcome === "win" ? WIN_DELTA : outcome === "loss" ? LOSS_DELTA : DRAW_DELTA;
    applyOutcome(stats, outcome);
  }
}

/**
 * Ленивый обход: завершает матчи с наступившим дедлайном, вычищает старые
 * завершённые матчи. Вызывается перед обработкой каждого запроса и перед дампом.
 */
function sweep(now = Date.now()) {
  for (const m of matches.values()) {
    if (m.resolved) {
      if (now - (m.resolvedAt || 0) > PRUNE_AFTER_MS) dropMatch(m);
      continue;
    }
    if (m.startAt && now >= resolveAt(m)) resolveMatch(m, now);
  }
}

function playersView(m) {
  return m.players.map((p) => ({
    playerId: p.playerId,
    name: p.name,
    score: p.score,
    finished: p.finished,
  }));
}

function matchedPayload(m, forPlayerId) {
  const opp = m.players.find((p) => p.playerId !== forPlayerId);
  return {
    status: "matched",
    matchId: m.matchId,
    seed: m.seed,
    durationMs: m.durationMs,
    startAt: m.startAt,
    opponent: { playerId: opp.playerId, name: opp.name },
  };
}

function createdPayload(m) {
  return { status: "created", matchId: m.matchId, code: m.code, seed: m.seed, durationMs: m.durationMs };
}

function statePayload(m) {
  const now = Date.now();
  const status = m.resolved
    ? "results"
    : m.players.length < 2
      ? "waiting"
      : now < m.startAt
        ? "countdown"
        : "running";
  const out = {
    status,
    matchId: m.matchId,
    seed: m.seed,
    durationMs: m.durationMs,
    startAt: m.startAt,
    players: playersView(m),
    winner: m.winner ?? null,
  };
  if (m.kind === "private") out.code = m.code;
  return out;
}

function resultPayload(m, forPlayerId) {
  const stats = ratings.get(forPlayerId);
  const me = m.players.find((p) => p.playerId === forPlayerId);
  return {
    winner: m.winner ?? null,
    players: playersView(m),
    rating: {
      me: stats ? stats.rating : START_RATING,
      delta: m.resolved ? me?.delta ?? 0 : 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Валидация входных данных
// ---------------------------------------------------------------------------

function requireIdentity(body) {
  const { playerId, name } = body || {};
  if (typeof playerId !== "string" || !playerId.trim()) throw httpError(400, "playerId required");
  if (playerId.length > 64) throw httpError(400, "playerId too long (max 64)");
  if (typeof name !== "string" || !name.trim()) throw httpError(400, "name required");
  if (name.trim().length > 40) throw httpError(400, "name too long (max 40)");
  return { playerId, name: name.trim() };
}

// ---------------------------------------------------------------------------
// Обработчики эндпоинтов
// ---------------------------------------------------------------------------

function newMatch(kind, code, playerId, name, now) {
  return {
    matchId: crypto.randomUUID(),
    kind,
    code,
    seed: randomSeed(),
    durationMs: DURATION_MS,
    createdAt: now,
    startAt: null,
    players: [{ playerId, name, score: 0, finished: false }],
    resolved: false,
    winner: null,
    resolvedAt: null,
  };
}

/** POST /api/match/quick */
function handleQuick(body) {
  const { playerId, name } = requireIdentity(body);

  // Идемпотентный повтор: игрок уже где-то активен.
  const active = activeMatchOf(playerId);
  if (active) {
    if (active.players.length === 1) return { status: "waiting", matchId: active.matchId };
    return matchedPayload(active, playerId);
  }

  // Чистим протухшие записи очереди.
  const now = Date.now();
  for (let i = quickQueue.length - 1; i >= 0; i--) {
    const m = matches.get(quickQueue[i]);
    if (!m || m.resolved || m.players.length !== 1) quickQueue.splice(i, 1);
  }

  // Есть ждущий соперник? Вступаем в ЕГО ждущий матч (matchId сохраняется —
  // клиент первого игрока продолжает поллинг того же матча).
  const idx = quickQueue.findIndex((id) => matches.get(id).players[0].playerId !== playerId);
  if (idx !== -1) {
    const m = matches.get(quickQueue[idx]);
    quickQueue.splice(idx, 1);
    m.players.push({ playerId, name, score: 0, finished: false });
    m.startAt = now + COUNTDOWN_MS;
    return matchedPayload(m, playerId);
  }

  // Никого нет — встаём в FIFO-очередь.
  const m = newMatch("quick", null, playerId, name, now);
  matches.set(m.matchId, m);
  quickQueue.push(m.matchId);
  return { status: "waiting", matchId: m.matchId };
}

/** POST /api/match/create */
function handleCreate(body) {
  const { playerId, name } = requireIdentity(body);

  const active = activeMatchOf(playerId);
  if (active) {
    if (active.players.length === 2) throw httpError(409, "player already in an active match");
    if (active.kind === "private") return createdPayload(active); // идемпотентный повтор
    dropMatch(active); // выходим из ждущего quick-матча и создаём комнату
  }

  const m = newMatch("private", generateUniqueCode(), playerId, name, Date.now());
  matches.set(m.matchId, m);
  return createdPayload(m);
}

/** POST /api/match/join */
function handleJoin(body) {
  const { playerId, name } = requireIdentity(body);
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!code) throw httpError(400, "code required");

  const m = [...matches.values()].find(
    (x) => x.kind === "private" && !x.resolved && x.code === code
  );
  if (!m) throw httpError(404, "room code not found");

  if (m.players.some((p) => p.playerId === playerId)) {
    if (m.players.length === 2 && m.startAt) return matchedPayload(m, playerId); // идемпотентный повтор
    throw httpError(409, "player already in this room");
  }
  if (m.resolved || m.players.length >= 2) throw httpError(409, "room is full");

  const active = activeMatchOf(playerId);
  if (active && active.players.length === 2) throw httpError(409, "player already in an active match");
  if (active) dropMatch(active); // выходим из ждущего матча (quick-очередь или своя комната)

  m.players.push({ playerId, name, score: 0, finished: false });
  m.startAt = Date.now() + COUNTDOWN_MS;
  return matchedPayload(m, playerId);
}

/** GET /api/match/{matchId} */
function handleState(matchId) {
  const m = matches.get(matchId);
  if (!m) throw httpError(404, "match not found");
  return statePayload(m);
}

/** POST /api/match/{matchId}/result */
function handleResult(matchId, body) {
  const playerId = typeof body?.playerId === "string" && body.playerId.trim() ? body.playerId : null;
  if (!playerId) throw httpError(400, "playerId required");
  if (playerId.length > 64) throw httpError(400, "playerId too long (max 64)");

  // Rate limit: не чаще 1 POST .../result в секунду на игрока (учитываются все попытки).
  const now = Date.now();
  const last = resultRate.get(playerId) || 0;
  if (now - last < RESULT_RATE_LIMIT_MS) {
    throw httpError(429, "rate limit: max 1 result POST per second per player");
  }
  resultRate.set(playerId, now);

  const m = matches.get(matchId);
  if (!m) throw httpError(404, "match not found");
  const p = m.players.find((x) => x.playerId === playerId);
  if (!p) throw httpError(404, "player is not in this match");
  if (m.players.length < 2 || !m.startAt) throw httpError(409, "match has not started yet");
  if (m.resolved) throw httpError(409, "match already finished");
  if (p.finished) throw httpError(409, "result already submitted for this match");

  // Анти-чит v1: потолок очков (40 заявок × 10 очков). Больше — отклоняем.
  const score = body?.score;
  if (!Number.isInteger(score) || score < 0) {
    throw httpError(400, "score must be a non-negative integer");
  }
  if (score > SCORE_CAP) throw httpError(400, `score above cap ${SCORE_CAP}`);

  p.score = score;
  p.finished = true;
  // Завершаем, если оба прислали ИЛИ дедлайн уже наступил
  // (не приславший соперник = техпоражение, если этот игрок прислал).
  if (m.players.every((x) => x.finished) || now >= resolveAt(m)) resolveMatch(m, now);
  return resultPayload(m, playerId);
}

/** GET /api/rating?playerId=... */
function handleRating(url) {
  const playerId = url.searchParams.get("playerId");
  if (!playerId) throw httpError(400, "playerId query parameter required");

  const top = [...ratings.values()]
    .sort((a, b) => b.rating - a.rating || (a.playerId < b.playerId ? -1 : 1))
    .slice(0, 10)
    .map((s) => ({ playerId: s.playerId, name: s.name, rating: s.rating }));

  const s = ratings.get(playerId);
  return {
    playerId,
    rating: s ? s.rating : START_RATING,
    wins: s?.wins ?? 0,
    losses: s?.losses ?? 0,
    draws: s?.draws ?? 0,
    top,
  };
}

// ---------------------------------------------------------------------------
// Персистентность: сервер/data.json, раз в 30 c, best-effort
// ---------------------------------------------------------------------------

function dumpState() {
  sweep(Date.now());
  const data = {
    version: 1,
    savedAt: new Date().toISOString(),
    ratings: [...ratings.values()],
    matches: [...matches.values()],
    queue: [...quickQueue],
  };
  try {
    fs.writeFileSync(DATA_FILE_TMP, JSON.stringify(data));
    fs.renameSync(DATA_FILE_TMP, DATA_FILE); // атомарная замена
  } catch (err) {
    console.error(`[duel-server] dump failed: ${err.message}`);
  }
}

function loadState() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const data = JSON.parse(raw);
    for (const s of Array.isArray(data.ratings) ? data.ratings : []) {
      if (s && typeof s.playerId === "string") ratings.set(s.playerId, s);
    }
    for (const m of Array.isArray(data.matches) ? data.matches : []) {
      if (m && typeof m.matchId === "string" && Array.isArray(m.players)) {
        matches.set(m.matchId, m);
      }
    }
    for (const id of Array.isArray(data.queue) ? data.queue : []) {
      if (matches.has(id)) quickQueue.push(id);
    }
    // Страховка: ждущие quick-матчи должны быть в очереди, даже если дамп был неполным.
    for (const m of matches.values()) {
      if (
        m.kind === "quick" &&
        !m.resolved &&
        m.players.length === 1 &&
        !quickQueue.includes(m.matchId)
      ) {
        quickQueue.push(m.matchId);
      }
    }
    console.log(
      `[duel-server] loaded state: ${ratings.size} ratings, ${matches.size} matches, ${quickQueue.length} queued`
    );
  } catch (err) {
    console.error(`[duel-server] load failed, starting fresh: ${err.message}`);
    ratings.clear();
    matches.clear();
    quickQueue.length = 0;
  }
}

// ---------------------------------------------------------------------------
// HTTP-сервер и маршрутизация
// ---------------------------------------------------------------------------

async function handleRequest(req, res) {
  const url = new URL(req.url, "http://localhost");
  const pathName = url.pathname;

  // CORS preflight — на любой путь.
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Max-Age": "600", ...corsHeaders() });
    res.end();
    return;
  }

  sweep(Date.now());

  if (pathName === "/api/ping" && req.method === "GET") {
    return send(res, 200, { ok: true });
  }
  if (pathName === "/api/match/quick" && req.method === "POST") {
    return send(res, 200, handleQuick(await readJson(req)));
  }
  if (pathName === "/api/match/create" && req.method === "POST") {
    return send(res, 200, handleCreate(await readJson(req)));
  }
  if (pathName === "/api/match/join" && req.method === "POST") {
    return send(res, 200, handleJoin(await readJson(req)));
  }
  let m = pathName.match(/^\/api\/match\/([^/]+)$/);
  if (m && req.method === "GET") {
    return send(res, 200, handleState(decodeURIComponent(m[1])));
  }
  m = pathName.match(/^\/api\/match\/([^/]+)\/result$/);
  if (m && req.method === "POST") {
    return send(res, 200, handleResult(decodeURIComponent(m[1]), await readJson(req)));
  }
  if (pathName === "/api/rating" && req.method === "GET") {
    return send(res, 200, handleRating(url));
  }
  throw httpError(404, `no route: ${req.method} ${pathName}`);
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    const status = Number.isInteger(err?.status) ? err.status : 500;
    if (status >= 500) console.error(`[duel-server] ${req.method} ${req.url}:`, err);
    if (!res.headersSent) send(res, status, { error: err?.message || "internal error" });
    else res.end();
  });
});

// Лог аномалий, чтобы процесс не падал из-за одного кривого запроса.
process.on("uncaughtException", (err) => console.error("[duel-server] uncaught:", err));
process.on("unhandledRejection", (err) => console.error("[duel-server] unhandled:", err));

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    try {
      dumpState();
    } catch {
      /* best-effort */
    }
    process.exit(0);
  });
}

loadState();
server.listen(PORT, () => {
  console.log(
    `[duel-server] listening on http://127.0.0.1:${PORT} (data file: ${DATA_FILE.href}, dump every ${DUMP_INTERVAL_MS / 1000}s)`
  );
});
setInterval(dumpState, DUMP_INTERVAL_MS).unref();
