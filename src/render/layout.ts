/**
 * Адаптивный вьюпорт (все размеры экрана, без letterbox).
 *
 * Архитектура: canvas занимает ВСЁ окно (Scale NONE + CSS 100%), backing store =
 * css × clamp(dpr, 1, 2) через scale.setGameSize, камера зумится так, чтобы
 * дизайн-область 720×1280 всегда была видна целиком, а фон (booth) тянулся
 * на всю видимую область. Сцены продолжают жить в дизайн-координатах.
 *
 * Ключевые решения (техдир, ревью исходников Phaser 3.90):
 * — Scale.NONE, а не RESIZE: RESIZE затирает gameSize css-размером на каждом
 *   refresh, dpr>1 получить нельзя; NONE отдаёт size нам.
 * — Никогда не трогать scale.setZoom (он переписывает style канваса) — зумим
 *   только camera.zoom.
 * — setGameSize идемпотентен (эмитит RESIZE даже при том же размере → события
 *   по кругу), ресайз-обработчик дебаунсится.
 * — worldView протухает до следующего preRender — видимую область считаем
 *   математикой, а не читаем из камеры.
 *
 * Модуль без импорта Phaser (структурные типы) — математика покрывается юнит-тестами.
 */

/** Дизайн-область: все сцены авторованы под 720×1280. */
export const DESIGN_W = 720;
export const DESIGN_H = 1280;
export const DESIGN_CX = DESIGN_W / 2;

/** Пределы плотности backing store и абсолютный потолок размера холста. */
const DPR_MIN = 1;
const DPR_MAX = 2;
const BACKING_MAX = 6144;
const RESIZE_DEBOUNCE_MS = 150;

/** Отступы выхода гостя за экран (в дизайн-единицах, от краёв видимой области). */
const OFF_LEFT_MARGIN = 120;
const OFF_RIGHT_MARGIN = 220;

/**
 * Оверлеи (dim-затемнения, вспышка вердикта): огромный прямоугольник, покрывающий
 * видимую область при любом аспекте окна (проверено до 4551×2560 дизайн-единиц).
 */
export const OVERLAY = { x: DESIGN_CX, y: DESIGN_H / 2, width: 24000, height: 16000 } as const;

export interface ViewRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface LayoutState {
  cssW: number;
  cssH: number;
  /** Множитель backing store: css px → физические пиксели холста. */
  q: number;
  /** zoom камеры: backing px на дизайн-единицу. */
  zoom: number;
  /** Видимая world-область в дизайн-координатах (всегда ⊇ 720×1280). */
  view: ViewRect;
  /** Середина ЭКРАНА в дизайн-координатах — для панелей/тостов/отсчёта дуэли. */
  centerX: number;
  centerY: number;
}

/** Минимальный набор сцены, нужный layout'у (Phaser.Scene подходит структурно). */
export interface LayoutScene {
  cameras: { main: { setZoom(z: number): unknown; centerOn(x: number, y: number): unknown } };
  events: { once(event: string, fn: () => void): unknown };
}

/** Минимальный набор Phaser.Game для initLayout. */
export interface LayoutGame {
  isBooted: boolean;
  events: { once(event: string, fn: () => void): unknown };
  scale: {
    canvas: { style: CSSStyleDeclaration };
    setGameSize(width: number, height: number): unknown;
  };
  scene: { scenes: LayoutScene[] };
}

/**
 * Чистая математика вьюпорта.
 * Вертикаль: низ дизайна прижат к низу экрана (стойка всегда у нижнего края,
 * лишняя высота уходит в стену сверху — заодно верхний UI уходит из-под нотча).
 * Горизонталь: всегда по центру, расширение симметричное.
 */
export function computeLayout(cssW: number, cssH: number, dpr: number): LayoutState {
  // вырожденные размеры (скрытый #app) — фолбэк на эталон, NaN не должен дойти до камеры
  const w = cssW > 0 ? cssW : DESIGN_W;
  const h = cssH > 0 ? cssH : DESIGN_H;
  const fitScale = Math.min(w / DESIGN_W, h / DESIGN_H);
  let q = Math.min(Math.max(dpr || DPR_MIN, DPR_MIN), DPR_MAX);
  const maxDim = Math.max(w, h);
  if (maxDim * q > BACKING_MAX) q = BACKING_MAX / maxDim;
  const zoom = q * fitScale;
  const visW = w / fitScale;
  const visH = h / fitScale;
  const y1 = DESIGN_H;
  const y0 = DESIGN_H - visH;
  const x0 = DESIGN_CX - visW / 2;
  const x1 = DESIGN_CX + visW / 2;
  return {
    cssW,
    cssH,
    q,
    zoom,
    view: { x0, y0, x1, y1 },
    centerX: DESIGN_CX,
    centerY: (y0 + y1) / 2,
  };
}

