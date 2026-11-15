import Phaser from 'phaser';
import {
  ACCESSORY_LABEL,
  BODY_COLOR_LABEL,
  BODY_FORM_LABEL,
  COLOR_HEX,
  EYES_LABEL,
  HEAD_COLOR_LABEL,
  HEAD_FORM_LABEL,
} from '../game/attributes';
import type { DocFieldId, PassDoc } from '../game/application';
import { drawHardShadow, FONT, INK_HEX, THEME } from './theme';

const CARD_W = 300;
const CARD_H = 420;

/** Центры рядов полей. Шапка занимает верх, срок/подпись — нижний ряд. */
const ROWS: Record<DocFieldId, number> = {
  head: -104,
  body: -40,
  eyes: 24,
  accessory: 88,
  expiry: 150,
  signature: 150,
};

export interface PassCardOptions {
  /** Лупа куплена: тап по полю подсвечивает признак (ГДД разд. 5). */
  interactiveFields?: boolean;
  onFieldTap?: (field: DocFieldId) => void;
}

/**
 * Пропуск «Мульт-поп»: белая карточка в ink-обводке, оранжевая шапка, перфорация-корешок,
 * штамп с squash и shake (спека §4.4). Ряды: метка капсом + значение одной строкой.
 * Подсветки полей — механика, только цвета из THEME.
 */
export class PassCard extends Phaser.GameObjects.Container {
  private overlays = new Map<DocFieldId, Phaser.GameObjects.Rectangle>();
  private opts: PassCardOptions = {};

