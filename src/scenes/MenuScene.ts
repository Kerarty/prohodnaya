import Phaser from 'phaser';
import { getPlatform } from '../platform';
import { BALANCE } from '../game/economy';
import { dateKey } from '../game/save';
import { flushSession, resetProgress, session, sessionRank, sessionToday } from '../game/session';
import { drawBooth } from '../render/booth';
import { applyCamera, OVERLAY, screenCenter, DESIGN_CX, DESIGN_W } from '../render/layout';
import { bulbWave } from '../render/juice';
import { FONT, INK_HEX, THEME } from '../render/theme';
import { sfx } from '../systems/sfx';
import { createMatchAPI, getPlayerIdentity, LocalMatchAPI, type MatchAPI } from '../net/matchApi';
import { isP2PNoSlotsError } from '../net/p2p';
import { queueLaunch } from './GameScene';
import { makeButton } from '../ui/button';
import { promptCode } from '../ui/lobbyUi';
import { showTop50 } from '../ui/top50Ui';
import { t } from '../i18n';
import { rankTitle } from '../i18n/labels';
import { makeLangButton } from '../ui/langPicker';

/**
 * Приглашение в дуэль, пришедшее при запуске (ссылка ?duel=КОД или
 * invite-параметр платформы) — подхватывается лобби при создании сцены.
 */
let pendingInvite: string | null = null;

export function queueDuelInvite(code: string | null): void {
  pendingInvite = code?.trim().toUpperCase() || null;
}

/**
 * Кабинет «Мульт-поп» (ГДД разд. 5–6 + план мультиплеера): вывеска-логотип,
 * звание и XP-бар, жетоны, смены (обычная/дневная/ночная), БЛИЦ и ДУЭЛЬ,
 * покупки инструментов. Смены безлимитны.
 */
export class MenuScene extends Phaser.Scene {
  private bulbs: Phaser.GameObjects.Arc[] = [];
  private waitingUi: Phaser.GameObjects.Container | null = null;
  private waitingEvent: Phaser.Time.TimerEvent | null = null;
  private waitingCancelled = false;
  private waitingMatchId: string | null = null;
  private waitingApi: MatchAPI | null = null;
  private lobbyUi: Phaser.GameObjects.Container | null = null;
  private settingsUi: Phaser.GameObjects.Container | null = null;
  private statsUi: Phaser.GameObjects.Container | null = null;
  private resetArmed = false;

  constructor() {
    super('Menu');
  }

