import Phaser from 'phaser';

/**
 * Тема «Мульт-поп» — единственный источник цветов и типографики (docs/art-upgrade-spec.md §2).
 * Гостевые цвета признаков НЕ здесь, а в game/attributes.ts (COLOR_HEX).
 */
export const THEME = {
  // — основные 8 ролей —
  BG_WALL: 0xffedd3, // фон-стена (крем-закат)
  PANEL: 0x4d7cff, // панели: вывеска, столешница
  ACCENT: 0xff7a3d, // CTA-кнопки, шапка пропуска, заголовок доски
  SUCCESS: 0x3ec46d,
  ERROR: 0xff4757,
  PAPER: 0xffffff, // пропуск, доска, карточки кабинета
  INK: 0x33254e, // чернила = цвет ВСЕХ обводок
  GOLD: 0xffc93c, // жетоны, лампочки, жёлтая лупа

  // — производные —
  BG_FLOOR: 0xffd9a0,
  NICHE: 0xfff3e0, // задник гостя
  NICHE_FLOOR: 0xffe0b3,
  COUNTER_TOP: 0x4d7cff,
  COUNTER_BODY: 0xff9f68,
  ACCENT_DARK: 0xf0622a,
  PANEL_DARK: 0x3d63cc,
  CHEEK: 0xff9bb0, // щёки (нейтраль — правило нейтральности декора)
  CLOUD: 0xffffff,

  // — прозрачности —
  SHADOW_A: 0.2, // hard-тень карточек/кнопок (INK)
  GUEST_SHADOW_A: 0.18,
  BULB_OFF_A: 0.35,
  FLASH_A: 0.12, // полноэкранная вспышка вердикта
} as const;

export const FONT = '"Balsamiq Sans", Arial, sans-serif';
export const INK_HEX = '#33254e';
export const SUCCESS_HEX = '#3ec46d';
export const ERROR_HEX = '#ff4757';
export const GOLD_HEX = '#ffc93c';
export const PAPER_HEX = '#ffffff';
export const ACCENT_HEX = '#ff7a3d';

/** Бумажная hard-тень: смещённый вниз roundRect цвета чернил. */
export function drawHardShadow(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  dy = 6,
): void {
  g.fillStyle(THEME.INK, THEME.SHADOW_A);
  g.fillRoundedRect(x, y + dy, w, h, r);
}
