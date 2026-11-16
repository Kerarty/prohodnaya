import { describe, expect, it } from 'vitest';
import { currentLocale, initLocale, t } from './index';
import { ruleText } from './labels';

describe('i18n', () => {
  it('t(): подстановка плейсхолдеров', () => {
    initLocale('ru');
    expect(t('entryOf', { i: 2, n: 12 })).toBe('Заявка 2/12');
    expect(t('shiftN', { n: 6 })).toBe('Смена 6');
  });

  it('локаль по базовому коду платформы: ru-RU → ru, pt-BR → pt', () => {
    initLocale('ru-RU');
    expect(currentLocale()).toBe('ru');
    initLocale('pt-BR');
    expect(currentLocale()).toBe('pt');
    initLocale('en');
    expect(t('entryOf', { i: 2, n: 12 })).toBe('Entry 2/12');
  });

  it('неизвестный язык — fallback en', () => {
    initLocale('zz');
    expect(currentLocale()).toBe('en');
    expect(t('ok')).toBe('Got it');
  });

  it('ruleText: правила доступные во всех локалях (первое и последнее)', () => {
    initLocale('en');
    expect(ruleText(1)).toBe('No blue heads');
    expect(ruleText(25)).toBe('No purple heads with unsigned passes');
    initLocale('ru');
    expect(ruleText(25)).toBe('Не пускать фиолетовые головы без подписи');
  });

  it('составные ключи признаков', () => {
    initLocale('ru');
    expect(ruleText(20)).toContain('одного цвета');
  });
});
