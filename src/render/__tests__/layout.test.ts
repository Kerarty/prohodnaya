import { describe, expect, it } from 'vitest';
import { computeLayout, DESIGN_H, DESIGN_W, DESIGN_CX } from '../layout';

/** Вьюпорты из QA-матрицы адаптации (портрет/ландшафт/планшет/десктоп/экстримы). */
const MATRIX: Array<{ name: string; w: number; h: number; dpr: number }> = [
  { name: 'эталон', w: 720, h: 1280, dpr: 2 },
  { name: 'слабый Android', w: 360, h: 640, dpr: 2 },
  { name: 'iPhone', w: 390, h: 844, dpr: 3 },
  { name: 'Android', w: 412, h: 915, dpr: 2.6 },
  { name: 'планшет портрет', w: 820, h: 1180, dpr: 2 },
  { name: 'планшет ландшафт', w: 1180, h: 820, dpr: 2 },
  { name: 'телефон ландшафт', w: 844, h: 390, dpr: 3 },
  { name: 'ноутбук 125%', w: 1536, h: 864, dpr: 1.25 },
  { name: 'десктоп 4K', w: 3840, h: 2160, dpr: 1 },
  { name: 'минимум', w: 320, h: 480, dpr: 2 },
  { name: 'ультравайд', w: 3440, h: 1440, dpr: 1 },
  { name: 'фолд', w: 720, h: 2560, dpr: 2 },
];

describe('computeLayout', () => {
  it('эталон 720×1280: зум = dpr, вид ровно дизайн-область', () => {
    const s = computeLayout(720, 1280, 2);
    expect(s.q).toBe(2);
    expect(s.zoom).toBe(2);
    expect(s.view).toEqual({ x0: 0, y0: 0, x1: 720, y1: 1280 });
    expect(s.centerX).toBe(360);
    expect(s.centerY).toBe(640);
  });

  it('дизайн-область видна целиком на любом аспекте матрицы', () => {
    for (const vp of MATRIX) {
      const s = computeLayout(vp.w, vp.h, vp.dpr);
      expect(s.view.x0, `${vp.name}: левый край`).toBeLessThanOrEqual(0);
      expect(s.view.y0, `${vp.name}: верхний край`).toBeLessThanOrEqual(0);
      expect(s.view.x1, `${vp.name}: правый край`).toBeGreaterThanOrEqual(DESIGN_W);
      expect(s.view.y1, `${vp.name}: нижний край`).toBeGreaterThanOrEqual(DESIGN_H);
      // дизайн целиком внутри видимой области
      expect(s.view.x1 - s.view.x0).toBeGreaterThanOrEqual(DESIGN_W);
      expect(s.view.y1 - s.view.y0).toBeGreaterThanOrEqual(DESIGN_H);
    }
  });

  it('низ дизайна прижат к низу экрана (y1 = 1280 всегда)', () => {
    for (const vp of MATRIX) {
      expect(computeLayout(vp.w, vp.h, vp.dpr).view.y1).toBe(DESIGN_H);
    }
  });

  it('горизонталь всегда центрирована относительно колонки', () => {
    for (const vp of MATRIX) {
      const s = computeLayout(vp.w, vp.h, vp.dpr);
      expect(s.view.x0 + s.view.x1).toBeCloseTo(DESIGN_W, 6);
    }
  });

  it('iPhone 390×844: dpr ограничен двойкой, верх уходит в стену', () => {
    const s = computeLayout(390, 844, 3);
    expect(s.q).toBe(2);
    expect(s.zoom).toBeCloseTo(2 * (390 / 720), 6);
    expect(s.view.y1).toBe(1280);
    expect(s.view.y0).toBeCloseTo(1280 - 844 / (390 / 720), 6); // ≈ −278
    expect(s.centerY).toBeCloseTo((s.view.y0 + 1280) / 2, 6);
  });

  it('ландшафт: высота видимой области ровно 1280, бока уходят в стену', () => {
    const s = computeLayout(1920, 1080, 1);
    expect(s.zoom).toBeCloseTo(1080 / 1280, 6);
    expect(s.view.y0).toBe(0);
    expect(s.view.y1).toBe(1280);
    expect(s.view.x0).toBeLessThan(0);
    expect(s.view.x1).toBeGreaterThan(720);
    expect(s.centerY).toBe(640);
  });

  it('ультравайд 3440×1440: dim-покрытие 24000×16000 с запасом', () => {
    const s = computeLayout(3440, 1440, 1);
    // OVERLAY импортируется в сценах напрямую; проверяем достаточность
    expect(s.view.x0).toBeGreaterThan(-12000);
    expect(s.view.x1).toBeLessThan(12360);
  });

  it('огромный окно: backing store ограничен BACKING_MAX', () => {
    const s = computeLayout(4000, 3000, 2);
    expect(s.q).toBeLessThanOrEqual(6144 / 4000 + 1e-9);
    expect(s.q * 4000).toBeLessThanOrEqual(6144.001);
  });

  it('дробный dpr сохраняется как есть (ноутбук 125%)', () => {
    const s = computeLayout(1536, 864, 1.25);
    expect(s.q).toBeCloseTo(1.25, 9);
  });

  it('камера-центр = центр экрана: centerY из view, centerX = 360', () => {
    for (const vp of MATRIX) {
      const s = computeLayout(vp.w, vp.h, vp.dpr);
      expect(s.centerY).toBeCloseTo((s.view.y0 + s.view.y1) / 2, 6);
      expect(s.centerX).toBe(DESIGN_CX);
    }
  });

  it('нулевой размер даёт фолбэк на эталон (NaN не дойдёт до камеры)', () => {
    const s = computeLayout(0, 0, 1);
    expect(Number.isFinite(s.zoom)).toBe(true);
    expect(s.view).toEqual({ x0: 0, y0: 0, x1: 720, y1: 1280 });
  });
});
