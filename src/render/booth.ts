import Phaser from 'phaser';
import { FONT, INK_HEX, THEME } from './theme';

export interface BoothView {
  /** Лампочки вывески — для волн (juice). */
  bulbs: Phaser.GameObjects.Arc[];
  /** Тень гостя — противофаза дыханию. */
  guestShadow: Phaser.GameObjects.Graphics | null;
}

/**
 * Сцена-«проходная»: стена, пол, ниша гостя, стойка с вывеской и лампочками
 * (спека §4.1). mode 'menu' — фон кабинета без ниши и вывески.
 */
export function drawBooth(scene: Phaser.Scene, width: number, mode: 'game' | 'menu'): BoothView {
  const g = scene.add.graphics().setDepth(-10);

  // Стена и пол
  g.fillStyle(THEME.BG_WALL, 1);
  g.fillRect(0, 0, width, 820);
  g.fillStyle(THEME.BG_FLOOR, 1);
  g.fillRect(0, 820, width, 460);
  g.lineStyle(3, THEME.INK, 0.12);
  g.lineBetween(0, 820, width, 820);

  // Облака на стене
  g.fillStyle(THEME.CLOUD, 0.7);
  g.fillRoundedRect(70, 300, 90, 28, 14);
  g.fillRoundedRect(575, 270, 90, 28, 14);
  g.fillRoundedRect(85, 465, 90, 28, 14);

  let guestShadow: Phaser.GameObjects.Graphics | null = null;

  if (mode === 'game') {
    // Ниша гостя
    g.fillStyle(THEME.NICHE, 1);
    g.fillRoundedRect(160, 252, 400, 328, 24);
    g.lineStyle(4, THEME.INK, 1);
    g.strokeRoundedRect(160, 252, 400, 328, 24);
    g.fillStyle(THEME.NICHE_FLOOR, 1);
    g.fillRoundedRect(176, 440, 368, 124, 16);
    g.lineStyle(3, THEME.INK, 0.15);
    g.lineBetween(176, 470, 544, 470);

    // Тень гостя — противофаза дыханию (спека §4.3 P0 №2)
    guestShadow = scene.add.graphics().setDepth(-9);
    guestShadow.fillStyle(THEME.INK, THEME.GUEST_SHADOW_A);
    guestShadow.fillEllipse(360, 472, 190, 28);
    scene.tweens.add({
      targets: guestShadow,
      scaleX: { from: 1, to: 0.96 },
      duration: 1600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  // Стойка: фронтон + столешница
  g.fillStyle(THEME.COUNTER_BODY, 1);
  g.fillRect(0, 1060, width, 220);
  g.fillStyle(THEME.COUNTER_TOP, 1);
  g.fillRoundedRect(0, 1032, width, 28, 6);
  g.lineStyle(4, THEME.INK, 1);
  g.strokeRoundedRect(0, 1032, width, 28, 6);

  const bulbs: Phaser.GameObjects.Arc[] = [];

  if (mode === 'game') {
    // Вывеска-неймплейт на фронтоне стойки
    g.fillStyle(THEME.PANEL, 1);
    g.fillRoundedRect(width / 2 - 130, 1208, 260, 64, 14);
    g.lineStyle(4, THEME.INK, 1);
    g.strokeRoundedRect(width / 2 - 130, 1208, 260, 64, 14);
    scene.add
      .text(width / 2, 1240, 'ПРОХОДНАЯ', {
        fontFamily: FONT,
        fontSize: '28px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setStroke(INK_HEX, 3)
      .setDepth(-9);
    for (let i = 0; i < 5; i++) {
      const x = 246 + i * 48;
      bulbs.push(scene.add.circle(x, 1214, 5, THEME.GOLD).setAlpha(THEME.BULB_OFF_A).setDepth(-9));
      bulbs.push(scene.add.circle(x, 1266, 5, THEME.GOLD).setAlpha(THEME.BULB_OFF_A).setDepth(-9));
    }
  }

  return { bulbs, guestShadow };
}
