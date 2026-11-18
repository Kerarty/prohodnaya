import Phaser from 'phaser';
import { COLOR_HEX } from '../game/attributes';
import { pickOf, rngFor } from '../game/rng';
import { THEME } from './theme';

/**
 * Окно мира (план v2 А1 — флагман): круглое окно на стене справа от ниши.
 * Погода — из суб-потока сида ('weather'): у всех игроков дневная смена в одной
 * погоде. Внутри — небо, солнце, два облачка и дорога с машинками-примитивами;
 * VIP-выход останавливает машину у окна (А2 связка).
 * Только Graphics + tweens; контент под geometry-маской круга. Depth −9.
 */

export interface WorldWindow {
  /** VIP-церемония: машина останавливается у окна, новые не выезжают. */
  stopCar(): void;
  /** После церемонии — обычный трафик. */
  resumeCar(): void;
}

type Weather = 'sun' | 'clouds' | 'rain';

const CX = 640;
const CY = 690;
const FRAME_R = 70;
const GLASS_R = 58;
const ROAD_Y = CY + 34;

export function createWorldWindow(scene: Phaser.Scene, seed: number): WorldWindow {
  const weather: Weather = pickOf(rngFor(seed, 'weather'), ['sun', 'clouds', 'rain'] as const);

  // Рама + стекло (статика — перерисовывается на ресайз вместе с booth вручную не нужно:
  // окно целиком в дизайн-координатах ядра 720×1280, расширенные зоны стены не задевает)
  const frame = scene.add.graphics().setDepth(-9);
  frame.fillStyle(THEME.PANEL, 1);
  frame.fillCircle(CX, CY, FRAME_R);
  frame.lineStyle(5, THEME.INK, 1);
  frame.strokeCircle(CX, CY, FRAME_R);
  const skyColor = weather === 'rain' ? 0xa9bfd6 : weather === 'clouds' ? 0xc9e2f6 : 0xc3e6ff;
  frame.fillStyle(skyColor, 1);
  frame.fillCircle(CX, CY, GLASS_R);

  // Солнце: катится к горизонту на закатном освещении — здесь статично в верхней трети
  if (weather !== 'rain') {
    frame.fillStyle(THEME.GOLD, 1);
    frame.fillCircle(CX - 20, CY - 28, 12);
    frame.lineStyle(3, THEME.INK, 0.5);
    frame.strokeCircle(CX - 20, CY - 28, 12);
  }

  // Дорога + разметка
  frame.fillStyle(THEME.INK, 0.18);
  frame.fillRect(CX - GLASS_R, ROAD_Y - 9, GLASS_R * 2, 20);
  frame.fillStyle(0xffffff, 0.5);
  for (let i = 0; i < 4; i++) {
    frame.fillRect(CX - GLASS_R + 10 + i * 26, ROAD_Y - 1, 12, 3);
  }

  // Контент под маской-кругом: облачка и машинки не вылезают за стекло
  const maskShape = scene.make.graphics(undefined, false);
  maskShape.fillCircle(CX, CY, GLASS_R - 2);
  const mask = maskShape.createGeometryMask();

  const content = scene.add.container().setDepth(-9);
  content.setMask(mask);

  const miniCloud = (x: number, y: number, k: number): Phaser.GameObjects.Container => {
    const g = scene.add.graphics();
    g.fillStyle(0xffffff, weather === 'rain' ? 0.75 : 0.95);
    g.fillRoundedRect(-22 * k, -6 * k, 44 * k, 13 * k, 7 * k);
    g.fillRoundedRect(-12 * k, -13 * k, 28 * k, 11 * k, 6 * k);
    return scene.add.container(x, y, [g]);
  };
  const cloud1 = miniCloud(CX - 26, CY - 34, 1);
  const cloud2 = miniCloud(CX + 22, CY - 12, 0.7);
  content.add([cloud1, cloud2]);
  scene.tweens.add({ targets: cloud1, x: cloud1.x + 16, duration: 5200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  scene.tweens.add({ targets: cloud2, x: cloud2.x - 12, duration: 4200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

  // Дождь: редкие капли-точки по стеклу
  if (weather === 'rain') {
    scene.time.addEvent({
      delay: 420,
      loop: true,
      callback: () => {
        const drop = scene.add.circle(CX - GLASS_R + 8 + Math.random() * (GLASS_R * 2 - 16), CY - 30, 2, 0x9fc4e8).setDepth(-9);
        content.add(drop);
        scene.tweens.add({
          targets: drop,
          y: drop.y + 70,
          alpha: 0,
          duration: 500 + Math.random() * 200,
          onComplete: () => drop.destroy(),
        });
      },
    });
  }

  // Машинки: одна на дороге, выезжает раз в ~2-4 с; цвет — гостевая палитра
  let stopped = false;
  let activeCarTween: Phaser.Tweens.Tween | null = null;

  const spawnCar = (): void => {
    if (stopped) return;
    const color = COLOR_HEX[pickOf(rngFor(seed, 'events'), ['red', 'green', 'blue', 'orange'] as const)];
    const car = scene.add.container(CX - GLASS_R - 10, ROAD_Y - 6);
    const body = scene.add.graphics();
    body.fillStyle(color, 1);
    body.fillRoundedRect(-16, -10, 32, 12, 4);
    body.fillStyle(color, 1);
    body.fillRoundedRect(-9, -17, 18, 9, 3);
    body.lineStyle(3, THEME.INK, 1);
    body.strokeRoundedRect(-16, -10, 32, 12, 4);
    body.strokeRoundedRect(-9, -17, 18, 9, 3);
    body.fillStyle(THEME.INK, 1);
    body.fillCircle(-8, 3, 5);
    body.fillCircle(8, 3, 5);
    car.add(body);
    content.add(car);
    const dir = Math.random() < 0.5 ? 1 : -1;
    car.setScale(dir, 1);
    const targetX = dir === 1 ? CX + GLASS_R + 10 : CX - GLASS_R - 10;
    activeCarTween = scene.tweens.add({
      targets: car,
      x: targetX,
      duration: 2400,
      ease: 'Linear',
      onComplete: () => {
        if (activeCarTween) activeCarTween.remove();
        activeCarTween = null;
        car.destroy();
      },
    });
    if (stopped) activeCarTween.pause();
  };

  scene.time.addEvent({
    delay: 1800,
    loop: true,
    callback: () => {
      if (!stopped && !activeCarTween) spawnCar();
    },
  });

  return {
    stopCar(): void {
      stopped = true;
      activeCarTween?.pause(); // машина замирает у окна на время VIP-церемонии
    },
    resumeCar(): void {
      stopped = false;
      activeCarTween?.resume();
    },
  };
}
