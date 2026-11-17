import Phaser from 'phaser';
import { MODE_SPECS, PromoScene, type PromoMode } from './promoScene';

/**
 * Промо-рендерер: обложки (PNG) и превью-видео для подачи на CrazyGames.
 *
 * Запуск: `npm run promo` (vite :5190) + `npm run promo:save` (приёмник файлов :5191),
 * затем в браузере: http://localhost:5190/promo.html?mode=<режим>
 * Режимы: cover-landscape | cover-portrait | cover-square | video-landscape | video-portrait
 * Готовые файлы падают в docs/promo/ (пишет save-server).
 *
 * Рендерер — Phaser.CANVAS: toBlob отдаёт точный backing store, captureStream
 * пишет полотно без preserveDrawingBuffer-нюансов WebGL.
 */

const SAVE_URL = 'http://localhost:5191/save';
const statusEl = document.getElementById('status');

function setStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

async function saveBlob(name: string, blob: Blob): Promise<void> {
  const res = await fetch(`${SAVE_URL}?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    body: blob,
  });
  if (!res.ok) throw new Error(`save-server вернул ${res.status}`);
  setStatus(`сохранено: ${name} (${Math.round(blob.size / 1024)} КБ)`);
  console.log(`[promo] сохранено: ${name} (${Math.round(blob.size / 1024)} КБ)`);
}

/** mp4, если браузер умеет муксить (Chrome 126+), иначе webm — портал CG принимает оба. */
function pickMime(): string {
  const candidates = [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

function saveCover(game: Phaser.Game, mode: PromoMode): void {
  setStatus('toBlob: кодирую PNG…');
  game.canvas.toBlob((blob) => {
    if (!blob) {
      setStatus('ошибка: canvas.toBlob вернул null');
      return;
    }
    setStatus(`blob ${Math.round(blob.size / 1024)} КБ — шлю на :5191`);
    saveBlob(`${mode}.png`, blob).catch((e) => setStatus(`ошибка: ${String(e)}`));
  }, 'image/png');
}

function startRecording(game: Phaser.Game, mode: PromoMode, recRef: { rec?: MediaRecorder }): void {
  const mime = pickMime();
  if (!mime) {
    setStatus('ошибка: MediaRecorder не поддерживается');
    return;
  }
  const stream = game.canvas.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 9_000_000 });
  recRef.rec = rec;
  const chunks: Blob[] = [];
  rec.ondataavailable = (e): void => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  rec.onstop = (): void => {
    const ext = mime.includes('mp4') ? 'mp4' : 'webm';
    saveBlob(`${mode}.${ext}`, new Blob(chunks, { type: mime })).catch((e) =>
      setStatus(`ошибка: ${String(e)}`),
    );
    stream.getTracks().forEach((t) => t.stop());
  };
  rec.start(1000);
  setStatus('запись видео… (≈19 с)');
  // страховка: сцена шлёт promo-done на 19-й секунде, тут — резервные 21 с
  setTimeout(() => {
    if (rec.state === 'recording') rec.stop();
  }, 21000);
}

/**
 * Keep-alive: бесшумный осциллятор держит вкладку «со звуком» — Chrome не
 * троттлит setTimeout в фоновых вкладках с активным аудио. Без него rAF/
 * таймеры в скрытой вкладке замирают до 1 Гц и таймлайн видео растягивается.
 */
function startAudioKeepAlive(): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 10; // инфразвук — не слышно
    gain.gain.value = 0.001;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    void ctx.resume();
  } catch {
    /* нет аудио — запись всё равно возможна при видимой вкладке */
  }
}

async function boot(): Promise<void> {
  const requested = new URLSearchParams(location.search).get('mode') ?? 'cover-landscape';
  const mode = (requested in MODE_SPECS ? requested : 'cover-landscape') as PromoMode;
  const spec = MODE_SPECS[mode];
  setStatus(`режим: ${mode} (${spec.width}×${spec.height}) — шрифты…`);

  // Название на обложке — Balsamiq Sans 700; ждём, иначе Phaser отрисует Arial
  try {
    await document.fonts.load('700 100px "Balsamiq Sans"');
  } catch {
    /* фолбэк на Arial — не повод падать */
  }

  const game = new Phaser.Game({
    type: Phaser.CANVAS,
    width: spec.width,
    height: spec.height,
    parent: 'app',
    scale: { mode: Phaser.Scale.NONE, autoCenter: Phaser.Scale.NO_CENTER },
    // setTimeout-цикл вместо rAF: в скрытой вкладке rAF замирает, а таймеры
    // не троттлятся при активном аудио (keep-alive ниже)
    fps: { forceSetTimeOut: true, target: 30 },
    banner: false,
    audio: { noAudio: true },
    scene: [PromoScene],
  });
  game.registry.set('mode', mode);
  startAudioKeepAlive();

  if (spec.video) {
    const recRef: { rec?: MediaRecorder } = {};
    game.events.once('promo-ready', () => {
      setStatus('promo-ready: включаю запись');
      startRecording(game, mode, recRef);
    });
    game.events.once('promo-done', () => {
      if (recRef.rec && recRef.rec.state === 'recording') recRef.rec.stop();
    });
  } else {
    game.events.once('promo-ready', () => {
      setStatus('promo-ready: снимаю обложку');
      saveCover(game, mode);
    });
  }
  // Диагностика: сцена создалась?
  game.events.once('ready', () => setStatus('игра готова (ready)'));
}

void boot();
