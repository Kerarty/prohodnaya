import Phaser from 'phaser';
import { drawHardShadow, FONT, INK_HEX, THEME } from '../src/render/theme';
import {
  drawCharacter,
  guestDeflate,
  guestReact,
  highlightField,
  startBreathing,
} from '../src/render/characterRenderer';
import type { CharacterAttrs } from '../src/game/attributes';

/**
 * Промо-рендер «Проходной» (Checkpoint) — только для подачи на CrazyGames.
 *
 * Требования CG (docs.crazygames.com/requirements/game-covers):
 * — 3 обложки: 1920×1080 (16:9), 800×1200 (2:3), 800×800 (1:1), единый стиль;
 * — на обложке только название игры стилизованным шрифтом, без рамок/логотипов;
 * — превью-видео 1080p 16:9 и 1080p 2:3, 15–20 с, без звука, первый кадр = обложка.
 *
 * Арт — те же Graphics-примитивы, что в игре (theme + characterRenderer), ноль
 * растровых ассетов. Композиции авторованы в «базовых координатах» каждого
 * формата; video-portrait (1080×1620) = портретная композиция с zoom 1.35,
 * поэтому первый кадр видео точно повторяет обложку.
 */

export type PromoMode =
  | 'cover-landscape'
  | 'cover-portrait'
  | 'cover-square'
  | 'video-landscape'
  | 'video-portrait';

export interface PromoSpec {
  width: number;
  height: number;
  /** zoom камеры: мир рисуется в базовых координатах композиции. */
  zoom: number;
  video: boolean;
}

export const MODE_SPECS: Record<PromoMode, PromoSpec> = {
  'cover-landscape': { width: 1920, height: 1080, zoom: 1, video: false },
  'cover-portrait': { width: 800, height: 1200, zoom: 1, video: false },
  'cover-square': { width: 800, height: 800, zoom: 1, video: false },
  'video-landscape': { width: 1920, height: 1080, zoom: 1, video: true },
  // 1080×1620 = 2:3, «1080p» по ширине (требование CG); мир = 800×1200 × 1.35
  'video-portrait': { width: 1080, height: 1620, zoom: 1620 / 1200, video: true },
};

/** Геометрия базовой композиции (в единицах дизайна конкретного формата). */
interface BaseGeom {
  W: number;
  H: number;
  /** Низ стены = верх пола. */
  wallEnd: number;
  counterTopY: number;
  counterBodyY: number;
  niche: { x: number; y: number; w: number; h: number };
  nicheFloor: { x: number; y: number; w: number; h: number };
  plaque: { x: number; y: number; w: number; h: number; textSize: number; bulbs: number };
  /** Карточка пропуска на стойке. */
  card: { x: number; y: number; scale: number; rot: number };
  /** Место гостя в нише (точка-«пятки» = cy + 120·scale). */
  spot: { x: number; cy: number; scale: number };
  walkY: number;
  offLeft: number;
  offRight: number;
  clouds: Array<{ x: number; y: number; k: number }>;
  sideGuests: Array<{ attrs: CharacterAttrs; x: number; cy: number; scale: number }>;
}