  constructor(
    scene: Phaser.Scene,
    doc: PassDoc,
    cx: number,
    cy: number,
    opts: PassCardOptions = {},
  ) {
    super(scene, cx, cy);
    this.opts = opts;
    scene.add.existing(this);

    const shadow = scene.add.graphics();
    drawHardShadow(shadow, -CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 18);

    const bg = scene.add.graphics();
    bg.fillStyle(THEME.PAPER, 1);
    bg.fillRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 18);
    // Шапка (верхние углы скруглены, нижние — прямые под обводкой)
    bg.fillStyle(THEME.ACCENT, 1);
    bg.fillRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, 64, { tl: 18, tr: 18, bl: 0, br: 0 });
    bg.lineStyle(5, THEME.INK, 1);
    bg.strokeRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 18);
    this.add([shadow, bg]);

    // Перфорация-корешок: полупрозрачные чернильные точки (фон за картой двуцветный)
    const perf = scene.add.graphics();
    perf.fillStyle(THEME.INK, 0.15);
    for (let i = 0; i < 8; i++) {
      perf.fillCircle(-138, -120 + i * 40, 6);
    }
    this.add(perf);

    this.add(
      scene.add
        .text(10, -CARD_H / 2 + 32, 'ПРОПУСК', {
          fontFamily: FONT,
          fontSize: '26px',
          color: '#ffffff',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setStroke(INK_HEX, 3),
    );
    this.add(scene.add.circle(-78, -CARD_H / 2 + 32, 9, 0xffffff, 0.85));

    this.addRow(scene, 'head', miniHead(scene, doc), 'Голова', `${HEAD_FORM_LABEL[doc.headForm]} · ${HEAD_COLOR_LABEL[doc.headColor]}`);
    this.addRow(scene, 'body', miniBody(scene, doc), 'Тело', `${BODY_FORM_LABEL[doc.bodyForm]} · ${BODY_COLOR_LABEL[doc.bodyColor]}`);
    this.addRow(scene, 'eyes', miniEyes(scene, doc), 'Глаза', EYES_LABEL[doc.eyes]);
    this.addRow(scene, 'accessory', miniAccessory(scene, doc), 'Аксессуар', ACCESSORY_LABEL[doc.accessory]);

    // Документные признаки: срок действия и подпись (ГДД разд. 3.1)
    this.add(
      scene.add
        .text(-CARD_W / 2 + 34, 138, 'Срок', {
          fontFamily: FONT,
          fontSize: '11px',
          color: INK_HEX,
          fontStyle: 'bold',
        })
        .setOrigin(0, 0.5)
        .setAlpha(0.55),
    );
    this.add(
      scene.add
        .text(-CARD_W / 2 + 34, 160, `Годен до: день ${doc.expiry}`, {
          fontFamily: FONT,
          fontSize: '17px',
          color: INK_HEX,
          fontStyle: 'bold',
        })
        .setOrigin(0, 0.5),
    );

    const sig = scene.add.graphics();
    if (doc.signature) {
      sig.lineStyle(4, THEME.SUCCESS, 1);
      sig.lineBetween(0, 0, 8, 9);
      sig.lineBetween(8, 9, 22, -10);
    } else {
      sig.lineStyle(4, THEME.ERROR, 1);
      sig.lineBetween(-9, -9, 9, 9);
      sig.lineBetween(9, -9, -9, 9);
    }
    this.add(scene.add.container(CARD_W / 2 - 44, 146, [sig]));
    this.add(
      scene.add
        .text(CARD_W / 2 - 44, 170, doc.signature ? 'подпись' : 'нет подписи', {
          fontFamily: FONT,
          fontSize: '13px',
          color: INK_HEX,
        })
        .setOrigin(0.5)
        .setAlpha(0.75),
    );
    if (opts.interactiveFields) this.addFieldHit(scene, 'expiry', -52, 148, 180, 56);
    if (opts.interactiveFields) this.addFieldHit(scene, 'signature', 106, 148, 120, 56);

    // Подсветки документных признаков — механика, только цвета из THEME
    this.overlays.set('expiry', this.makeOverlay(-52, 148, 180, 56));
    this.overlays.set('signature', this.makeOverlay(106, 148, 120, 56));
  }

  private addRow(
    scene: Phaser.Scene,
    id: DocFieldId,
    icon: Phaser.GameObjects.Graphics,
    label: string,
    value: string,
  ): void {
    const y = ROWS[id];
    const overlay = this.makeOverlay(-30, y, 250, 56);
    // подложка ряда — тёплая полоса, структурирует карточку
    const rowBg = scene.add.graphics();
    rowBg.fillStyle(THEME.NICHE, 0.55);
    rowBg.fillRoundedRect(-118, y - 27, 248, 54, 12);
    const iconC = scene.add.container(-94, y, [icon]);
    const labelText = scene.add
      .text(-62, y - 14, label.toUpperCase(), {
        fontFamily: FONT,
        fontSize: '11px',
        color: INK_HEX,
        fontStyle: 'bold',
      })
      .setOrigin(0, 0.5)
      .setAlpha(0.55);
    const valueText = scene.add
      .text(-62, y + 10, value, {
        fontFamily: FONT,
        fontSize: '15px',
        color: INK_HEX,
        fontStyle: 'bold',
        wordWrap: { width: 214 },
      })
      .setOrigin(0, 0.5);
    this.add([rowBg, iconC, labelText, valueText]);
    if (this.opts.interactiveFields) this.addFieldHit(scene, id, -20, y, 250, 56);
    this.overlays.set(id, overlay);
  }

  private makeOverlay(x: number, y: number, w: number, h: number): Phaser.GameObjects.Rectangle {
    const ov = this.scene!.add
      .rectangle(x, y, w, h, THEME.ERROR, 0.22)
      .setStrokeStyle(2, THEME.INK, 0.6)
      .setAlpha(0);
    this.add(ov);
    return ov;
  }

  private addFieldHit(
    scene: Phaser.Scene,
    id: DocFieldId,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const hit = scene.add
      .rectangle(x, y, w, h, 0xffffff, 0.001)
      .setInteractive({ useHandCursor: true });
    hit.on('pointerup', () => this.opts.onFieldTap?.(id));
    this.add(hit);
  }

  /** Подсветка несовпавшего поля — остаётся видимой до ухода заявки (ГДД разд. 8). */
  flashField(id: DocFieldId): void {
    const ov = this.overlays.get(id);
    if (!ov || !this.scene) return;
    ov.setAlpha(0.45);
    this.scene.tweens.add({ targets: ov, alpha: 0.22, duration: 700 });
  }

  /** Мягкая жёлтая подсветка поля (Лупа) — гаснет сама. */
  softHighlight(field: DocFieldId): void {
    if (!this.scene) return;
    const y = ROWS[field];
    const x = field === 'expiry' ? -52 : field === 'signature' ? 106 : -30;
    const w = field === 'expiry' ? 180 : field === 'signature' ? 120 : 250;
    const rect = this.scene.add.rectangle(x, y, w, 56, THEME.GOLD, 0.4);
    this.add(rect);
    this.scene.tweens.add({
      targets: rect,
      alpha: 0,
      delay: 600,
      duration: 500,
      onComplete: () => rect.destroy(),
    });
  }

  /** Штамп решения: scale 2.4→1 Back.Out + squash + shake камеры (спека §4.4, juice №1). */
  showStamp(ok: boolean): void {
    if (!this.scene) return;
    const color = ok ? THEME.SUCCESS : THEME.ERROR;
    const g = this.scene.add.graphics();
    g.lineStyle(5, color, 1);
    g.strokeRoundedRect(-98, -35, 196, 70, 10);
    const hex = ok ? '#3ec46d' : '#ff4757';
    const t = this.scene.add
      .text(0, 0, ok ? 'ПРОПУСК' : 'ОТКАЗ', {
        fontFamily: FONT,
        fontSize: '34px',
        color: hex,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setLetterSpacing(3);
    const stamp = this.scene.add.container(0, 30, [g, t]).setAngle(-12).setAlpha(0.95).setScale(2.4);
    this.add(stamp);
    this.scene.tweens.add({
      targets: stamp,
      scale: 1,
      duration: 180,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.scene?.tweens.add({
          targets: stamp,
          scaleX: 1.15,
          scaleY: 0.85,
          duration: 60,
          yoyo: true,
        });
        this.scene?.cameras.main.shake(120, 0.004);
      },
    });
  }
}

function miniHead(scene: Phaser.Scene, doc: PassDoc): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  const color = COLOR_HEX[doc.headColor];
  switch (doc.headForm) {
    case 'circle':
      g.fillStyle(color, 1);
      g.fillCircle(0, 0, 18);
      g.lineStyle(2, THEME.INK, 1);
      g.strokeCircle(0, 0, 18);
      break;
    case 'square':
      g.fillStyle(color, 1);
      g.fillRect(-15, -15, 30, 30);
      g.lineStyle(2, THEME.INK, 1);
      g.strokeRect(-15, -15, 30, 30);
      break;
    case 'triangle': {
      const pts = [new Phaser.Geom.Point(0, -18), new Phaser.Geom.Point(-17, 13), new Phaser.Geom.Point(17, 13)];
      g.fillStyle(color, 1);
      g.fillPoints(pts, true);
      g.lineStyle(2, THEME.INK, 1);
      g.strokePoints(pts, true);
      break;
    }
    case 'hexagon': {
      const pts: Phaser.Geom.Point[] = [];
      for (let i = 0; i < 6; i++) {
        const a = Phaser.Math.DegToRad(-90 + i * 60);
        pts.push(new Phaser.Geom.Point(Math.cos(a) * 19, Math.sin(a) * 19));
      }
      g.fillStyle(color, 1);
      g.fillPoints(pts, true);
      g.lineStyle(2, THEME.INK, 1);
      g.strokePoints(pts, true);
      break;
    }
  }
  return g;
}

