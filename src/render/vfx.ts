import Phaser from 'phaser';
import { COLOR_HEX } from '../game/attributes';
import { THEME } from './theme';

/**
 * VFX-слой (спека тех-художника): частицы из Graphics-текстур — ноль растровых
 * ассетов. One-shot эмиттеры без пула (Phaser 3.60+ переиспользует частицы внутри
 * эмиттера), самоликвидация по 'complete'. Бюджеты: ≤6 burst-эмиттеров + 1 ambient,
 * ≤150 живых частиц — худший кадр ~74, запас к 60 FPS среднего мобиля.
 */

export type VfxTier = 'high' | 'low';
let tier: string = 'high';
let burstCount = 0;

/** Порядок обхода COLOR_HEX стабилен — цвета конфетти детерминированы. */
const SALVO_COLORS: number[] = Object.values(COLOR_HEX);

interface EmitSpec {
  texture: string;
  count: number;
  speed?: { min: number; max: number };
  angle?: { min: number; max: number };
  lifespan: { min: number; max: number };
  scale?: { start: number; end: number };
  scaleX?: { start: number; end: number };
  scaleY?: { start: number; end: number };
  alpha?: { start: number; end: number };
  rotate?: { min: number; max: number };
  gravityY?: number;
  blendMode?: string;
  tint?: number;
  emitZone?: Phaser.Types.GameObjects.Particles.ParticleEmitterEdgeZoneConfig;
  depth: number;
}

/** Одноразовый burst с самоликвидацией; превышение бюджета — дропается. */
function burst(scene: Phaser.Scene, x: number, y: number, spec: EmitSpec): Phaser.GameObjects.Particles.ParticleEmitter | null {
  if (burstCount >= 6) return null;
  burstCount += 1;
  const emitter = scene.add.particles(x, y, spec.texture, {
    speed: spec.speed,
    angle: spec.angle,
    lifespan: spec.lifespan,
    scale: spec.scale,
    scaleX: spec.scaleX,
    scaleY: spec.scaleY,
    alpha: spec.alpha,
    rotate: spec.rotate,
    gravityY: spec.gravityY,
    blendMode: spec.blendMode,
    tint: spec.tint,
    emitZone: spec.emitZone,
    emitting: false,
  });
  emitter.setDepth(spec.depth);
  emitter.once('complete', () => {
    burstCount -= 1;
    emitter.destroy();
  });
  emitter.explode(spec.count, x, y);
  return emitter;
}

/** Одноразовые текстуры из Graphics: круг, 4-лучевая искра, кольцо, чип-квадратик. */
function ensureTextures(scene: Phaser.Scene): void {
  const make = (key: string, size: number, draw: (g: Phaser.GameObjects.Graphics) => void): void => {
    if (scene.textures.exists(key)) return;
    const g = scene.make.graphics(undefined, false);
    draw(g);
    g.generateTexture(key, size, size);
    g.destroy();
  };
  make('vfx-dot', 12, (g) => {
    g.fillStyle(0xffffff, 1);
    g.fillCircle(6, 6, 6);
  });
  make('vfx-spark', 28, (g) => {
    g.fillStyle(0xffffff, 1);
    g.fillTriangle(14, 0, 11, 14, 17, 14);
    g.fillTriangle(14, 28, 11, 14, 17, 14);
    g.fillTriangle(0, 14, 14, 11, 14, 17);
    g.fillTriangle(28, 14, 14, 11, 14, 17);
  });
  make('vfx-ring', 64, (g) => {
    g.lineStyle(6, 0xffffff, 1);
    g.strokeCircle(32, 32, 28);
  });
  make('vfx-chip', 14, (g) => {
    g.fillStyle(0xffffff, 1);
    g.fillRect(1, 1, 12, 12);
    g.lineStyle(2, 0x33254e, 1);
    g.strokeRect(1, 1, 12, 12);
  });
}

/** Чернильный брызг из-под штампа на карточке. */
export function stampInk(scene: Phaser.Scene, x: number, y: number): void {
  ensureTextures(scene);
  burst(scene, x, y, {
    texture: 'vfx-dot',
    count: tier === 'low' ? 8 : 14,
    speed: { min: 120, max: 260 },
    angle: { min: 0, max: 360 },
    lifespan: { min: 380, max: 550 },
    scale: { start: 0.6, end: 0.9 },
    alpha: { start: 0.9, end: 0 },
    rotate: { min: -360, max: 360 },
    gravityY: 600,
    tint: THEME.INK,
    depth: 6,
  });
}

