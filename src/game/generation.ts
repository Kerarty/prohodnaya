import { docFromGuest, makeFixedQueue } from './application';
import type { Application, PassDoc } from './application';
import type {
  AccessoryType,
  BodyForm,
  CharacterAttrs,
  ColorName,
  EyesType,
  HeadForm,
} from './attributes';
import { pickInt, pickOf, rngFor, shuffle } from './rng';
import type { Rng } from './rng';
import { rulesForShift } from './rules';
import type { Rule } from './rules';

const COLORS: readonly ColorName[] = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
const HEAD_FORMS: readonly HeadForm[] = ['circle', 'square', 'triangle', 'hexagon'];
const BODY_FORMS: readonly BodyForm[] = ['rect', 'trapezoid', 'oval'];
const EYE_TYPES: readonly EyesType[] = ['dots', 'stripes'];
const ACCESSORY_TYPES: readonly AccessoryType[] = ['none', 'hat', 'antenna'];
const NAME_SYLLABLES: readonly string[] = ['КО', 'РА', 'МУ', 'ТУ', 'БИ', 'НА', 'ВА', 'ЛИ', 'ДА', 'ЖУ', 'ЗО', 'ПИ'];

const MUTABLE_FIELDS: readonly (keyof CharacterAttrs)[] = [
  'headForm',
  'headColor',
  'bodyForm',
  'bodyColor',
  'eyes',
  'accessory',
];

export interface GeneratedShift {
  seed: number;
  shift: number;
  today: number;
  /** Активный набор правил смены — доска и объяснения ошибок используют его же. */
  rules: Rule[];
  apps: Application[];
}

/** Число заявок в смене (ГДД разд. 2). */
export function appsForShift(shift: number): number {
  if (shift <= 1) return 8;
  return shift <= 5 ? 10 : 12;
}

/** Доля самозванцев (ГДД разд. 3.2). */
function invalidProb(shift: number): number {
  return shift <= 1 ? 0.2 : Math.min(0.45, 0.25 + 0.03 * (shift - 2));
}

/** Все 4×6×3×6×2×3 = 2592 комбинации признаков — пулы строятся полным перебором. */
function buildAttrCombos(): CharacterAttrs[] {
  const out: CharacterAttrs[] = [];
  for (const headForm of HEAD_FORMS) {
    for (const headColor of COLORS) {
      for (const bodyForm of BODY_FORMS) {
        for (const bodyColor of COLORS) {
          for (const eyes of EYE_TYPES) {
            for (const accessory of ACCESSORY_TYPES) {
              out.push({ headForm, headColor, bodyForm, bodyColor, eyes, accessory });
            }
          }
        }
      }
    }
  }
  return out;
}

const ALL_ATTR_COMBOS: readonly CharacterAttrs[] = buildAttrCombos();

/** Пропуск с заведомо валидными документными полями — для проверки гостевых правил. */
function probeDoc(guest: CharacterAttrs, today: number): PassDoc {
  return docFromGuest(guest, today + 5, 'ПРО-БА');
}

/** Гости, чистые по всем активным правилам, и гости с ровно одним нарушением — по правилу. */
function guestPools(
  rules: readonly Rule[],
  today: number,
): { valid: CharacterAttrs[]; byRule: Map<number, CharacterAttrs[]> } {
  const valid: CharacterAttrs[] = [];
  const byRule = new Map<number, CharacterAttrs[]>();
  for (const guest of ALL_ATTR_COMBOS) {
    const ctx = { guest, doc: probeDoc(guest, today), today };
    const violations = rules.filter((r) => r.rejects(ctx));
    if (violations.length === 0) {
      valid.push(guest);
    } else if (violations.length === 1) {
      const id = violations[0].id;
      const list = byRule.get(id) ?? [];
      list.push(guest);
      byRule.set(id, list);
    }
  }
  return { valid, byRule };
}

/** Поля, закрытые активными правилами: подделка их не мутирует (инвариант ГДД 3.4.1). */
function lockedFields(rules: readonly Rule[]): Set<keyof CharacterAttrs> {
  const locked = new Set<keyof CharacterAttrs>();
  for (const rule of rules) {
    for (const key of Object.keys(rule.icon)) locked.add(key as keyof CharacterAttrs);
  }
  return locked;
}

/**
 * Базовый пропуск с валидными документными полями относительно активных правил:
 * срок учитывает «короче 3 дней» (№16), подпись всегда есть (№9 — только через нарушителя).
 */
function genDoc(rng: Rng, guest: CharacterAttrs, rules: readonly Rule[], today: number): PassDoc {
  const needsLongExpiry = rules.some((r) => r.expiryKind === 'short');
  const doc = docFromGuest(guest, (needsLongExpiry ? today + 3 : today) + pickInt(rng, 25), genName(rng));
  doc.signature = true;
  return doc;
}

