import Phaser from 'phaser';
import { BALANCE } from '../game/economy';
import { dateKey } from '../game/save';
import { flushSession, resetProgress, session, sessionRank, sessionToday } from '../game/session';
import { drawBooth } from '../render/booth';
import { bulbWave } from '../render/juice';
import { FONT, INK_HEX, THEME } from '../render/theme';
import { sfx } from '../systems/sfx';
import { createMatchAPI, type MatchAPI } from '../net/matchApi';
import { queueLaunch } from './GameScene';
import { makeButton } from '../ui/button';

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
  private settingsUi: Phaser.GameObjects.Container | null = null;
  private resetArmed = false;

  constructor() {
    super('Menu');
  }

  create(): void {
    const { width } = this.scale;
    const s = session();
    const rank = sessionRank();
    this.bulbs = [];
    this.waitingUi = null;
    this.waitingEvent = null;
    this.waitingCancelled = false;

    drawBooth(this, width, 'menu');

    // Логотип-вывеска с лампочками (спека §4.6)
    const logo = this.add.graphics();
    logo.fillStyle(THEME.INK, THEME.SHADOW_A);
    logo.fillRoundedRect(120, 101, 480, 110, 20);
    logo.fillStyle(THEME.PANEL, 1);
    logo.fillRoundedRect(120, 95, 480, 110, 20);
    logo.lineStyle(5, THEME.INK, 1);
    logo.strokeRoundedRect(120, 95, 480, 110, 20);
    this.add
      .text(width / 2, 150, 'ПРОХОДНАЯ', {
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
      const fillW = Math.max(10, (barW - 10) * progress);
      if (progress > 0) {
        bar.fillStyle(THEME.ACCENT, 1);
        bar.fillRoundedRect(barX + 5, barY + 5, fillW, 10, 5);
        bar.lineStyle(4, 0xffffff, 0.25);
        for (let sx = barX; sx < barX + fillW; sx += 14) {
          bar.lineBetween(sx, barY + 18, Math.min(sx + 12, barX + 5 + fillW), barY + 2);
        }
      }
      this.add
        .text(width / 2, 303, `${s.xp} XP · до «${BALANCE.ranks[rank.index + 1].title}» ${rank.nextXp - s.xp} XP`, {
          fontFamily: FONT,
          fontSize: '20px',
          color: INK_HEX,
        })
        .setOrigin(0.5);
    } else {
      this.add
        .text(width / 2, 303, `${s.xp} XP · максимальное звание`, {
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
        `День ${sessionToday()} · серия ${s.bestStreak} · дуэли ${mp.duelWins}-${mp.duelLosses}-${mp.duelDraws} · рейтинг ${mp.duelRating}`,
        { fontFamily: FONT, fontSize: '19px', color: INK_HEX },
      )
      .setOrigin(0.5);

    // Строки кабинета: stagger-въезд (спека §4.6)
    const resume = s.currentShift;
    const shiftLabel = resume
      ? resume.isNight
        ? 'Продолжить ночную смену'
        : 'Продолжить смену'
      : 'Начать смену';
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
          makeButton(this, width / 2, 592, 'Блиц · 90 секунд', () => this.startBlitz(), {
            color: THEME.ACCENT,
            width: 380,
            height: 72,
            fontSize: 24,
          }),
      },
      {
        alpha: 1,
        make: () =>
          makeButton(this, width / 2, 676, 'Дуэль', () => void this.startDuel(), {
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
            'Дневная смена',
            () => this.startDaily(),
            {
              secondary: true,
              width: 380,
              height: 72,
              fontSize: 24,
              subtitle: !unlocked
                ? 'со звания Дежурный'
                : dailyPlayed
                  ? 'уже сыграна — завтра'
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
            'Ночная смена ×1.5',
            () => this.startNight(),
            {
              secondary: true,
              width: 380,
              height: 72,
              fontSize: 24,
              subtitle: !unlocked
                ? 'со звания Дежурный'
                : nightPlayed
                  ? 'уже сыграна — завтра'
                  : undefined,
            },
          ),
      },
      {
        alpha: s.tools.lens || s.tokens < BALANCE.lensPrice ? 0.55 : 1,
        make: () =>
          makeButton(this, width / 2 - 98, 928, `Лупа ${BALANCE.lensPrice}`, () => this.buy('lens'), {
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
            928,
            `Детектор ${BALANCE.detectorPrice}`,
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
          makeButton(this, width / 2 - 98, 1004, 'Тест платформы', () => this.scene.start('PlatformTest'), {
            secondary: true,
            width: 186,
            height: 72,
            fontSize: 18,
          }),
      });
      rows.push({
        alpha: 1,
        make: () =>
          makeButton(this, width / 2 + 98, 1004, 'Настройки', () => this.showSettings(), {
            secondary: true,
            width: 186,
            height: 72,
            fontSize: 18,
          }),
      });
    } else {
      rows.push({
        alpha: 1,
        make: () =>
          makeButton(this, width / 2, 1004, 'Настройки', () => this.showSettings(), {
            secondary: true,
            width: 280,
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

  /** Дуэль: сервер (два таба) или соперник-бот (план мультиплеера, фаза 2). */
  private async startDuel(): Promise<void> {
    if (this.waitingUi) return;
    this.showWaiting();
    try {
      const api = await createMatchAPI();
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
      this.hideWaiting('Не удалось начать дуэль');
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
          opponentName: poll.opponentName ?? 'Соперник',
          botOpponent: api.botOpponent,
        });
        this.scene.start('Game');
      }
    } catch {
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
      opponentName: poll.opponentName ?? 'Соперник',
      botOpponent: api.botOpponent,
    });
    this.scene.start('Game');
  }

  /** Настройки: звук, сброс прогресса (двухшаговое подтверждение), версия. */
  private showSettings(): void {
    if (this.settingsUi) return;
    this.resetArmed = false;
    const { width, height } = this.scale;
    const s = session();

    // Затемнение — в ЛОКАЛЬНЫХ координатах контейнера (иначе смещается на его центр)
    const dim = this.add.rectangle(0, 0, width, height, 0x000000, 0.5).setDepth(20);
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
      .text(0, -174, 'Настройки', { fontFamily: FONT, fontSize: '26px', color: '#ffffff', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setStroke(INK_HEX, 3);

    const soundLabel = `Звук: ${s.soundOn ? 'вкл' : 'выкл'}`;
    const soundBtn = makeButton(this, 0, -90, soundLabel, () => {
      session().soundOn = !session().soundOn;
      sfx.setMuted(!session().soundOn);
      void flushSession();
      if (session().soundOn) sfx.tap();
      this.rebuildSettings();
    }, { secondary: true, width: 380, fontSize: 24 });
    if (!session().soundOn) soundBtn.setAlpha(0.7);

    const resetLabel = this.resetArmed ? 'Точно сбросить?' : 'Сбросить прогресс';
    const resetBtn = makeButton(this, 0, 0, resetLabel, () => this.resetFlow(), {
      secondary: true,
      width: 380,
      fontSize: 24,
      color: this.resetArmed ? THEME.ERROR : undefined,
    });

    const version = this.add
      .text(0, 90, 'Проходная · v0.1.0', { fontFamily: FONT, fontSize: '16px', color: INK_HEX })
      .setOrigin(0.5)
      .setAlpha(0.6);

    const back = makeButton(this, 0, 148, 'Назад', () => this.closeSettings(), {
      secondary: true,
      width: 300,
      fontSize: 24,
    });

    this.settingsUi = this.add
      .container(width / 2, height / 2, [dim, plate, title, soundBtn, resetBtn, version, back])
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

  private showWaiting(): void {
    const { width, height } = this.scale;
    const dim = this.add.rectangle(0, 0, width, height, 0x000000, 0.5).setDepth(20);
    const plate = this.add.graphics().setDepth(20);
    plate.fillStyle(THEME.PAPER, 1);
    plate.fillRoundedRect(-180, -110, 360, 220, 18);
    plate.lineStyle(4, THEME.INK, 1);
    plate.strokeRoundedRect(-180, -110, 360, 220, 18);
    this.waitingUi = this.add.container(width / 2, height / 2, [dim, plate]).setDepth(20);
    this.waitingUi.add(
      this.add
        .text(0, -60, 'Ожидание соперника…', { fontFamily: FONT, fontSize: '24px', color: INK_HEX, fontStyle: 'bold' })
        .setOrigin(0.5),
    );
    this.waitingUi.add(
      this.add
        .text(0, -20, 'Открой игру во второй вкладке', { fontFamily: FONT, fontSize: '15px', color: INK_HEX })
        .setOrigin(0.5)
        .setAlpha(0.75),
    );
    const cancel = makeButton(this, 0, 55, 'Отмена', () => this.cancelWaiting(), {
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
  }

  private cancelWaiting(): void {
    this.waitingCancelled = true;
    this.cleanupWaiting();
    sfx.tap();
  }

  private hideWaiting(message: string): void {
    this.cleanupWaiting();
    const t = this.add
      .text(this.scale.width / 2, this.scale.height / 2, message, {
        fontFamily: FONT,
        fontSize: '22px',
        color: INK_HEX,
        backgroundColor: '#ffffff',
        padding: { x: 16, y: 8 },
      })
      .setOrigin(0.5)
      .setDepth(20);
    this.tweens.add({ targets: t, alpha: 0, delay: 1800, duration: 300, onComplete: () => t.destroy() });
  }
}
