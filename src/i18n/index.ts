import { en } from './locales/en';
import { ru } from './locales/ru';
import { es } from './locales/es';
import { pt } from './locales/pt';
import { fr } from './locales/fr';
import { de } from './locales/de';
import { it } from './locales/it';

/** Канонический набор ключей — en-словарь. Остальные локали обязаны их покрывать (проверяет TS). */
export type TranslationKey = keyof typeof en;

export type LocaleCode = 'ru' | 'en' | 'es' | 'pt' | 'fr' | 'de' | 'it';

const DICTS: Record<LocaleCode, Record<TranslationKey, string>> = { ru, en, es, pt, fr, de, it };

const FALLBACK: LocaleCode = 'en';
let current: LocaleCode = 'ru';

const LOCALE_MAP: Record<string, LocaleCode> = {
  ru: 'ru', be: 'ru', kk: 'ru', uk: 'ru',
  en: 'en',
  es: 'es', 'es-419': 'es',
  pt: 'pt', 'pt-BR': 'pt',
  fr: 'fr',
  de: 'de',
  it: 'it',
};

/**
 * Применить локаль. Приоритет решает вызывающий (bootstrap): выбор игрока из сейва
 * → ?lang=xx в адресе (проверка локалей) → язык платформы.
 */
export function initLocale(lang: string): void {
  const base = lang.toLowerCase().split(/[-_]/)[0];
  current = LOCALE_MAP[base] ?? LOCALE_MAP[lang] ?? FALLBACK;
  console.info(`[i18n] локаль: ${current}`);
}

export function currentLocale(): LocaleCode {
  return current;
}

/** Перевод с подстановкой плейсхолдеров: t('appOf', { i: 2, n: 12 }) → «Заявка 2/12». */
export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  let line: string = DICTS[current][key] ?? DICTS[FALLBACK][key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      line = line.split(`{${name}}`).join(String(value));
    }
  }
  return line;
}