function genName(rng: Rng): string {
  return `${pickOf(rng, NAME_SYLLABLES)}-${pickOf(rng, NAME_SYLLABLES)}-${pickOf(rng, NAME_SYLLABLES)}`;
}

/**
 * Дефектный пропуск для документного правила: копия гостя + дефект по спецификации правила
 * (просрочка / «короче 3 дней» / нет подписи). Остальные поля заведомо валидны.
 */
function defectiveDoc(rng: Rng, guest: CharacterAttrs, rule: Rule, today: number): PassDoc {
  const doc = genDoc(rng, guest, [rule], today);
  for (const field of rule.docs ?? []) {
    if (field === 'expiry') {
      doc.expiry = rule.expiryKind === 'short' ? today + pickInt(rng, 3) : today - 1 - pickInt(rng, 10);
    } else {
      doc.signature = false;
    }
  }
  return doc;
}

/**
 * Раскладка слотов: валидные серии разбиваются невалидными на сегменты ≤4
 * (кап серий, ГДД разд. 3.2). Размеры сегментов перемешиваются — позиции
 * невалидных заявок меняются от сида к сиду. true = невалидный слот.
 */
function spreadLayout(total: number, invalidCount: number, rng: Rng): boolean[] {
  const val = total - invalidCount;
  const segments = invalidCount + 1;
  const base = Math.floor(val / segments);
  let extra = val % segments;

  const sizes: number[] = [];
  for (let s = 0; s < segments; s++) {
    const size = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra -= 1;
    sizes.push(size);
  }

  const out: boolean[] = [];
  let invLeft = invalidCount;
  for (const size of shuffle(sizes, rng)) {
    for (let i = 0; i < size; i++) out.push(false);
    if (invLeft > 0) {
      out.push(true);
      invLeft -= 1;
    }
  }
  return out;
}

/**
 * Смена целиком по сиду (ГДД разд. 3.2): онбординг смены 1, обучающий слот новейшего правила
 * (всегда первая заявка), директивная выборка нарушителей на каждое активное правило,
 * подделки по доле — всё в пределах потолка невалидных и капов серий.
 */
