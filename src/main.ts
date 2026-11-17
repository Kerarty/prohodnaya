import Phaser from 'phaser';
import { getPlatform, initPlatform } from './platform';
import { initLocale } from './i18n';
import { flushSession, initSession, loadSession, session } from './game/session';
import { getPlayerIdentity } from './net/matchApi';
import { sfx } from './systems/sfx';
import { initLayout } from './render/layout';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { MenuScene, queueDuelInvite } from './scenes/MenuScene';
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
  // Самолечение WebGL: на части драйверов/софтверных GL ресайз холста ломает
  // фреймбуфер RenderTarget (Phaser 3.90). Один тихий перезапуск на Canvas-рендер:
  // игра полностью векторная, Canvas тянет её без проблем; сейв переживает reload.
  if (e.message?.includes('Framebuffer status')) {
    try {
      if (sessionStorage.getItem('prohodnaya.renderer') !== 'canvas') {
        sessionStorage.setItem('prohodnaya.renderer', 'canvas');
        location.reload();
      }
    } catch {
      /* приватный режим без sessionStorage — продолжаем как есть */
    }
  }
});
window.addEventListener('unhandledrejection', (e) => {
  (window as unknown as { __errs: string[] }).__errs.push(`rejection: ${String(e.reason)}`);
});

/**
 * Все Text растеризуем в 2×: при дробном зуме адаптивной камеры текст остаётся
 * чётким (текстура не растягивается). Патч фабрики — одна точка на всю игру.
 */
function installHiDpiText(): void {
  type Factory = Phaser.GameObjects.GameObjectFactory;
  const proto = Phaser.GameObjects.GameObjectFactory.prototype as unknown as {
    text: (
      this: Factory,
      x: number | undefined,
      y: number | undefined,
      content: string | string[] | undefined,
      style?: Phaser.Types.GameObjects.Text.TextStyle,
    ) => Phaser.GameObjects.Text;
  };
  const orig = proto.text;
  proto.text = function (x, y, content, style) {
    return orig.call(this, x, y, content, { resolution: 2, ...style });
  };
}

async function bootstrap(): Promise<void> {
  const platform = await initPlatform();

  // Пауза извне (реклама, сворачивание вкладки): глушим звук (п. 4.7 правил Яндекса).
  platform.onStateChanged(() => {
    console.info('[game] пауза от платформы');
    sfx.setMuted(true);
  });
  document.addEventListener('visibilitychange', () => {
    // при возврате во вкладку возвращаем НАСТРОЙКУ игрока, а не безусловно включаем звук
    if (!document.hidden) sfx.setMuted(!session().soundOn);
  });
  window.addEventListener('pointerdown', () => sfx.unlock());

  initSession(platform);
  await loadSession();
  // Стабильное имя игрока (топ-50, соперники в дуэлях): один раз, затем в сейве.
  // Приоритет — ник платформы (CrazyGames username: требование CG «в игре видны
  // платформенные ники»), фолбэк — сгенерированное имя.
  if (!session().mp.name) {
    session().mp.name = platform.getUserName?.() ?? getPlayerIdentity().name;
    void flushSession();
  }

  // Локализация: выбор игрока из сейва → ?lang=xx в адресе (проверка локалей) → язык
  // платформы (требование Яндекса 2.14 — автоопределение)
  const urlLang = new URLSearchParams(location.search).get('lang');
  initLocale(session().lang ?? urlLang ?? platform.getLang());
  sfx.setMuted(!session().soundOn); // настройка звука из сейва

  // Приглашение в дуэль: ?duel=КОД (универсальная ссылка) или параметр
  // запуска платформы (CrazyGames invite links) — лобби подхватит при старте
  const urlParams = new URLSearchParams(location.search);
  const inviteCode = urlParams.get('duel') ?? (await platform.getInviteParam?.('duel')) ?? null;
  if (inviteCode) queueDuelInvite(inviteCode);

  // Последняя попытка сохранить прогресс при уходе со страницы (не гарантирована)
  window.addEventListener('pagehide', () => {
    void flushSession();
  });

  await waitFonts();

  installHiDpiText();

  // Рендер: WebGL по умолчанию (?canvas=1 или флаг самолечения — Canvas).
  // Полностью векторная игра без растровых ассетов — Canvas-рендер тянет её целиком.
  let forceCanvas = false;
  try {
    forceCanvas = sessionStorage.getItem('prohodnaya.renderer') === 'canvas';
  } catch {
    /* приватный режим */
  }
  if (new URLSearchParams(location.search).has('canvas')) forceCanvas = true;

  // Адаптивный вьюпорт: canvas на всё окно, backing = css × clamp(dpr,1,2),
  // камеры зумятся на дизайн-область 720×1280 (см. render/layout.ts).
  // Ширина/высота в конфиге — стартовые, initLayout пересчитает их при 'ready'.
  const game = new Phaser.Game({
    type: forceCanvas ? Phaser.CANVAS : Phaser.AUTO,
    parent: 'app',
    width: 720,
    height: 1280,
    backgroundColor: '#ffedd3',
    roundPixels: false, // дробный зум: без привязки к пикселям анимации плавнее
    scale: {
      mode: Phaser.Scale.NONE, // размеры холста ведёт render/layout.ts
    },
    scene: [BootScene, MenuScene, GameScene, PlatformTestScene],
  });
  // Первый замер и живой ресайз (окно/ориентация/dpr) — применится после boot игры
  initLayout(game);
  // LoadingAPI.ready() — обязательный сигнал Яндекса: игра загрузилась и игрок может играть
  // (шрифты уже дождались до создания игры; Boot→Menu происходят мгновенно, ассетов нет)
  game.events.once(Phaser.Core.Events.READY, () => {
    getPlatform().ready();
    console.info('[game] LoadingAPI.ready() отправлен');
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
