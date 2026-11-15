import Phaser from 'phaser';
import { COLOR_HEX } from '../game/attributes';
import { FONT, INK_HEX, THEME } from './theme';

/** Конфетти из Graphics-кружков, имитация гравитации — без текстур (спека §5 №2). */
export function confetti(scene: Phaser.Scene, cx: number, cy: number): void {
  const colors = Object.values(COLOR_HEX);
  for (let i = 0; i < 26; i++) {
    const r = 4 + Math.random() * 3;
    const color = colors[Math.floor(Math.random() * colors.length)];
    const dot = scene.add.circle(cx + (Math.random() - 0.5) * 280, cy + (Math.random() - 0.5) * 40, r, color);
    scene.tweens.add({
      targets: dot,
      x: dot.x + (Math.random() - 0.5) * 320,
      y: dot.y + 420 + Math.random() * 100,
      rotation: (Math.random() - 0.5) * 6,
      alpha: 0,
      duration: 700 + Math.random() * 400,
      delay: Math.random() * 150,
      ease: 'Quad.easeIn',
      onComplete: () => dot.destroy(),
    });
  }
}

/** Облачко «?!» у головы гостя при ошибке игрока — локально в контейнере (спека §4.3 №10). */
export function spawnThought(scene: Phaser.Scene, guest: Phaser.GameObjects.Container): void {
  const g = scene.add.graphics();
  g.fillStyle(THEME.PAPER, 1);
  g.fillRoundedRect(-60, -27, 120, 54, 18);
  g.fillTriangle(34, 24, 62, 24, 54, 44);
  g.lineStyle(4, THEME.INK, 1);
  g.strokeRoundedRect(-60, -27, 120, 54, 18);
  g.strokeTriangle(34, 24, 62, 24, 54, 44);
  const t = scene.add
    .text(0, 0, '?!', { fontFamily: FONT, fontSize: '30px', color: INK_HEX, fontStyle: 'bold' })
    .setOrigin(0.5);

  const cloud = scene.add.container(125, -140, [g, t]);
  cloud.setScale(0);
  guest.add(cloud);

  scene.tweens.add({ targets: cloud, scale: 1, duration: 200, ease: 'Back.easeOut' });
  scene.time.delayedCall(900, () => {
    scene.tweens.add({ targets: cloud, alpha: 0, duration: 150, onComplete: () => cloud.destroy() });
  });
}

/** Волна по лампочкам: затухание от 1 к off-state с задержкой по индексу (спека §5 №4). */
export function bulbWave(scene: Phaser.Scene, bulbs: Phaser.GameObjects.Arc[]): void {
  bulbs.forEach((bulb, i) => {
    scene.tweens.add({
      targets: bulb,
      alpha: { from: 1, to: THEME.BULB_OFF_A },
      duration: 250,
      yoyo: true,
      repeat: 1,
      delay: i * 40,
    });
  });
}
