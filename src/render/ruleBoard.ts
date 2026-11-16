import Phaser from 'phaser';
import { COLOR_HEX } from '../game/attributes';
import type { BodyForm, HeadForm } from '../game/attributes';
import type { Rule } from '../game/rules';
import { drawHardShadow, FONT, INK_HEX, THEME } from './theme';
import { t } from '../i18n';
import { ruleText } from '../i18n/labels';

const ROW_H = 56;

export interface RuleBoardView {
  board: Phaser.GameObjects.Container;
  /** Пульс + волна лампочек — при старте смены/новом правиле (спека §4.2). */
  pulse(): void;
}

/** Доска правил: белая табличка в ink-обводке, заголовок-плашка, лампочки (спека §4.2). */
export function drawRuleBoard(
  scene: Phaser.Scene,
  rules: readonly Rule[],
  cx: number,
  cy: number,
  width: number,
): RuleBoardView {
  const board = scene.add.container(cx, cy);

  const rowH = ROW_H;
  const height = 64 + rules.length * rowH; // формула не меняется — чек-лист приёмки
  const half = height / 2;

  const shadow = scene.add.graphics();
  drawHardShadow(shadow, -width / 2, -half, width, height, 20);

  const bg = scene.add.graphics();
  bg.fillStyle(THEME.PAPER, 1);
  bg.fillRoundedRect(-width / 2, -half, width, height, 20);
  bg.lineStyle(5, THEME.INK, 1);
  bg.strokeRoundedRect(-width / 2, -half, width, height, 20);
  board.add([shadow, bg]);

  // Заголовок на оранжевой плашке
  const head = scene.add.graphics();
  head.fillStyle(THEME.ACCENT, 1);
  head.fillRoundedRect(-160, -half + 10, 320, 40, 10);
  head.lineStyle(3, THEME.INK, 1);
  head.strokeRoundedRect(-160, -half + 10, 320, 40, 10);
  board.add(head);
  board.add(
    scene.add
      .text(0, -half + 30, t('rulesTitle'), { fontFamily: FONT, fontSize: '26px', color: '#ffffff', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setStroke(INK_HEX, 3),
  );

  rules.forEach((rule, i) => {
    const y = -half + 92 + i * rowH;
    // подложка ряда — структурирует список
    const rowBg = scene.add.graphics();
    rowBg.fillStyle(THEME.NICHE, 0.55);
    rowBg.fillRoundedRect(-width / 2 + 14, y - 25, width - 28, 50, 12);
    board.add(rowBg);
    board.add(
      scene.add
        .text(-width / 2 + 34, y, ruleText(rule.id), {
          fontFamily: FONT,
          fontSize: '20px',
          color: INK_HEX,
          // до пиктограммы места ~440px: узкая обёртка давала лишние переносы
          wordWrap: { width: 440 },
        })
        .setOrigin(0, 0.5),
    );
    board.add(ruleIcon(scene, -width / 2 + width - 48, y, rule));
  });

  // Лампочки: углы + середины сторон
  const bulbs: Phaser.GameObjects.Arc[] = [];
  const bx = width / 2 - 14;
  const by = half - 14;
  const positions: Array<[number, number]> = [
    [-bx, -by],
    [0, -by],
    [bx, -by],
    [-bx, 0],
    [bx, 0],
    [-bx, by],
    [0, by],
    [bx, by],
  ];
  for (const [px, py] of positions) {
    const bulb = scene.add.circle(px, py, 4, THEME.GOLD).setAlpha(THEME.BULB_OFF_A);
    board.add(bulb);
    bulbs.push(bulb);
  }

  const pulse = (): void => {
    scene.tweens.add({
      targets: board,
      scale: { from: 1, to: 1.04 },
      duration: 125,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
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
  };

  return { board, pulse };
}

/** Пиктограмма: перечёркнутые признаки правила — до двух символов (механика, не декор). */
function ruleIcon(scene: Phaser.Scene, x: number, y: number, rule: Rule): Phaser.GameObjects.Container {
  const g = scene.add.graphics();
  const symbols = iconSymbols(rule);
  const offsets = symbols.length === 2 ? [-15, 15] : [0];
  symbols.forEach((s, i) => drawSymbol(g, s, offsets[i]));
  g.lineStyle(6, THEME.ERROR, 1);
  g.lineBetween(-27, -27, 27, 27);
  return scene.add.container(x, y, [g]);
}

interface IconSymbol {
  kind: 'shape' | 'eyes' | 'hat' | 'antenna' | 'calendar' | 'sign';
  form?: HeadForm | BodyForm;
  fill?: number;
  eyes?: 'dots' | 'stripes';
}

function iconSymbols(rule: Rule): IconSymbol[] {
  const out: IconSymbol[] = [];
  const { headColor, bodyColor, headForm, bodyForm, eyes, accessory } = rule.icon;
  if (headForm) out.push({ kind: 'shape', form: headForm, fill: headColor ? COLOR_HEX[headColor] : THEME.NICHE });
  else if (headColor) out.push({ kind: 'shape', form: 'circle', fill: COLOR_HEX[headColor] });
  if (bodyForm) out.push({ kind: 'shape', form: bodyForm, fill: bodyColor ? COLOR_HEX[bodyColor] : THEME.NICHE });
  else if (bodyColor) out.push({ kind: 'shape', form: 'rect', fill: COLOR_HEX[bodyColor] });
  if (eyes) out.push({ kind: 'eyes', eyes });
  if (accessory) out.push({ kind: accessory === 'hat' ? 'hat' : 'antenna' });
  for (const d of rule.docs ?? []) out.push(d === 'expiry' ? { kind: 'calendar' } : { kind: 'sign' });
  return out.slice(0, 2);
}

function drawSymbol(g: Phaser.GameObjects.Graphics, s: IconSymbol, dx: number): void {
  switch (s.kind) {
    case 'shape':
      drawMiniShape(g, s.form!, s.fill ?? THEME.NICHE, dx);
      break;
    case 'eyes': {
      g.lineStyle(2, THEME.INK, 1);
      g.strokeCircle(dx, 0, 14);
      g.fillStyle(THEME.INK, 1);
      if (s.eyes === 'dots') {
        g.fillCircle(dx - 6, -3, 3.5);
        g.fillCircle(dx + 6, -3, 3.5);
      } else {
        g.fillRect(dx - 11, -6, 8, 4);
        g.fillRect(dx + 3, -6, 8, 4);
      }
      break;
    }
    case 'hat':
      g.fillStyle(THEME.INK, 1);
      g.fillRect(dx - 13, 0, 26, 5);
      g.fillRect(dx - 8, -11, 16, 11);
      break;
    case 'antenna':
      g.fillStyle(THEME.INK, 1);
      g.fillRect(dx - 2, -10, 4, 13);
      g.fillCircle(dx, -13, 4);
      break;
    case 'calendar':
      g.fillStyle(THEME.PAPER, 1);
      g.fillRect(dx - 11, -8, 22, 17);
      g.lineStyle(2, THEME.INK, 1);
      g.strokeRect(dx - 11, -8, 22, 17);
      g.fillStyle(THEME.INK, 1);
      g.fillRect(dx - 11, -8, 22, 5);
      break;
    case 'sign':
      g.lineStyle(3, THEME.INK, 1);
      g.lineBetween(dx - 8, 2, dx - 2, 8);
      g.lineBetween(dx - 2, 8, dx + 8, -8);
      break;
  }
}

const pt = (x: number, y: number): Phaser.Geom.Point => new Phaser.Geom.Point(x, y);

function drawMiniShape(
  g: Phaser.GameObjects.Graphics,
  form: HeadForm | BodyForm,
  fill: number,
  dx = 0,
): void {
  g.fillStyle(fill, 1);
  g.lineStyle(2, THEME.INK, 1);
  switch (form) {
    case 'circle':
      g.fillCircle(dx, 0, 20);
      g.strokeCircle(dx, 0, 20);
      break;
    case 'square':
      g.fillRect(dx - 19, -19, 38, 38);
      g.strokeRect(dx - 19, -19, 38, 38);
      break;
    case 'triangle': {
      const pts = [pt(dx, -22), pt(dx - 20, 16), pt(dx + 20, 16)];
      g.fillPoints(pts, true);
      g.strokePoints(pts, true);
      break;
    }
    case 'hexagon': {
      const pts: Phaser.Geom.Point[] = [];
      for (let i = 0; i < 6; i++) {
        const a = Phaser.Math.DegToRad(-90 + i * 60);
        pts.push(pt(dx + Math.round(Math.cos(a) * 21), Math.round(Math.sin(a) * 21)));
      }
      g.fillPoints(pts, true);
      g.strokePoints(pts, true);
      break;
    }
    case 'rect':
      g.fillRect(dx - 18, -12, 36, 24);
      g.strokeRect(dx - 18, -12, 36, 24);
      break;
    case 'trapezoid': {
      const pts = [pt(dx - 15, -12), pt(dx + 15, -12), pt(dx + 19, 12), pt(dx - 19, 12)];
      g.fillPoints(pts, true);
      g.strokePoints(pts, true);
      break;
    }
    case 'oval':
      g.fillEllipse(dx, 0, 36, 24);
      g.strokeEllipse(dx, 0, 36, 24);
      break;
  }
}