function miniBody(scene: Phaser.Scene, doc: PassDoc): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  const color = COLOR_HEX[doc.bodyColor];
  switch (doc.bodyForm) {
    case 'rect':
      g.fillStyle(color, 1);
      g.fillRect(-16, -13, 32, 26);
      g.lineStyle(2, THEME.INK, 1);
      g.strokeRect(-16, -13, 32, 26);
      break;
    case 'trapezoid': {
      const pts = [
        new Phaser.Geom.Point(-14, -13),
        new Phaser.Geom.Point(14, -13),
        new Phaser.Geom.Point(18, 13),
        new Phaser.Geom.Point(-18, 13),
      ];
      g.fillStyle(color, 1);
      g.fillPoints(pts, true);
      g.lineStyle(2, THEME.INK, 1);
      g.strokePoints(pts, true);
      break;
    }
    case 'oval':
      g.fillStyle(color, 1);
      g.fillEllipse(0, 0, 32, 26);
      g.lineStyle(2, THEME.INK, 1);
      g.strokeEllipse(0, 0, 32, 26);
      break;
  }
  return g;
}

function miniEyes(scene: Phaser.Scene, doc: PassDoc): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.lineStyle(2, THEME.INK, 1);
  g.strokeCircle(0, 0, 18);
  g.fillStyle(THEME.INK, 1);
  if (doc.eyes === 'dots') {
    g.fillCircle(-7, -4, 4);
    g.fillCircle(7, -4, 4);
  } else {
    g.fillRect(-12, -7, 9, 4);
    g.fillRect(3, -7, 9, 4);
  }
  return g;
}

function miniAccessory(scene: Phaser.Scene, doc: PassDoc): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  if (doc.accessory === 'hat') {
    g.fillStyle(THEME.INK, 1);
    g.fillRect(-16, -2, 32, 5);
    g.fillRect(-10, -14, 20, 13);
  } else if (doc.accessory === 'antenna') {
    g.fillStyle(THEME.INK, 1);
    g.fillRect(-2, -12, 4, 16);
    g.fillCircle(0, -15, 5);
  } else {
    g.lineStyle(3, THEME.INK, 1);
    g.lineBetween(-9, 0, 9, 0);
  }
  return g;
}
