import Phaser from 'phaser';
import { drawHardShadow, FONT, INK_HEX, THEME } from '../render/theme';
import { sfx } from '../systems/sfx';

export interface ButtonOptions {
  width?: number;
  height?: number;
  color?: number;
  fontSize?: number;
  /** Вторичная кнопка: белая заливка, чернильный текст (кабинет, «В МЕНЮ»). */
  secondary?: boolean;
}

/**
 * Кнопка «Мульт-поп»: hard-тень + ink-обводка 4px + squash-нажатие (спека §4.5).
 * Тап-зона сохраняется целиком, текст uppercase с ink-stroke — читаем на солнце.
 */
export function makeButton(
  scene: Phaser.Scene,
  cx: number,
  cy: number,
  label: string,
  onClick: () => void,
  opts: ButtonOptions = {},
): Phaser.GameObjects.Container {
  const { width = 340, height = 88, color = THEME.ACCENT, fontSize = 32, secondary = false } = opts;
  const fill = secondary ? THEME.PAPER : color;

  const container = scene.add.container(cx, cy);

  const shadow = scene.add.graphics();
  drawHardShadow(shadow, -width / 2, -height / 2, width, height, 22);

  const rect = scene.add
    .rectangle(0, 0, width, height, fill)
    .setStrokeStyle(4, THEME.INK, 1)
    .setInteractive({ useHandCursor: true });

  const text = scene.add
    .text(0, 0, label.toUpperCase(), {
      fontFamily: FONT,
      fontSize: `${fontSize}px`,
      color: secondary ? INK_HEX : '#ffffff',
      fontStyle: 'bold',
    })
    .setOrigin(0.5, 0.5)
    .setStroke(INK_HEX, secondary ? 0 : 3);

  const release = (): void => {
    scene.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 90, ease: 'Back.easeOut' });
  };

  rect.on('pointerdown', () => {
    container.setScale(1.08, 0.9); // squash: пружинит, а не сжимается
    sfx.tap();
  });
  rect.on('pointerout', release);
  rect.on('pointerup', () => {
    release();
    onClick();
  });

  container.add([shadow, rect, text]);
  return container;
}
