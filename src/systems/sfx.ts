/** Звуковой движок на WebAudio без ассетов: осцилляторы и шум. Вес бандла +0 КБ. */

let ctx: AudioContext | null = null;
let muted = false;

function ensure(): AudioContext | null {
  if (muted || typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

interface ToneSpec {
  freq: number;
  endFreq?: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
}

function tone({ freq, endFreq, duration, type = 'square', gain = 0.07, delay = 0 }: ToneSpec): void {
  const c = ensure();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (endFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t0 + duration);
  }
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

function burst(duration = 0.09, gain = 0.14): void {
  const c = ensure();
  if (!c) return;
  const frames = Math.max(1, Math.floor(c.sampleRate * duration));
  const buf = c.createBuffer(1, frames, c.sampleRate);
  const channel = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    channel[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(g);
  g.connect(c.destination);
  src.start();
}

// — Музыкальный секвенсор: F мажор, Fmaj7–Dm7–Bbmaj7–C, два лупа по 8 тактов —

type MusicMode = 'menu' | 'shift';
const MUSIC_BASE_GAIN = 0.5;
const MUSIC_LOOKAHEAD = 1.2; // с запасом на троттлинг setInterval в скрытой вкладке

let musicMode: MusicMode | null = null;
let musicBus: GainNode | null = null;
let musicTimer: number | undefined;
let musicStep = 0;
let musicNextTime = 0;

const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

function busOf(c: AudioContext): GainNode {
  if (!musicBus) {
    musicBus = c.createGain();
    musicBus.gain.value = muted ? 0 : MUSIC_BASE_GAIN;
    musicBus.connect(c.destination);
  }
  return musicBus;
}

interface VoiceSpec {
  type: OscillatorType;
  gain: number;
  attack: number;
  release: number;
  filter?: number;
  detune?: number;
}

function voice(c: AudioContext, dest: AudioNode, v: VoiceSpec, freq: number, t0: number, dur: number): void {
  const osc = c.createOscillator();
  osc.type = v.type;
  osc.frequency.setValueAtTime(freq, t0);
  if (v.detune) osc.detune.setValueAtTime(v.detune, t0);
  const g = c.createGain();
  const atk = Math.min(v.attack, dur * 0.5);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(v.gain, t0 + atk);
  g.gain.setValueAtTime(v.gain, t0 + dur);
  g.gain.linearRampToValueAtTime(0.0001, t0 + dur + v.release);
  osc.connect(g);
  let head: AudioNode = g;
  if (v.filter) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(v.filter, t0);
    head.connect(f);
    head = f;
  }
  head.connect(dest);
  osc.start(t0);
  osc.stop(t0 + dur + v.release + 0.05);
}

/** «Пишущая машинка» смены: короткий шумовой тик через highpass. */
function typeTick(c: AudioContext, dest: AudioNode, t0: number): void {
  const frames = Math.max(1, Math.floor(c.sampleRate * 0.015));
  const buf = c.createBuffer(1, frames, c.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    ch[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.setValueAtTime(5000, t0);
  const g = c.createGain();
  g.gain.value = 0.02;
  src.connect(f);
  f.connect(g);
  g.connect(dest);
  src.start(t0);
}

/** Аккорды прогрессии I–vi–IV–V (midi) и корни баса по такту. */
const CHORDS: number[][] = [
  [53, 57, 60, 64], // Fmaj7
  [50, 53, 57, 60], // Dm7
  [58, 62, 65, 69], // Bbmaj7
  [55, 60, 64, 67], // C
];
const BASS_ROOT = [41, 38, 46, 36]; // F2, D2, Bb2, C2

/** Мелодии на такт: карта {шаг: midi}. Такты 5–8 — то же с октавы вверх. */
const MENU_MEL: Array<Record<number, number>> = [
  { 0: 69, 3: 67, 6: 65, 12: 60 },
  { 0: 74, 3: 72, 6: 69 },
  { 0: 65, 3: 67, 6: 69, 12: 74 },
  { 0: 67, 8: 69, 12: 72 },
];
const SHIFT_MEL: Array<Record<number, number>> = [
  { 0: 69, 2: 72, 4: 69, 7: 67 },
  { 0: 65, 3: 67, 5: 69 },
  { 0: 62, 3: 65, 6: 69 },
  { 0: 72, 3: 74, 6: 72 },
];
const MENU_BASS_STEPS = [0, 8];
const SHIFT_BASS_STEPS = [0, 3, 7, 8, 11, 14];
const SHIFT_TICK_STEPS = [2, 6, 10, 14];
const LOOP_STEPS = 8 * 16;

function scheduleStep(c: AudioContext, bus: GainNode, step: number, t0: number, stepDur: number): void {
  const mode = musicMode;
  if (!mode) return;
  const bar = Math.floor(step / 16) % 8;
  const s = step % 16;
  const half = bar >= 4 ? 12 : 0; // второй проход лупа — октава вверх
  const chord = CHORDS[bar % 4];
  const barDur = stepDur * 16;

  // Пэд: аккорд на первом шаге такта, два расстроенных треугольника на тон
  if (s === 0) {
    const padGain = mode === 'menu' ? 0.04 : 0.034;
    for (const note of chord) {
      for (const det of [-4, 4]) {
        voice(c, bus, { type: 'triangle', gain: padGain, attack: 0.4, release: 0.8, filter: 900, detune: det }, midiHz(note), t0, barDur * 0.92);
      }
    }
  }

  // Бас
  const bassSteps = mode === 'menu' ? MENU_BASS_STEPS : SHIFT_BASS_STEPS;
  if (bassSteps.includes(s)) {
    voice(
      c,
      bus,
      { type: 'triangle', gain: 0.16, attack: 0.005, release: 0.15, filter: 400 },
      midiHz(BASS_ROOT[bar % 4]),
      t0,
      stepDur * (mode === 'menu' ? 3 : 1.8),
    );
  }

  // Мелодия
  const mel = (mode === 'menu' ? MENU_MEL : SHIFT_MEL)[bar % 4];
  const melNote = mel[s];
  if (melNote !== undefined) {
    voice(
      c,
      bus,
      { type: 'sine', gain: 0.06, attack: 0.005, release: 0.4, filter: 1200 },
      midiHz(melNote + half),
      t0,
      stepDur * 3,
    );
  }

  // Пишущая машинка — только в смене, на оффбитах
  if (mode === 'shift' && SHIFT_TICK_STEPS.includes(s)) {
    typeTick(c, bus, t0);
  }
}

function tickScheduler(): void {
  if (!musicMode || muted) return;
  const c = ensure();
  if (!c) return;
  const bus = busOf(c);
  const stepDur = musicMode === 'menu' ? 60 / 84 / 4 : 60 / 96 / 4;
  if (musicNextTime < c.currentTime - 0.05) {
    // контекст спал/троттлил — не догоняем залпом, продолжаем от текущего момента
    musicNextTime = c.currentTime + 0.05;
  }
  while (musicNextTime < c.currentTime + MUSIC_LOOKAHEAD) {
    scheduleStep(c, bus, musicStep, musicNextTime, stepDur);
    musicNextTime += stepDur;
    musicStep = (musicStep + 1) % LOOP_STEPS;
  }
}

export const sfx = {
  /** Разблокировка аудио после первого жеста игрока (autoplay-политики iOS/Chrome). */
  unlock(): void {
    ensure();
  },

  /** Пауза/реклама — глушим (требование п. 4.7 правил Яндекса). */
  setMuted(m: boolean): void {
    muted = m;
  },

  stamp(): void {
    burst(0.09, 0.15);
    tone({ freq: 170, endFreq: 90, duration: 0.12, type: 'triangle', gain: 0.1 });
  },

  success(): void {
    tone({ freq: 520, endFreq: 780, duration: 0.13, gain: 0.05 });
    tone({ freq: 780, endFreq: 1040, duration: 0.12, delay: 0.1, gain: 0.05 });
  },

  fail(): void {
    tone({ freq: 320, endFreq: 150, duration: 0.28, type: 'sawtooth', gain: 0.06 });
  },

  coin(): void {
    tone({ freq: 900, endFreq: 1350, duration: 0.08, gain: 0.05 });
  },

  tap(): void {
    tone({ freq: 320, endFreq: 240, duration: 0.05, type: 'triangle', gain: 0.04 });
  },

  /** «Чик» верного штампа: два восходящих тона (спека §5 №8). */
  chip(): void {
    tone({ freq: 660, endFreq: 880, duration: 0.06, gain: 0.05 });
    tone({ freq: 880, endFreq: 1100, duration: 0.06, delay: 0.06, gain: 0.05 });
  },

  /** «Вжух» входящего гостя: мягкий шумовой выдох. */
  whoosh(): void {
    burst(0.18, 0.05);
  },

  purchase(): void {
    this.coin();
    tone({ freq: 1200, endFreq: 1600, duration: 0.1, delay: 0.12, gain: 0.05 });
  },

  // — Музыка: генеративные лупы меню/смены (спецификация аудио-директора) —

  /** Включить луп режима; idempotent — безопасно при scene.restart(). */
  startMusic(mode: MusicMode): void {
    if (musicMode === mode) return;
    musicMode = mode;
    const c = ensure();
    if (!c) return; // планировщик стартует из tick после unlock/снятия мьюта
    musicStep = 0;
    musicNextTime = c.currentTime + 0.08;
    const bus = busOf(c);
    bus.gain.cancelScheduledValues(c.currentTime);
    bus.gain.setValueAtTime(muted ? 0 : MUSIC_BASE_GAIN, c.currentTime);
    if (musicTimer === undefined) {
      musicTimer = window.setInterval(tickScheduler, 120);
    }
  },

  /** Полный стоп (выход из смены в меню): шина затухает за 0.3 с. */
  stopMusic(): void {
    musicMode = null;
    if (musicTimer !== undefined) {
      window.clearInterval(musicTimer);
      musicTimer = undefined;
    }
    const c = ctx;
    if (c && musicBus) {
      const t = c.currentTime;
      musicBus.gain.cancelScheduledValues(t);
      musicBus.gain.setValueAtTime(musicBus.gain.value, t);
      musicBus.gain.linearRampToValueAtTime(0.0001, t + 0.3);
    }
  },

  /** Краткое приглушение музыки под вердикт — вердикт всегда слышнее фона. */
  duckMusic(): void {
    const c = ctx;
    if (!c || !musicBus || muted || !musicMode) return;
    const t = c.currentTime;
    musicBus.gain.cancelScheduledValues(t);
    musicBus.gain.setValueAtTime(musicBus.gain.value, t);
    musicBus.gain.linearRampToValueAtTime(MUSIC_BASE_GAIN * 0.55, t + 0.08);
    musicBus.gain.linearRampToValueAtTime(MUSIC_BASE_GAIN, t + 0.4);
  },
};
