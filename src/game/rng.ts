/** Детерминированная генерация (ГДД разд. 3.3). */

export type Rng = () => number;

export type RngChannel = 'queue' | 'char' | 'doc' | 'rules';

/** mulberry32 — быстрый 32-битный ГПСЧ с хорошим распределением для игр. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Суб-потоки не пересекаются: правки одной генерации не ломают остальные. */
export function rngFor(seed: number, channel: RngChannel): Rng {
  let h = seed >>> 0;
  for (let i = 0; i < channel.length; i++) {
    h ^= channel.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return mulberry32(h);
}

/** Случайный сид смены: время XOR счётчик запусков (ГДД разд. 3.3). */
export function newShiftSeed(launchCounter: number): number {
  return (Date.now() ^ launchCounter) >>> 0;
}

export function pickInt(rng: Rng, maxExclusive: number): number {
  return Math.floor(rng() * maxExclusive);
}

export function pickOf<T>(rng: Rng, arr: readonly T[]): T {
  return arr[pickInt(rng, arr.length)];
}

export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

export function shuffle<T>(arr: readonly T[], rng: Rng): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = pickInt(rng, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
