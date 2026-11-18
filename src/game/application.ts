import type {
  AccessoryType,
  BodyForm,
  CharacterAttrs,
  ColorName,
  EyesType,
  HeadForm,
} from './attributes';
import { bodyColorLabel, bodyFormLabel, headColorLabel, headFormLabel, ruleText, accessoryLabel, eyesLabel } from '../i18n/labels';
import { t } from '../i18n';
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
  /** Событийный слот (план v2 В4): спешащий VIP — терпение ×0.5, зарплата ×2. */
  vip?: boolean;
  /** Событийный слот (план v2 А3): гость-невидимка — проявляется проверкой поля. */
  ghost?: boolean;
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
      text: t('forgHeadColor', { a: headColorLabel(g.headColor), b: headColorLabel(d.headColor) }),
    };
  }
  if (d.headForm !== g.headForm) {
    return {
      field: 'head',
      text: t('forgHeadForm', { a: headFormLabel(g.headForm), b: headFormLabel(d.headForm) }),
    };
  }
  if (d.bodyColor !== g.bodyColor) {
    return {
      field: 'body',
      text: t('forgBodyColor', { a: bodyColorLabel(g.bodyColor), b: bodyColorLabel(d.bodyColor) }),
    };
  }
  if (d.bodyForm !== g.bodyForm) {
    return {
      field: 'body',
      text: t('forgBodyForm', { a: bodyFormLabel(g.bodyForm), b: bodyFormLabel(d.bodyForm) }),
    };
  }
  if (d.eyes !== g.eyes) {
    return {
      field: 'eyes',
      text: t('forgEyes', { a: eyesLabel(g.eyes), b: eyesLabel(d.eyes) }),
    };
  }
  if (d.accessory !== g.accessory) {
    return {
      field: 'accessory',
      text: t('forgAcc', { a: accessoryLabel(g.accessory), b: accessoryLabel(d.accessory) }),
    };
  }
  return { field: 'head', text: t('forgUnknown') };
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
  // Подсветка — первый гостевой признак из иконки правила (аудит п.11), иначе документный
  const iconField: DocFieldId | null =
    rule.icon.headColor || rule.icon.headForm
      ? 'head'
      : rule.icon.bodyColor || rule.icon.bodyForm
        ? 'body'
        : rule.icon.eyes
          ? 'eyes'
          : rule.icon.accessory
            ? 'accessory'
            : null;
  const field: DocFieldId = rule.docs?.[0] ?? iconField ?? 'head';
  const key = rule.docs?.length ? 'violPass' : 'violGuest';
  return { field, text: t(key, { rule: ruleText(rule.id) }) };
}
