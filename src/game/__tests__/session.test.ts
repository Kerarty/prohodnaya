import { describe, expect, it, beforeEach } from 'vitest';
import type { PlatformAPI, PlatformName, SaveData } from '../../platform';
import { epochDays } from '../save';
import {
  commitSession,
  flushSession,
  initSession,
  loadSession,
  resetSession,
  session,
  sessionToday,
} from '../session';

class FakePlatform implements PlatformAPI {
  readonly name: PlatformName = 'Local';
  readonly adsSupported = true;
  saves: SaveData[] = [];
  stored: SaveData | null = null;
  gameplayStarted = 0;
  gameplayStopped = 0;

  init(): Promise<void> {
    return Promise.resolve();
  }

  ready(): void {}

  gameplayStart(): void {
    this.gameplayStarted += 1;
  }

  gameplayStop(): void {
    this.gameplayStopped += 1;
  }

  getLang(): string {
    return 'ru';
  }

  async save(data: SaveData): Promise<void> {
    this.stored = data;
    this.saves.push(data);
  }

  async load(): Promise<SaveData | null> {
    return this.stored;
  }

  showRewarded(onReward: () => void): Promise<'shown' | 'failed'> {
    onReward();
    return Promise.resolve('shown');
  }

  showInterstitial(): Promise<void> {
    return Promise.resolve();
  }

  submitScore(): Promise<void> {
    return Promise.resolve();
  }

  onStateChanged(): void {}
}

async function freshSession(): Promise<FakePlatform> {
  const fake = new FakePlatform();
  initSession(fake);
  await loadSession();
  return fake;
}

describe('сессия (день 5)', () => {
  beforeEach(() => {
    resetSession();
  });

  it('чистый старт: дефолты и игровой день 1', async () => {
    const fake = await freshSession();
    expect(session().tokens).toBe(0);
    expect(session().shiftNumber).toBe(1);
    expect(sessionToday()).toBe(1);
    expect(fake.saves.length).toBe(0);
  });

  it('flushSession пишет сейв в платформу', async () => {
    const fake = await freshSession();
    session().tokens = 50;
    session().xp = 12;
    await flushSession();
    expect(fake.saves).toHaveLength(1);
    expect(fake.saves[0].tokens).toBe(50);
    expect(fake.saves[0].xp).toBe(12);
  });

  it('commitSession троттлится: две подряд — один реальный setData', async () => {
    const fake = await freshSession();
    session().tokens = 1;
    commitSession();
    session().tokens = 2;
    commitSession();
    expect(fake.saves.length).toBe(1);
  });

  it('восстановление: сейв с незавершённой сменой читается', async () => {
    const fake = new FakePlatform();
    const yesterday = epochDays() - 2; // та же база дней, что и sessionToday()
    const save = {
      version: 1,
      tokens: 120,
      xp: 350,
      shiftNumber: 4,
      todayBase: yesterday,
      currentStreak: 3,
      bestStreak: 9,
      tools: { lens: true, detector: false },
      currentShift: {
        seed: 777,
        shift: 4,
        isDaily: false,
        today: 3,
        appIndex: 5,
        correct: 4,
        errors: 1,
        earnedTokens: 45,
        earnedXp: 25,
        fastCount: 3,
      },
      dailyPlayed: null,
    };
    fake.stored = save as unknown as SaveData;
    initSession(fake);
    await loadSession();

    expect(sessionToday()).toBe(3);
    expect(session().tokens).toBe(120);
    expect(session().currentShift).toMatchObject({ seed: 777, appIndex: 5, earnedTokens: 45 });
    expect(session().tools.lens).toBe(true);
  });

  it('flushSession до loadSession безопасен', async () => {
    const fake = new FakePlatform();
    initSession(fake);
    await flushSession();
    expect(fake.saves.length).toBe(0);
  });
});
