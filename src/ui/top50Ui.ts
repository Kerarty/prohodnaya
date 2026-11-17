import Phaser from 'phaser';
import { FONT, INK_HEX } from '../render/theme';
import { t } from '../i18n';
import { fetchTop50, type Top50Entry } from '../net/top50';

const OVERLAY_ID = 'prohodnaya-top50-overlay';

/**
 * Таблицы топ-50 (блиц по рейтингу блица, дуэли по дуэльному рейтингу) —
 * DOM-оверлей над канвасом: 50 строк без ограничений Phaser-текста, скролл,
 * своя строка подсвечена, при отсутствии в топе — приколота снизу с местом.
 * Данные с сигналинг-сервера (?peer=); без него — честная надпись «недоступен».
 */
export function showTop50(
  scene: Phaser.Scene,
  myName: string,
  myProfile: { blitzRating: number; duelRating: number; blitzBest: number; duelWins: number; duelLosses: number; duelDraws: number },
): void {
  removeTop50();
  const wrap = document.createElement('div');
  wrap.id = OVERLAY_ID;
  wrap.innerHTML = `
    <div class="t50-card">
      <div class="t50-tabs">
        <button class="t50-tab t50-tab-active" data-tab="blitz">${t('blitzName')}</button>
        <button class="t50-tab" data-tab="duels">${t('duelName')}</button>
        <button class="t50-close" aria-label="close">✕</button>
      </div>
      <div class="t50-body">${t('top50Loading')}</div>
    </div>`;
  const style = document.createElement('style');
  style.textContent = `
    #${OVERLAY_ID} { position: fixed; inset: 0; z-index: 1000; display: flex;
      align-items: center; justify-content: center; background: rgba(0,0,0,0.5);
      font-family: ${FONT}; }
    #${OVERLAY_ID} .t50-card { background: #ffffff; border: 5px solid ${INK_HEX};
      border-radius: 20px; width: min(560px, 92vw); padding: 16px;
      box-shadow: 0 6px 0 rgba(51,37,78,0.2); }
    #${OVERLAY_ID} .t50-tabs { display: flex; gap: 8px; margin-bottom: 10px; }
    #${OVERLAY_ID} .t50-tab { flex: 1; font-family: ${FONT}; font-weight: 700; font-size: 18px;
      padding: 8px 0; border-radius: 12px; border: 4px solid ${INK_HEX};
      background: #ffffff; color: ${INK_HEX}; cursor: pointer; }
    #${OVERLAY_ID} .t50-tab-active { background: #ff7a3d; color: #ffffff; }
    #${OVERLAY_ID} .t50-close { width: 44px; font-family: ${FONT}; font-weight: 700;
      font-size: 18px; border-radius: 12px; border: 4px solid ${INK_HEX};
      background: #ffffff; color: ${INK_HEX}; cursor: pointer; }
    #${OVERLAY_ID} .t50-body { max-height: 62vh; overflow-y: auto; }
    #${OVERLAY_ID} .t50-note { text-align: center; color: ${INK_HEX};
      font-size: 16px; padding: 24px 8px; }
    #${OVERLAY_ID} .t50-row { display: flex; align-items: center; gap: 8px;
      padding: 5px 8px; border-radius: 10px; font-size: 15px; color: ${INK_HEX}; }
    #${OVERLAY_ID} .t50-row:nth-child(odd) { background: #fff6ec; }
    #${OVERLAY_ID} .t50-row-me { background: #ffe2cf; outline: 3px solid #ff7a3d; }
    #${OVERLAY_ID} .t50-rank { width: 34px; font-weight: 700; flex-shrink: 0; }
    #${OVERLAY_ID} .t50-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #${OVERLAY_ID} .t50-num { font-weight: 700; flex-shrink: 0; }
    #${OVERLAY_ID} .t50-sub { font-size: 12px; opacity: 0.65; flex-shrink: 0; }`;
  document.body.append(style, wrap);
  const cleanup = (): void => {
    style.remove();
    wrap.remove();
    scene.events.off(Phaser.Scenes.Events.SHUTDOWN, cleanup);
    scene.events.off(Phaser.Scenes.Events.DESTROY, cleanup);
  };
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
  scene.events.once(Phaser.Scenes.Events.DESTROY, cleanup);

  const body = wrap.querySelector<HTMLDivElement>('.t50-body')!;
  const tabs = wrap.querySelectorAll<HTMLButtonElement>('.t50-tab');
  let active: 'blitz' | 'duels' = 'blitz';
  let data: Awaited<ReturnType<typeof fetchTop50>> = null;

  const makeRow = (e: Top50Entry, rank: number | null, tab: 'blitz' | 'duels', meName: string): HTMLDivElement => {
    const row = document.createElement('div');
    const isMe = e.name === meName;
    row.className = `t50-row${isMe ? ' t50-row-me' : ''}`;
    const rankEl = document.createElement('span');
    rankEl.className = 't50-rank';
    rankEl.textContent = rank === null ? '—' : `${rank}`;
    const nameEl = document.createElement('span');
    nameEl.className = 't50-name';
    nameEl.textContent = isMe ? `${e.name} · ${t('top50You')}` : e.name;
    const numEl = document.createElement('span');
    numEl.className = 't50-num';
    numEl.textContent = `${tab === 'blitz' ? e.blitzRating : e.duelRating}`;
    const subEl = document.createElement('span');
    subEl.className = 't50-sub';
    subEl.textContent =
      tab === 'blitz' ? t('top50BestSuffix', { best: e.blitzBest }) : `${e.duelWins}-${e.duelLosses}-${e.duelDraws}`;
    row.append(rankEl, nameEl, numEl, subEl);
    return row;
  };

  const render = (): void => {
    if (!data) return;
    const list = data[active];
    body.textContent = '';
    if (list.length === 0) {
      const note = document.createElement('div');
      note.className = 't50-note';
      note.textContent = t('top50Empty');
      body.append(note);
      return;
    }
    list.forEach((e, i) => {
      body.append(makeRow(e, i + 1, active, myName));
    });
    // Своя строка видна ВСЕГДА: нет в топ-50 — приколота снизу с твоим рейтингом
    if (!list.some((e) => e.name === myName)) {
      const me: Top50Entry = { name: myName, ts: 0, ...myProfile };
      body.append(makeRow(me, null, active, myName));
    }
  };

  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      active = (btn.dataset.tab as 'blitz' | 'duels') ?? 'blitz';
      tabs.forEach((b) => b.classList.toggle('t50-tab-active', b === btn));
      render();
    });
  });
  wrap.querySelector('.t50-close')?.addEventListener('click', cleanup);

  void fetchTop50().then((d) => {
    data = d;
    if (!data) {
      body.textContent = '';
      const note = document.createElement('div');
      note.className = 't50-note';
      note.textContent = t('top50Offline');
      body.append(note);
      return;
    }
    render();
  });
}

/** Убрать оверлей, если остался от предыдущего флоу. */
export function removeTop50(): void {
  document.getElementById(OVERLAY_ID)?.remove();
}