export function generateShift(
  seed: number,
  shift: number,
  today = 1,
  totalOverride?: number,
): GeneratedShift {
  const rngQueue = rngFor(seed, 'queue');
  const rngChar = rngFor(seed, 'char');
  const rngDoc = rngFor(seed, 'doc');
  const rules = rulesForShift(shift, rngFor(seed, 'rules'));
  const pools = guestPools(rules, today);
  const locked = lockedFields(rules);
  const total = totalOverride ?? appsForShift(shift);
  const maxInvalid = Math.floor(total * 0.45);
  const apps: Application[] = [];
  let invalidCount = 0;

  const pushValid = (): void => {
    const guest = pickOf(rngChar, pools.valid);
    apps.push({ guest, doc: genDoc(rngDoc, guest, rules, today), expected: 'approve', reason: 'none' });
  };

  const pushForgery = (): void => {
    const guest = pickOf(rngChar, pools.valid);
    const doc = docFromGuest(guest, 0, genName(rngDoc));
    // Срок и подпись — валидные относительно активных документных правил
    const needsLongExpiry = rules.some((r) => r.expiryKind === 'short');
    doc.expiry = (needsLongExpiry ? today + 3 : today) + pickInt(rngDoc, 25);
    doc.signature = true;

    const free = MUTABLE_FIELDS.filter((f) => !locked.has(f));
    if (free.length === 0) {
      // Активные правила закрыли все поля — вместо подделки ставим валидную заявку
      apps.push({ guest, doc, expected: 'approve', reason: 'none' });
      return;
    }

    const field = pickOf(rngDoc, free);
    switch (field) {
      case 'headForm':
        doc.headForm = pickOf(rngDoc, HEAD_FORMS.filter((f) => f !== guest.headForm));
        break;
      case 'headColor':
        doc.headColor = pickOf(rngDoc, COLORS.filter((c) => c !== guest.headColor));
        break;
      case 'bodyForm':
        doc.bodyForm = pickOf(rngDoc, BODY_FORMS.filter((f) => f !== guest.bodyForm));
        break;
      case 'bodyColor':
        doc.bodyColor = pickOf(rngDoc, COLORS.filter((c) => c !== guest.bodyColor));
        break;
      case 'eyes':
        doc.eyes = pickOf(rngDoc, EYE_TYPES.filter((e) => e !== guest.eyes));
        break;
      case 'accessory':
        doc.accessory = pickOf(rngDoc, ACCESSORY_TYPES.filter((a) => a !== guest.accessory));
        break;
    }
    apps.push({ guest, doc, expected: 'reject', reason: 'forgery' });
    invalidCount += 1;
  };

  const pushGuestViolator = (rule: Rule, training: boolean): boolean => {
    const pool = pools.byRule.get(rule.id) ?? [];
    if (pool.length === 0) return false;
    const guest = pickOf(rngChar, pool);
    apps.push({
      guest,
      doc: genDoc(rngDoc, guest, rules, today),
      expected: 'reject',
      reason: 'rule',
      ruleId: rule.id,
      training,
    });
    invalidCount += 1;
    return true;
  };

  const pushDocViolator = (rule: Rule, training: boolean): boolean => {
    const guest = pickOf(rngChar, pools.valid);
    const doc = defectiveDoc(rngDoc, guest, rule, today);
    const ctx = { guest, doc, today };
    const violations = rules.filter((r) => r.rejects(ctx));
    if (violations.length !== 1 || violations[0].id !== rule.id) return false;
    apps.push({ guest, doc, expected: 'reject', reason: 'rule', ruleId: rule.id, training });
    invalidCount += 1;
    return true;
  };

  const pushViolator = (rule: Rule, training = false): boolean =>
    rule.docs?.length ? pushDocViolator(rule, training) : pushGuestViolator(rule, training);

  if (shift <= 1) {
    // Онбординг (ГДД разд. 8): первые две заявки фиксированы — валидный гость и явная подделка
    const [first, second] = makeFixedQueue();
    apps.push(first, second);
    invalidCount += (first.expected === 'reject' ? 1 : 0) + (second.expected === 'reject' ? 1 : 0);
  } else {
    // Обучающий слот новейшего введённого правила: гарантированный нарушитель (ошибка не считается)
    const newest = rules.reduce((a, b) =>
      b.fromShift > a.fromShift || (b.fromShift === a.fromShift && b.id > a.id) ? b : a,
    );
    pushViolator(newest, true);
  }

  // Директивная выборка: нарушитель для каждого ещё не покрытого активного правила
  const plan: Array<Rule | 'forgery'> = [];
  for (const rule of rules) {
    if (apps.some((a) => a.reason === 'rule' && a.ruleId === rule.id)) continue;
    plan.push(rule);
  }

  // Подделки по доле — в пределах потолка невалидных (ГДД разд. 3.2)
  const capLeft = Math.max(0, maxInvalid - invalidCount - plan.length);
  const forgeries = Math.min(capLeft, Math.floor((total - apps.length - plan.length) * invalidProb(shift)));
  for (let i = 0; i < forgeries; i++) plan.push('forgery');

  // Раскладка слотов с капами серий, затем материализация плана
  const remaining = total - apps.length;
  const layout = spreadLayout(remaining, plan.length, rngQueue);

  let planIdx = 0;
  for (const slotInvalid of layout) {
    if (slotInvalid && planIdx < plan.length) {
      const item = plan[planIdx];
      planIdx += 1;
      if (item === 'forgery') {
        pushForgery();
        continue;
      }
      // Нарушитель не построился (практически невозможно) — слот становится валидным
      if (!pushViolator(item)) pushValid();
    } else {
      pushValid();
    }
  }

  decorateEvents(seed, shift, total, apps);

  return { seed, shift, today, rules, apps };
}

/**
 * Событийные слоты (план v2 В4 + А3): RNG только из суб-потока 'events' —
 * существующие потоки queue/char/doc/rules не тронуты, сиды бит-в-бит.
 * — VIP (смены 3+, слот не первый/не последний): терпение ×0.5, зарплата ×2;
 * — невидимка (смены 6+, ≤1 за смену; на смене 6 — обучающий слот);
 * — клон-двойник (смены 12+): гость повторно через ≥4 заявки.
 */
function decorateEvents(seed: number, shift: number, total: number, apps: Application[]): void {
  if (total < 6) return;
  const rngEvents = rngFor(seed, 'events');
  const midSlots = Math.max(1, total - 2);

  let vipIndex = -1;
  if (shift >= 3) {
    vipIndex = 2 + Math.floor(rngEvents() * midSlots);
    if (vipIndex >= total - 1) vipIndex = total - 2;
    apps[vipIndex].vip = true;
  }

  let ghostIndex = -1;
  if (shift >= 6) {
    ghostIndex = 3 + Math.floor(rngEvents() * midSlots);
    if (ghostIndex >= total - 1) ghostIndex = total - 2;
    if (ghostIndex === vipIndex) ghostIndex = Math.max(2, vipIndex - 1);
    apps[ghostIndex].ghost = true;
    if (shift === 6) apps[ghostIndex].training = true;
  }

  if (shift >= 12 && apps.length >= 6) {
    const src = 1 + Math.floor(rngEvents() * Math.max(1, apps.length - 5));
    const insertAt = Math.min(apps.length, src + 4 + Math.floor(rngEvents() * 3));
    const clone: Application = { ...apps[src], vip: false, ghost: false, training: false };
    apps.splice(insertAt, 0, clone);
  }
}
