import Phaser from 'phaser';
import { FONT, INK_HEX } from '../render/theme';
import { t } from '../i18n';

const OVERLAY_ID = 'prohodnaya-code-overlay';

/**
 * Нативный ввод кода комнаты поверх канваса: обычный <input> поднимает
 * мобильную клавиатуру, не требуя DOM-режима Phaser. Оверлей сам убирается
 * при подтверждении/отмене и при рестарте сцены (SHUTDOWN).
 */
export function promptCode(
  scene: Phaser.Scene,
  onSubmit: (code: string) => void,
  onCancel: () => void,
): void {
  removeOverlay();
  const wrap = document.createElement('div');
  wrap.id = OVERLAY_ID;
  wrap.innerHTML = `
    <div class="pc-card">
      <div class="pc-title">${t('enterCode')}</div>
      <input class="pc-input" maxlength="5" autocomplete="off" autocapitalize="characters" spellcheck="false" />
      <div class="pc-row">
        <button class="pc-btn pc-ok">OK</button>
        <button class="pc-btn pc-cancel">${t('cancel')}</button>
      </div>
    </div>`;
  const style = document.createElement('style');
  style.textContent = `
    #${OVERLAY_ID} { position: fixed; inset: 0; z-index: 1000; display: flex;
      align-items: center; justify-content: center; background: rgba(0,0,0,0.5);
      font-family: ${FONT}; }
    #${OVERLAY_ID} .pc-card { background: #ffffff; border: 5px solid ${INK_HEX};
      border-radius: 20px; padding: 24px 28px; display: flex; flex-direction: column;
      gap: 16px; box-shadow: 0 6px 0 rgba(51,37,78,0.2); }
    #${OVERLAY_ID} .pc-title { font-weight: 700; font-size: 22px; color: ${INK_HEX}; text-align: center; }
    #${OVERLAY_ID} .pc-input { font-family: ${FONT}; font-weight: 700; font-size: 34px;
      letter-spacing: 8px; text-transform: uppercase; text-align: center; color: ${INK_HEX};
      border: 4px solid ${INK_HEX}; border-radius: 12px; padding: 8px 12px; width: 220px; outline: none; }
    #${OVERLAY_ID} .pc-row { display: flex; gap: 12px; justify-content: center; }
    #${OVERLAY_ID} .pc-btn { font-family: ${FONT}; font-weight: 700; font-size: 18px;
      padding: 10px 22px; border-radius: 12px; border: 4px solid ${INK_HEX}; cursor: pointer; }
    #${OVERLAY_ID} .pc-ok { background: #ff7a3d; color: #ffffff; }
    #${OVERLAY_ID} .pc-cancel { background: #ffffff; color: ${INK_HEX}; }`;
  document.body.append(style, wrap);

  const input = wrap.querySelector<HTMLInputElement>('.pc-input');
  const cleanup = (): void => {
    style.remove();
    wrap.remove();
    scene.events.off(Phaser.Scenes.Events.SHUTDOWN, cleanup);
    scene.events.off(Phaser.Scenes.Events.DESTROY, cleanup);
  };
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
  scene.events.once(Phaser.Scenes.Events.DESTROY, cleanup);

  wrap.querySelector('.pc-ok')?.addEventListener('click', () => {
    const code = (input?.value ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4,6}$/.test(code)) return;
    cleanup();
    onSubmit(code);
  });
  wrap.querySelector('.pc-cancel')?.addEventListener('click', () => {
    cleanup();
    onCancel();
  });
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const code = (input.value ?? '').trim().toUpperCase();
      if (!/^[A-Z0-9]{4,6}$/.test(code)) return;
      cleanup();
      onSubmit(code);
    }
  });
  // сфокусировать после вставки — мобильная клавиатура открывается сразу
  window.setTimeout(() => input?.focus(), 50);
}

/** Убрать оверлей кода, если он остался от предыдущего флоу. */
export function removeOverlay(): void {
  document.getElementById(OVERLAY_ID)?.remove();
}
