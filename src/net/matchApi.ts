/**
 * MatchAPI — сетевой слой дуэлей (план мультиплеера, фаза 2).
 * Три реализации: LocalMatchAPI (соперник-бот, без сети), HttpMatchAPI
 * (бандл-сервер из server/index.mjs — если он доступен) и P2PMatchAPI
 * (WebRTC через peerjs — основной путь реальных дуэлей без серверов).
 * Выбор: probe() к серверу; нет сервера → P2P; P2P упал → бот.
 */

import { BALANCE, duelDelta } from '../game/economy';
import { mulberry32 } from '../game/rng';

export interface MatchPlayerState {
  playerId: string;
  name: string;
  score: number;
  finished: boolean;
}

export interface MatchOutcome {
  winner: 'me' | 'opponent' | 'draw';
  myScore: number;
  opponentScore: number;
  ratingDelta: number;
}

export interface MatchPoll {
  /** Соперник найден (для бота всегда true). */
  matched: boolean;
  seed: number | null;
  durationMs: number | null;
  /** Epoch ms старта забега (после matched). */
  startAt: number | null;
  opponentName: string | null;
  /** Живой счёт соперника — для индикатора прогресса. */
  opponentScore: number;
  opponentFinished: boolean;
  /** Заполнено после reportResult, когда известен результат соперника. */
  winner: 'me' | 'opponent' | 'draw' | null;
  ratingDelta: number | null;
}

export interface MatchAPI {
  /** Бот-соперник (без сети) или живой соперник через сервер/P2P. */
  readonly botOpponent: boolean;
  /** HTTP-реализация проверяет доступность сервера; P2P/локальная всегда true. */
  probe(): Promise<boolean>;
  /** Быстрый матч. matched=false — ждём соперника (поллим pollMatch). */
  quickMatch(): Promise<{ matchId: string; matched: boolean }>;
  /** Состояние матча: matched/старт + живой счёт соперника. */
  pollMatch(matchId: string): Promise<MatchPoll>;
  /** Отправить свой скор; дельта рейтинга — когда итог известен. */
  reportResult(matchId: string, score: number): Promise<MatchOutcome>;
  /** Живой скор сопернику (P2P-канал); остальным реализациям не нужен. */
  notifyProgress?(matchId: string, score: number): void;
  /** Отмена поиска/матча (лобби закрыто) — P2P рвёт соединения и слоты. */
  cancel?(matchId?: string): void;
  /** Создать комнату с кодом (лобби «Создать комнату»); боту недоступно. */
  createRoom?(): Promise<{ matchId: string; code: string; matched: boolean }>;
  /** Войти в комнату по коду; ошибка — комната не найдена/занята. */
  joinRoom?(code: string): Promise<{ matchId: string; matched: boolean }>;
}

/** Личность игрока: id на вкладку (для локальных дуэлей) и отображаемое имя. */
export function getPlayerIdentity(): { playerId: string; name: string } {
  let pid: string | null = null;
  try {
    pid = sessionStorage.getItem('prohodnaya.pid');
  } catch {
    /* node-тесты / приватный режим — id без хранилища */
  }
  if (!pid) {
    pid = Math.floor(Math.random() * 1679616)
      .toString(36)
      .padStart(4, '0')
      .toUpperCase();
    try {
      sessionStorage.setItem('prohodnaya.pid', pid);
    } catch {
      /* см. выше */
    }
  }
  return { playerId: `tab-${pid}`, name: `Дежурный-${pid}` };
}

/** Адрес бандл-сервера: ?server=URL в адресе или localhost:8787 по умолчанию. */
export function matchServerUrl(): string {
  const fromQuery = new URLSearchParams(window.location.search).get('server');
  return fromQuery ?? localStorage.getItem('matchServerUrl') ?? 'http://localhost:8787';
}

/** Фабрика: сервер доступен → HTTP-дуэли; нет → P2P (WebRTC); P2P упал → бот. */
export async function createMatchAPI(): Promise<MatchAPI> {
  const { playerId, name } = getPlayerIdentity();
  const http = new HttpMatchAPI(matchServerUrl(), playerId, name);
  if (await http.probe()) return http;
  try {
    const { P2PMatchAPI, defaultPeerFactory } = await import('./p2p');
    return new P2PMatchAPI(defaultPeerFactory);
  } catch (e) {
    console.warn('[net] P2P недоступен, дуэли с ботом', e);
    return new LocalMatchAPI();
  }
}

interface LocalMatch {
  seed: number;
  durationMs: number;
  startAt: number;
  opponentName: string;
  /** Моменты завершения заявок ботом (мс от старта забега). */
  perAppMs: number[];
  correct: boolean[];
  myScore: number | null;
}

/** Соперник-бот: темп и точность детерминированы сидом матча. */
export class LocalMatchAPI implements MatchAPI {
  readonly botOpponent = true;

  /** Матчи общие для всех экземпляров API: матч создаётся в кабинете, играется в GameScene. */
  private static matches = new Map<string, LocalMatch>();

  async probe(): Promise<boolean> {
    return true;
  }

