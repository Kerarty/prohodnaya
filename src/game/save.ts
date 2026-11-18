import type { SaveData } from '../platform';

export interface ToolState {
  lens: boolean;
  detector: boolean;
  /** Синки за жетоны (план v2 В5): кофе — терпение +5 с, перчатка — +1 ошибка. */
  coffee: boolean;
  glove: boolean;
}

/** Задания дня (план v2 В2): прогресс и получение наград за календарный день. */
export interface MissionSave {
  date: string;
  /** Прогресс: [верные решения, безошибочные смены, пойманные подделки]. */
  progress: [number, number, number];
  /** Награда получена. */
  claimed: [boolean, boolean, boolean];
}

/** Незавершённая смена — восстановление с той же заявки (ГДД разд. 9). */
export interface ShiftProgress {
  seed: number;
  shift: number;
  isDaily: boolean;
  isNight: boolean;
  today: number;
  appIndex: number;
  correct: number;
  errors: number;
  earnedTokens: number;
  earnedXp: number;
  fastCount: number;
}

/** Мультиплеерная статистика (план мультиплеера, фазы 1–2). */
export interface MultiplayerSave {
  blitzBest: number;
  blitzRuns: number;
  /** Рейтинг блица: самокалибруется к фактическому уровню игрока. */
  blitzRating: number;
  duelWins: number;
  duelLosses: number;
  duelDraws: number;
  duelRating: number;
  /** Стабильное имя игрока (топ-50, соперники в дуэлях); null — ещё не сгенерировано. */
  name: string | null;
}

/** Состояние рекламы для interstitial-политики (ГДД разд. 7). */
export interface AdState {
  /** Время последнего показа любой рекламы (interstitial и rewarded). */
  lastAdAt: number;
  /** Завершённых смен с момента последнего interstitial. */
  shiftsSince: number;
}

/** Схема облачного сейва v1 (ГДД разд. 6). ~1 КБ — далеко до лимита 200 КБ. */
export interface SaveDataV1 {
  version: 1;
  tokens: number;
  xp: number;
  shiftNumber: number;
  /** День (epoch-дни) первого запуска — от него считается игровой «today». */
  todayBase: number;
  currentStreak: number;
  bestStreak: number;
  tools: ToolState;
  currentShift: ShiftProgress | null;
  /** Задания дня (план v2 В2); null — до первого запуска за день. */
  missions: MissionSave | null;
  /** Счётчик поимок по правилам (план v2 В8) — ключ = rule.id. */
  ruleCatch: Record<string, number>;
  /** Ключ даты 'YYYY-MM-DD' последней сыгранной дневной смены. */
  dailyPlayed: string | null;
  /** Ключ даты последней ночной смены (1 в день, ГДД разд. 7). */
  nightPlayed: string | null;
  mp: MultiplayerSave;
  /** Звуковые эффекты включены (настройки). */
  soundOn: boolean;
  /** Рекламные счётчики (interstitial-политика). */
  ad: AdState;
  /** Выбранная локаль ('ru'|'en'|...); null — язык платформы. */
  lang: string | null;
}

/** Локальные epoch-дни: границы суток по таймзоне игрока — согласованы с dateKey()
 * (UTC-дни переключались в 03:00 МСК и рассинхронизировались с dailyPlayed). */
export function epochDays(now = Date.now(), tzOffsetMin = new Date(now).getTimezoneOffset()): number {
  return Math.floor((now - tzOffsetMin * 60_000) / 86_400_000);
}

