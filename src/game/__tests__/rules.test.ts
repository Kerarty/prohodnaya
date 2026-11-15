import { describe, expect, it } from 'vitest';
import { rngFor } from '../rng';
import { CATALOG, rulesConflict, rulesForShift } from '../rules';

function expectedSize(shift: number): number {
  return shift <= 1 ? 1 : shift <= 3 ? 2 : 3;
}

describe('каталог и активный набор правил (день 4)', () => {
  it('полный каталог: 25 правил с id 1..25', () => {
    expect(CATALOG.map((r) => r.id)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it('размер активного набора по сменам: 1 / 2 / 3', () => {
    for (let shift = 1; shift <= 25; shift++) {
      expect(rulesForShift(shift)).toHaveLength(expectedSize(shift));
      expect(rulesForShift(shift, rngFor(shift, 'rules'))).toHaveLength(expectedSize(shift));
    }
  });

  it('совместимость и лимит сложности 5 во всех наборах, с ротацией и без', () => {
    for (let shift = 1; shift <= 25; shift++) {
      const sets = [rulesForShift(shift), rulesForShift(shift, rngFor(shift * 17, 'rules'))];
      for (const rules of sets) {
        for (let i = 0; i < rules.length; i++) {
          for (let j = i + 1; j < rules.length; j++) {
            expect(rulesConflict(rules[i], rules[j])).toBe(false);
          }
        }
        expect(rules.filter((r) => r.difficulty === 5).length).toBeLessThanOrEqual(1);
      }
    }
  });

  it('каждое правило каталога когда-нибудь активно (детерминированная серия)', () => {
    const seen = new Set<number>();
    for (let shift = 1; shift <= 25; shift++) {
      for (const r of rulesForShift(shift)) seen.add(r.id);
    }
    for (const rule of CATALOG) expect(seen.has(rule.id)).toBe(true);
  });

  it('ротация с rng: детерминизм и разнообразие составов', () => {
    const a = rulesForShift(10, rngFor(777, 'rules'));
    const b = rulesForShift(10, rngFor(777, 'rules'));
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id));

    const variants = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      variants.add(
        rulesForShift(10, rngFor((seed * 131) >>> 0, 'rules'))
          .map((r) => r.id)
          .join(','),
      );
    }
    expect(variants.size).toBeGreaterThan(1);
  });
});
