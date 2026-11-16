import type { PlatformAPI, PlatformName, SaveData } from './types';

/* Минимальные типы SDK — только то, что используем. Дополняются по мере интеграции. */
interface YandexPlayer {
  setData(data: unknown): Promise<void>;
  getData(): Promise<Record<string, unknown>>;
}

interface YandexSdk {
  environment: { i18n: { lang: string } };
  features: {
    LoadingAPI?: { ready(): void };
    GameplayAPI?: { start(): void; stop(): void };
  };
  getPlayer(options: { scopes: boolean }): Promise<YandexPlayer>;
  adv: {
    showRewardedVideo(args: {
      callbacks: {
        onOpen?(): void;
        onRewarded(): void;
        onClose?(): void;
        onError?(error?: unknown): void;
      };
    }): void;
    showFullscreenAdv(args: {
      callbacks: { onClose?(wasShown?: boolean): void; onError?(error?: unknown): void };
    }): void;
  };
  getLeaderboards(): Promise<{
    setLeaderboardScore(name: string, score: number): Promise<void>;
  }>;
  on(event: 'game_api_pause', cb: () => void): void;
}

declare global {
  interface Window {
    YaGames?: { init(): Promise<YandexSdk> };
  }
}

const SAVE_KEY = 'save';
/** Локальная копия сейва: прогресс не теряется, пока игрок не авторизован или облако недоступно. */
const FALLBACK_KEY = 'prohodnaya.cloud';

function writeFallback(data: SaveData): void {
  try {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(data));
  } catch {
    /* приватный режим — остаётся только облако */
  }
}

function readFallback(): SaveData | null {
  try {
    const raw = localStorage.getItem(FALLBACK_KEY);
    return raw ? (JSON.parse(raw) as SaveData) : null;
  } catch {
    return null;
  }
}

/** Реальная платформа Яндекс Игр. Работает только на хостинге платформы (sdk.js в index.html). */
export class YandexPlatform implements PlatformAPI {
  readonly name: PlatformName = 'Yandex';
  readonly adsSupported: boolean = true;

  private ysdk: YandexSdk | null = null;
  private player: YandexPlayer | null = null;

  async init(): Promise<void> {
    if (!window.YaGames) {
      throw new Error('SDK Яндекс Игр не загружен (window.YaGames отсутствует)');
    }
    this.ysdk = await window.YaGames.init();
    try {
      this.player = await this.ysdk.getPlayer({ scopes: false });
    } catch (e) {
      // Без игрока облачные сейвы не работают — прогресс держится локальной копией
      console.warn('[platform:yandex] игрок недоступен, сейвы в localStorage', e);
    }
  }

  ready(): void {
    try {
      this.ysdk?.features.LoadingAPI?.ready();
    } catch (e) {
      console.warn('[platform:yandex] LoadingAPI.ready() упал', e);
    }
  }

  gameplayStart(): void {
    try {
      this.ysdk?.features.GameplayAPI?.start();
    } catch (e) {
      console.warn('[platform:yandex] GameplayAPI.start() упал', e);
    }
  }

  gameplayStop(): void {
    try {
      this.ysdk?.features.GameplayAPI?.stop();
    } catch (e) {
      console.warn('[platform:yandex] GameplayAPI.stop() упал', e);
    }
  }

  /** У Яндекса нет аналога праздника достижений — сознательный no-op. */
  happytime(): void {
    /* не поддерживается платформой */
  }

  getLang(): string {
    return this.ysdk?.environment.i18n.lang ?? 'ru';
  }

  async save(data: SaveData): Promise<void> {
    // Локальная копия пишется всегда: требование «сохранение сразу после действия»
    // не должно зависеть от доступности облака (гостевой режим, сетевые сбои)
    writeFallback(data);
    if (!this.player) return;
    try {
      // Лимит 200 КБ на игрока; частота ограничивается вызывающей стороной (троттлинг в сейве игры)
      await this.player.setData({ [SAVE_KEY]: data });
    } catch (e) {
      console.warn('[platform:yandex] setData не удался', e);
    }
  }

  async load(): Promise<SaveData | null> {
    if (this.player) {
      try {
        const data = await this.player.getData();
        const cloud = (data[SAVE_KEY] as SaveData | undefined) ?? null;
        if (cloud) return cloud;
      } catch (e) {
        console.warn('[platform:yandex] getData не удался', e);
      }
    }
    // Облака нет/пусто — играем от локальной копии (не теряем прогресс гостя)
    return readFallback();
  }

  showRewarded(onReward: () => void): Promise<'shown' | 'failed'> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (v: 'shown' | 'failed') => {
        if (!settled) {
          settled = true;
          resolve(v);
        }
      };
      this.ysdk!.adv.showRewardedVideo({
        callbacks: {
          onOpen: () => settle('shown'),
          onRewarded: () => onReward(),
          onClose: () => settle('shown'),
          onError: () => settle('failed'),
        },
      });
    });
  }

  showInterstitial(): Promise<void> {
    return new Promise((resolve) => {
      this.ysdk!.adv.showFullscreenAdv({
        callbacks: { onClose: () => resolve(), onError: () => resolve() },
      });
    });
  }

  async submitScore(boardId: string, score: number): Promise<void> {
    try {
      const boards = await this.ysdk!.getLeaderboards();
      await boards.setLeaderboardScore(boardId, score);
    } catch (e) {
      console.warn(`[platform:yandex] submitScore(${boardId}) не удался`, e);
    }
  }

  onStateChanged(cb: () => void): void {
    this.ysdk?.on('game_api_pause', cb);
  }
}