const GEOMS: Record<'landscape' | 'portrait' | 'square', BaseGeom> = {
  landscape: {
    W: 1920,
    H: 1080,
    wallEnd: 780,
    counterTopY: 880,
    counterBodyY: 930,
    niche: { x: 900, y: 330, w: 560, h: 460 },
    nicheFloor: { x: 920, y: 640, w: 520, h: 140 },
    plaque: { x: 140, y: 135, w: 880, h: 150, textSize: 96, bulbs: 10 },
    card: { x: 560, y: 945, scale: 0.85, rot: -0.06 },
    spot: { x: 1180, cy: 607, scale: 1.15 },
    walkY: 607,
    offLeft: -160,
    offRight: 2080,
    clouds: [
      { x: 250, y: 160, k: 1.2 },
      { x: 1680, y: 180, k: 1.35 },
      { x: 1120, y: 110, k: 0.9 },
      { x: 430, y: 330, k: 0.7 },
    ],
    sideGuests: [
      {
        attrs: { headForm: 'square', headColor: 'red', bodyForm: 'trapezoid', bodyColor: 'blue', eyes: 'stripes', accessory: 'antenna' },
        x: 170,
        cy: 754,
        scale: 0.8,
      },
      {
        attrs: { headForm: 'hexagon', headColor: 'green', bodyForm: 'rect', bodyColor: 'orange', eyes: 'dots', accessory: 'hat' },
        x: 1770,
        cy: 760,
        scale: 0.72,
      },
    ],
  },
  portrait: {
    W: 800,
    H: 1200,
    wallEnd: 740,
    counterTopY: 1000,
    counterBodyY: 1045,
    niche: { x: 185, y: 360, w: 430, h: 400 },
    nicheFloor: { x: 205, y: 615, w: 390, h: 125 },
    plaque: { x: 80, y: 75, w: 640, h: 130, textSize: 76, bulbs: 8 },
    card: { x: 400, y: 1060, scale: 0.9, rot: -0.05 },
    spot: { x: 400, cy: 610, scale: 1 },
    walkY: 610,
    offLeft: -140,
    offRight: 940,
    clouds: [
      { x: 110, y: 280, k: 0.9 },
      { x: 690, y: 330, k: 1.1 },
      { x: 180, y: 540, k: 0.6 },
    ],
    sideGuests: [
      {
        attrs: { headForm: 'circle', headColor: 'blue', bodyForm: 'rect', bodyColor: 'yellow', eyes: 'dots', accessory: 'none' },
        x: 140,
        cy: 880,
        scale: 0.75,
      },
    ],
  },
  square: {
    W: 800,
    H: 800,
    wallEnd: 500,
    counterTopY: 640,
    counterBodyY: 678,
    niche: { x: 200, y: 185, w: 400, h: 330 },
    nicheFloor: { x: 218, y: 400, w: 364, h: 105 },
    plaque: { x: 70, y: 48, w: 660, h: 115, textSize: 64, bulbs: 8 },
    card: { x: 400, y: 690, scale: 0.72, rot: -0.04 },
    spot: { x: 400, cy: 388, scale: 0.85 },
    walkY: 388,
    offLeft: -140,
    offRight: 940,
    clouds: [
      { x: 120, y: 150, k: 0.8 },
      { x: 680, y: 190, k: 0.9 },
    ],
    sideGuests: [],
  },
};

/** Гость обложки — в нише с первого кадра (та же связка форм, что в игре). */
const COVER_GUEST: CharacterAttrs = {
  headForm: 'hexagon',
  headColor: 'orange',
  bodyForm: 'trapezoid',
  bodyColor: 'blue',
  eyes: 'stripes',
  accessory: 'hat',
};

/** Очередь гостей видео: показать/пропустить → показать/развернуть → показать. */
const VIDEO_GUESTS: Array<{ attrs: CharacterAttrs; ok: boolean; field: 'head' | 'body' | 'accessory' }> = [
  { attrs: { headForm: 'square', headColor: 'red', bodyForm: 'rect', bodyColor: 'green', eyes: 'dots', accessory: 'hat' }, ok: true, field: 'body' },
  { attrs: { headForm: 'circle', headColor: 'purple', bodyForm: 'oval', bodyColor: 'yellow', eyes: 'stripes', accessory: 'antenna' }, ok: false, field: 'accessory' },
  { attrs: { headForm: 'triangle', headColor: 'blue', bodyForm: 'trapezoid', bodyColor: 'orange', eyes: 'dots', accessory: 'none' }, ok: true, field: 'head' },
];

