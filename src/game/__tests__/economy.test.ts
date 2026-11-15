import { describe, expect, it } from 'vitest';
import { BALANCE, correctReward, dailyScore, nightReward, rankFor } from '../economy';

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
});
