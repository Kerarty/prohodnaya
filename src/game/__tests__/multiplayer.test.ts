import { describe, expect, it } from 'vitest';
import { duelDelta } from '../economy';
import { LocalMatchAPI } from '../../net/matchApi';
import { defaultSave, normalizeSave } from '../save';

describe('дуэльный рейтинг (план мультиплеера)', () => {
  it('дельты: победа +8, поражение −6, ничья 0', () => {
    expect(duelDelta(200, 120)).toBe(8);
    expect(duelDelta(120, 200)).toBe(-6);
    expect(duelDelta(150, 150)).toBe(0);
  });
});

describe('соперник-бот (LocalMatchAPI)', () => {
  it('quickMatch сразу даёт матч с сидом и стартом в будущем', async () => {
    const api = new LocalMatchAPI();
    const { matchId, matched } = await api.quickMatch();
    expect(matched).toBe(true);
    const poll = await api.pollMatch(matchId);
    expect(poll.seed).toBeGreaterThan(0);
    expect(poll.durationMs).toBe(90000);
    expect(poll.startAt).toBeGreaterThan(Date.now());
    expect(poll.opponentName).toContain('Бот');
  });

  it('счёт бота растёт со временем и ограничен потолком', async () => {
    const api = new LocalMatchAPI();
    const { matchId } = await api.quickMatch();
    const m = api['matches'].get(matchId)!;
    const early = api['botScoreAt'](m, 1000);
    const mid = api['botScoreAt'](m, 45000);
    const end = api['botFinal'](m);
    expect(early).toBeLessThanOrEqual(mid);
    expect(mid).toBeLessThanOrEqual(end);
    expect(end).toBeLessThanOrEqual(400); // потолок анти-чита
    expect(end).toBeGreaterThan(0); // бот набирает очки
  });

  it('reportResult: победа над ботом даёт +8, поражение −6', async () => {
    const api = new LocalMatchAPI();
    const { matchId } = await api.quickMatch();
    const m = api['matches'].get(matchId)!;
    const bot = api['botFinal'](m);

    const win = await api.reportResult(matchId, bot + 10);
    expect(win.winner).toBe('me');
    expect(win.ratingDelta).toBe(8);
    expect(win.opponentScore).toBe(bot);

    const api2 = new LocalMatchAPI();
    const { matchId: id2 } = await api2.quickMatch();
    const bot2 = api2['botFinal'](m2Of(api2, id2));
    const loss = await api2.reportResult(id2, Math.max(0, bot2 - 10));
    expect(loss.winner).toBe('opponent');
    expect(loss.ratingDelta).toBe(-6);
  });

  // бот-финал вычисляется из закрытого состояния — хелпер для теста
  function m2Of(api: LocalMatchAPI, id: string) {
    return api['matches'].get(id)!;
  }
});

describe('сейв v1 с мультиплеерным блоком', () => {
  it('normalizeSave: mp по умолчанию (рейтинг 1000)', () => {
    const s = normalizeSave(null, 20000);
    expect(s.mp).toEqual({
      blitzBest: 0,
      blitzRuns: 0,
      duelWins: 0,
      duelLosses: 0,
      duelDraws: 0,
      duelRating: 1000,
    });
    expect(defaultSave(20000).mp.duelRating).toBe(1000);
  });

  it('normalizeSave: битый mp заменяется дефолтами', () => {
    const s = normalizeSave({ mp: { duelRating: 'абв', blitzBest: -5 } }, 20000);
    expect(s.mp.duelRating).toBe(1000);
    expect(s.mp.blitzBest).toBe(0);
  });

  it('normalizeSave: валидный mp читается как есть', () => {
    const s = normalizeSave(
      { version: 1, mp: { blitzBest: 150, blitzRuns: 3, duelWins: 2, duelLosses: 1, duelDraws: 0, duelRating: 1016 } },
      20000,
    );
    expect(s.mp).toMatchObject({ blitzBest: 150, duelRating: 1016, duelWins: 2 });
  });
});
