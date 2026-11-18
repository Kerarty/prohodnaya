import Phaser from 'phaser';
import { FONT, INK_HEX, THEME } from './theme';
import { currentLayout, subscribe, DESIGN_CX, type ViewRect } from './layout';
import { t } from '../i18n';

export interface BoothView {
  /** Лампочки вывески — для волн (juice). */
  bulbs: Phaser.GameObjects.Arc[];
  /** Тень гостя — противофаза дыханию. */
  guestShadow: Phaser.GameObjects.Graphics | null;
  /** Перерисовать фон под текущую видимую область (layout вызывает сам на resize). */
  redraw: () => void;
}

/**
 * Сцена-«проходная»: стена, пол, ниша гостя, стойка с вывеской и лампочками
 * (спека §4.1). mode 'menu' — фон кабинета без ниши и вывески.
 *
 * Фон тянется на всю видимую область: стена вверх и по бокам за пределы
 * дизайн-колонки 720×1280 (низ всегда прижат к низу экрана — layout.ts).
 * На resize Graphics перерисовывается, объекты (лампочки, текст, тень) не
 * пересоздаются — волны в сценах продолжают работать по живым ссылкам.
 */
export function drawBooth(scene: Phaser.Scene, mode: 'game' | 'menu'): BoothView {
  const g = scene.add.graphics().setDepth(-10);

  // Тень гостя создаётся один раз — не зависит от вьюпорта (tween живёт на ней)
  let guestShadow: Phaser.GameObjects.Graphics | null = null;
  if (mode === 'game') {
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

  const draw = (): void => {
    const { view } = currentLayout();
    const w = view.x1 - view.x0;
    g.clear();

    // Стена и пол: стена уходит вверх за пределы дизайна, пол — до низа (1280)
    g.fillStyle(THEME.BG_WALL, 1);
    g.fillRect(view.x0, view.y0, w, 820 - view.y0);
    // плинтус у стыка
    g.fillStyle(THEME.INK, 0.06);
    g.fillRect(view.x0, 800, w, 20);
    g.fillStyle(THEME.BG_FLOOR, 1);
    g.fillRect(view.x0, 820, w, 460);
    g.lineStyle(3, THEME.INK, 0.12);
    g.lineBetween(view.x0, 820, view.x1, 820);

    // Облака на стене: ядро 0..720 — авторские позиции спеки, расширения — генератор
    g.fillStyle(THEME.CLOUD, 0.75);
    drawCloud(g, 70, 302);
    drawCloud(g, 575, 272);
    drawCloud(g, 85, 467);
    drawExtendedClouds(g, view, view.x0, 0);
    drawExtendedClouds(g, view, 720, view.x1);

    if (mode === 'game') {
      // Ниша гостя + стойки-косяки по краям (структура проходной)
      g.fillStyle(THEME.NICHE, 1);
      g.fillRoundedRect(160, 252, 400, 328, 24);
      g.lineStyle(4, THEME.INK, 1);
      g.strokeRoundedRect(160, 252, 400, 328, 24);
      g.fillStyle(THEME.PANEL, 1);
      g.fillRoundedRect(146, 246, 26, 340, 10);
      g.lineStyle(4, THEME.INK, 1);
      g.strokeRoundedRect(146, 246, 26, 340, 10);
      g.fillRoundedRect(548, 246, 26, 340, 10);
      g.strokeRoundedRect(548, 246, 26, 340, 10);
      g.fillStyle(THEME.NICHE_FLOOR, 1);
      g.fillRoundedRect(176, 440, 368, 124, 16);
      g.lineStyle(3, THEME.INK, 0.15);
      g.lineBetween(176, 470, 544, 470);
    }

    // Стойка: фронтон + столешница. В кабинете стол ниже — нижние кнопки сетки его не наезжают.
    const counterTopY = mode === 'menu' ? 1080 : 1032;
    g.fillStyle(THEME.COUNTER_BODY, 1);
    g.fillRect(view.x0, counterTopY + 28, w, 1280 - counterTopY - 28);
    // фактура фронтона
    g.lineStyle(3, THEME.INK, 0.08);
    g.lineBetween(view.x0, counterTopY + 88, view.x1, counterTopY + 88);
    g.lineBetween(view.x0, counterTopY + 138, view.x1, counterTopY + 138);
    g.fillStyle(THEME.COUNTER_TOP, 1);
    g.fillRoundedRect(view.x0, counterTopY, w, 28, 6);
    g.lineStyle(4, THEME.INK, 1);
    g.strokeRoundedRect(view.x0, counterTopY, w, 28, 6);

    if (mode === 'game') {
      // Вывеска-неймплейт на фронтоне стойки (центр дизайн-колонки)
      g.fillStyle(THEME.PANEL, 1);
      g.fillRoundedRect(DESIGN_CX - 130, 1208, 260, 64, 14);
      g.lineStyle(4, THEME.INK, 1);
      g.strokeRoundedRect(DESIGN_CX - 130, 1208, 260, 64, 14);
      // Чашка на столешнице (правый угол) — якорь ambient-пара (VFX-слой)
      g.fillStyle(THEME.PAPER, 1);
      g.fillRoundedRect(600, 1006, 34, 26, 4);
      g.lineStyle(3, THEME.INK, 1);
      g.strokeRoundedRect(600, 1006, 34, 26, 4);
      g.beginPath();
      g.arc(638, 1019, 10, Phaser.Math.DegToRad(-80), Phaser.Math.DegToRad(80));
      g.strokePath();
    }
  };

  draw();
  subscribe(scene, draw);

  const bulbs: Phaser.GameObjects.Arc[] = [];

  if (mode === 'game') {
    scene.add
      .text(DESIGN_CX, 1240, t('appName'), {
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

  return { bulbs, guestShadow, redraw: draw };
}

/** Облако из двух «пухов» (пара roundedRect), как в спеке §4.1. */
function drawCloud(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  g.fillRoundedRect(x, y, 90, 26, 13);
  g.fillRoundedRect(x + 22, y - 14, 56, 22, 11);
}

/**
 * Облака в расширенных зонах стены: за пределами [from..to] по бокам и выше
 * уровня topCloudY, если стена вытянулась вверх (телефоны 16:10+ и фолды).
 * Позиции привязаны к мировой сетке 460px — не «плывут» при ресайзе.
 */
function drawExtendedClouds(
  g: Phaser.GameObjects.Graphics,
  view: ViewRect,
  from: number,
  to: number,
): void {
  const step = 460;
  const place = (x: number, y: number): void => drawCloud(g, x, y);

  // боковая зона [from..to]: два ряда, как в ядре
  const sideY = [302, 467];
  for (let x = from + 60; x < to - 60; x += step) {
    for (let i = 0; i < sideY.length; i++) place(x + i * 30, sideY[i]);
  }

  // верхняя зона: строки облаков в новом пространстве выше дизайн-области
  // (y < 40 — выше авторованных облаков ядра); на «родной» высоте зоны нет
  for (let y = view.y0 + 90; y < 40; y += step) {
    for (let x = view.x0 + 90; x < view.x1 - 60; x += step) {
      place(x, y);
    }
  }
}
