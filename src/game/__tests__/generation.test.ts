import { describe, expect, it } from 'vitest';
import { attrDiffCount, makeFixedQueue } from '../application';
import type { Application } from '../application';
import { generateShift } from '../generation';
import type { Rule } from '../rules';

const ATTR_FIELDS = [
  'headForm',
  'headColor',
  'bodyForm',
  'bodyColor',
  'eyes',
  'accessory',
] as const;

interface Sample {
  seed: number;
  shift: number;
  today: number;
  rules: Rule[];
  apps: Application[];
}

function shifted(shifts: number[] = [1, 2, 3, 4, 5, 6], seeds = 150): Sample[] {
  const out: Sample[] = [];
  for (const shift of shifts) {
    for (let s = 0; s < seeds; s++) {
      out.push(generateShift((s * 7919 + shift * 104729) >>> 0, shift));
    }
  }
  return out;
}

describe('генерация смены (дни 3–4)', () => {
  it('детерминирована: один сид — одна очередь', () => {
    const a = generateShift(12345, 2);
    const b = generateShift(12345, 2);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('структура смены: 8/10/12 заявок, онбординг смены 1 фиксирован', () => {
    const s1 = generateShift(1, 1);
    expect(s1.apps).toHaveLength(8);
    expect(s1.apps[0].training).toBe(true);
    expect(s1.apps[1].training).toBe(true);
    expect(generateShift(2, 2).apps).toHaveLength(10);
    expect(generateShift(3, 6).apps).toHaveLength(12);
    // Дневная смена: ровно 12 заявок независимо от номера смены
    expect(generateShift(4, 2, 1, 12).apps).toHaveLength(12);
  });

  it('смена 2+ начинается с обучающего слота новейшего правила', () => {
    for (let shift = 2; shift <= 6; shift++) {
      const g = generateShift(shift, shift);
      const newest = g.rules.reduce((a, b) =>
        b.fromShift > a.fromShift || (b.fromShift === a.fromShift && b.id > a.id) ? b : a,
      );
      const first = g.apps[0];
      expect(first.training).toBe(true);
      expect(first.reason).toBe('rule');
      expect(first.ruleId).toBe(newest.id);
    }
  });

  it('инварианты заявок на 900 сменах', () => { // тяжёлый перебор: таймаут 20 с
    // (тест умещается в 2–3 с, но под нагрузкой CI/машин бывает дольше 5 с)

    for (const { today, rules, apps } of shifted()) {
      const locked = new Set(rules.flatMap((r) => Object.keys(r.icon)));
      for (const app of apps) {
        const ctx = { guest: app.guest, doc: app.doc, today };
        const violations = rules.filter((r) => r.rejects(ctx));
        if (app.expected === 'approve') {
          expect(app.reason).toBe('none');
          expect(attrDiffCount(app.doc, app.guest)).toBe(0);
          expect(violations).toHaveLength(0);
        } else if (app.reason === 'forgery') {
          // подделка: гость чист, мутируется ровно одно свободное поле
          expect(violations).toHaveLength(0);
          const mutated = ATTR_FIELDS.filter((f) => app.doc[f] !== app.guest[f]);
          expect(mutated).toHaveLength(1);
          if (!app.training) expect(locked.has(mutated[0])).toBe(false);
        } else {
          // нарушитель: ровно одно нарушение, документные дефекты не трогают признаки
          expect(violations).toHaveLength(1);
          expect(app.ruleId).toBe(violations[0].id);
          expect(attrDiffCount(app.doc, app.guest)).toBe(0);
        }
      }
    }
  }, 20000);

  it('нарушители документных правил — дефект только в пропуске', () => {
    for (const { today, rules, apps } of shifted([5, 6, 11, 16, 20], 25)) {
      for (const app of apps) {
        if (app.reason !== 'rule') continue;
        const rule = rules.find((r) => r.id === app.ruleId);
        if (!rule?.docs?.length) continue;
        expect(attrDiffCount(app.doc, app.guest)).toBe(0);
        for (const d of rule.docs) {
          if (d === 'expiry') {
            if (rule.expiryKind === 'short') expect(app.doc.expiry - today).toBeLessThan(3);
            else expect(app.doc.expiry).toBeLessThan(today);
          } else {
            expect(app.doc.signature).toBe(false);
          }
        }
      }
    }
  });

  it('капы серий и потолок доли невалидных', () => {
    for (const { apps } of shifted()) {
      let run = 1;
      for (let i = 1; i < apps.length; i++) {
        if (apps[i].expected === apps[i - 1].expected) {
          run += 1;
          const invalid = apps[i].expected === 'reject';
          expect(run).toBeLessThanOrEqual(invalid ? 3 : 4);
        } else {
          run = 1;
        }
      }
      const invalid = apps.filter((a) => a.expected === 'reject').length;
      expect(invalid).toBeLessThanOrEqual(Math.floor(apps.length * 0.45));
    }
  });

  it('правило не мёртво: каждое активное правило имеет нарушителя', () => {
    for (const { rules, apps } of shifted()) {
      for (const rule of rules) {
        expect(apps.some((a) => a.reason === 'rule' && a.ruleId === rule.id)).toBe(true);
      }
    }
  });

  it('фиксированный онбординг остаётся валидным', () => {
    const queue = makeFixedQueue();
    expect(queue).toHaveLength(4);
    expect(attrDiffCount(queue[1].doc, queue[1].guest)).toBe(1);
    expect(attrDiffCount(queue[2].doc, queue[2].guest)).toBe(0);
    expect(attrDiffCount(queue[3].doc, queue[3].guest)).toBe(1);
  });
});
