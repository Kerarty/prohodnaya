import type {
  AccessoryType,
  BodyForm,
  CharacterAttrs,
  ColorName,
  EyesType,
  HeadForm,
} from './attributes';
import {
  ACCESSORY_LABEL,
  BODY_COLOR_LABEL,
  BODY_FORM_LABEL,
  EYES_LABEL,
  HEAD_COLOR_LABEL,
  HEAD_FORM_LABEL,
} from './attributes';
import type { Rule } from './rules';

export type Decision = 'approve' | 'reject';

/** Единственная причина отказа заявки — инвариант генерации (ГДД разд. 3.4.1). */
export type RejectReason = 'none' | 'forgery' | 'rule';

/** Поле пропуска — для подсветки несовпадения в карточке объяснения. */
export type DocFieldId = 'head' | 'body' | 'eyes' | 'accessory' | 'expiry' | 'signature';

export interface PassDoc {
  headForm: HeadForm;
  headColor: ColorName;
  bodyForm: BodyForm;
  bodyColor: ColorName;
  eyes: EyesType;
  accessory: AccessoryType;
  /** «ГОДЕН ДО: ДЕНЬ N» — документный признак (проверка срока — день 4). */
  expiry: number;
  signature: boolean;
  /** Декоративное имя из слогов — никогда не проверяется (ГДД разд. 3.1). */
  name: string;
}

export interface Application {
  guest: CharacterAttrs;
  doc: PassDoc;
  expected: Decision;
  reason: RejectReason;
  /** Идентификатор нарушенного правила (только для reason = 'rule'). */
  ruleId?: number;
  /** Обучающий слот: ошибка не засчитывается (ГДД разд. 8). */
  training?: boolean;
}

export function docFromGuest(guest: CharacterAttrs, expiry: number, name: string): PassDoc {
  return { ...guest, expiry, signature: true, name };
}

/**
 * День 2: фиксированная очередь — валидный гость и явная подделка по цвету головы
 * (онбординг из ГДД разд. 8) + два обычных варианта. День 3 заменит генератором.
 */
export function makeFixedQueue(): Application[] {
  const green: CharacterAttrs = {
    headForm: 'circle',
    headColor: 'green',
    bodyForm: 'rect',
    bodyColor: 'yellow',
    eyes: 'dots',
    accessory: 'none',
  };
  const red: CharacterAttrs = {
    headForm: 'circle',
    headColor: 'red',
    bodyForm: 'trapezoid',
    bodyColor: 'blue',
    eyes: 'dots',
    accessory: 'none',
  };
  const purple: CharacterAttrs = {
    headForm: 'square',
    headColor: 'purple',
    bodyForm: 'oval',
    bodyColor: 'green',
    eyes: 'stripes',
    accessory: 'hat',
  };
  const orange: CharacterAttrs = {
    headForm: 'hexagon',
    headColor: 'orange',
    bodyForm: 'rect',
    bodyColor: 'red',
    eyes: 'stripes',
    accessory: 'antenna',
  };

  const redDocForged: PassDoc = { ...docFromGuest(red, 20, 'ТУ-БИ-НА'), headColor: 'blue' };
  const orangeDocForged: PassDoc = { ...docFromGuest(orange, 11, 'ЖУ-КО-ЖУ'), bodyColor: 'green' };

  return [
    {
      guest: green,
      doc: docFromGuest(green, 14, 'КО-РА-МУ'),
      expected: 'approve',
      reason: 'none',
      training: true,
    },
    { guest: red, doc: redDocForged, expected: 'reject', reason: 'forgery', training: true },
    { guest: purple, doc: docFromGuest(purple, 27, 'ВА-ЛИ-ДА'), expected: 'approve', reason: 'none' },
    { guest: orange, doc: orangeDocForged, expected: 'reject', reason: 'forgery' },
  ];
}

/** Текст карточки объяснения для подделки + какое поле подсветить (ГДД разд. 2, 8). */
export function describeForgery(app: Application): { text: string; field: DocFieldId } {
  const { guest: g, doc: d } = app;
  if (d.headColor !== g.headColor) {
    return {
      field: 'head',
      text: `Гость: ${HEAD_COLOR_LABEL[g.headColor]} голова.\nПропуск: ${HEAD_COLOR_LABEL[d.headColor]}. Подделка!`,
    };
  }
  if (d.headForm !== g.headForm) {
    return {
      field: 'head',
      text: `Гость: ${HEAD_FORM_LABEL[g.headForm]} голова.\nПропуск: ${HEAD_FORM_LABEL[d.headForm]}. Подделка!`,
    };
  }
  if (d.bodyColor !== g.bodyColor) {
    return {
      field: 'body',
      text: `Гость: ${BODY_COLOR_LABEL[g.bodyColor]} тело.\nПропуск: ${BODY_COLOR_LABEL[d.bodyColor]}. Подделка!`,
    };
  }
  if (d.bodyForm !== g.bodyForm) {
    return {
      field: 'body',
      text: `Гость: ${BODY_FORM_LABEL[g.bodyForm]} тело.\nПропуск: ${BODY_FORM_LABEL[d.bodyForm]}. Подделка!`,
    };
  }
  if (d.eyes !== g.eyes) {
    return {
      field: 'eyes',
      text: `Гость: глаза — ${EYES_LABEL[g.eyes]}.\nПропуск: глаза — ${EYES_LABEL[d.eyes]}. Подделка!`,
    };
  }
  if (d.accessory !== g.accessory) {
    return {
      field: 'accessory',
      text: `Гость: ${ACCESSORY_LABEL[g.accessory]}.\nПропуск: ${ACCESSORY_LABEL[d.accessory]}. Подделка!`,
    };
  }
  return { field: 'head', text: 'Пропуск не совпадает с гостем.' };
}

const ATTR_FIELDS = [
  'headForm',
  'headColor',
  'bodyForm',
  'bodyColor',
  'eyes',
  'accessory',
] as const satisfies readonly (keyof PassDoc)[];

/** Число расхождений «документ ↔ гость» по признакам персонажа. */
export function attrDiffCount(doc: PassDoc, guest: CharacterAttrs): number {
  return ATTR_FIELDS.filter((f) => doc[f] !== guest[f]).length;
}

/** Объяснение нарушителя правила — карточка ошибки (столп «Ошибка учит»). */
export function describeViolation(
  app: Application,
  rules: readonly Rule[],
): { text: string; field: DocFieldId } {
  const rule = rules.find((r) => r.id === app.ruleId) ?? rules[0];
  const field: DocFieldId = rule.docs?.[0] ?? 'head';
  const subject = rule.docs?.length ? 'Пропуск' : 'Гость';
  return { field, text: `${subject} нарушает правило:\n«${rule.text}».` };
}