/** Таймлайн видео, мс (19 с: запись стартует на promo-ready ≈ +400 мс). */
const TIMELINE = {
  firstHighlight: 2500,
  firstStamp: 3000,
  coverExit: 3600,
  guestSlots: [
    { enter: 5200, highlight: 6800, stamp: 7300, exit: 7900 },
    { enter: 9300, highlight: 10900, stamp: 11400, exit: 12000 },
    { enter: 13400, highlight: 15000, stamp: 15500, exit: 16100 },
  ],
  finale: 17000,
  done: 19000,
};

export class PromoScene extends Phaser.Scene {
  private spec!: PromoSpec;
  private geom!: BaseGeom;
  private bulbs: Phaser.GameObjects.Arc[] = [];
  private titleText: Phaser.GameObjects.Text | null = null;
  private coverGuest: Phaser.GameObjects.Container | null = null;
  private cardWorld = { x: 0, y: 0, scale: 1, rot: 0 };

  constructor() {
    super('promo');
  }

  create(): void {
    const mode = (this.game.registry.get('mode') as PromoMode) ?? 'cover-landscape';
    this.spec = MODE_SPECS[mode];
    const base = mode.includes('landscape') ? 'landscape' : mode.includes('square') ? 'square' : 'portrait';
    this.geom = GEOMS[base];

    this.cameras.main.setZoom(this.spec.zoom);
    this.cameras.main.centerOn(this.geom.W / 2, this.geom.H / 2);

    this.drawBackdrop();
    this.drawNiche();
    this.drawSideGuests();
    this.coverGuest = drawCharacter(this, COVER_GUEST, this.geom.spot.x, this.geom.spot.cy, this.geom.spot.scale);
    startBreathing(this.coverGuest, this.geom.spot.scale);
    this.drawCounter();
    this.cardWorld = this.geom.card;
    this.drawMiniCard(this.geom.card);
    this.drawTitle();

    if (this.spec.video) this.startTimeline();

    // Кадр готов: main.ts снимает обложку / включает запись (первый кадр = обложка)
    this.time.delayedCall(400, () => this.game.events.emit('promo-ready'));
  }

  /** Счётчик живости цикла: automation проверяет его перед записью видео. */
  update(): void {
    const w = window as unknown as { __promoFrame?: number };
    w.__promoFrame = (w.__promoFrame ?? 0) + 1;
  }

  // — фон —

  private drawBackdrop(): void {
    const g = this.add.graphics().setDepth(-10);
    const { W, H, wallEnd, clouds } = this.geom;

    g.fillStyle(THEME.BG_WALL, 1);
    g.fillRect(0, 0, W, wallEnd);
    g.fillStyle(THEME.INK, 0.06);
    g.fillRect(0, wallEnd - 24, W, 24);
    g.fillStyle(THEME.BG_FLOOR, 1);
    g.fillRect(0, wallEnd, W, H - wallEnd);
    g.lineStyle(3, THEME.INK, 0.12);
    g.lineBetween(0, wallEnd, W, wallEnd);

    for (const c of clouds) this.drawCloud(g, c.x, c.y, c.k);
  }

  private drawCloud(g: Phaser.GameObjects.Graphics, x: number, y: number, k: number): void {
    g.fillStyle(THEME.CLOUD, 0.75);
    g.fillCircle(x, y, 30 * k);
    g.fillCircle(x - 38 * k, y + 8 * k, 22 * k);
    g.fillCircle(x + 38 * k, y + 8 * k, 22 * k);
    g.fillEllipse(x, y + 12 * k, 96 * k, 30 * k);
  }

