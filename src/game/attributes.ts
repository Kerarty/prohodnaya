/** Признаковая модель персонажа (ГДД разд. 3.1). Арт — только Graphics-примитивы. */

export type ColorName = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple';
export type HeadForm = 'circle' | 'square' | 'triangle' | 'hexagon';
export type BodyForm = 'rect' | 'trapezoid' | 'oval';
export type EyesType = 'dots' | 'stripes';
export type AccessoryType = 'none' | 'hat' | 'antenna';

export interface CharacterAttrs {
  headForm: HeadForm;
  headColor: ColorName;
  bodyForm: BodyForm;
  bodyColor: ColorName;
  eyes: EyesType;
  accessory: AccessoryType;
}

export const COLOR_HEX: Record<ColorName, number> = {
  red: 0xd95050,
  orange: 0xe09a3c,
  yellow: 0xe8cc4d,
  green: 0x5cb85f,
  blue: 0x5079d9,
  purple: 0x9c5ecf,
};

/** Подписи для карточек объяснения: голова — женский род. */
export const HEAD_COLOR_LABEL: Record<ColorName, string> = {
  red: 'красная',
  orange: 'оранжевая',
  yellow: 'жёлтая',
  green: 'зелёная',
  blue: 'синяя',
  purple: 'фиолетовая',
};

/** Тело — средний род. */
export const BODY_COLOR_LABEL: Record<ColorName, string> = {
  red: 'красное',
  orange: 'оранжевое',
  yellow: 'жёлтое',
  green: 'зелёное',
  blue: 'синее',
  purple: 'фиолетовое',
};

export const HEAD_FORM_LABEL: Record<HeadForm, string> = {
  circle: 'круглая',
  square: 'квадратная',
  triangle: 'треугольная',
  hexagon: 'шестиугольная',
};

export const BODY_FORM_LABEL: Record<BodyForm, string> = {
  rect: 'прямоугольное',
  trapezoid: 'трапециевидное',
  oval: 'овальное',
};

export const EYES_LABEL: Record<EyesType, string> = {
  dots: 'точки',
  stripes: 'полоски',
};

export const ACCESSORY_LABEL: Record<AccessoryType, string> = {
  none: 'без аксессуара',
  hat: 'в шляпе',
  antenna: 'с антенной',
};
