/**
 * P2P-транспорт дуэлей поверх WebRTC (peerjs) — без своего сервера.
 *
 * Идея адресации: детерминированные peer-id в общем облаке сигналинга.
 * — Комната по коду: хост занимает id `prohodnaya-1-room-<КОД>`, гость
 *   подключается к нему. Код есть — дуэль есть; не найден — честная ошибка.
 * — Быстрый матч: 4 «хаба» `prohodnaya-1-quick-<slot>`. Первый свободный слот
 *   занимает ждущий игрок (он же хост и он же соперник); следующий игрок
 *   подключается к занятому слоту и получает пару. Если хаб уже в дуэли,
 *   хост отвечает {t:'busy'} — игрок пробует следующий слот; когда заняты все,
 *   pollMatch кидает 'p2p-no-slots' — лобби перезапускает поиск ботом.
 *
 * Контракт — тот же MatchAPI (quick/poll/report + комнаты), поэтому флоу
 * GameScene не меняется. Тесты подставляют фейк-фабрику Peer вместо сети.
 */

import { BALANCE, duelDelta } from '../game/economy';
import { getPlayerIdentity, type MatchAPI, type MatchOutcome, type MatchPoll } from './matchApi';

/* ——— структурные типы peerjs (совместимы с настоящими Peer/DataConnection) ——— */

export interface P2PDataConnection {
  on(event: 'open', cb: () => void): void;
  on(event: 'data', cb: (data: unknown) => void): void;
  on(event: 'close', cb: () => void): void;
  on(event: 'error', cb: (err: unknown) => void): void;
  send(data: unknown): void;
  close(): void;
}

export interface P2PPeer {
  on(event: 'open', cb: (id: string) => void): void;
  on(event: 'error', cb: (err: { type?: string; message?: string }) => void): void;
  on(event: 'connection', cb: (conn: P2PDataConnection) => void): void;
  connect(id: string, opts?: { reliable?: boolean }): P2PDataConnection;
  off?(event: 'error', cb: (err: { type?: string }) => void): void;
  destroy(): void;
}

export type PeerFactory = (id?: string) => Promise<P2PPeer>;

/**
 * Сигналинг: по умолчанию бесплатное облако PeerJS (0.peerjs.com, без ключей).
 * ?peer=host:port[/path] — свой сигналинг-сервер (локальная отладка:
 * `npx peerjs --port 9100` + `?peer=localhost:9100`).
 */
export function peerServerConfig(): { host: string; port: number; path: string; secure: boolean } | undefined {
  const raw = new URLSearchParams(location.search).get('peer');
  if (!raw) return undefined;
  const [hostPort, path = '/'] = raw.split('/');
  const [host, port] = hostPort.split(':');
  return {
    host,
    port: Number(port ?? 443),
    path: path.startsWith('/') ? path : `/${path}`,
    secure: host !== 'localhost' && host !== '127.0.0.1',
  };
}

/** Фабрика по умолчанию: облако PeerJS или ?peer= — свой сигналинг. */
export const defaultPeerFactory: PeerFactory = async (id) => {
  const { Peer } = await import('peerjs');
  const cfg = peerServerConfig();
  const options = { ...(cfg ?? {}), debug: 0 };
  return id ? new Peer(id, options) : new Peer(options);
};

/* ——— протокол сообщений ——— */

type Msg =
  | { t: 'hello'; name: string }
  | { t: 'welcome'; seed: number; durationMs: number; startAt: number; opponentName: string }
  | { t: 'busy' }
  | { t: 'score'; score: number }
  | { t: 'result'; score: number };

function asMsg(data: unknown): Msg | null {
  if (typeof data !== 'object' || data === null) return null;
  const m = data as Record<string, unknown>;
  switch (m.t) {
    case 'hello':
      return typeof m.name === 'string' ? { t: 'hello', name: m.name } : null;
    case 'welcome':
      return typeof m.seed === 'number' &&
        typeof m.durationMs === 'number' &&
        typeof m.startAt === 'number' &&
        typeof m.opponentName === 'string'
        ? {
            t: 'welcome',
            seed: m.seed,
            durationMs: m.durationMs,
            startAt: m.startAt,
            opponentName: m.opponentName,
          }
        : null;
    case 'busy':
      return { t: 'busy' };
    case 'score':
    case 'result':
      return typeof m.score === 'number' ? { t: m.t, score: m.score } : null;
    default:
      return null;
  }
}

