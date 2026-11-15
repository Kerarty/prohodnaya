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
};
