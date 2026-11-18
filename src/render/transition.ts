import Phaser from 'phaser';

/**
 * Мягкий переход между сценами: fadeOut в цвет чернил → scene.start →
 * fadeIn в create() новой сцены (спека арт-директора №1: «продукт вместо прототипа»).
 * Старт сцены откладывается до конца затухания; повторный вызов в затухании — no-op.
 */
export function fadeToScene(scene: Phaser.Scene, key: string, data?: Record<string, unknown>): void {
  const cam = scene.cameras.main;
  const flag = 'transitioning';
  if (scene.data.get(flag)) return;
  scene.data.set(flag, true);
  cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
    scene.scene.start(key, data);
  });
  cam.fadeOut(220, 51, 37, 78); // INK #33254e
}

/** Приёмная сторона перехода: мягкое проявление в цвете чернил. */
export function fadeIn(scene: Phaser.Scene): void {
  scene.cameras.main.fadeIn(220, 51, 37, 78);
}