/** Shockwave-кольцо «шлепка» печати. */
export function stampShock(scene: Phaser.Scene, x: number, y: number): void {
  ensureTextures(scene);
  burst(scene, x, y, {
    texture: 'vfx-ring',
    count: 1,
    lifespan: { min: 300, max: 300 },
    scale: { start: 0.3, end: 2.2 },
    alpha: { start: 0.85, end: 0 },
    tint: THEME.INK,
    depth: 6,
  });
}

/** Speedlines за быстрый верный вердикт (speed bonus). */
export function speedlines(scene: Phaser.Scene, x: number, y: number): void {
  if (tier === 'low') return;
  ensureTextures(scene);
  burst(scene, x, y, {
    texture: 'vfx-chip',
    count: 8,
    speed: { min: 480, max: 560 },
    angle: { min: 150, max: 210 },
    lifespan: { min: 240, max: 280 },
    scaleX: { start: 2.2, end: 0 },
    scaleY: { start: 0.35, end: 0.1 },
    alpha: { start: 0.8, end: 0 },
    blendMode: 'ADD',
    tint: THEME.PAPER,
    depth: 14,
  });
}

/** Золотая искра по контуру гостя (подсветка поля лупой). */
export function outlineSpark(scene: Phaser.Scene, guest: Phaser.GameObjects.Container): void {
  if (tier === 'low') return;
  ensureTextures(scene);
  const rect = new Phaser.Geom.Rectangle(-70, -130, 140, 250);
  burst(scene, guest.x, guest.y, {
    texture: 'vfx-spark',
    count: tier === 'low' ? 8 : 12,
    speed: { min: 20, max: 45 },
    lifespan: { min: 500, max: 700 },
    scale: { start: 0.7, end: 0 },
    alpha: { start: 0.95, end: 0 },
    blendMode: 'ADD',
    tint: THEME.GOLD,
    emitZone: { type: 'edge', quantity: 12, source: rect },
    depth: 4,
  });
}

/** Пульс-кольцо от кнопки при тапе. */
export function buttonPulse(scene: Phaser.Scene, x: number, y: number): void {
  ensureTextures(scene);
  const ring = scene.add.image(x, y, 'vfx-ring').setDepth(30).setScale(0.4).setAlpha(0.8).setTint(0xffffff);
  scene.tweens.add({
    targets: ring,
    scale: 1.6,
    alpha: 0,
    duration: 320,
    ease: 'Quad.easeOut',
    onComplete: () => ring.destroy(),
  });
}

/** Парад-конфетти: залп с двух сторон внутрь (замена ручных твинов juice.confetti). */
export function confettiSalvo(scene: Phaser.Scene): void {
  ensureTextures(scene);
  const tints = SALVO_COLORS;
  for (const side of [0, 1]) {
    const x = side === 0 ? -30 : 750;
    const angle = side === 0 ? { min: 25, max: 75 } : { min: 105, max: 155 };
    const emitter = scene.add.particles(x, 280, 'vfx-chip', {
      speed: { min: 350, max: 650 },
      angle,
      lifespan: { min: 1400, max: 2000 },
      scale: { start: 1.6, end: 0.6 },
      rotate: { min: -540, max: 540 },
      gravityY: 900,
      emitting: false,
      tint: tints,
    });
    emitter.setDepth(25);
    emitter.once('complete', () => emitter.destroy());
    emitter.explode(tier === 'low' ? 10 : 18, x, 280);
  }
}

/** Ambient-пар из чашки на стойке; возвращает эмиттер (один на сцену). */
export function steamAmbient(scene: Phaser.Scene, x: number, y: number): Phaser.GameObjects.Particles.ParticleEmitter | null {
  if (tier === 'low') return null;
  ensureTextures(scene);
  const emitter = scene.add.particles(x, y, 'vfx-dot', {
    speed: { min: 8, max: 16 },
    angle: { min: 250, max: 290 },
    lifespan: { min: 1400, max: 1800 },
    scale: { start: 0.3, end: 0.9 },
    alpha: { start: 0.35, end: 0 },
    gravityY: -20,
    frequency: 600,
    tint: 0xffffff,
  });
  emitter.setDepth(-6);
  return emitter;
}

/** Пыль-клуб у ног гостя (клубок при приземлении после входа). */
export function walkPuff(scene: Phaser.Scene, x: number, y: number): void {
  if (tier === 'low') return;
  ensureTextures(scene);
  burst(scene, x, y, {
    texture: 'vfx-dot',
    count: 5,
    speed: { min: 40, max: 80 },
    angle: { min: 160, max: 380 },
    lifespan: { min: 350, max: 500 },
    scale: { start: 0.5, end: 0.8 },
    alpha: { start: 0.5, end: 0 },
    tint: THEME.NICHE_FLOOR,
    depth: -5,
  });
}

/** Переключатель качества: авто или вручную (слабые устройства). */
export function setVfxTier(t: VfxTier): void {
  tier = t;
}
