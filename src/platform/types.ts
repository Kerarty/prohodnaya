/** Данные сейва. v0.1 — каркас; полная схема появится с экономикой (день 5 ГДД). */
export interface SaveData {
  version: number;
  [key: string]: unknown;
}

/** Какая реализация платформы активна — для отладки и тестов. */
export type PlatformName = 'Yandex' | 'Local' | 'Itch' | 'Crazy';

/**
 * Единый контракт платформы. Игра не знает, где запущена:
 * LocalPlatform — localStorage + отложенные заглушки рекламы,
 * YandexPlatform — реальный SDK Яндекс Игр.
 */
export interface PlatformAPI {
  readonly name: PlatformName;

  /** Rewarded-точки показываются только там, где есть реклама (на itch.io — нет). */
  readonly adsSupported: boolean;

  /** Инициализация SDK. Вызывается один раз до старта игры. */
  init(): Promise<void>;

  /** Игра готова к первому действию игрока (LoadingAPI.ready — требование Яндекса). */
  ready(): void;

  /** Активный геймплей начался (GameplayAPI.start — требование Яндекса 1.19.3). */
  gameplayStart(): void;

  /** Геймплей приостановлен: меню, панели результатов, карточки (GameplayAPI.stop). */
  gameplayStop(): void;

  /**
   * Особое достижение игрока (рекорд блица, победа в дуэли, новое звание, чистая
   * смена) — на CrazyGames триггерит праздник сайта. Звать РЕДКО: только значимые
   * моменты, не за каждую смену (требование документации CrazyGames).
   */
  happytime(): void;

  /** Язык интерфейса игрока ('ru' | 'en' | ...). */
  getLang(): string;

  /** Сохранить прогресс (облако на Яндексе, localStorage локально). */
  save(data: SaveData): Promise<void>;

  /** Загрузить прогресс или null, если сейва нет. */
  load(): Promise<SaveData | null>;

  /**
   * Rewarded-видео. onReward вызывается только за реально просмотренную рекламу
   * (событие onRewarded, не onClose — требование п. 4.7 правил Яндекса).
   */
  showRewarded(onReward: () => void): Promise<'shown' | 'failed'>;

  /** Interstitial. Игра зовёт только на логических паузах (политика — ГДД, разд. 7). */
  showInterstitial(): Promise<void>;

  /** Отправить скор в лидерборд (таблица должна существовать в Консоли). */
  submitScore(boardId: string, score: number): Promise<void>;

  /** Пауза извне (реклама, сворачивание) — игра глушит звук и таймеры. */
  onStateChanged(cb: () => void): void;

  /** Параметр запуска-приглашения (CrazyGames invite links); иначе null. */
  getInviteParam?(key: string): string | null;

  /** Ссылка-приглашение с параметром для друга (CrazyGames); иначе null. */
  createInviteLink?(code: string): Promise<string | null>;
}