/** Локальный ключ календарного дня — флаг дневной смены. */
export function dateKey(now = new Date()): string {
  const y = now.getFullYear();
  const m = `${now.getMonth() + 1}`.padStart(2, '0');
  const d = `${now.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Дневной сид: одинаков у всех игроков в этот день, сервер не нужен (ГДД разд. 3.3). */
export function dailySeed(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Math.imul(y * 10_000 + m * 100 + d, 2_654_435_761) >>> 0;
}

export function defaultSave(todayBase: number): SaveDataV1 {
  return {
    version: 1,
    tokens: 0,
    xp: 0,
    shiftNumber: 1,
    todayBase,
    currentStreak: 0,
    bestStreak: 0,
    tools: { lens: false, detector: false, coffee: false, glove: false },
    currentShift: null,
    missions: null,
    ruleCatch: {},
    dailyPlayed: null,
    nightPlayed: null,
    mp: {
      blitzBest: 0,
      blitzRuns: 0,
      blitzRating: 1000,
      duelWins: 0,
      duelLosses: 0,
      duelDraws: 0,
      duelRating: 1000,
      name: null,
    },
    soundOn: true,
    ad: { lastAdAt: 0, shiftsSince: 0 },
    lang: null,
  };
}

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const int = (v: unknown, fallback: number, min: number): number =>
  Math.max(min, Math.floor(num(v, fallback)));
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/** Миграция/валидация: битые поля заменяются дефолтами, игра не падает. */
export function normalizeSave(raw: unknown, todayBase: number): SaveDataV1 {
  const def = defaultSave(todayBase);
  if (typeof raw !== 'object' || raw === null) return def;
  const r = raw as Record<string, unknown>;
  const tools = (typeof r.tools === 'object' && r.tools !== null ? r.tools : {}) as Record<string, unknown>;
  const cs = (typeof r.currentShift === 'object' && r.currentShift !== null
    ? r.currentShift
    : null) as Record<string, unknown> | null;

  return {
    version: 1,
    tokens: int(r.tokens, def.tokens, 0),
    xp: int(r.xp, def.xp, 0),
    shiftNumber: int(r.shiftNumber, def.shiftNumber, 1),
    todayBase: int(r.todayBase, todayBase, 0),
    currentStreak: int(r.currentStreak, 0, 0),
    bestStreak: int(r.bestStreak, 0, 0),
    tools: {
      lens: bool(tools.lens, false),
      detector: bool(tools.detector, false),
      coffee: bool(tools.coffee, false),
      glove: bool(tools.glove, false),
    },
    currentShift: cs
      ? {
          seed: int(cs.seed, 0, 0) >>> 0,
          shift: int(cs.shift, 1, 1),
          isDaily: bool(cs.isDaily, false),
          isNight: bool(cs.isNight, false),
          today: int(cs.today, 1, 1),
          appIndex: int(cs.appIndex, 0, 0),
          correct: int(cs.correct, 0, 0),
          errors: int(cs.errors, 0, 0),
          earnedTokens: int(cs.earnedTokens, 0, 0),
          earnedXp: int(cs.earnedXp, 0, 0),
          fastCount: int(cs.fastCount, 0, 0),
        }
      : null,
    dailyPlayed: typeof r.dailyPlayed === 'string' ? r.dailyPlayed : null,
    nightPlayed: typeof r.nightPlayed === 'string' ? r.nightPlayed : null,
    missions: readMissions(r.missions),
    ruleCatch: readRuleCatch(r.ruleCatch),
    mp: readMp(r.mp),
    soundOn: bool(r.soundOn, true),
    ad: readAd(r.ad),
    lang: typeof r.lang === 'string' ? r.lang : null,
  };
}

function readMissions(raw: unknown): MissionSave | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.date !== 'string') return null;
  const triplet = (v: unknown, def: number[]): [number, number, number] =>
    Array.isArray(v) && v.length === 3 ? [num(v[0], def[0]), num(v[1], def[1]), num(v[2], def[2])] : [def[0], def[1], def[2]];
  const bools = (v: unknown): [boolean, boolean, boolean] =>
    Array.isArray(v) && v.length === 3 ? [bool(v[0], false), bool(v[1], false), bool(v[2], false)] : [false, false, false];
  return {
    date: m.date,
    progress: triplet(m.progress, [0, 0, 0]),
    claimed: bools(m.claimed),
  };
}

function readRuleCatch(raw: unknown): Record<string, number> {
  if (typeof raw !== 'object' || raw === null) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (/^\d+$/.test(k)) out[k] = int(v, 0, 0);
  }
  return out;
}

function readMp(raw: unknown): MultiplayerSave {
  const def = defaultSave(0).mp;
  const m = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    blitzBest: int(m.blitzBest, def.blitzBest, 0),
    blitzRuns: int(m.blitzRuns, def.blitzRuns, 0),
    blitzRating: int(m.blitzRating, def.blitzRating, 0),
    name: typeof m.name === 'string' ? m.name.slice(0, 24) || null : null,
    duelWins: int(m.duelWins, def.duelWins, 0),
    duelLosses: int(m.duelLosses, def.duelLosses, 0),
    duelDraws: int(m.duelDraws, def.duelDraws, 0),
    duelRating: int(m.duelRating, def.duelRating, 0),
  };
}

function readAd(raw: unknown): AdState {
  const def = defaultSave(0).ad;
  const a = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    lastAdAt: int(a.lastAdAt, def.lastAdAt, 0),
    shiftsSince: int(a.shiftsSince, def.shiftsSince, 0),
  };
}

/** Приведение к контракту PlatformAPI. */
export function toPlatformSave(data: SaveDataV1): SaveData {
  const copy: SaveData = { ...data };
  return copy;
}
