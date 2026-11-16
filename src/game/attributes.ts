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

/* Подписи признаков живут в src/i18n/labels.ts — локализация всех языков. */
