import { LocalPlatform } from './local';
import type { PlatformName, SaveData } from './types';

/* Минимальные типы SDK CrazyGames v3 — только то, что используем. */
interface CrazySdk {
  init(): Promise<void>;
  environment: { locale: string };
  game: {
    loadingStart(): void;
    loadingComplete(): void;
    gameplayStart(): void;
    gameplayStop(): void;
  };
  ad: {
    requestAd(type: 'midgame' | 'rewarded', callbacks: {
      adStarted?(): void;
      adFinished?(): void;
      adError?(error?: unknown): void;
    }): void;
  };
  data: {
    setItem(key: string, value: string): void;
    getItem(key: string): string | null;
  };
}

declare global {
  interface Window {
    CrazyGames?: { SDK: CrazySdk };
  }
}

const SAVE_KEY = 'save';
/** Локальная копия сейва — на случай dataModuleDisabled или сетевых сбоев. */
const FALLBACK_KEY = 'prohodnaya.cloud';

const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`не удалось загрузить ${src}`));
    document.head.appendChild(s);
  });
}

function writeFallback(data: SaveData): void {
  try {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(data));
  } catch {
    /* приватный режим */
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

/**
 * CrazyGames (HTML5-подача): SDK подгружается динамически, только когда игра
 * запущена на домене CrazyGames в production-сборке — index.html остаётся чистым
 * для остальных площадок. Сейвы через Data Module (гостям — localStorage,
 * авторизация не нужна), реклама midgame/rewarded только через SDK.
 */
export class CrazyPlatform extends LocalPlatform {
  readonly name: PlatformName = 'Crazy';

  private sdk: CrazySdk | null = null;

  async init(): Promise<void> {
    // Деградация вместо падения: без SDK игра работает на локальной базе
    try {
      if (!window.CrazyGames) {
        await loadScript(SDK_URL);
      }
    } catch (e) {
      console.warn('[platform:crazy] SDK не загрузился, сейвы локальные', e);
      return;
    }
    if (!window.CrazyGames) return;
    try {
      this.sdk = window.CrazyGames.SDK;
      await this.sdk.init();
    } catch (e) {
      console.warn('[platform:crazy] SDK.init упал, сейвы локальные', e);
      this.sdk = null;
      return;
    }
    // Трекинг загрузки: complete в ready(), когда игрок может играть
    try {
      this.sdk.game.loadingStart();
    } catch (e) {
      console.warn('[platform:crazy] loadingStart упал', e);
    }
  }

  ready(): void {
    try {
      this.sdk?.game.loadingComplete();
    } catch (e) {
      console.warn('[platform:crazy] loadingComplete упал', e);
    }
  }

  gameplayStart(): void {
    try {
      this.sdk?.game.gameplayStart();
    } catch (e) {
      console.warn('[platform:crazy] gameplayStart упал', e);
    }
  }

  gameplayStop(): void {
    try {
      this.sdk?.game.gameplayStop();
    } catch (e) {
      console.warn('[platform:crazy] gameplayStop упал', e);
    }
  }

  getLang(): string {
    return this.sdk?.environment?.locale ?? 'en';
  }

  async save(data: SaveData): Promise<void> {
    writeFallback(data);
    if (!this.sdk) return;
    try {
      // Data Module: гостям пишет в localStorage, залогиненным — в облако (лимит 1 МБ)
      this.sdk.data.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('[platform:crazy] data.setItem не удался', e);
    }
  }

  async load(): Promise<SaveData | null> {
    if (this.sdk) {
      try {
        const raw = this.sdk.data.getItem(SAVE_KEY);
        if (raw) return JSON.parse(raw) as SaveData;
      } catch (e) {
        console.warn('[platform:crazy] data.getItem не удался', e);
      }
    }
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
      if (!this.sdk) {
        settle('failed');
        return;
      }
      const callbacks = {
        // Звук/геймплей глушатся вызывающей стороной (showRewardedSafe) до запроса
        adStarted: () => settle('shown'),
        adFinished: () => {
          onReward(); // награда только за реально просмотренную рекламу
          settle('shown');
        },
        adError: () => settle('failed'),
      };
      try {
        this.sdk.ad.requestAd('rewarded', callbacks);
      } catch (e) {
        console.warn('[platform:crazy] requestAd(rewarded) упал', e);
        settle('failed');
      }
    });
  }

  showInterstitial(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.sdk) {
        resolve();
        return;
      }
      const callbacks = {
        adFinished: () => resolve(),
        adError: () => resolve(), // unfilled/adCooldown — игра продолжается без рекламы
      };
      try {
        this.sdk.ad.requestAd('midgame', callbacks);
      } catch (e) {
        console.warn('[platform:crazy] requestAd(midgame) упал', e);
        resolve();
      }
    });
  }
}
