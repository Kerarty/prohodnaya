import type { SaveData } from '../platform';

export interface ToolState {
  lens: boolean;
  detector: boolean;
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
  /** Ключ даты 'YYYY-MM-DD' последней сыгранной дневной смены. */
  dailyPlayed: string | null;
  /** Ключ даты последней ночной смены (1 в день, ГДД разд. 7). */
  nightPlayed: string | null;
}

export function epochDays(now = Date.now()): number {
  return Math.floor(now / 86_400_000);
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
    tools: { lens: false, detector: false },
    currentShift: null,
    dailyPlayed: null,
    nightPlayed: null,
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
  };
}

/** Приведение к контракту PlatformAPI. */
export function toPlatformSave(data: SaveDataV1): SaveData {
  const copy: SaveData = { ...data };
  return copy;
}