  private drawNiche(): void {
    const g = this.add.graphics().setDepth(-8);
    const n = this.geom.niche;
    const f = this.geom.nicheFloor;

    g.fillStyle(THEME.NICHE, 1);
    g.fillRoundedRect(n.x, n.y, n.w, n.h, 24);
    g.lineStyle(5, THEME.INK, 1);
    g.strokeRoundedRect(n.x, n.y, n.w, n.h, 24);
    // стойки-косяки по краям, как в booth.ts
    g.fillStyle(THEME.PANEL, 1);
    g.fillRoundedRect(n.x - 14, n.y - 6, 26, n.h + 12, 10);
    g.lineStyle(4, THEME.INK, 1);
    g.strokeRoundedRect(n.x - 14, n.y - 6, 26, n.h + 12, 10);
    g.fillRoundedRect(n.x + n.w - 12, n.y - 6, 26, n.h + 12, 10);
    g.strokeRoundedRect(n.x + n.w - 12, n.y - 6, 26, n.h + 12, 10);
    g.fillStyle(THEME.NICHE_FLOOR, 1);
    g.fillRoundedRect(f.x, f.y, f.w, f.h, 16);
  }

  private drawCounter(): void {
    const g = this.add.graphics().setDepth(5);
    const { W, H, counterTopY, counterBodyY } = this.geom;

    g.fillStyle(THEME.COUNTER_BODY, 1);
    g.fillRect(0, counterBodyY, W, H - counterBodyY);
    g.fillStyle(THEME.COUNTER_TOP, 1);
    g.fillRect(0, counterTopY, W, counterBodyY - counterTopY);
    g.lineStyle(4, THEME.INK, 1);
    g.lineBetween(0, counterTopY, W, counterTopY);
    g.lineBetween(0, counterBodyY, W, counterBodyY);
    // уголки-заклёпки на столешнице
    g.fillStyle(THEME.INK, 0.15);
    for (let x = 40; x < W; x += 240) {
      g.fillCircle(x, counterBodyY + 28, 7);
    }
  }

  private drawSideGuests(): void {
    for (const s of this.geom.sideGuests) {
      const c = drawCharacter(this, s.attrs, s.x, s.cy, s.scale);
      startBreathing(c, s.scale);
    }
  }

  // — вывеска с названием —