/* ——— тайминги (инъекция для тестов) ——— */

export interface P2PTimings {
  /** Ожидание открытия соединения (peer-id/conn). */
  connectMs: number;
  /** Сколько хаб-хост ждёт гостя, прежде чем освободить слот. */
  hubWaitMs: number;
  /** Ожидание результата соперника после своего финиша. */
  resultMs: number;
}

const DEFAULT_TIMINGS: P2PTimings = { connectMs: 8000, hubWaitMs: 25000, resultMs: 45000 };

/* ——— адресация ——— */

const PROTOCOL = 'prohodnaya-1';
/** Алфавит кодов без похожих символов (нет I/L/1/O/0). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function genRoomCode(): string {
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

const roomId = (code: string): string => `${PROTOCOL}-room-${code.toUpperCase()}`;
const hubId = (slot: number): string => `${PROTOCOL}-quick-${slot}`;

export function isP2PNoSlotsError(e: unknown): boolean {
  return String(e).includes('p2p-no-slots');
}

interface P2PSession {
  conn: P2PDataConnection;
  seed: number;
  durationMs: number;
  startAt: number;
  opponentName: string;
  /** Последний живой счёт соперника ({t:'score'}). */
  opponentScore: number;
  /** Итоговый скор соперника ({t:'result'}) — после его финиша. */
  opponentResult: number | null;
  myScore: number | null;
  peerGone: boolean;
}

/**
 * MatchAPI поверх WebRTC — реальный соперник без серверов.
 * «Дуэль всегда даёт игру»: если слотов нет — лобби (MenuScene) ловит
 * 'p2p-no-slots' и перезапускает поиск ботом.
 */
export class P2PMatchAPI implements MatchAPI {
  readonly botOpponent = false;

  async probe(): Promise<boolean> {
    return true;
  }

  /* ——— быстрый матч ——— */

  async quickMatch(): Promise<{ matchId: string; matched: boolean }> {
    const matchId = `p2p-quick-${Math.floor(Math.random() * 1e9).toString(36)}`;
    this.searching = true;
    void this.searchQuick();
    return { matchId, matched: false };
  }

  /**
   * Поиск пары: СХОДЯЩИЙСЯ протокол — все ищут со слота 0, занимают первый
   * свободный. Двое ждущих всегда встречаются на младшем свободном слоте
   * (случайный порядок слотов оставлял их на разных слотах навсегда).
   * Хаб-таймаут (никто не пришёл) → новый круг; заняты ВСЕ слоты дуэлями
   * (два круга подряд) → 'p2p-no-slots' → лобби перезапускает поиск ботом.
   */
  private async searchQuick(): Promise<void> {
    let busyRounds = 0;
    while (this.searching && !this.session) {
      let sawFreeSlot = false;
      for (const slot of [0, 1, 2, 3]) {
        if (this.searchAborted()) return;
        // 1) попробовать подключиться к чужому хабу (кто-то ждёт)
        try {
          await this.joinHubSlot(slot);
          return; // сессия открыта
        } catch (e) {
          const type = this.errType(e);
          if (this.searchAborted()) return;
          if (type === 'busy') continue; // хаб слота в дуэли — следующий слот
          if (type !== 'peer-unavailable') continue; // таймаут/сеть — следующий слот
          // 2) слот свободен — занять его самому и ждать гостя
          sawFreeSlot = true;
          try {
            const paired = await this.hostHubSlot(slot);
            if (paired) return; // сессия открыта
            break; // таймаут ожидания — новый круг (снова join со слота 0)
          } catch {
            if (this.searchAborted()) return;
            break; // unavailable-id (слот заняли одновременно) / сеть — новый круг
          }
        }
      }
      // круг пройден: все 4 слота ответили busy два круга подряд — слотов нет
      if (!sawFreeSlot) busyRounds++;
      else busyRounds = 0;
      if (busyRounds >= 2) {
        this.searching = false;
        this.pendingNoSlots = true;
        return;
      }
      await new Promise<void>((r) => setTimeout(r, 300)); // пауза перед новым кругом
    }
  }

