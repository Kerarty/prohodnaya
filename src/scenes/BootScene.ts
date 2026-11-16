import Phaser from 'phaser';
import { applyCamera } from '../render/layout';

/** Точка входа Phaser. Ассетов в игре нет (всё Graphics) — сразу в меню. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    // камера Boot видима один кадр — но зум применяем и здесь, без пропусков
    applyCamera(this);
    this.scene.start('Menu');
  }
}
