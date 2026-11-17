import { LocalPlatform } from './local';
import type { PlatformName, SaveData } from './types';

/* Минимальные типы SDK CrazyGames v3 — только то, что используем. */
interface CrazySdk {
  init(): Promise<void>;
  /** Строка-режим: 'local' | 'crazygames' | 'disabled' (НЕ объект). */
  environment: string;
  user: {
    /** Синхронно после init: локаль вида 'en-US', страна, устройство. */
    systemInfo?: { locale?: string };
    /** null — игрок не залогинен (гость). */
    getUser(): Promise<{ username?: string } | null>;
  };
  game: {
    loadingStart(): void;
    /** SDK v3: окончание загрузки (в v2 метод назывался loadingComplete). */
    loadingStop?(): void;
    /** Легаси-имя для страховки от старых версий SDK. */
    loadingComplete?(): void;
    gameplayStart(): void;
    gameplayStop(): void;
    happytime(): void;
    /** Ссылка-приглашение: параметры попадают в запуск игры у друга. */
    inviteLink(params: Record<string, string>): Promise<string>;
    /** Чтение параметров запуска-приглашения. */
    getInviteParam(key: string): string | null;
    /** Room Data: комната питает кнопки Join/Invite на сайте. */
    updateRoom?(room: { roomId?: string; isJoinable?: boolean; inviteParams?: Record<string, string> }): void;
    leftRoom?(): void;
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
  /** CrazyGames username (требование мультиплеера CG) — null для гостей. */
  private userName: string | null = null;

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
      console.info(`[platform:crazy] SDK окружение: ${this.sdk.environment}`);
    } catch (e) {
      console.warn('[platform:crazy] SDK.init упал, сейвы локальные', e);
      this.sdk = null;
      return;
    }
    // Трекинг загрузки: старт сразу после init (шрифты/сессия грузятся дальше),
    // остановка — в ready(), когда игрок может играть
    try {
      this.sdk.game.loadingStart();
    } catch (e) {
      console.warn('[platform:crazy] loadingStart упал', e);
    }
    // Username для дуэлей: друзья должны видеть платформенные ники (требование CG)
    await this.loadUserName();
  }

  /** Отдельный метод — чтобы тест проверял контракт без сетевого init(). */
  private async loadUserName(): Promise<void> {
    if (!this.sdk) return;
    try {
      const user = await this.sdk.user.getUser();
      this.userName = user?.username ?? null;
    } catch {
      /* 'disabled'-режим или гость — имя останется сгенерированным */
    }
  }

  getUserName(): string | null {
    return this.userName;
  }

  updateRoom(room: { roomId?: string; isJoinable?: boolean; inviteParams?: Record<string, string> }): void {
    try {
      this.sdk?.game.updateRoom?.(room);
    } catch (e) {
      console.warn('[platform:crazy] updateRoom упал', e);
    }
  }

  leftRoom(): void {
    try {
      this.sdk?.game.leftRoom?.();
    } catch (e) {
      console.warn('[platform:crazy] leftRoom упал', e);
    }
  }

  ready(): void {
    try {
      // SDK v3 = loadingStop(); loadingComplete — легаси v2, вызываем если есть
      if (typeof this.sdk?.game.loadingStop === 'function') {
        this.sdk.game.loadingStop();
      } else if (typeof this.sdk?.game.loadingComplete === 'function') {
        this.sdk.game.loadingComplete();
      }
    } catch (e) {
      console.warn('[platform:crazy] loadingStop упал', e);
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

  happytime(): void {
    try {
      this.sdk?.game.happytime();
    } catch (e) {
      console.warn('[platform:crazy] happytime упал', e);
    }
  }

  getLang(): string {
    // ВАЖНО: environment в v3 — строка-режим, локаль живёт в user.systemInfo
    try {
      const locale = this.sdk?.user?.systemInfo?.locale;
      if (locale) return locale.slice(0, 2);
    } catch {
      /* 'disabled'-режим: user-модуль недоступен */
    }
    return navigator.language?.slice(0, 2) ?? 'en';
  }

  getInviteParam(key: string): string | null {
    try {
      return this.sdk?.game.getInviteParam?.(key) ?? null;
    } catch {
      return null;
    }
  }

  async createInviteLink(code: string): Promise<string | null> {
    try {
      return (await this.sdk?.game.inviteLink({ duel: code })) ?? null;
    } catch {
      return null;
    }
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

  showRewarded(onReward: () => void, onAdStart?: () => void): Promise<'shown' | 'failed'> {
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
        // Звук глушится вызывающей стороной только здесь — когда реклама
        // реально пошла (требование CG: не мутить до запроса)
        adStarted: () => {
          onAdStart?.();
          settle('shown');
        },
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

  showInterstitial(onAdStart?: () => void): Promise<void> {
    return new Promise((resolve) => {
      if (!this.sdk) {
        resolve();
        return;
      }
      const callbacks = {
        adStarted: () => onAdStart?.(),
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
