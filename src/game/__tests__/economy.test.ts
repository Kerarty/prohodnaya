import { describe, expect, it } from 'vitest';
import {
  BALANCE,
  blitzRatingUpdate,
  correctReward,
  dailyScore,
  nightReward,
  rankFor,
  shouldShowInterstitial,
} from '../economy';
import { defaultSave } from '../save';

describe('экономика (день 5–6)', () => {
  it('зарплата и скоростной бонус', () => {
    expect(correctReward(false)).toBe(BALANCE.salary);
    expect(correctReward(true)).toBe(BALANCE.salary + BALANCE.speedBonus);
  });

  it('ночная смена: ×1.5 с округлением вверх', () => {
    expect(nightReward(11)).toBe(Math.ceil(11 * BALANCE.nightSalaryMult));
    expect(nightReward(11)).toBe(17);
    expect(nightReward(12)).toBe(18);
  });

  it('скор дневной смены: максимум 182', () => {
    expect(dailyScore(BALANCE.dailyApps, BALANCE.dailyApps, 0)).toBe(182);
    expect(dailyScore(12, 0, 1)).toBe(120);
    expect(dailyScore(0, 0, 3)).toBe(0);
  });

  it('звания по XP с границами', () => {
    expect(rankFor(0)).toMatchObject({ index: 0, title: 'Стажёр', nextXp: 300 });
    expect(rankFor(299).title).toBe('Стажёр');
    expect(rankFor(300)).toMatchObject({ index: 1, title: 'Дежурный', nextXp: 900 });
    expect(rankFor(900).title).toBe('Старший дежурный');
    expect(rankFor(2000).title).toBe('Инспектор');
    expect(rankFor(4000)).toMatchObject({ index: 4, title: 'Главный инспектор', nextXp: null });
  });

  it('interstitial-политика: онбординг, интервал и частота (ГДД разд. 7)', () => {
    const ad = { lastAdAt: 0, shiftsSince: 0 };
    const now = 10_000_000;
    // онбординг: смены 1–3 без interstitial
    expect(shouldShowInterstitial({ ...ad, shiftsSince: 10 }, 3, now)).toBe(false);
    // не чаще 1 на 3 смены
    expect(shouldShowInterstitial(ad, 4, now)).toBe(false);
    expect(shouldShowInterstitial({ ...ad, shiftsSince: 2 }, 4, now)).toBe(false);
    expect(shouldShowInterstitial({ ...ad, shiftsSince: BALANCE.interstitialEveryShifts }, 4, now)).toBe(true);
    // 120 с после любой рекламы (rewarded включительно)
    const fresh = { lastAdAt: now - BALANCE.interstitialMinGapMs + 1, shiftsSince: 10 };
    expect(shouldShowInterstitial(fresh, 4, now)).toBe(false);
    expect(shouldShowInterstitial({ ...fresh, lastAdAt: now - BALANCE.interstitialMinGapMs }, 4, now)).toBe(true);
    // дефолтный сейв: ничего не показываем
    expect(shouldShowInterstitial(defaultSave(0).ad, 4, now)).toBe(false);
  });

  it('рейтинг блица: самокалибровка, потолок дельты и пол нуля', () => {
    const { blitzRatingScale: scale, blitzRatingStep: step, blitzRatingCap: cap } = BALANCE;
    // старт 1000: ожидаемый скор = 1000 × scale
    const expectedAt1000 = 1000 * scale;
    // забег заметно выше ожидания — рейтинг растёт
    const up = blitzRatingUpdate(1000, expectedAt1000 + step * 5);
    expect(up.delta).toBe(5);
    expect(up.rating).toBe(1005);
    // забег ниже ожидания — падает
    const down = blitzRatingUpdate(1000, Math.max(0, expectedAt1000 - step * 7));
    expect(down.delta).toBe(-7);
    // потолок дельты: вверх — забег сильно выше ожидания,
    // вниз — высокий рейтинг при нулевом скор (ожидание 480, кап ограничивает −48 → −30)
    const cappedUp = blitzRatingUpdate(1000, expectedAt1000 + 1000);
    expect(cappedUp.delta).toBe(cap);
    const cappedDown = blitzRatingUpdate(4000, 0);
    expect(cappedDown.delta).toBe(-cap);
    expect(cappedDown.rating).toBe(4000 - cap);
    // реалистичный минимум со старта: нулевой забег с рейтинга 1000 → −12
    expect(blitzRatingUpdate(1000, 0)).toMatchObject({ delta: -12, rating: 988 });
    // пол: рейтинг не уходит в минус
    const floored = blitzRatingUpdate(5, 0);
    expect(floored.rating).toBeGreaterThanOrEqual(0);
    // сходимость: серия «идеальных» забегов тянется к фактическому уровню
    let r = 1000;
    const level = 400;
    for (let i = 0; i < 1000; i++) {
      r = blitzRatingUpdate(r, level).rating;
    }
    expect(Math.abs(r - level / scale)).toBeLessThanOrEqual(cap * 2);
    // и не уходит за него бесконечно: дельта у цели мала
    expect(Math.abs(blitzRatingUpdate(r, level).delta)).toBeLessThanOrEqual(1);
  });

  it('рейтинг блица в дефолтном сейве = 1000', () => {
    expect(defaultSave(0).mp.blitzRating).toBe(1000);
  });
});
