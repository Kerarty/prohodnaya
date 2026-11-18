import { BALANCE } from './economy';
import { dateKey } from './save';
import type { MissionSave, SaveDataV1 } from './save';

/**
 * Задания дня (план v2 В2): три контракта за календарный день — причина
 * возвращаться завтра (CG: clear reachable goals + retention). Прогресс — в сейве,
 * награды получают игроки в кабинете тапом по выполненному контракту.
 */

export interface MissionDef {
  goal: number;
  reward: number;
}

export const MISSIONS: readonly MissionDef[] = [
  { goal: 10, reward: BALANCE.missionRewards[0] }, // 10 верных решений
  { goal: 1, reward: BALANCE.missionRewards[1] }, // смена без ошибок
  { goal: 5, reward: BALANCE.missionRewards[2] }, // 5 пойманных подделок
];

/** Гарантировать свежие задания на сегодня: новый день — прогресс с нуля. */
export function ensureMissions(s: SaveDataV1): MissionSave {
  const today = dateKey();
  if (!s.missions || s.missions.date !== today) {
    s.missions = { date: today, progress: [0, 0, 0], claimed: [false, false, false] };
  }
  return s.missions;
}

/** Начислить итоги смены: верные решения, безошибочность, пойманные подделки. */
export function bumpMissions(s: SaveDataV1, result: { correct: number; clean: boolean; fakes: number }): void {
  const m = ensureMissions(s);
  m.progress[0] += result.correct;
  m.progress[1] += result.clean ? 1 : 0;
  m.progress[2] += result.fakes;
}

/** Контракт выполнен и награда ещё не забрана. */
export function isClaimable(s: SaveDataV1, index: 0 | 1 | 2): boolean {
  const m = ensureMissions(s);
  return !m.claimed[index] && m.progress[index] >= MISSIONS[index].goal;
}

/** Забрать награду: жетоны + флаг; true — если забрал (для перерисовки кабинета). */
export function claimMission(s: SaveDataV1, index: 0 | 1 | 2): boolean {
  if (!isClaimable(s, index)) return false;
  const m = ensureMissions(s);
  m.claimed[index] = true;
  s.tokens += MISSIONS[index].reward;
  return true;
}
