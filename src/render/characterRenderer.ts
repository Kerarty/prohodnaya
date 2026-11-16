import Phaser from 'phaser';
import { COLOR_HEX } from '../game/attributes';
import type { DocFieldId } from '../game/application';
import type { AccessoryType, BodyForm, CharacterAttrs, EyesType, HeadForm } from '../game/attributes';
import { THEME } from './theme';

const HEAD_CY: Record<HeadForm, number> = { circle: -70, square: -70, triangle: -52, hexagon: -70 };
const HEAD_TOP: Record<HeadForm, number> = { circle: -125, square: -118, triangle: -124, hexagon: -128 };

const p = (x: number, y: number): Phaser.Geom.Point => new Phaser.Geom.Point(x, y);

function drawBody(g: Phaser.GameObjects.Graphics, form: BodyForm, color: number): void {
  switch (form) {
    case 'rect':
      g.fillStyle(color, 1);
      g.fillRect(-55, 12, 110, 95);
      g.lineStyle(3, THEME.INK, 1);
      g.strokeRect(-55, 12, 110, 95);
      break;
    case 'trapezoid': {
      const pts = [p(-48, 12), p(48, 12), p(62, 107), p(-62, 107)];
      g.fillStyle(color, 1);
      g.fillPoints(pts, true);
      g.lineStyle(3, THEME.INK, 1);
      g.strokePoints(pts, true);
      break;
    }
    case 'oval':
      g.fillStyle(color, 1);
      g.fillEllipse(0, 60, 110, 95);
      g.lineStyle(3, THEME.INK, 1);
      g.strokeEllipse(0, 60, 110, 95);
      break;
  }
}

function drawHead(g: Phaser.GameObjects.Graphics, form: HeadForm, cy: number, color: number): void {
  switch (form) {
    case 'circle':
      g.fillStyle(color, 1);
      g.fillCircle(0, cy, 55);
      g.lineStyle(3, THEME.INK, 1);
      g.strokeCircle(0, cy, 55);
      break;
    case 'square':
      g.fillStyle(color, 1);
      g.fillRect(-48, cy - 48, 96, 96);
      g.lineStyle(3, THEME.INK, 1);
      g.strokeRect(-48, cy - 48, 96, 96);
      break;
    case 'triangle': {
      const pts = [p(0, cy - 72), p(-56, cy + 55), p(56, cy + 55)];
      g.fillStyle(color, 1);
      g.fillPoints(pts, true);
      g.lineStyle(3, THEME.INK, 1);
      g.strokePoints(pts, true);
      break;
    }
    case 'hexagon': {
      const pts: Phaser.Geom.Point[] = [];
      for (let i = 0; i < 6; i++) {
        const a = Phaser.Math.DegToRad(-90 + i * 60);
        pts.push(p(Math.round(Math.cos(a) * 58), Math.round(cy + Math.sin(a) * 58)));
      }
      g.fillStyle(color, 1);
      g.fillPoints(pts, true);
      g.lineStyle(3, THEME.INK, 1);
      g.strokePoints(pts, true);
      break;
    }
  }
}

/** Глаза рисуются ТОЛЬКО сюда — моргание перерисовывает этот Graphics (спека §4.3 P0). */
function drawEyesInto(g: Phaser.GameObjects.Graphics, eyes: EyesType, cy: number, scaleY: number): void {
  g.clear();
  g.fillStyle(THEME.INK, 1);
  if (eyes === 'dots') {
    g.fillEllipse(-18, cy - 12, 18, Math.max(2, 18 * scaleY));
    g.fillEllipse(18, cy - 12, 18, Math.max(2, 18 * scaleY));
  } else {
    g.fillRect(-30, cy - 18, 23, Math.max(2, 8 * scaleY));
    g.fillRect(7, cy - 18, 23, Math.max(2, 8 * scaleY));
  }
}

function drawAccessory(g: Phaser.GameObjects.Graphics, acc: AccessoryType, form: HeadForm): void {
  if (acc === 'none') return;
  const top = HEAD_TOP[form];
  if (acc === 'hat') {
    g.fillStyle(THEME.INK, 1);
    g.fillRect(-46, top - 8, 92, 12);
    g.fillRect(-27, top - 46, 54, 40);
  } else {
    g.fillStyle(THEME.INK, 1);
    g.fillRect(-3, top - 34, 6, 36);
    g.fillCircle(0, top - 40, 9);
  }
}

function drawMouth(g: Phaser.GameObjects.Graphics, mood: 'smile' | 'sad', cy: number): void {
  g.clear();
  g.lineStyle(3.5, THEME.INK, 1);
  if (mood === 'smile') {
    g.arc(0, cy + 22, 10, Phaser.Math.DegToRad(20), Phaser.Math.DegToRad(160));
  } else {
    g.arc(0, cy + 30, 10, Phaser.Math.DegToRad(200), Phaser.Math.DegToRad(340));
  }
  g.strokePath();
}

/**
 * Персонаж «Мульт-поп»: ботинки, тело/голова, щёки, рот-улыбка, глаза в eyesG с морганием,
 * дыхание (спека §4.3 P0). Эмоции — нейтраль до вердикта (правило нейтральности декора).
 */
