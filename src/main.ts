import Phaser from 'phaser';
import { initPlatform } from './platform';
import { flushSession, initSession, loadSession, session } from './game/session';
import { sfx } from './systems/sfx';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { MenuScene } from './scenes/MenuScene';
import { PlatformTestScene } from './scenes/PlatformTestScene';

/** Phaser-текст растеризует глифы в момент создания — шрифт должен быть готов до старта сцен. */
async function waitFonts(): Promise<void> {
  try {
    const load = (weight: number, sample: string): Promise<unknown> =>
      document.fonts.load(`${weight} 32px "Balsamiq Sans"`, sample);
    await Promise.race([
      Promise.all([load(700, 'ПРОХОДНАЯ +11?!'), load(400, 'правила дня 123')]),
      new Promise((r) => setTimeout(r, 1500)), // фолбэк: стартуем с Arial, не блокируем игру
    ]);
    await document.fonts.ready;
  } catch {
    /* Arial-фолбэк */
  }
}

// Дебаг-хук: ошибки времени выполнения видны в консоли и в window.__errs
(window as unknown as { __errs: string[] }).__errs = [];
window.addEventListener('error', (e) => {
  (window as unknown as { __errs: string[] }).__errs.push(
    `${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`,
  );
  console.error(e.error ?? e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  (window as unknown as { __errs: string[] }).__errs.push(`rejection: ${String(e.reason)}`);
});

async function bootstrap(): Promise<void> {
  const platform = await initPlatform();

  // Пауза извне (реклама, сворачивание вкладки): глушим звук (п. 4.7 правил Яндекса).
  platform.onStateChanged(() => {
    console.info('[game] пауза от платформы');
    sfx.setMuted(true);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) sfx.setMuted(false);
  });
  window.addEventListener('pointerdown', () => sfx.unlock());

  initSession(platform);
  await loadSession();
  sfx.setMuted(!session().soundOn); // настройка звука из сейва

  // Последняя попытка сохранить прогресс при уходе со страницы (не гарантирована)
  window.addEventListener('pagehide', () => {
    void flushSession();
  });

  await waitFonts();

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'app',
    width: 720,
    height: 1280,
    backgroundColor: '#ffedd3',
    roundPixels: true,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [BootScene, MenuScene, GameScene, PlatformTestScene],
  });
  // Отладочный доступ: инстанс игры, Phaser и классы сцен из консоли
  // (window.__dbg.Phaser.HEADLESS используется тестовым ригом без рендера)
  (window as unknown as { __game: Phaser.Game }).__game = game;
  (window as unknown as { __dbg: { Phaser: typeof Phaser; scenes: Phaser.Types.Scenes.SceneType[] } }).__dbg = {
    Phaser,
    scenes: [BootScene, MenuScene, GameScene, PlatformTestScene],
  };
}

void bootstrap();
