import type { PlatformAPI } from './types';
import { CrazyPlatform } from './crazy';
import { ItchPlatform } from './itch';
import { LocalPlatform } from './local';
import { YandexPlatform } from './yandex';

export type { PlatformAPI, PlatformName, SaveData } from './types';

/** HTML5-подача CrazyGames: игра хостится на их домене в production-сборке. */
function onCrazyGamesHosting(): boolean {
  return (
    import.meta.env.MODE === 'production' &&
    typeof location !== 'undefined' &&
    /(^|\.)crazygames\.com$/.test(location.hostname)
  );
}

/** Явный оверрайд для локального теста платформы: ?platform=crazy|itch|local. */
function forcedPlatform(): 'crazy' | 'itch' | 'local' | null {
  if (typeof location === 'undefined') return null;
  const p = new URLSearchParams(location.search).get('platform');
  return p === 'crazy' || p === 'itch' || p === 'local' ? p : null;
}

let instance: PlatformAPI | null = null;

/**
 * Одна production-сборка обслуживает все площадки: приоритет у SDK, который
 * реально доступен в окружении. SDK Яндекса платформа подставляет сама
 * (window.YaGames), itch-сборка идёт в режиме itch (без рекламы),
 * CrazyGames определяется по домену хостинга (SDK подгружается динамически).
 * Локально SDK отсутствует — играется через заглушку LocalPlatform.
 * ?platform=crazy гоняет CrazyPlatform на localhost: SDK v3 сам включает
 * local-режим с демо-рекламой (доки CrazyGames), ?useLocalSdk=true не нужен.
 */
export async function initPlatform(): Promise<PlatformAPI> {
  if (instance) return instance;

  const forced = forcedPlatform();
  instance =
    typeof window !== 'undefined' && window.YaGames !== undefined
      ? new YandexPlatform()
      : forced === 'itch'
        ? new ItchPlatform()
        : forced === 'crazy' || onCrazyGamesHosting()
          ? new CrazyPlatform()
          : new LocalPlatform();
  await instance.init();
  console.info(`[platform] активна: ${instance.name}`);
  return instance;
}

export function getPlatform(): PlatformAPI {
  if (!instance) throw new Error('PlatformAPI не инициализирован — сначала initPlatform()');
  return instance;
}