  private searchAborted(): boolean {
    return !this.searching || this.session !== null;
  }

  private errType(e: unknown): string {
    return (e as { p2pType?: string }).p2pType ?? '';
  }

  /** Подключиться к хабу слота: peer-unavailable — слот свободен. */
  private async joinHubSlot(slot: number): Promise<void> {
    const conn = await this.connectTo(hubId(slot));
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (fn: () => void): void => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          fn();
        }
      };
      const timer = setTimeout(() => done(() => reject(this.p2pErr('timeout'))), this.timings.connectMs);
      conn.on('data', (raw) => {
        const msg = asMsg(raw);
        if (msg?.t === 'busy') {
          done(() => {
            conn.close();
            reject(this.p2pErr('busy'));
          });
        } else if (msg?.t === 'welcome') {
          done(() => {
            this.openSession(conn, msg);
            resolve();
          });
        }
      });
      conn.on('close', () => done(() => reject(this.p2pErr('peer-gone'))));
      conn.on('error', () => done(() => reject(this.p2pErr('peer-gone'))));
      conn.send({ t: 'hello', name: this.myName } satisfies Msg);
    });
  }

  /** Занять слот хабом и ждать гостя: true — спарились, false — таймаут, слот освобождён. */
  private async hostHubSlot(slot: number): Promise<boolean> {
    const peer = await this.claim(hubId(slot));
    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (fn: () => void): void => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          fn();
        }
      };
      const timer = setTimeout(
        () =>
          done(() => {
            peer.destroy();
            if (this.peer === peer) this.peer = null;
            resolve(false); // слот освобождён, ищем дальше
          }),
        this.timings.hubWaitMs,
      );
      peer.on('connection', (conn) => {
        conn.on('data', (raw) => {
          const msg = asMsg(raw);
          if (msg?.t !== 'hello') return;
          if (this.session) {
            conn.send({ t: 'busy' } satisfies Msg); // хаб уже в дуэли — гость ищет дальше
            setTimeout(() => conn.close(), 150);
            return;
          }
          done(() => {
            this.openSession(conn, this.makeWelcome(), true);
            resolve(true);
          });
        });
      });
    });
  }

  /* ——— комнаты по коду ——— */

  async createRoom(): Promise<{ matchId: string; code: string; matched: boolean }> {
    this.searching = true;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = genRoomCode();
      try {
        const peer = await this.claim(roomId(code));
        peer.on('connection', (conn) => {
          conn.on('data', (raw) => {
            const msg = asMsg(raw);
            if (msg?.t === 'hello' && !this.session) {
              this.openSession(conn, this.makeWelcome(), true);
            }
          });
        });
        return { matchId: `p2p-room-${code}`, code, matched: false };
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr ?? new Error('room-claim-failed');
  }

  async joinRoom(code: string): Promise<{ matchId: string; matched: boolean }> {
    const clean = code.trim().toUpperCase();
    this.searching = true;
    const conn = await this.connectTo(roomId(clean));
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (fn: () => void): void => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          fn();
        }
      };
      const timer = setTimeout(() => done(() => reject(this.p2pErr('timeout'))), this.timings.connectMs);
      conn.on('data', (raw) => {
        const msg = asMsg(raw);
        if (msg?.t === 'welcome') {
          done(() => {
            this.openSession(conn, msg);
            resolve();
          });
        } else if (msg?.t === 'busy') {
          done(() => {
            conn.close();
            reject(this.p2pErr('busy'));
          });
        }
      });
      conn.on('close', () => done(() => reject(this.p2pErr('peer-gone'))));
      conn.on('error', () => done(() => reject(this.p2pErr('peer-gone'))));
      conn.send({ t: 'hello', name: this.myName } satisfies Msg);
    });
    return { matchId: `p2p-room-${clean}`, matched: true };
  }

  /* ——— MatchAPI ——— */

  async pollMatch(matchId: string): Promise<MatchPoll> {
    void matchId;
    const s = this.session;
    if (!s) {
      if (this.pendingNoSlots) {
        this.pendingNoSlots = false;
        throw new Error('p2p-no-slots');
      }
      return {
        matched: false,
        seed: null,
        durationMs: null,
        startAt: null,
        opponentName: null,
        opponentScore: 0,
        opponentFinished: false,
        winner: null,
        ratingDelta: null,
      };
    }
    const winner = this.winnerOf(s);
    return {
      matched: true,
      seed: s.seed,
      durationMs: s.durationMs,
      startAt: s.startAt,
      opponentName: s.opponentName,
      opponentScore: s.opponentResult ?? s.opponentScore,
      opponentFinished: s.opponentResult !== null || s.peerGone,
      winner,
      ratingDelta:
        winner !== null && s.myScore !== null
          ? duelDelta(s.myScore, s.opponentResult ?? s.opponentScore)
          : null,
    };
  }

  async reportResult(matchId: string, score: number): Promise<MatchOutcome> {
    void matchId;
    const s = this.session;
    if (!s) throw new Error(`матч ${matchId} не найден`);
    s.myScore = score;
    this.safeSend(s.conn, { t: 'result', score });
    // ждём итог соперника (или его уход) — результат синхронен на обеих сторонах
    await new Promise<void>((resolve) => {
      if (s.opponentResult !== null || s.peerGone) return resolve();
      const timer = setTimeout(resolve, this.timings.resultMs);
      const check = setInterval(() => {
        if (s.opponentResult !== null || s.peerGone) {
          clearTimeout(timer);
          clearInterval(check);
          resolve();
        }
      }, 100);
    });
    const opponentScore = s.opponentResult ?? s.opponentScore;
    const winner =
      s.peerGone && s.opponentResult === null
        ? 'me'
        : score > opponentScore
          ? 'me'
          : score < opponentScore
            ? 'opponent'
            : 'draw';
    this.teardown();
    return { winner, myScore: score, opponentScore, ratingDelta: duelDelta(score, opponentScore) };
  }

  notifyProgress(matchId: string, score: number): void {
    const s = this.session;
    void matchId;
    if (s && s.myScore === null) this.safeSend(s.conn, { t: 'score', score });
  }

  /** Отмена поиска/матча (закрыли лобби) — рвём всё, освобождаем слоты. */
  cancel(matchId?: string): void {
    void matchId;
    this.searching = false;
    this.pendingNoSlots = false;
    this.session = null;
    this.peer?.destroy();
    this.peer = null;
    this.peerOpen = false;
  }

  /* ——— внутренности ——— */

  private peer: P2PPeer | null = null;
  private session: P2PSession | null = null;
  private searching = false;
  private pendingNoSlots = false;
  /** WS сигналинга у текущего peer открыт (connect() до open теряет OFFER). */
  private peerOpen = false;
  private readonly myName: string;

  constructor(
    private readonly factory: PeerFactory,
    private readonly timings: P2PTimings = DEFAULT_TIMINGS,
  ) {
    this.myName = getPlayerIdentity().name;
  }

  private p2pErr(type: string): Error {
    // Отладочный хвост последней ошибки P2P (как window.__errs) — видно в консоли смоука
    (window as unknown as { __p2pLastErr?: string }).__p2pLastErr = type;
    const e = new Error(`p2p:${type}`);
    (e as { p2pType?: string }).p2pType = type;
    return e;
  }

  private makeWelcome(): Extract<Msg, { t: 'welcome' }> {
    return {
      t: 'welcome',
      seed: (Math.random() * 4294967296) >>> 0,
      durationMs: BALANCE.duelDurationMs,
      startAt: Date.now() + BALANCE.duelCountdownMs,
      opponentName: this.myName,
    };
  }

  private openSession(
    conn: P2PDataConnection,
    welcome: Extract<Msg, { t: 'welcome' }>,
    sendWelcome = false,
  ): P2PSession {
    const s: P2PSession = {
      conn,
      seed: welcome.seed,
      durationMs: welcome.durationMs,
      startAt: welcome.startAt,
      opponentName: welcome.opponentName,
      opponentScore: 0,
      opponentResult: null,
      myScore: null,
      peerGone: false,
    };
    this.session = s;
    this.searching = false;
    this.pendingNoSlots = false;
    conn.on('data', (raw) => {
      const msg = asMsg(raw);
      if (!msg) return;
      if (msg.t === 'score') s.opponentScore = Math.max(s.opponentScore, msg.score);
      else if (msg.t === 'result') s.opponentResult = msg.score;
    });
    conn.on('close', () => {
      s.peerGone = true;
    });
    conn.on('error', () => {
      s.peerGone = true;
    });
    // хост отвечает на hello своим welcome (гость ждёт его в joinHubSlot/joinRoom)
    if (sendWelcome) this.safeSend(conn, welcome);
    return s;
  }

  private safeSend(conn: P2PDataConnection, msg: Msg): void {
    try {
      conn.send(msg);
    } catch {
      /* канал умер — peerGone проставит close/error */
    }
  }

  private winnerOf(s: P2PSession): 'me' | 'opponent' | 'draw' | null {
    if (s.myScore === null) return null;
    const known = s.opponentResult !== null || s.peerGone;
    if (!known) return null;
    const opponent = s.opponentResult ?? s.opponentScore;
    if (s.peerGone && s.opponentResult === null) return 'me';
    if (s.myScore > opponent) return 'me';
    if (s.myScore < opponent) return 'opponent';
    return 'draw';
  }

  /** Занять peer-id (open) или ошибка unavailable-id/сети. */
  private async claim(id: string): Promise<P2PPeer> {
    const peer = await this.factory(id);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (fn: () => void): void => {
        if (!settled) {
          settled = true;
          fn();
        }
      };
      peer.on('open', () => {
        this.peerOpen = true;
        done(resolve);
      });
      peer.on('error', (err) => done(() => reject(this.p2pErr(err.type ?? 'error'))));
    });
    this.peer = peer;
    return peer;
  }

  /** Подключиться к чужому peer-id; peer-unavailable → p2pType='peer-unavailable'. */
  private async connectTo(id: string): Promise<P2PDataConnection> {
    if (!this.peer || this.peerOpen !== true) {
      this.peer = await this.factory();
      this.peerOpen = false;
      // ждём open сигналинга: connect() до открытия теряет OFFER
      await new Promise<void>((resolve, reject) => {
        const peer = this.peer!;
        peer.on('open', () => {
          this.peerOpen = true;
          resolve();
        });
        peer.on('error', (err) => {
          if (err.type !== 'peer-unavailable') {
            // авто-id: ошибки сети fatal, peer-unavailable касается только connectTo
            reject(this.p2pErr(err.type ?? 'error'));
          }
        });
      });
    }
    const peer = this.peer;
    return await new Promise<P2PDataConnection>((resolve, reject) => {
      let settled = false;
      const done = (fn: () => void): void => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          peer.off?.('error', onError);
          fn();
        }
      };
      const timer = setTimeout(() => done(() => reject(this.p2pErr('timeout'))), this.timings.connectMs);
      const onError = (err: { type?: string }): void => {
        if (err.type === 'peer-unavailable') done(() => reject(this.p2pErr('peer-unavailable')));
      };
      peer.on('error', onError);
      const conn = peer.connect(id, { reliable: true });
      conn.on('open', () => done(() => resolve(conn)));
      conn.on('error', () => done(() => reject(this.p2pErr('conn-error'))));
    });
  }

  private teardown(): void {
    this.session = null;
    this.searching = false;
    this.peer?.destroy();
    this.peer = null;
    this.peerOpen = false;
  }
}
