import type { CharacterAttrs } from './attributes';
import type { PassDoc } from './application';
import type { Rng } from './rng';
import { shuffle } from './rng';

/** Что проверяет правило: гостя, документ и «сегодня» (день от первого запуска, ГДД разд. 3.1). */
export interface RuleContext {
  guest: CharacterAttrs;
  doc: PassDoc;
  today: number;
}

export type RuleDifficulty = 1 | 2 | 3 | 4 | 5;
export type RuleDocField = 'expiry' | 'signature';

export interface Rule {
  id: number;
  /** Формулировка на доске — ≤ 8 слов (ГДД разд. 4). */
  text: string;
  difficulty: RuleDifficulty;
  /** Номер смены, с которой правило входит в ротацию (ГДД разд. 4). */
  fromShift: number;
  /** Признаки для пиктограммы; ключи = гостевые поля, закрытые активным правилом (инвариант 3.4.1). */
  icon: Partial<CharacterAttrs>;
  /** Документные признаки, которые правило задевает — нарушители делаются дефектным пропуском. */
  docs?: readonly RuleDocField[];
  /** Для правил срока: 'expired' — просрочка, 'short' — «короче 3 дней». */
  expiryKind?: 'expired' | 'short';
  /** Машинный предикат отказа: true — не пускать. */
  rejects(ctx: RuleContext): boolean;
}

/**
 * Полный каталог v1 — 25 правил в 5 тирах (ГДД разд. 4). Комбинаторные правила
 * тиров 4–5 имеют 1–2 признака в icon; документные помечены docs.
 */
export const RULE_BLUE_HEADS: Rule = {
  id: 1,
  text: 'Не пускать синие головы',
  difficulty: 1,
  fromShift: 1,
  icon: { headColor: 'blue' },
  rejects: (ctx) => ctx.guest.headColor === 'blue',
};

export const RULE_TRIANGLE_HEADS: Rule = {
  id: 2,
  text: 'Не пускать треугольные головы',
  difficulty: 1,
  fromShift: 2,
  icon: { headForm: 'triangle' },
  rejects: (ctx) => ctx.guest.headForm === 'triangle',
};

export const RULE_RED_BODIES: Rule = {
  id: 3,
  text: 'Не пускать красные тела',
  difficulty: 1,
  fromShift: 2,
  icon: { bodyColor: 'red' },
  rejects: (ctx) => ctx.guest.bodyColor === 'red',
};

export const RULE_OVAL_BODIES: Rule = {
  id: 4,
  text: 'Не пускать овальные тела',
  difficulty: 1,
  fromShift: 3,
  icon: { bodyForm: 'oval' },
  rejects: (ctx) => ctx.guest.bodyForm === 'oval',
};

export const RULE_HEXAGON_HEADS: Rule = {
  id: 5,
  text: 'Не пускать шестиугольные головы',
  difficulty: 1,
  fromShift: 4,
  icon: { headForm: 'hexagon' },
  rejects: (ctx) => ctx.guest.headForm === 'hexagon',
};

export const RULE_HATS: Rule = {
  id: 6,
  text: 'Не пускать головы в шляпах',
  difficulty: 2,
  fromShift: 4,
  icon: { accessory: 'hat' },
  rejects: (ctx) => ctx.guest.accessory === 'hat',
};

export const RULE_GREEN_BODIES: Rule = {
  id: 7,
  text: 'Не пускать зелёные тела',
  difficulty: 2,
  fromShift: 5,
  icon: { bodyColor: 'green' },
  rejects: (ctx) => ctx.guest.bodyColor === 'green',
};

export const RULE_EXPIRED: Rule = {
  id: 8,
  text: 'Не пускать просроченные пропуска',
  difficulty: 2,
  fromShift: 5,
  icon: {},
  docs: ['expiry'],
  expiryKind: 'expired',
  rejects: (ctx) => ctx.doc.expiry < ctx.today,
};

export const RULE_UNSIGNED: Rule = {
  id: 9,
  text: 'Не пускать пропуска без подписи',
  difficulty: 2,
  fromShift: 6,
  icon: {},
  docs: ['signature'],
  rejects: (ctx) => !ctx.doc.signature,
};

