import type { AccessoryType, BodyForm, ColorName, EyesType, HeadForm } from '../game/attributes';
import { t } from './index';
import type { TranslationKey } from './index';

/** Подписи признаков и правил — тонкие обёртки над t() с составными ключами. */

export const headColorLabel = (c: ColorName): string => t(`headColor_${c}` as TranslationKey);
export const bodyColorLabel = (c: ColorName): string => t(`bodyColor_${c}` as TranslationKey);
export const headFormLabel = (f: HeadForm): string => t(`headForm_${f}` as TranslationKey);
export const bodyFormLabel = (f: BodyForm): string => t(`bodyForm_${f}` as TranslationKey);
export const eyesLabel = (e: EyesType): string => (e === 'dots' ? t('eyesDots') : t('eyesStripes'));
export const accessoryLabel = (a: AccessoryType): string =>
  a === 'none' ? t('accNone') : a === 'hat' ? t('accHat') : t('accAntenna');

export const ruleText = (id: number): string => t(`rule_${id}` as TranslationKey);

export const rankTitle = (index: number): string => t(`rank_${index}` as TranslationKey);
