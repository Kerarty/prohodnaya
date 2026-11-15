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

/** Реальная платформа Яндекс Игр. Работает только на хостинге платформы (sdk.js в index.html). */
export class YandexPlatform implements PlatformAPI {
  readonly name: PlatformName = 'Yandex';

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
      // Без игрока сейвы не работают, но игра должна запускаться
      console.warn('[platform:yandex] игрок недоступен, облачные сейвы отключены', e);
    }
  }

  ready(): void {
    try {
      this.ysdk?.features.LoadingAPI?.ready();
    } catch (e) {
      console.warn('[platform:yandex] LoadingAPI.ready() упал', e);
    }
  }

  getLang(): string {
    return this.ysdk?.environment.i18n.lang ?? 'ru';
  }

  async save(data: SaveData): Promise<void> {
    if (!this.player) return;
    try {
      // Лимит 200 КБ на игрока; частота ограничивается вызывающей стороной (троттлинг в сейве игры)
      await this.player.setData({ [SAVE_KEY]: data });
    } catch (e) {
      console.warn('[platform:yandex] setData не удался', e);
    }
  }

  async load(): Promise<SaveData | null> {
    if (!this.player) return null;
    try {
      const data = await this.player.getData();
      return (data[SAVE_KEY] as SaveData | undefined) ?? null;
    } catch (e) {
      console.warn('[platform:yandex] getData не удался', e);
      return null;
    }
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
