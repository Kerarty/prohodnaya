import { describe, expect, it } from 'vitest';
import { dailySeed, dateKey, defaultSave, epochDays, normalizeSave } from '../save';

describe('сейв (день 5)', () => {
  it('dailySeed: одинаковый день — один сид у всех игроков', () => {
    expect(dailySeed('2026-11-11')).toBe(dailySeed('2026-11-11'));
    expect(dailySeed('2026-11-11')).not.toBe(dailySeed('2026-11-12'));
    expect(dailySeed('2026-11-11')).not.toBe(dailySeed('2027-11-11'));
  });

  it('dateKey: формат YYYY-MM-DD', () => {
    expect(dateKey(new Date(2026, 10, 9))).toBe('2026-11-09');
    expect(dateKey(new Date(2027, 0, 3))).toBe('2027-01-03');
  });

  it('defaultSave: чистый старт с todayBase', () => {
    const s = defaultSave(20000);
    expect(s.tokens).toBe(0);
    expect(s.shiftNumber).toBe(1);
    expect(s.todayBase).toBe(20000);
    expect(s.currentShift).toBeNull();
    expect(s.tools.lens).toBe(false);
  });

  it('normalizeSave: мусор -> дефолты', () => {
    const s = normalizeSave('garbage', 20000);
    expect(s).toEqual(defaultSave(20000));
    expect(normalizeSave(null, 20000)).toEqual(defaultSave(20000));
  });

  it('normalizeSave: рейтинги блица/дуэлей — дефолт 1000 при отсутствии и мусоре', () => {
    // старый сейв без blitzRating вообще (сейвы до системы рейтинга)
    const legacy = normalizeSave({ version: 1, mp: { blitzBest: 40, duelRating: 1012 } }, 20000);
    expect(legacy.mp.blitzRating).toBe(1000);
    expect(legacy.mp.duelRating).toBe(1012);
    // мусор в поле → дефолт
    const broken = normalizeSave({ version: 1, mp: { blitzRating: 'много', duelRating: -5 } }, 20000);
    expect(broken.mp.blitzRating).toBe(1000);
    expect(broken.mp.duelRating).toBe(0); // отрицательный int → 0 (не клампится к 1000)
  });

  it('normalizeSave: битые и отрицательные поля заменяются', () => {
    const s = normalizeSave(
      {
        version: 1,
        tokens: -50,
        xp: 'много',
        shiftNumber: 0,
        currentStreak: 2.7,
        tools: { lens: 'yes', detector: true },
        currentShift: { seed: 5, shift: -3, appIndex: 99.9 },
        dailyPlayed: 123,
      },
      20000,
    );
    expect(s.tokens).toBe(0);
    expect(s.xp).toBe(0);
    expect(s.shiftNumber).toBe(1);
    expect(s.currentStreak).toBe(2);
    expect(s.tools.lens).toBe(false);
    expect(s.tools.detector).toBe(true);
    expect(s.currentShift).toMatchObject({ seed: 5, shift: 1, appIndex: 99 });
    expect(s.dailyPlayed).toBeNull();
  });

  it('normalizeSave: валидный сейв читается как есть', () => {
    const raw = {
      version: 1,
      tokens: 340,
      xp: 320,
      shiftNumber: 4,
      todayBase: 19000,
      currentStreak: 7,
      bestStreak: 12,
      tools: { lens: true, detector: false },
      currentShift: {
        seed: 123456,
        shift: 4,
        isDaily: false,
        isNight: true,
        today: 3,
        appIndex: 5,
        correct: 4,
        errors: 1,
        earnedTokens: 44,
        earnedXp: 20,
        fastCount: 2,
      },
      dailyPlayed: '2026-11-10',
      nightPlayed: '2026-11-09',
    };
    const s = normalizeSave(raw, 20000);
    expect(s.tokens).toBe(340);
    expect(s.bestStreak).toBe(12);
    expect(s.tools.lens).toBe(true);
    expect(s.currentShift).toMatchObject({ seed: 123456, appIndex: 5, errors: 1, isNight: true });
    expect(s.dailyPlayed).toBe('2026-11-10');
    expect(s.nightPlayed).toBe('2026-11-09');
  });

  it('epochDays: локальные дни — границы суток по таймзоне игрока', () => {
    // Явная таймзона: UTC+0
    expect(epochDays(0, 0)).toBe(0);
    expect(epochDays(86_400_000, 0)).toBe(1);
    expect(epochDays(86_399_999, 0)).toBe(0);
    // UTC+3 (МСК): в 00:40 локального дня epoch-число уже следующего дня,
    // хотя по UTC предыдущий день ещё идёт — синхронно с dateKey()
    expect(epochDays(78_000_000, -180)).toBe(1);
    expect(epochDays(60_000_000, -180)).toBe(0);
  });
});
