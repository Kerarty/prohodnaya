import type { PlatformAPI, PlatformName, SaveData } from './types';

const STORAGE_KEY = 'prohodnaya.save';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Заглушка платформы: игра полностью играбельна локально, без интернета.
 * Реклама эмулируется с задержкой 3 с, чтобы видеть, что геймплей реально ставится на паузу.
 */
export class LocalPlatform implements PlatformAPI {
  readonly name: PlatformName = 'Local';

  init(): Promise<void> {
    return Promise.resolve();
  }

  ready(): void {
    console.info('[platform:local] ready()');
  }

  gameplayStart(): void {
    console.info('[platform:local] gameplayStart()');
  }

  gameplayStop(): void {
    console.info('[platform:local] gameplayStop()');
  }

  getLang(): string {
    return navigator.language?.slice(0, 2) ?? 'ru';
  }

  async save(data: SaveData): Promise<void> {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  async load(): Promise<SaveData | null> {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SaveData;
    } catch {
      return null;
    }
  }

  async showRewarded(onReward: () => void): Promise<'shown' | 'failed'> {
    await delay(3000);
    onReward();
    return 'shown';
  }

  async showInterstitial(): Promise<void> {
    await delay(3000);
  }

  async submitScore(boardId: string, score: number): Promise<void> {
    console.info(`[platform:local] submitScore(${boardId}, ${score})`);
  }

  onStateChanged(cb: () => void): void {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) cb();
    });
  }
}
