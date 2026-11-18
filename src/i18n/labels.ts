import type { AccessoryType, BodyForm, CharacterAttrs, ColorName, EyesType, HeadForm } from '../game/attributes';
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

/** Подпись процедурного правила Tier 6 (план v2 В7): «Запрещено: {значение} {признак}». */
export function syntheticRuleLabel(key: keyof CharacterAttrs, value: string): string {
  const attrLabel =
    key === 'headForm' || key === 'headColor'
      ? t('headLabel')
      : key === 'bodyForm' || key === 'bodyColor'
        ? t('bodyLabel')
        : key === 'eyes'
          ? t('eyesLabel')
          : t('accLabel');
  const valueLabel =
    key === 'headForm'
      ? headFormLabel(value as HeadForm)
      : key === 'bodyForm'
        ? bodyFormLabel(value as BodyForm)
        : key === 'headColor'
          ? headColorLabel(value as ColorName)
          : key === 'bodyColor'
            ? bodyColorLabel(value as ColorName)
            : key === 'eyes'
              ? eyesLabel(value as EyesType)
              : accessoryLabel(value as AccessoryType);
  return t('ruleSynthetic', { v: valueLabel, a: attrLabel.toLowerCase() });
}

export const rankTitle = (index: number): string => t(`rank_${index}` as TranslationKey);
