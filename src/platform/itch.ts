import { LocalPlatform } from './local';
import type { PlatformName } from './types';

/**
 * itch.io (сборка `npm run build:itch`): той же локальной базой (localStorage-сейвы),
 * но без rewarded-точек — сторонняя реклама на itch.io запрещена, а имитировать
 * «награду за рекламу» без рекламы нельзя. Rewarded-кнопки скрываются по adsSupported.
 */
export class ItchPlatform extends LocalPlatform {
  readonly name: PlatformName = 'Itch';
  readonly adsSupported = false;
}
