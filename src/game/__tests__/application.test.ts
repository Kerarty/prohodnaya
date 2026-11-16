import { describe, expect, it } from 'vitest';
import { initLocale } from '../../i18n';
import { attrDiffCount, describeForgery, makeFixedQueue } from '../application';
import { RULE_BLUE_HEADS } from '../rules';

// Тексты карточек проверяются в исходной локали
initLocale('ru');

function diffCount(app: ReturnType<typeof makeFixedQueue>[number]): number {
  return attrDiffCount(app.doc, app.guest);
}

describe('очередь дня 2 (фиксированная)', () => {
  const queue = makeFixedQueue();

  it('валидные заявки: документ совпадает с гостем, причина — none', () => {
    for (const app of queue) {
      if (app.expected !== 'approve') continue;
      expect(app.reason).toBe('none');
      expect(diffCount(app)).toBe(0);
      expect(app.doc.expiry).toBeGreaterThan(0);
      expect(app.doc.signature).toBe(true);
    }
  });

  it('у каждой подделки ровно одно расхождение (инвариант ГДД 3.4.1)', () => {
    forgeries().forEach((app) => {
      expect(diffCount(app)).toBe(1);
      expect(app.expected).toBe('reject');
    });
  });

  it('гость любой заявки не нарушает активное правило — причина отказа всегда одна', () => {
    for (const app of queue) {
      const ctx = { guest: app.guest, doc: app.doc, today: 1 };
      expect(RULE_BLUE_HEADS.rejects(ctx)).toBe(false);
    }
  });

  it('describeForgery указывает на несовпавшее поле', () => {
    const [forgeryHead, forgeryBody] = forgeries();
    expect(describeForgery(forgeryHead).field).toBe('head');
    expect(describeForgery(forgeryBody).field).toBe('body');
    expect(describeForgery(forgeryHead).text).toContain('Подделка');
    expect(describeForgery(forgeryBody).text).toContain('Подделка');
  });

  function forgeries() {
    return queue.filter((app) => app.reason === 'forgery');
  }
});
