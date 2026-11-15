import Phaser from 'phaser';

/** Точка входа Phaser. Ассетов в игре нет (всё Graphics) — сразу в меню. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    this.scene.start('Menu');
  }
}
