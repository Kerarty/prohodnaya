import type { PlatformAPI } from './types';
import { ItchPlatform } from './itch';
import { LocalPlatform } from './local';
import { YandexPlatform } from './yandex';

export type { PlatformAPI, PlatformName, SaveData } from './types';

let instance: PlatformAPI | null = null;

/**
 * SDK на хостинге Яндекса подключается тегом в index.html и определяет window.YaGames.
 * itch-сборка (`npm run build:itch`, vite mode=itch) получает ItchPlatform без рекламы.
 * Локально SDK отсутствует — играется через заглушку LocalPlatform.
 */
export async function initPlatform(): Promise<PlatformAPI> {
  if (instance) return instance;

  instance =
    typeof window !== 'undefined' && window.YaGames !== undefined
      ? new YandexPlatform()
      : import.meta.env.MODE === 'itch'
        ? new ItchPlatform()
        : new LocalPlatform();
  await instance.init();
  console.info(`[platform] активна: ${instance.name}`);
  return instance;
}

export function getPlatform(): PlatformAPI {
  if (!instance) throw new Error('PlatformAPI не инициализирован — сначала initPlatform()');
  return instance;
}
