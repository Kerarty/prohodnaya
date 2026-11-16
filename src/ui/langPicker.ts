import Phaser from 'phaser';
import { currentLocale, initLocale, type LocaleCode } from '../i18n';
import { flushSession, session } from '../game/session';
import { THEME } from '../render/theme';
import { OVERLAY, screenCenter, DESIGN_CX } from '../render/layout';
import { sfx } from '../systems/sfx';
import { makeButton } from './button';

/** Языки селектора — подписи всегда на родном языке (не переводятся). */
const LANGS: Array<{ code: LocaleCode; label: string }> = [
  { code: 'ru', label: 'Русский' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
];

/**
 * Кнопка смены языка (код текущей локали) + попап со всеми языками.
 * Выбор сохраняется в сейв и перезапускает сцену — тексты пересоздаются.
 */
export function makeLangButton(
  scene: Phaser.Scene,
  cx: number,
  cy: number,
  onChange?: () => void,
): Phaser.GameObjects.Container {
  return makeButton(scene, cx, cy, currentLocale().toUpperCase(), () => openPicker(scene, onChange), {
    secondary: true,
    width: 96,
    height: 72,
    fontSize: 24,
  });
}

function openPicker(scene: Phaser.Scene, onChange?: () => void): void {
  if (scene.children.getByName('langPicker')) return;
  // Панель — по центру ЭКРАНА (не только дизайн-колонки); dim больше любого аспекта
  const c = screenCenter();

  const group = scene.add.container(0, 0).setName('langPicker');
  const dim = scene.add
    .rectangle(OVERLAY.x, OVERLAY.y, OVERLAY.width, OVERLAY.height, 0x000000, 0.5)
    .setInteractive()
    .setDepth(20);
  dim.on('pointerdown', () => closePicker(scene));
  group.add(dim);

  const plate = scene.add.graphics().setDepth(20);
  const listH = LANGS.length * 74;
  plate.fillStyle(THEME.PAPER, 1);
  plate.fillRoundedRect(DESIGN_CX - 210, c.y - listH / 2 - 24, 420, listH + 48, 20);
  plate.lineStyle(5, THEME.INK, 1);
  plate.strokeRoundedRect(DESIGN_CX - 210, c.y - listH / 2 - 24, 420, listH + 48, 20);
  group.add(plate);

  const current = currentLocale();
  LANGS.forEach((lang, i) => {
    const y = c.y - listH / 2 - 24 + 44 + i * 74;
    const isCurrent = lang.code === current;
    const btn = makeButton(
      scene,
      DESIGN_CX,
      y,
      lang.label,
      () => selectLocale(scene, lang.code, onChange),
      isCurrent
        ? { color: THEME.ACCENT, width: 360, height: 60, fontSize: 24 }
        : { secondary: true, width: 360, height: 60, fontSize: 24 },
    ).setDepth(20);
    group.add(btn);
  });
}

function selectLocale(scene: Phaser.Scene, code: LocaleCode, onChange?: () => void): void {
  session().lang = code;
  void flushSession();
  initLocale(code);
  closePicker(scene);
  if (onChange) {
    onChange();
  } else {
    scene.scene.restart();
  }
}

function closePicker(scene: Phaser.Scene): void {
  sfx.tap();
  scene.children.getByName('langPicker')?.destroy();
}