let state: LayoutState | null = null;
let applied: { cssW: number; cssH: number; dpr: number } | null = null;
let game: LayoutGame | null = null;
let debounceTimer: number | undefined;
const listeners = new Set<() => void>();

function measure(): { cssW: number; cssH: number; dpr: number } {
  const app = document.getElementById('app');
  const rect = app?.getBoundingClientRect();
  const cssW = rect && rect.width > 0 ? rect.width : window.innerWidth;
  const cssH = rect && rect.height > 0 ? rect.height : window.innerHeight;
  return { cssW, cssH, dpr: window.devicePixelRatio || DPR_MIN };
}

/** Текущее состояние (лениво, до initLayout тоже работает — берёт размеры DOM). */
export function currentLayout(): LayoutState {
  if (!state) {
    const m = measure();
    state = computeLayout(m.cssW, m.cssH, m.dpr);
  }
  return state;
}

/** Середина экрана в дизайн-координатах — точки отсчёта для модальных панелей. */
export function screenCenter(): { x: number; y: number } {
  const s = currentLayout();
  return { x: s.centerX, y: s.centerY };
}

/** Точка левее видимой области — вход гостя (в портрете это −120, как раньше −80). */
export function layoutOffLeft(): number {
  return currentLayout().view.x0 - OFF_LEFT_MARGIN;
}

/** Точка правее видимой области — уход гостя (в портрете 940, как раньше 720+220). */
export function layoutOffRight(): number {
  return currentLayout().view.x1 + OFF_RIGHT_MARGIN;
}

/** Применить зум/центр к камере сцены. Вызывать в create() каждой сцены. */
export function applyCamera(scene: LayoutScene): void {
  const s = currentLayout();
  scene.cameras.main.setZoom(s.zoom);
  scene.cameras.main.centerOn(s.centerX, s.centerY);
}

/**
 * Подписка на изменение вьюпорта (перерисовка растягивающегося фона).
 * Автоотписка на shutdown/destroy сцены — рестарты не копят листенеры.
 */
export function subscribe(scene: LayoutScene, cb: () => void): void {
  listeners.add(cb);
  scene.events.once('shutdown', () => listeners.delete(cb));
  scene.events.once('destroy', () => listeners.delete(cb));
}

function applyNow(): void {
  if (!game) return;
  const m = measure();
  if (
    applied &&
    applied.cssW === m.cssW &&
    applied.cssH === m.cssH &&
    applied.dpr === m.dpr
  ) {
    return; // идемпотентность: setGameSize эмитит RESIZE даже при том же размере
  }
  state = computeLayout(m.cssW, m.cssH, m.dpr);
  applied = { cssW: m.cssW, cssH: m.cssH, dpr: m.dpr };
  game.scale.setGameSize(Math.round(m.cssW * state.q), Math.round(m.cssH * state.q));
  // style канваса = CSS-размер окна (Scale NONE при boot пишет размер конфига)
  game.scale.canvas.style.width = `${Math.round(m.cssW)}px`;
  game.scale.canvas.style.height = `${Math.round(m.cssH)}px`;
  for (const scene of game.scene.scenes) {
    // часть сцен может быть ещё не забучена к моменту первого apply — их
    // камерам зум применит applyCamera в create()
    if (scene?.cameras?.main) applyCamera(scene);
  }
  for (const cb of listeners) cb();
}

function schedule(): void {
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(applyNow, RESIZE_DEBOUNCE_MS);
}

/** Смена dpr без изменения css (перенос окна между мониторами, Ctrl±, pinch). */
let dprMq: MediaQueryList | null = null;
let dprHandler: (() => void) | null = null;
function watchDpr(onChange: () => void): void {
  if (dprMq && dprHandler) dprMq.removeEventListener('change', dprHandler);
  dprMq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  dprHandler = () => {
    onChange();
    watchDpr(onChange); // dpr изменился — слушаем уже новое значение
  };
  dprMq.addEventListener('change', dprHandler);
}

/**
 * Подключить адаптивный вьюпорт к игре: первый замер после boot игры,
 * далее — живой ресайз с дебаунсом. Источники событий:
 * — window resize / orientationchange (окно, поворот телефона, fullscreen);
 * — ResizeObserver на #app (ресайз iframe платформы, тулбар iOS, любые
 *   изменения контейнера БЕЗ window resize — ResizeObserver ловит все);
 * — смена dpr без изменения css (перенос окна на другой монитор, Ctrl±).
 */
export function initLayout(target: LayoutGame): void {
  game = target;
  if (target.isBooted) applyNow();
  else target.events.once('ready', applyNow);
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  watchDpr(schedule);
  const app = document.getElementById('app');
  if (app && typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(schedule);
    ro.observe(app);
  }
  // Отладочный доступ: текущее состояние вьюпорта из консоли (как window.__game)
  (window as unknown as { __layout: () => LayoutState }).__layout = currentLayout;
}