export const RULE_SQUARE_HEADS: Rule = {
  id: 10,
  text: 'Не пускать квадратные головы',
  difficulty: 2,
  fromShift: 7,
  icon: { headForm: 'square' },
  rejects: (ctx) => ctx.guest.headForm === 'square',
};

export const RULE_PURPLE_HEADS: Rule = {
  id: 11,
  text: 'Не пускать фиолетовые головы',
  difficulty: 2,
  fromShift: 8,
  icon: { headColor: 'purple' },
  rejects: (ctx) => ctx.guest.headColor === 'purple',
};

export const RULE_ANTENNAS: Rule = {
  id: 12,
  text: 'Не пускать головы с антеннами',
  difficulty: 2,
  fromShift: 8,
  icon: { accessory: 'antenna' },
  rejects: (ctx) => ctx.guest.accessory === 'antenna',
};

export const RULE_TRAPEZOID_BODIES: Rule = {
  id: 13,
  text: 'Не пускать трапециевидные тела',
  difficulty: 3,
  fromShift: 9,
  icon: { bodyForm: 'trapezoid' },
  rejects: (ctx) => ctx.guest.bodyForm === 'trapezoid',
};

export const RULE_YELLOW_BODIES: Rule = {
  id: 14,
  text: 'Не пускать жёлтые тела',
  difficulty: 3,
  fromShift: 9,
  icon: { bodyColor: 'yellow' },
  rejects: (ctx) => ctx.guest.bodyColor === 'yellow',
};

export const RULE_ORANGE_HEADS: Rule = {
  id: 15,
  text: 'Не пускать оранжевые головы',
  difficulty: 3,
  fromShift: 10,
  icon: { headColor: 'orange' },
  rejects: (ctx) => ctx.guest.headColor === 'orange',
};

export const RULE_SHORT_PASS: Rule = {
  id: 16,
  text: 'Не пускать пропуска короче 3 дней',
  difficulty: 3,
  fromShift: 11,
  icon: {},
  docs: ['expiry'],
  expiryKind: 'short',
  rejects: (ctx) => ctx.doc.expiry - ctx.today < 3,
};

export const RULE_STRIPE_EYES: Rule = {
  id: 17,
  text: 'Не пускать глаза-полоски',
  difficulty: 3,
  fromShift: 12,
  icon: { eyes: 'stripes' },
  rejects: (ctx) => ctx.guest.eyes === 'stripes',
};

export const RULE_HATS_EXCEPT_RED: Rule = {
  id: 18,
  text: 'Шляпы запрещены, кроме красных голов',
  difficulty: 4,
  fromShift: 13,
  icon: { accessory: 'hat', headColor: 'red' },
  rejects: (ctx) => ctx.guest.accessory === 'hat' && ctx.guest.headColor !== 'red',
};

export const RULE_CIRCLE_ANTENNA: Rule = {
  id: 19,
  text: 'Круглые головы с антеннами не пускать',
  difficulty: 4,
  fromShift: 14,
  icon: { headForm: 'circle', accessory: 'antenna' },
  rejects: (ctx) => ctx.guest.headForm === 'circle' && ctx.guest.accessory === 'antenna',
};

export const RULE_SAME_COLOR: Rule = {
  id: 20,
  text: 'Не пускать, если тело и голова одного цвета',
  difficulty: 4,
  fromShift: 15,
  icon: { headColor: 'red', bodyColor: 'red' },
  rejects: (ctx) => ctx.guest.bodyColor === ctx.guest.headColor,
};

export const RULE_EXPIRED_UNSIGNED: Rule = {
  id: 21,
  text: 'Просроченное без подписи не пускать',
  difficulty: 4,
  fromShift: 16,
  icon: {},
  docs: ['expiry', 'signature'],
  expiryKind: 'expired',
  rejects: (ctx) => ctx.doc.expiry < ctx.today && !ctx.doc.signature,
};

export const RULE_GREEN_BODY_SQUARE_HEAD: Rule = {
  id: 22,
  text: 'Зелёные тела с квадратной головой не пускать',
  difficulty: 5,
  fromShift: 17,
  icon: { bodyColor: 'green', headForm: 'square' },
  rejects: (ctx) => ctx.guest.bodyColor === 'green' && ctx.guest.headForm === 'square',
};