  create(): void {
    // Адаптивный вьюпорт: зум камеры под фактический размер окна (layout.ts)
    applyCamera(this);
    const width = DESIGN_W; // сцены живут в дизайн-координатах 720×1280
    const s = session();
    const rank = sessionRank();
    this.bulbs = [];
    this.waitingUi = null;
    this.waitingEvent = null;
    this.waitingCancelled = false;
    // Кабинет — не активный геймплей: разметка GameplayAPI.stop для платформы
    try {
      getPlatform().gameplayStop();
    } catch {
      /* platform ещё не инициализирована (изолированные тесты сцен) */
    }

    drawBooth(this, 'menu');

    // Смена языка — правый верхний угол (рядом с кнопкой «Меню» в смене)
    makeLangButton(this, width - 48, 44);

    // Логотип-вывеска с лампочками (спека §4.6)
    const logo = this.add.graphics();
    logo.fillStyle(THEME.INK, THEME.SHADOW_A);
    logo.fillRoundedRect(120, 101, 480, 110, 20);
    logo.fillStyle(THEME.PANEL, 1);
    logo.fillRoundedRect(120, 95, 480, 110, 20);
    logo.lineStyle(5, THEME.INK, 1);
    logo.strokeRoundedRect(120, 95, 480, 110, 20);
    this.add
      .text(width / 2, 150, t('appName'), {
        fontFamily: FONT,
        fontSize: '56px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setStroke(INK_HEX, 4);
    for (let i = 0; i < 5; i++) {
      const x = 150 + i * 105;
      this.bulbs.push(this.add.circle(x, 101, 6, THEME.GOLD).setAlpha(THEME.BULB_OFF_A));
      this.bulbs.push(this.add.circle(x, 199, 6, THEME.GOLD).setAlpha(THEME.BULB_OFF_A));
    }
    this.bulbs.push(this.add.circle(126, 150, 6, THEME.GOLD).setAlpha(THEME.BULB_OFF_A));
    this.bulbs.push(this.add.circle(594, 150, 6, THEME.GOLD).setAlpha(THEME.BULB_OFF_A));
    this.time.addEvent({ delay: 4000, loop: true, callback: () => bulbWave(this, this.bulbs) });

    // Звание + XP-бар с полосатой заливкой (спека §4.6)
    this.add
      .text(width / 2, 235, rank.title, {
        fontFamily: FONT,
        fontSize: '30px',
        color: INK_HEX,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const barW = 420;
    const barX = width / 2 - barW / 2;
    const barY = 267;
    const bar = this.add.graphics();
    bar.fillStyle(THEME.NICHE, 1);
    bar.fillRoundedRect(barX, barY, barW, 20, 10);
    bar.lineStyle(4, THEME.INK, 1);
    bar.strokeRoundedRect(barX, barY, barW, 20, 10);
    if (rank.nextXp !== null) {
      const prevXp = BALANCE.ranks[rank.index].xp;
      const progress = Phaser.Math.Clamp((s.xp - prevXp) / (rank.nextXp - prevXp), 0, 1);
      // минимальная заливка — заметная капсула, а не точка-кружок
      const fillW = Math.max(16, (barW - 10) * progress);
      if (progress > 0) {
        bar.fillStyle(THEME.ACCENT, 1);
        bar.fillRoundedRect(barX + 5, barY + 5, fillW, 10, 5);
        bar.lineStyle(4, 0xffffff, 0.25);
        for (let sx = barX + 5; sx < barX + 5 + fillW; sx += 14) {
          bar.lineBetween(sx, barY + 18, Math.min(sx + 12, barX + 5 + fillW), barY + 2);
        }
      }
      this.add
        .text(width / 2, 303, t('xpLine', { xp: s.xp, rank: rankTitle(rank.index + 1), left: rank.nextXp - s.xp }), {
          fontFamily: FONT,
          fontSize: '20px',
          color: INK_HEX,
        })
        .setOrigin(0.5);
    } else {
      this.add
        .text(width / 2, 303, t('xpMax', { xp: s.xp }), {
          fontFamily: FONT,
          fontSize: '20px',
          color: INK_HEX,
        })
        .setOrigin(0.5);
    }

    // Жетоны: иконка-монета с бликом + число
    const tokens = this.add
      .text(width / 2 + 34, 370, `${s.tokens}`, {
        fontFamily: FONT,
        fontSize: '44px',
        color: INK_HEX,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    const coin = this.add.graphics();
    coin.setPosition(width / 2 + 8 - tokens.width / 2, 370);
    coin.fillStyle(THEME.GOLD, 1);
    coin.fillCircle(0, 0, 22);
    coin.lineStyle(4, THEME.INK, 1);
    coin.strokeCircle(0, 0, 22);
    coin.lineStyle(3, THEME.INK, 0.3);
    coin.strokeCircle(0, 0, 15);
    coin.fillStyle(0xffffff, 0.5);
    coin.fillCircle(-7, -8, 5);

    const mp = s.mp;
    this.add
      .text(
        width / 2,
        412,
        t('statsLine', { day: sessionToday(), b: s.bestStreak, w: mp.duelWins, l: mp.duelLosses, draws: mp.duelDraws, r: mp.duelRating }),
        { fontFamily: FONT, fontSize: '19px', color: INK_HEX },
      )
      .setOrigin(0.5);

    // Строки кабинета: stagger-въезд (спека §4.6)
    const resume = s.currentShift;
    const shiftLabel = resume
      ? resume.isNight
        ? t('continueNight')
        : t('continueShift')
      : t('startShift');
    const dailyPlayed = s.dailyPlayed === dateKey();
    const nightPlayed = s.nightPlayed === dateKey();
    const unlocked = rank.index >= 1;
    const debugMode = new URLSearchParams(location.search).has('debug');

    const rows: Array<{ alpha: number; make: () => Phaser.GameObjects.Container }> = [
      {
        alpha: 1,
        make: () =>
          makeButton(this, width / 2, 500, shiftLabel, () => this.scene.start('Game'), {
            color: THEME.ACCENT,
            width: 380,
          }),
      },
      {
        alpha: 1,
        make: () =>
          makeButton(this, width / 2, 592, t('blitzButton'), () => this.startBlitz(), {
            color: THEME.ACCENT,
            width: 380,
            height: 72,
            fontSize: 24,
          }),
      },
      {
        alpha: 1,
        make: () =>
          makeButton(this, width / 2, 676, t('duelButton'), () => void this.startDuel(), {
            color: THEME.ACCENT,
            width: 380,
            height: 72,
            fontSize: 24,
          }),
      },
      {
        alpha: !unlocked || dailyPlayed ? 0.55 : 1,
        make: () =>
          makeButton(
            this,
            width / 2,
            760,
            t('dailyButton'),
            () => this.startDaily(),
            {
              secondary: true,
              width: 380,
              height: 72,
              fontSize: 24,
              subtitle: !unlocked
                ? t('subRank')
                : dailyPlayed
                  ? t('subPlayed')
                  : undefined,
            },
          ),
      },
      {
        alpha: !unlocked || nightPlayed ? 0.55 : 1,
        make: () =>
          makeButton(
            this,
            width / 2,
            844,
            t('nightButton'),
            () => this.startNight(),
            {
              secondary: true,
              width: 380,
              height: 72,
              fontSize: 24,
              subtitle: !unlocked
                ? 'со звания Дежурный'
                : nightPlayed
                  ? t('subPlayed')
                  : undefined,
            },
          ),
      },
      {
        alpha: s.tools.lens || s.tokens < BALANCE.lensPrice ? 0.55 : 1,
        make: () =>
          makeButton(this, width / 2 - 98, 924, t('lensBuy', { p: BALANCE.lensPrice }), () => this.buy('lens'), {
            secondary: true,
            width: 186,
            height: 72,
            fontSize: 18,
          }),
      },
      {
        alpha: s.tools.detector || s.tokens < BALANCE.detectorPrice ? 0.55 : 1,
        make: () =>
          makeButton(
            this,
            width / 2 + 98,
            924,
            t('detectorBuy', { p: BALANCE.detectorPrice }),
            () => this.buy('detector'),
            { secondary: true, width: 186, height: 72, fontSize: 18 },
          ),
      },
    ];

    if (debugMode) {
      // Отладочная сцена платформы — только при ?debug (не показываем в проде)
      rows.push({
        alpha: 1,
        make: () =>
          makeButton(this, width / 2 - 130, 1004, t('statsBtn'), () => this.showStats(), {
            secondary: true,
            width: 124,
            height: 72,
            fontSize: 16,
          }),
      });
      rows.push({
        alpha: 1,
        make: () =>
          makeButton(this, width / 2, 1004, t('platformTest'), () => this.scene.start('PlatformTest'), {
            secondary: true,
            width: 124,
            height: 72,
            fontSize: 16,
          }),
      });
      rows.push({
        alpha: 1,
        make: () =>
          makeButton(this, width / 2 + 130, 1004, t('settings'), () => this.showSettings(), {
            secondary: true,
            width: 124,
            height: 72,
            fontSize: 16,
          }),
      });
    } else {
      rows.push({
        alpha: 1,
        make: () =>
          makeButton(this, width / 2 - 98, 1004, t('statsBtn'), () => this.showStats(), {
            secondary: true,
            width: 186,
            height: 72,
            fontSize: 18,
          }),
      });
      rows.push({
        alpha: 1,
        make: () =>
          makeButton(this, width / 2 + 98, 1004, t('settings'), () => this.showSettings(), {
            secondary: true,
            width: 186,
            height: 72,
            fontSize: 18,
          }),
      });
    }

    rows.forEach((row, i) => {
      const btn = row.make();
      btn.setAlpha(0);
      const targetY = btn.y;
      btn.y = targetY + 30;
      this.tweens.add({
        targets: btn,
        y: targetY,
        alpha: row.alpha,
        duration: 250,
        delay: i * 60,
        ease: 'Back.easeOut',
      });
    });

    // Приглашение по ссылке/платформенному параметру — сразу в дуэль
    if (pendingInvite) {
      const code = pendingInvite;
      pendingInvite = null;
      void this.joinRoomByCode(code);
    }
  }

  private buy(tool: 'lens' | 'detector'): void {
    const s = session();
    if (tool === 'lens' ? s.tools.lens : s.tools.detector) return;
    const price = tool === 'lens' ? BALANCE.lensPrice : BALANCE.detectorPrice;
    if (s.tokens < price) return;

    s.tokens -= price;
    if (tool === 'lens') s.tools.lens = true;
    else s.tools.detector = true;
    void flushSession();
    sfx.purchase();
    this.scene.restart();
  }

  private startDaily(): void {
    const s = session();
    if (sessionRank().index < 1 || s.dailyPlayed === dateKey()) return;
    // Флаг ставится при старте: перезапуск дня ради лучшего сида — чит (ГДД разд. 6)
    s.dailyPlayed = dateKey();
    void flushSession();
    this.scene.start('Game', { daily: true });
  }

  private startNight(): void {
    const s = session();
    if (sessionRank().index < 1 || s.nightPlayed === dateKey()) return;
    // Аналогично дневной: попытка тратится при старте
    s.nightPlayed = dateKey();
    void flushSession();
    this.scene.start('Game', { night: true });
  }

  /** Блиц: забег на 90 с без сервера (план мультиплеера, фаза 1). */
  private startBlitz(): void {
    this.scene.start('Game', { blitz: true });
  }

  /** Кнопка ДУЭЛЬ: лобби с тремя путями — быстрый матч, комната, код. */
  private startDuel(): void {
    if (this.waitingUi || this.lobbyUi) return;
    this.showLobby();
  }

  /** Лобби дуэли: быстрый матч / создать комнату / войти по коду. */
  private showLobby(): void {
    const dim = this.add
      .rectangle(0, 0, OVERLAY.width, OVERLAY.height, 0x000000, 0.5)
      .setInteractive()
      .setDepth(20);
    dim.on('pointerdown', () => this.closeLobby());
    const plate = this.add.graphics().setDepth(20);
    plate.fillStyle(THEME.PAPER, 1);
    plate.fillRoundedRect(-210, -200, 420, 400, 18);
    plate.lineStyle(4, THEME.INK, 1);
    plate.strokeRoundedRect(-210, -200, 420, 400, 18);
    plate.fillStyle(THEME.PANEL, 1);
    plate.fillRoundedRect(-130, -186, 260, 44, 12);
    plate.lineStyle(3, THEME.INK, 1);
    plate.strokeRoundedRect(-130, -186, 260, 44, 12);

    const title = this.add
      .text(0, -164, t('duelName'), { fontFamily: FONT, fontSize: '24px', color: '#ffffff', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setDepth(20)
      .setStroke(INK_HEX, 3);

    const quick = makeButton(this, 0, -100, t('quickMatchBtn'), () => {
      this.closeLobby();
      void this.startQuickMatch();
    }, { color: THEME.ACCENT, width: 360, height: 72, fontSize: 24 });
    const create = makeButton(this, 0, -16, t('createRoomBtn'), () => {
      this.closeLobby();
      void this.startRoomHost();
    }, { color: THEME.ACCENT, width: 360, height: 72, fontSize: 24 });
    const join = makeButton(this, 0, 68, t('joinByCodeBtn'), () => {
      this.closeLobby();
      this.promptJoinCode();
    }, { color: THEME.ACCENT, width: 360, height: 72, fontSize: 24 });
    const back = makeButton(this, 0, 152, t('cancel'), () => this.closeLobby(), {
      secondary: true,
      width: 260,
      height: 64,
      fontSize: 22,
    });

    this.lobbyUi = this.add
      .container(DESIGN_CX, screenCenter().y, [dim, plate, title, quick, create, join, back])
      .setDepth(20);
  }

  private closeLobby(): void {
    this.lobbyUi?.destroy();
    this.lobbyUi = null;
    sfx.tap();
  }

  /** Тост-подсказка поверх кабинета (как в GameScene). */
  private toast(text: string): void {
    const toast = this.add
      .text(DESIGN_CX, screenCenter().y, text, {
        fontFamily: FONT,
        fontSize: '22px',
        color: INK_HEX,
        backgroundColor: '#ffffff',
        padding: { x: 16, y: 8 },
      })
      .setOrigin(0.5)
      .setDepth(30);
    this.tweens.add({ targets: toast, alpha: 0, delay: 1600, duration: 300, onComplete: () => toast.destroy() });
  }

  /** Пригласительная ссылка: платформенная (CrazyGames) или универсальная ?duel=КОД. */
  private async copyInvite(code: string): Promise<void> {
    const universal = `${location.origin}${location.pathname}?duel=${code}`;
    let link: string | null = universal;
    try {
      link = (await getPlatform().createInviteLink?.(code)) ?? universal;
    } catch {
      link = universal;
    }
    try {
      await navigator.clipboard.writeText(link);
      this.toast(t('inviteCopied'));
    } catch {
      this.toast(t('inviteCopyFail'));
    }
  }

  /** Быстрый матч: P2P-хабы → нет слотов → бот (дуэль всегда даёт игру). */
  private async startQuickMatch(): Promise<void> {
    if (this.waitingUi) return;
    this.showWaiting();
    try {
      const api = await createMatchAPI();
      this.waitingApi = api;
      const quick = await api.quickMatch();
      this.waitingMatchId = quick.matchId;
      if (quick.matched) {
        await this.enterDuel(api);
        return;
      }
      // ждём соперника: поллим состояние раз в 2 с
      this.waitingEvent = this.time.addEvent({
        delay: 2000,
        loop: true,
        callback: () => void this.pollWaiting(api),
      });
    } catch {
      this.hideWaiting(t('duelFailed'));
    }
  }

  /** Создать комнату: показываем код + копию ссылки, ждём гостя. */
  private async startRoomHost(): Promise<void> {
    if (this.waitingUi) return;
    try {
      const api = await createMatchAPI();
      if (!api.createRoom) throw new Error('rooms-unsupported');
      this.waitingApi = api;
      const room = await api.createRoom();
      this.waitingMatchId = room.matchId;
      // Room Data (CrazyGames): комната открыта для Join/Invite на стороне сайта
      getPlatform().updateRoom?.({
        roomId: room.matchId,
        isJoinable: true,
        inviteParams: { duel: room.code },
      });
      this.showWaiting(room.code);
      this.waitingEvent = this.time.addEvent({
        delay: 2000,
        loop: true,
        callback: () => void this.pollWaiting(api),
      });
    } catch {
      this.toast(t('duelFailed'));
    }
  }

  /** Ввод кода комнаты — нативный оверлей (мобильная клавиатура). */
  private promptJoinCode(): void {
    promptCode(
      this,
      (code) => void this.joinRoomByCode(code),
      () => sfx.tap(),
    );
  }

  /** Войти в комнату по коду (кнопка лобби или приглашение по ссылке). */
  private async joinRoomByCode(code: string): Promise<void> {
    if (this.waitingUi) return;
    this.showWaiting();
    try {
      const api = await createMatchAPI();
      if (!api.joinRoom) throw new Error('rooms-unsupported');
      this.waitingApi = api;
      const room = await api.joinRoom(code);
      this.waitingMatchId = room.matchId;
      await this.enterDuel(api);
    } catch {
      this.hideWaiting(t('roomNotFound'));
    }
  }

  private async pollWaiting(api: MatchAPI): Promise<void> {
    if (this.waitingCancelled || !this.waitingMatchId) return;
    try {
      const poll = await api.pollMatch(this.waitingMatchId);
      if (poll.matched && poll.seed !== null) {
        this.cleanupWaiting();
        queueLaunch({
          duel: true,
          matchId: this.waitingMatchId,
          seed: poll.seed,
          durationMs: poll.durationMs ?? BALANCE.duelDurationMs,
          startAt: poll.startAt ?? Date.now() + BALANCE.duelCountdownMs,
          opponentName: poll.opponentName ?? t('opponentDefault'),
          botOpponent: api.botOpponent,
          api,
        });
        this.scene.start('Game');
      }
    } catch (e) {
      if (isP2PNoSlotsError(e)) {
        // Все P2P-хабы заняты дуэлями — дуэль всегда даёт игру: бот
        this.cleanupWaiting();
        this.waitingApi = new LocalMatchAPI();
        await this.startQuickMatch();
        return;
      }
      // сетевая ошибка — следующий тик
    }
  }

  private async enterDuel(api: MatchAPI): Promise<void> {
    if (this.waitingCancelled || !this.waitingMatchId) return;
    const poll = await api.pollMatch(this.waitingMatchId);
    if (!poll.matched || poll.seed === null) throw new Error('матч не готов');
    this.cleanupWaiting();
    queueLaunch({
      duel: true,
      matchId: this.waitingMatchId,
      seed: poll.seed,
      durationMs: poll.durationMs ?? BALANCE.duelDurationMs,
      startAt: poll.startAt ?? Date.now() + BALANCE.duelCountdownMs,
      opponentName: poll.opponentName ?? t('opponentDefault'),
      botOpponent: api.botOpponent,
      api,
    });
    this.scene.start('Game');
  }

  /** Панель статистики: рейтинги блица и дуэлей, рекорды — всё в одном месте. */
  private showStats(): void {
    if (this.statsUi) return;
    const s = session();

    const dim = this.add
      .rectangle(0, 0, OVERLAY.width, OVERLAY.height, 0x000000, 0.5)
      .setInteractive()
      .setDepth(20);
    const plate = this.add.graphics().setDepth(20);
    plate.fillStyle(THEME.PAPER, 1);
    plate.fillRoundedRect(-250, -230, 500, 460, 20);
    plate.lineStyle(5, THEME.INK, 1);
    plate.strokeRoundedRect(-250, -230, 500, 460, 20);
    plate.fillStyle(THEME.ACCENT, 1);
    plate.fillRoundedRect(-140, -216, 280, 44, 12);
    plate.lineStyle(3, THEME.INK, 1);
    plate.strokeRoundedRect(-140, -216, 280, 44, 12);

    const title = this.add
      .text(0, -194, t('statsTitle'), { fontFamily: FONT, fontSize: '24px', color: '#ffffff', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setStroke(INK_HEX, 3);

    const blitzLine = this.add
      .text(0, -124, t('blitzStatsLine', { r: s.mp.blitzRating, best: s.mp.blitzBest, n: s.mp.blitzRuns }), {
        fontFamily: FONT,
        fontSize: '20px',
        color: INK_HEX,
        align: 'center',
        wordWrap: { width: 440 },
      })
      .setOrigin(0.5);

    const duelLine = this.add
      .text(0, -68, t('duelStatsLine', { r: s.mp.duelRating, w: s.mp.duelWins, l: s.mp.duelLosses, d: s.mp.duelDraws }), {
        fontFamily: FONT,
        fontSize: '20px',
        color: INK_HEX,
        align: 'center',
        wordWrap: { width: 440 },
      })
      .setOrigin(0.5);

    const streakLine = this.add
      .text(0, -12, t('bestStreakLine', { n: s.bestStreak }), {
        fontFamily: FONT,
        fontSize: '20px',
        color: INK_HEX,
      })
      .setOrigin(0.5);

    const top50Btn = makeButton(this, 0, 56, t('top50Btn'), () => {
      showTop50(this, getPlayerIdentity().name, {
        blitzRating: s.mp.blitzRating,
        duelRating: s.mp.duelRating,
        blitzBest: s.mp.blitzBest,
        duelWins: s.mp.duelWins,
        duelLosses: s.mp.duelLosses,
        duelDraws: s.mp.duelDraws,
      });
    }, {
      color: THEME.PANEL,
      width: 320,
      height: 60,
      fontSize: 22,
    });

    const back = makeButton(this, 0, 148, t('back'), () => this.closeStats(), {
      secondary: true,
      width: 300,
      height: 64,
      fontSize: 24,
    });

    this.statsUi = this.add
      .container(DESIGN_CX, screenCenter().y, [dim, plate, title, blitzLine, duelLine, streakLine, top50Btn, back])
      .setDepth(20);
  }

  private closeStats(): void {
    this.statsUi?.destroy();
    this.statsUi = null;
    sfx.tap();
  }

  /** Настройки: звук, сброс прогресса (двухшаговое подтверждение), версия. */
  private showSettings(): void {
    if (this.settingsUi) return;
    this.resetArmed = false;
    const s = session();

    // Затемнение — в ЛОКАЛЬНЫХ координатах контейнера (иначе смещается на его центр);
    // больше видимой области любого аспекта — закрывает весь экран
    const dim = this.add
      .rectangle(0, 0, OVERLAY.width, OVERLAY.height, 0x000000, 0.5)
      .setInteractive()
      .setDepth(20);
    const plate = this.add.graphics().setDepth(20);
    plate.fillStyle(THEME.PAPER, 1);
    plate.fillRoundedRect(-250, -210, 500, 420, 20);
    plate.lineStyle(5, THEME.INK, 1);
    plate.strokeRoundedRect(-250, -210, 500, 420, 20);
    plate.fillStyle(THEME.ACCENT, 1);
    plate.fillRoundedRect(-140, -196, 280, 44, 12);
    plate.lineStyle(3, THEME.INK, 1);
    plate.strokeRoundedRect(-140, -196, 280, 44, 12);

    const title = this.add
      .text(0, -174, t('settings'), { fontFamily: FONT, fontSize: '26px', color: '#ffffff', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setStroke(INK_HEX, 3);

    const soundLabel = t('soundLine', { on: s.soundOn ? t('soundOn') : t('soundOff') });
    const soundBtn = makeButton(this, 0, -100, soundLabel, () => {
      session().soundOn = !session().soundOn;
      sfx.setMuted(!session().soundOn);
      void flushSession();
      if (session().soundOn) sfx.tap();
      this.rebuildSettings();
    }, { secondary: true, width: 380, fontSize: 24 });
    if (!session().soundOn) soundBtn.setAlpha(0.7);

    const resetLabel = this.resetArmed ? t('resetConfirm') : t('reset');
    const resetBtn = makeButton(this, 0, -5, resetLabel, () => this.resetFlow(), {
      secondary: true,
      width: 380,
      fontSize: 24,
      color: this.resetArmed ? THEME.ERROR : undefined,
    });

    const version = this.add
      .text(0, 82, t('versionLine', { v: '1.0.0' }), { fontFamily: FONT, fontSize: '16px', color: INK_HEX })
      .setOrigin(0.5)
      .setAlpha(0.6);

    const back = makeButton(this, 0, 148, t('back'), () => this.closeSettings(), {
      secondary: true,
      width: 300,
      fontSize: 24,
    });

    this.settingsUi = this.add
      .container(DESIGN_CX, screenCenter().y, [dim, plate, title, soundBtn, resetBtn, version, back])
      .setDepth(20);
  }

  private rebuildSettings(): void {
    this.settingsUi?.destroy();
    this.settingsUi = null;
    this.showSettings();
  }

  private resetFlow(): void {
    if (!this.resetArmed) {
      this.resetArmed = true;
      this.rebuildSettings();
      return;
    }
    resetProgress();
    this.closeSettings();
    this.scene.restart();
  }

  private closeSettings(): void {
    this.settingsUi?.destroy();
    this.settingsUi = null;
    this.resetArmed = false;
    sfx.tap();
  }

  /** Панель ожидания; с кодом комнаты — крупный код + копия пригласительной ссылки. */
  private showWaiting(code?: string): void {
    // dim в локальных координатах контейнера — больше видимой области любого аспекта
    const dim = this.add
      .rectangle(0, 0, OVERLAY.width, OVERLAY.height, 0x000000, 0.5)
      .setInteractive()
      .setDepth(20);
    const plate = this.add.graphics().setDepth(20);
    const hasCode = code !== undefined;
    const half = hasCode ? 160 : 110;
    plate.fillStyle(THEME.PAPER, 1);
    plate.fillRoundedRect(-210, -half, 420, half * 2, 18);
    plate.lineStyle(4, THEME.INK, 1);
    plate.strokeRoundedRect(-210, -half, 420, half * 2, 18);
    this.waitingUi = this.add.container(DESIGN_CX, screenCenter().y, [dim, plate]).setDepth(20);
    this.waitingUi.add(
      this.add
        .text(0, -half + 44, t('waitingOpponent'), { fontFamily: FONT, fontSize: '24px', color: INK_HEX, fontStyle: 'bold' })
        .setOrigin(0.5),
    );
    this.waitingUi.add(
      this.add
        .text(0, -half + 84, hasCode ? t('roomHint') : t('waitingHint'), { fontFamily: FONT, fontSize: '15px', color: INK_HEX, wordWrap: { width: 380 }, align: 'center' })
        .setOrigin(0.5)
        .setAlpha(0.75),
    );
    if (hasCode && code) {
      this.waitingUi.add(
        this.add
          .text(0, -10, code, { fontFamily: FONT, fontSize: '44px', color: INK_HEX, fontStyle: 'bold', letterSpacing: 6 })
          .setOrigin(0.5),
      );
      const copy = makeButton(this, 0, 62, t('copyInvite'), () => void this.copyInvite(code), {
        color: THEME.PANEL,
        width: 320,
        height: 60,
        fontSize: 20,
      });
      this.waitingUi.add(copy);
    }
    const cancel = makeButton(this, 0, hasCode ? 136 : 55, t('cancel'), () => this.cancelWaiting(), {
      secondary: true,
      width: 260,
      height: 64,
      fontSize: 22,
    });
    cancel.setDepth(20);
    this.waitingUi.add(cancel);
  }

  private cleanupWaiting(): void {
    this.waitingEvent?.remove(false);
    this.waitingEvent = null;
    this.waitingUi?.destroy();
    this.waitingUi = null;
    this.waitingApi = null;
    // Room Data (CrazyGames): матч начался/поиск отменён — комната больше не joinable
    getPlatform().leftRoom?.();
  }

  private cancelWaiting(): void {
    this.waitingCancelled = true;
    // P2P: рвём соединения и освобождаем хаб-слот, чтобы другие находились
    this.waitingApi?.cancel?.(this.waitingMatchId ?? undefined);
    this.cleanupWaiting();
    sfx.tap();
  }

  private hideWaiting(message: string): void {
    this.cleanupWaiting();
    const toast = this.add
      .text(screenCenter().x, screenCenter().y, message, {
        fontFamily: FONT,
        fontSize: '22px',
        color: INK_HEX,
        backgroundColor: '#ffffff',
        padding: { x: 16, y: 8 },
      })
      .setOrigin(0.5)
      .setDepth(20);
    this.tweens.add({ targets: toast, alpha: 0, delay: 1800, duration: 300, onComplete: () => toast.destroy() });
  }
}