  async quickMatch(): Promise<{ matchId: string; matched: boolean }> {
    const matchId = `bot-${Math.floor(Math.random() * 1e9).toString(36)}`;
    const seed = (Math.random() * 4294967296) >>> 0;
    const rng = mulberry32(seed);
    const perAppMs: number[] = [];
    const correct: boolean[] = [];
    let t = 0;
    for (let i = 0; i < 60; i++) {
      t += 2500 + rng() * 4000;
      perAppMs.push(t);
      correct.push(rng() < 0.8);
    }
    LocalMatchAPI.matches.set(matchId, {
      seed,
      durationMs: BALANCE.duelDurationMs,
      startAt: Date.now() + BALANCE.duelCountdownMs,
      opponentName: 'Бот-дежурный',
      perAppMs,
      correct,
      myScore: null,
    });
    return { matchId, matched: true };
  }

  async pollMatch(matchId: string): Promise<MatchPoll> {
    const m = LocalMatchAPI.matches.get(matchId);
    if (!m) throw new Error(`матч ${matchId} не найден`);
    const winner = this.winnerOf(m);
    return {
      matched: true,
      seed: m.seed,
      durationMs: m.durationMs,
      startAt: m.startAt,
      opponentName: m.opponentName,
      opponentScore: this.botScoreAt(m, Math.min(Date.now() - m.startAt, m.durationMs)),
      opponentFinished: winner !== null,
      winner,
      ratingDelta:
        m.myScore !== null && winner !== null
          ? duelDelta(m.myScore, this.botFinal(m))
          : null,
    };
  }

  async reportResult(matchId: string, score: number): Promise<MatchOutcome> {
    const m = LocalMatchAPI.matches.get(matchId);
    if (!m) throw new Error(`матч ${matchId} не найден`);
    m.myScore = score;
    const opponentScore = this.botFinal(m);
    const winner = score > opponentScore ? 'me' : score < opponentScore ? 'opponent' : 'draw';
    return { winner, myScore: score, opponentScore, ratingDelta: duelDelta(score, opponentScore) };
  }

  private botScoreAt(m: LocalMatch, elapsedMs: number): number {
    let score = 0;
    for (let i = 0; i < m.perAppMs.length; i++) {
      if (m.perAppMs[i] <= Math.max(0, elapsedMs) && m.correct[i]) score += 10;
    }
    return score;
  }

  private botFinal(m: LocalMatch): number {
    return this.botScoreAt(m, m.durationMs);
  }

  private winnerOf(m: LocalMatch): 'me' | 'opponent' | 'draw' | null {
    if (m.myScore === null) return null;
    const opponent = this.botFinal(m);
    if (m.myScore > opponent) return 'me';
    if (m.myScore < opponent) return 'opponent';
    return 'draw';
  }
}

/** Живой соперник через бандл-сервер (server/index.mjs). */
export class HttpMatchAPI implements MatchAPI {
  readonly botOpponent = false;

  constructor(
    private baseUrl: string,
    private playerId: string,
    private name: string,
  ) {}

  async probe(): Promise<boolean> {
    try {
      const r = await fetch(`${this.baseUrl}/api/ping`, {
        signal: AbortSignal.timeout(800),
      });
      return r.ok;
    } catch {
      return false;
    }
  }

  async quickMatch(): Promise<{ matchId: string; matched: boolean }> {
    const r = await this.post<{ matchId: string; status: string }>('/api/match/quick', { playerId: this.playerId, name: this.name });
    return { matchId: r.matchId, matched: r.status === 'matched' };
  }

  async pollMatch(matchId: string): Promise<MatchPoll> {
    const r = await fetch(`${this.baseUrl}/api/match/${matchId}?playerId=${encodeURIComponent(this.playerId)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const s = await r.json();
    const matched = s.status !== 'waiting';
    const me = (s.players ?? []).find((p: MatchPlayerState) => p.playerId === this.playerId);
    const opponent = (s.players ?? []).find((p: MatchPlayerState) => p.playerId !== this.playerId);
    const winnerRaw: string | null = s.winner ?? null;
    const winner = winnerRaw === null ? null : winnerRaw === 'draw' ? 'draw' : winnerRaw === this.playerId ? 'me' : 'opponent';
    const ratingDelta =
      winner !== null && me && typeof s.rating === 'object' && s.rating
        ? (s.rating.delta ?? duelDelta(me.score, opponent?.score ?? 0))
        : null;
    return {
      matched,
      seed: matched ? (s.seed ?? null) : null,
      durationMs: matched ? (s.durationMs ?? null) : null,
      startAt: matched ? (s.startAt ?? null) : null,
      opponentName: matched ? (opponent?.name ?? null) : null,
      opponentScore: opponent?.score ?? 0,
      opponentFinished: Boolean(opponent?.finished),
      winner,
      ratingDelta,
    };
  }

  async reportResult(matchId: string, score: number): Promise<MatchOutcome> {
    const r = await this.post<{ winner: string | null; players?: MatchPlayerState[]; rating?: { delta: number } | null }>(
      `/api/match/${matchId}/result`,
      { playerId: this.playerId, score },
    );
    const winnerRaw: string | null = r.winner ?? null;
    const opponent = (r.players ?? []).find((p: MatchPlayerState) => p.playerId !== this.playerId);
    const winner: MatchOutcome['winner'] | null =
      winnerRaw === null ? null : winnerRaw === 'draw' ? 'draw' : winnerRaw === this.playerId ? 'me' : 'opponent';
    const outcome: MatchOutcome = {
      winner: winner ?? 'draw',
      myScore: score,
      opponentScore: opponent?.score ?? 0,
      ratingDelta: r.rating ? (r.rating.delta ?? 0) : 0,
    };
    return outcome;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const r = await fetch(this.baseUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
}
