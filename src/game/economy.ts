import balance from '../data/balance.json';

/** Все числа баланса — в data-файле (ГДД, «крутилки» разд. 5). */
export const BALANCE = balance;

export const BOARD_IDS: { streak: string; daily: string } = BALANCE.boardIds;

export function correctReward(fast: boolean): number {
  return BALANCE.salary + (fast ? BALANCE.speedBonus : 0);
}

/** Скор дневной смены (ГДД разд. 6): максимум 10×12 + 12 + 50 = 182. */
export function dailyScore(correct: number, fast: number, errors: number): number {
  return (
    BALANCE.dailyScoreCorrect * correct +
    BALANCE.dailyScoreFast * fast +
    (errors === 0 ? BALANCE.dailyScoreClean : 0)
  );
}

/** Зарплата ночной смены: ×1.5 с округлением вверх (ГДД разд. 7). */
export function nightReward(base: number): number {
  return Math.ceil(base * BALANCE.nightSalaryMult);
}

/** Дельта дуэльного рейтинга (план мультиплеера, фаза 2): победа/поражение/ничья. */
export function duelDelta(myScore: number, opponentScore: number): number {
  if (myScore === opponentScore) return BALANCE.duelDrawDelta;
  return myScore > opponentScore ? BALANCE.duelWinDelta : BALANCE.duelLossDelta;
}

export function rankFor(xp: number): { index: number; title: string; nextXp: number | null } {
  const ranks = BALANCE.ranks;
  let index = 0;
  for (let i = 0; i < ranks.length; i++) {
    if (xp >= ranks[i].xp) index = i;
  }
  return {
    index,
    title: ranks[index].title,
    nextXp: index + 1 < ranks.length ? ranks[index + 1].xp : null,
  };
}