  private drawTitle(): void {
    const p = this.geom.plaque;
    const g = this.add.graphics().setDepth(1);
    drawHardShadow(g, p.x, p.y, p.w, p.h, 24, 8);
    g.fillStyle(THEME.PANEL, 1);
    g.fillRoundedRect(p.x, p.y, p.w, p.h, 24);
    g.lineStyle(5, THEME.INK, 1);
    g.strokeRoundedRect(p.x, p.y, p.w, p.h, 24);

    // лампочки вдоль верхнего края
    this.bulbs = [];
    const margin = 44;
    const step = (p.w - margin * 2) / (p.bulbs - 1);
    for (let i = 0; i < p.bulbs; i++) {
      const bx = p.x + margin + i * step;
      const bulb = this.add.circle(bx, p.y + 22, 11, THEME.GOLD, 1).setDepth(2);
      this.bulbs.push(bulb);
    }

    const cy = p.y + p.h / 2 + 14;
    this.titleText = this.add
      .text(p.x + p.w / 2, cy, 'CHECKPOINT', {
        fontFamily: FONT,
        fontSize: `${p.textSize}px`,
        fontStyle: 'bold',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setStroke(INK_HEX, Math.max(5, Math.round(p.textSize / 14)))
      .setDepth(2);
    if ('letterSpacing' in (this.titleText.style as object)) {
      this.titleText.setLetterSpacing(2);
    }
  }

  private waveBulbs(fast = false): void {
    this.bulbs.forEach((bulb, i) => {
      this.tweens.add({
        targets: bulb,
        alpha: { from: 1, to: THEME.BULB_OFF_A },
        duration: fast ? 300 : 600,
        yoyo: true,
        repeat: -1,
        delay: i * (fast ? 45 : 90),
      });
    });
  }

  // — пропуск на стойке (свой мини-рендер: только метки, без текста — на обложке
  //   допустимо только название игры) —

  private drawMiniCard(card: { x: number; y: number; scale: number; rot: number }): void {
    const W = 420;
    const H = 260;
    const c = this.add.container(card.x, card.y).setDepth(10).setScale(card.scale).setRotation(card.rot);

    const g = this.add.graphics();
    drawHardShadow(g, -W / 2, -H / 2, W, H, 18);
    g.fillStyle(THEME.PAPER, 1);
    g.fillRoundedRect(-W / 2, -H / 2, W, H, 18);
    g.fillStyle(THEME.ACCENT, 1);
    g.fillRoundedRect(-W / 2, -H / 2, W, 64, { tl: 18, tr: 18, bl: 0, br: 0 });
    g.lineStyle(5, THEME.INK, 1);
    g.strokeRoundedRect(-W / 2, -H / 2, W, H, 18);
    c.add(g);

    // перфорация-корешок слева
    const perf = this.add.graphics();
    perf.fillStyle(THEME.INK, 0.15);
    for (let i = 0; i < 6; i++) perf.fillCircle(-W / 2 + 28, -60 + i * 36, 5);
    c.add(perf);

    // шапка: кружок-фото + строка названия
    const head = this.add.graphics();
    head.fillStyle(0xffffff, 0.85);
    head.fillCircle(-W / 2 + 72, -H / 2 + 32, 11);
    head.fillRoundedRect(-W / 2 + 96, -H / 2 + 22, 190, 20, 10);
    c.add(head);

    // 3 ряда признаков: иконка-окно + «строки значения» (без текста)
    const rows = this.add.graphics();
    const rowY = [-18, 32, 82];
    rowY.forEach((y, idx) => {
      rows.fillStyle(THEME.NICHE, 1);
      rows.fillRoundedRect(-W / 2 + 62, y - 22, 44, 44, 8);
      rows.lineStyle(3, THEME.INK, 1);
      rows.strokeRoundedRect(-W / 2 + 62, y - 22, 44, 44, 8);
      rows.fillStyle(THEME.INK, 0.12);
      rows.fillRoundedRect(-W / 2 + 120, y - 10, 190, 20, 10);
      rows.fillRoundedRect(-W / 2 + 120, y + 4, 120, 12, 6);
      // иконки признаков — те же формы, что у гостей
      const ix = -W / 2 + 84;
      if (idx === 0) {
        rows.fillStyle(THEME.ACCENT, 1);
        rows.fillCircle(ix, y, 12);
      } else if (idx === 1) {
        rows.fillStyle(THEME.SUCCESS, 1);
        rows.fillRoundedRect(ix - 11, y - 9, 22, 18, 4);
      } else {
        rows.fillStyle(THEME.INK, 1);
        rows.fillCircle(ix - 6, y, 3.5);
        rows.fillCircle(ix + 6, y, 3.5);
      }
    });
    c.add(rows);

    // пустой штамп (в видео на него «плюхается» вердикт)
    const stampSlot = this.add.graphics();
    stampSlot.lineStyle(6, THEME.GOLD, 0.9);
    stampSlot.strokeCircle(W / 2 - 96, H / 2 - 84, 40);
    c.add(stampSlot);
  }

  // — вердикт —

  private lastStamp: Phaser.GameObjects.Container | null = null;

  private stamp(ok: boolean): void {
    const { x, y, scale, rot } = this.cardWorld;
    // один вердикт на карточке: прошлый штамп уходит, новый плюхается
    this.lastStamp?.destroy();
    const c = this.add
      .container(x + 128 * scale, y + 66 * scale)
      .setDepth(20)
      .setScale(scale * 1.8)
      .setRotation(rot + 0.28)
      .setAlpha(0.95);

    const g = this.add.graphics();
    const color = ok ? THEME.SUCCESS : THEME.ERROR;
    g.lineStyle(9, color, 0.9);
    g.strokeCircle(0, 0, 46);
    if (ok) {
      g.lineBetween(-20, 2, -6, 16);
      g.lineBetween(-6, 16, 22, -14);
    } else {
      g.lineBetween(-16, -16, 16, 16);
      g.lineBetween(-16, 16, 16, -16);
    }
    c.add(g);

    this.lastStamp = c;
    this.tweens.add({ targets: c, scale: scale, duration: 180, ease: 'Back.easeOut' });
  }

  private flash(ok: boolean): void {
    const { W, H } = this.geom;
    const rect = this.add
      .rectangle(W / 2, H / 2, W * 2, H * 2, ok ? THEME.SUCCESS : THEME.ERROR, THEME.FLASH_A)
      .setDepth(30);
    this.tweens.add({ targets: rect, alpha: 0, duration: 420, onComplete: () => rect.destroy() });
  }

  // — движение гостей —

  private walkTo(c: Phaser.GameObjects.Container, x: number, cy: number, dur: number, onDone: () => void): void {
    const bob = this.tweens.add({
      targets: c,
      y: cy - 10,
      duration: 260,
      yoyo: true,
      repeat: Math.ceil(dur / 520),
    });
    this.tweens.add({
      targets: c,
      x,
      duration: dur,
      ease: 'Linear',
      onComplete: () => {
        bob.stop();
        c.setY(cy);
        onDone();
      },
    });
  }

  private walkOff(c: Phaser.GameObjects.Container): void {
    // выходим с текущей высоты (гость из ниши и пришедшие — на одной линии)
    this.walkTo(c, this.geom.offRight, c.y, 1200, () => c.destroy());
  }

  private spawnGuest(
    g: { attrs: CharacterAttrs; ok: boolean; field: 'head' | 'body' | 'accessory' },
    slot: { highlight: number; stamp: number; exit: number },
    at: (ms: number, fn: () => void) => void,
  ): void {
    const { offLeft, spot } = this.geom;
    const guest = drawCharacter(this, g.attrs, offLeft, spot.cy, spot.scale);
    startBreathing(guest, spot.scale);
    this.walkTo(guest, spot.x, spot.cy, 1600, () => {
      // слоты заданы в абсолютном времени таймлайна — после прихода переводим
      // их в относительные задержки от момента прихода (walkTo 1600 мс)
      const t0 = this.time.now;
      const rel = (ms: number): number => Math.max(0, ms - t0);
      at(rel(slot.highlight), () => highlightField(guest, g.field));
      at(rel(slot.stamp), () => {
        this.stamp(g.ok);
        this.flash(g.ok);
        guestReact(guest, g.ok ? 'ok' : 'reject');
        if (!g.ok) this.time.delayedCall(120, () => guestDeflate(guest));
      });
      at(rel(slot.exit), () => this.walkOff(guest));
    });
  }

  // — таймлайн видео —

  private startTimeline(): void {
    const cover = this.coverGuest;
    if (!cover) return;
    const t = TIMELINE;
    const at = (ms: number, fn: () => void): void => this.time.delayedCall(ms, fn);

    this.waveBulbs();

    // свой гость: проверка головы → штамп «пропустить» → уходит
    at(t.firstHighlight, () => highlightField(cover, 'head'));
    at(t.firstStamp, () => {
      this.stamp(true);
      this.flash(true);
      guestReact(cover, 'ok');
    });
    at(t.coverExit, () => this.walkOff(cover));

    t.guestSlots.forEach((slot, i) => {
      at(t.guestSlots[i].enter - 200, () => this.spawnGuest(VIDEO_GUESTS[i], slot, at));
    });

    // финал: пульс вывески + быстрая волна лампочек
    at(t.finale, () => {
      this.waveBulbs(true);
      if (this.titleText) {
        this.tweens.add({
          targets: this.titleText,
          scaleY: { from: 1, to: 1.06 },
          duration: 250,
          yoyo: true,
          repeat: 3,
        });
      }
    });

    at(t.done, () => this.game.events.emit('promo-done'));
  }
}