export const RULE_HEXAGON_STRIPE_EYES: Rule = {
  id: 23,
  text: 'Шестиугольники с глазами-полосками не пускать',
  difficulty: 5,
  fromShift: 18,
  icon: { headForm: 'hexagon', eyes: 'stripes' },
  rejects: (ctx) => ctx.guest.headForm === 'hexagon' && ctx.guest.eyes === 'stripes',
};

export const RULE_ORANGE_BODY_ANTENNA: Rule = {
  id: 24,
  text: 'Оранжевые тела с антеннами не пускать',
  difficulty: 5,
  fromShift: 19,
  icon: { bodyColor: 'orange', accessory: 'antenna' },
  rejects: (ctx) => ctx.guest.bodyColor === 'orange' && ctx.guest.accessory === 'antenna',
};

export const RULE_PURPLE_UNSIGNED: Rule = {
  id: 25,
  text: 'Не пускать фиолетовые головы без подписи',
  difficulty: 5,
  fromShift: 20,
  icon: { headColor: 'purple' },
  docs: ['signature'],
  rejects: (ctx) => ctx.guest.headColor === 'purple' && !ctx.doc.signature,
};

export const CATALOG: readonly Rule[] = [
  RULE_BLUE_HEADS,
  RULE_TRIANGLE_HEADS,
  RULE_RED_BODIES,
  RULE_OVAL_BODIES,
  RULE_HEXAGON_HEADS,
  RULE_HATS,
  RULE_GREEN_BODIES,
  RULE_EXPIRED,
  RULE_UNSIGNED,
  RULE_SQUARE_HEADS,
  RULE_PURPLE_HEADS,
  RULE_ANTENNAS,
  RULE_TRAPEZOID_BODIES,
  RULE_YELLOW_BODIES,
  RULE_ORANGE_HEADS,
  RULE_SHORT_PASS,
  RULE_STRIPE_EYES,
  RULE_HATS_EXCEPT_RED,
  RULE_CIRCLE_ANTENNA,
  RULE_SAME_COLOR,
  RULE_EXPIRED_UNSIGNED,
  RULE_GREEN_BODY_SQUARE_HEAD,
  RULE_HEXAGON_STRIPE_EYES,
  RULE_ORANGE_BODY_ANTENNA,
  RULE_PURPLE_UNSIGNED,
];

/** Конфликт (ГДД 3.4.2): правила задевают пересекающиеся гостевые или документные признаки. */
export function rulesConflict(a: Rule, b: Rule): boolean {
  const attrsB = new Set(Object.keys(b.icon));
  for (const key of Object.keys(a.icon)) {
    if (attrsB.has(key)) return true;
  }
  const docsA = new Set(a.docs ?? []);
  for (const field of b.docs ?? []) {
    if (docsA.has(field)) return true;
  }
  return false;
}

/**
 * Активный набор правил смены (ГДД разд. 2, 4): смена 1 — 1 правило, 2–3 — 2, далее 3.
 * Без rng — новейшие введённые (детерминированная серия для тестов); с rng —
 * «2 новейших + 1 случайное из ранее освоенных» (ротация), ≤1 правила сложности 5.
 */
export function rulesForShift(shift: number, rng?: Rng): Rule[] {
  const size = shift <= 1 ? 1 : shift <= 3 ? 2 : 3;
  const mastered = CATALOG.filter((r) => r.fromShift <= shift);
  const newest = mastered.slice().sort((a, b) => b.fromShift - a.fromShift || b.id - a.id);
  const set: Rule[] = [];

  const canAdd = (rule: Rule): boolean =>
    !set.some((s) => rulesConflict(s, rule)) &&
    !(rule.difficulty === 5 && set.some((s) => s.difficulty === 5));

  const newestQuota = rng ? Math.min(2, size) : size;
  for (const rule of newest) {
    if (set.length >= newestQuota) break;
    if (canAdd(rule)) set.push(rule);
  }

  if (rng && set.length < size) {
    // Ротация: слот добирается случайным правилом из ранее освоенных (ГДД разд. 4)
    for (const rule of shuffle(mastered.filter((r) => !set.includes(r)), rng)) {
      if (set.length >= size) break;
      if (canAdd(rule)) set.push(rule);
    }
  } else {
    for (const rule of newest) {
      if (set.length >= size) break;
      if (canAdd(rule)) set.push(rule);
    }
  }

  return set.slice().sort((a, b) => a.id - b.id);
}
