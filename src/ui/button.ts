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
  /** Мелкая строка под основной надписью (условие разблокировки и т.п.). */
  subtitle?: string;
}

/**
 * Кнопка «Мульт-поп»: hard-тень + ink-обводка 4px + squash-нажатие (спека §4.5).
 * Тап-зона сохраняется целиком, текст uppercase с ink-stroke — читаем на солнце.
 * Длинные надписи автоматически ужимаются, чтобы не вылезать за рамку.
 */
export function makeButton(
  scene: Phaser.Scene,
  cx: number,
  cy: number,
  label: string,
  onClick: () => void,
  opts: ButtonOptions = {},
): Phaser.GameObjects.Container {
  const { width = 340, height = 88, color = THEME.ACCENT, fontSize = 32, secondary = false, subtitle } = opts;
  const fill = secondary ? (color ?? THEME.PAPER) : color;

  const container = scene.add.container(cx, cy);

  const shadow = scene.add.graphics();
  drawHardShadow(shadow, -width / 2, -height / 2, width, height, 22);

  // Корпус кнопки: roundRect r=22 в ink-обводке (спека §4.5), hit-зона — весь прямоугольник
  const rect = scene.add.graphics();
  rect.fillStyle(fill, 1);
  rect.fillRoundedRect(-width / 2, -height / 2, width, height, 22);
  rect.lineStyle(4, THEME.INK, 1);
  rect.strokeRoundedRect(-width / 2, -height / 2, width, height, 22);
  rect.setInteractive({
    hitArea: new Phaser.Geom.Rectangle(-width / 2, -height / 2, width, height),
    hitAreaCallback: Phaser.Geom.Rectangle.Contains,
    useHandCursor: true,
  });

  const textColor = secondary ? INK_HEX : '#ffffff';
  const maxTextWidth = width - 32;

  const makeText = (value: string, size: number, y: number): Phaser.GameObjects.Text => {
    const t = scene.add
      .text(0, y, value.toUpperCase(), {
        fontFamily: FONT,
        fontSize: `${size}px`,
        color: textColor,
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0.5)
      .setStroke(INK_HEX, secondary ? 0 : 3);
    // автоуменьшение, если надпись шире кнопки
    if (t.width > maxTextWidth) {
      const fitted = Math.max(14, Math.floor((size * maxTextWidth) / t.width));
      t.setFontSize(fitted);
    }
    return t;
  };

  const mainY = subtitle !== undefined ? -12 : 0;
  const text = makeText(label, fontSize, mainY);
  container.add([shadow, rect, text]);

  if (subtitle) {
    const sub = makeText(subtitle, 14, 18).setAlpha(0.85);
    container.add(sub);
  }

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

  return container;
}