export function drawCharacter(
  scene: Phaser.Scene,
  attrs: CharacterAttrs,
  cx: number,
  cy: number,
  scale = 1,
): Phaser.GameObjects.Container {
  const headCy = HEAD_CY[attrs.headForm];

  const boots = scene.add.graphics();
  boots.fillStyle(THEME.INK, 1);
  boots.fillEllipse(-30, 112, 34, 16);
  boots.fillEllipse(30, 112, 34, 16);

  const g = scene.add.graphics();
  drawBody(g, attrs.bodyForm, COLOR_HEX[attrs.bodyColor]);
  drawHead(g, attrs.headForm, headCy, COLOR_HEX[attrs.headColor]);
  drawAccessory(g, attrs.accessory, attrs.headForm);

  const cheeks = scene.add.graphics();
  cheeks.fillStyle(THEME.CHEEK, 0.45);
  cheeks.fillCircle(-34, headCy + 16, 10);
  cheeks.fillCircle(34, headCy + 16, 10);

  const mouth = scene.add.graphics().setName('mouth');
  drawMouth(mouth, 'smile', headCy);

  const eyesG = scene.add.graphics().setName('eyes');
  drawEyesInto(eyesG, attrs.eyes, headCy, 1);

  const c = scene.add.container(cx, cy, [boots, g, cheeks, mouth, eyesG]);
  c.setScale(scale);
  c.setData('headCy', headCy);
  c.setData('headForm', attrs.headForm);

  // Моргание: случайные интервалы 2.5–5 с, прикрытие на 90 мс
  const blink = (): void => {
    const ev = scene.time.delayedCall(2500 + Math.random() * 2500, () => {
      if (!c.active) return;
      drawEyesInto(eyesG, attrs.eyes, headCy, 0.15);
      scene.time.delayedCall(90, () => {
        if (!c.active) return;
        drawEyesInto(eyesG, attrs.eyes, headCy, 1);
        blink();
      });
    });
    c.once(Phaser.GameObjects.Events.DESTROY, () => ev.remove(false));
  };
  blink();

  return c;
}

/** Дыхание — запускать ПОСЛЕ bounce-входа, чтобы твины scale не воевали (спека §4.3 P0 №5). */
export function startBreathing(container: Phaser.GameObjects.Container, scale: number): void {
  const tween = container.scene.tweens.add({
    targets: container,
    scaleY: { from: scale, to: scale * 1.012 },
    duration: 1600,
    yoyo: true,
    repeat: -1,
    ease: 'Sine.easeInOut',
  });
  container.setData('breathTween', tween);
}

/** Реакция гостя ПОСЛЕ вердикта: грусть/радость + брови (спека §4.3 P1, правило нейтральности). */
export function guestReact(container: Phaser.GameObjects.Container, kind: 'ok' | 'reject'): void {
  const scene = container.scene;
  const headCy = (container.getData('headCy') as number) ?? -70;

  const mouth = container.getByName('mouth') as Phaser.GameObjects.Graphics | undefined;
  if (mouth) drawMouth(mouth, kind === 'ok' ? 'smile' : 'sad', headCy);

  const browY = headCy - 36;
  const makeBrow = (x: number, angle: number): Phaser.GameObjects.Graphics => {
    const b = scene.add.graphics();
    b.fillStyle(THEME.INK, 1);
    b.fillRect(-9, -2.5, 18, 5);
    b.setPosition(x, browY + (kind === 'ok' ? -4 : 0));
    b.setRotation(angle);
    b.setAlpha(0);
    return b;
  };
  const bl = makeBrow(-16, kind === 'reject' ? Phaser.Math.DegToRad(18) : 0);
  const br = makeBrow(16, kind === 'reject' ? Phaser.Math.DegToRad(-18) : 0);
  container.add([bl, br]);
  scene.tweens.add({ targets: [bl, br], alpha: 1, duration: 120 });
}

/** «Сдувание» отказника перед уходом (спека §4.3 №9). Останавливает дыхание. */
export function guestDeflate(container: Phaser.GameObjects.Container): void {
  const breath = container.getData('breathTween') as Phaser.Tweens.Tween | undefined;
  breath?.stop();
  container.scene.tweens.add({
    targets: container,
    scaleY: { from: container.scaleY, to: container.scaleY * 0.88 },
    scaleX: { from: container.scaleX, to: container.scaleX * 1.06 },
    duration: 140,
    ease: 'Quad.easeOut',
  });
}

/** Подсветка поля признака на госте (эффект Лупы) — кольцо GOLD поверх eyesG/бровей. */
export function highlightField(container: Phaser.GameObjects.Container, field: DocFieldId): void {
  const prev = container.getByName('fieldRing');
  if (prev) prev.destroy();
  if (field === 'expiry' || field === 'signature') return;

  // Центр головы зависит от формы (у треугольника он выше) — кольцо должно сидеть точно
  const headCy = (container.getData('headCy') as number | undefined) ?? -70;
  const headForm = container.getData('headForm') as HeadForm | undefined;
  const top = headForm ? HEAD_TOP[headForm] : -125;

  const ring = container.scene.add.graphics().setName('fieldRing');
  ring.lineStyle(5, THEME.GOLD, 1);
  switch (field) {
    case 'head':
      ring.strokeCircle(0, headCy, 66);
      break;
    case 'body':
      ring.strokeRect(-72, 0, 144, 118);
      break;
    case 'eyes':
      ring.strokeCircle(0, headCy, 44);
      break;
    case 'accessory':
      ring.strokeRect(-58, top - 52, 116, 62);
      break;
  }
  container.add(ring);
}
