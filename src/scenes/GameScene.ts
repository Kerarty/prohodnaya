import Phaser from 'phaser';
import { getPlatform } from '../platform';
import { describeForgery, describeViolation } from '../game/application';
import type { Application, Decision, DocFieldId } from '../game/application';
import {
  BALANCE,
  BOARD_IDS,
  correctReward,
  dailyScore,
  duelDelta,
  nightReward,
  rankFor,
} from '../game/economy';
import { generateShift } from '../game/generation';
import { newShiftSeed } from '../game/rng';
import { commitSession, flushSession, session, sessionRank, sessionToday } from '../game/session';
import type { Rule } from '../game/rules';
import {
  drawCharacter,
  guestDeflate,
  guestReact,
  highlightField,
  startBreathing,
} from '../render/characterRenderer';
import { drawBooth } from '../render/booth';
import type { BoothView } from '../render/booth';
import { bulbWave, confetti, spawnThought } from '../render/juice';
import { PassCard } from '../render/passCard';
import { drawRuleBoard } from '../render/ruleBoard';
import { drawHardShadow, FONT, INK_HEX, THEME } from '../render/theme';
import { sfx } from '../systems/sfx';
import { makeButton } from '../ui/button';
import { createMatchAPI } from '../net/matchApi';
import type { MatchAPI, MatchOutcome, MatchPoll } from '../net/matchApi';

const BOARD_W = 560;
const BOARD_CY = 130;
const GUEST_Y = 370;
const GUEST_SCALE = 0.8;
const CARD_Y = 690;
const BAR_Y = 1010;
const COUNTER_Y = 1050;
const DETECTOR_Y = 965; // над полосой терпения — иначе кнопка лежит на баре и столешнице
const BTN_Y = 1150;
const PATIENCE_MS = BALANCE.patienceMs;
const MAX_ERRORS = BALANCE.maxErrors;

/** Счётчик запусков для смешивания сидов (ГДД разд. 3.3). */
let launchCounter = 0;

/** Отложенный запуск (кнопки «ещё раз» и дуэль из кабинета переживают restart сцены). */
let pendingLaunch: SceneLaunchData | null = null;

/** Запуск сцены с данными после restart (кнопка «ещё раз», дуэль из кабинета). */
export function queueLaunch(data: SceneLaunchData): void {
  pendingLaunch = data;
}

export interface SceneLaunchData {
  /** Новая дневная смена — кабинет уже проставил флаг в сейве. */
  daily?: boolean;
  /** Новая ночная смена — кабинет уже проставил флаг в сейве. */
  night?: boolean;
  /** Режим блица: 90 с, ошибка −5 с, скор в лидерборд. */
  blitz?: boolean;
  /** Дуэль: тот же забег с соперником. */
  duel?: boolean;
  matchId?: string;
  seed?: number;
  durationMs?: number;
  startAt?: number;
  opponentName?: string;
  botOpponent?: boolean;
}

type RunMode = 'shift' | 'blitz' | 'duel';

/**
 * Кор-сцена: обычные смены, блиц и дуэли. Экономика, стрик, восстановление,
 * монетизация (дни 5–6) + мультиплеер (план мультиплеера, фазы 1–2).
 */
export class GameScene extends Phaser.Scene {
  private queue: Application[] = [];
  private rules: Rule[] = [];
  private shift = 1;
  private seed = 0;
  private isDaily = false;
  private isNight = false;
  private runMode: RunMode = 'shift';
  private rankIndexStart = 0;
  private index = 0;
  private correct = 0;
  private errors = 0;
  private earnedTokens = 0;
  private earnedXp = 0;
  private fastCount = 0;
  private forgivenThisShift = false;
  private decisionStart = 0;
  private detectorCharges = 0;
  private detectorAdUses = 0;
  private detectorBtn: Phaser.GameObjects.Container | null = null;
  private finishTokenTotal = 0;
  private finishXpTotal = 0;
  private doubled = false;
  private rewardText: Phaser.GameObjects.Text | null = null;
  private doubleBtn: Phaser.GameObjects.Container | null = null;
  private busy = true;
  private guest: Phaser.GameObjects.Container | null = null;
  private card: PassCard | null = null;
  private approveBtn: Phaser.GameObjects.Container | null = null;
  private rejectBtn: Phaser.GameObjects.Container | null = null;
  private counter: Phaser.GameObjects.Text | null = null;
  private patienceBar: Phaser.GameObjects.Rectangle | null = null;
  private barFrame: Phaser.GameObjects.Graphics | null = null;
  private patienceEvent: Phaser.Time.TimerEvent | null = null;
  private boothView: BoothView | null = null;
  private signBulbs: Phaser.GameObjects.Arc[] = [];
  private boardView: { board: Phaser.GameObjects.Container; pulse(): void } | null = null;
  // Блиц/дуэль: глобальный таймер забега вместо терпения на заявку
  private runDuration = BALANCE.blitzDurationMs;
  private runEndAt = 0;
  private runStarted = false;
  private runEnded = false;
  private duelMatchId: string | null = null;
  private duelStartAt = 0;
  private duelOpponentName = 'Соперник';
  private duelReported = false;
  private duelOutcome: MatchOutcome | null = null;
  private matchApi: MatchAPI | null = null;
  private lastOpponentPoll = 0;
  private opponentScore = 0;
  private opponentText: Phaser.GameObjects.Text | null = null;
  private countdownText: Phaser.GameObjects.Text | null = null;

  constructor() {
    super('Game');
  }

  create(data?: SceneLaunchData): void {
    const { width, height } = this.scale;
    const s = session();
    this.isDaily = false;
    this.isNight = false;
    this.runEnded = false;
    this.runStarted = false;
    this.forgivenThisShift = false;
    this.rankIndexStart = sessionRank().index;
    this.signBulbs = [];
    this.matchApi = null;
    // Полный сброс прогресса забега: scene.restart() не пересоздаёт экземпляр сцены,
    // поля класса переживают рестарт (после «Следующая смена» открывалась последняя заявка)
    this.index = 0;
    this.correct = 0;
    this.errors = 0;
    this.earnedTokens = 0;
    this.earnedXp = 0;
    this.fastCount = 0;
    this.detectorCharges = 0;
    this.detectorAdUses = 0;
    this.doubled = false;
    this.finishTokenTotal = 0;
    this.finishXpTotal = 0;
    this.duelReported = false;
    this.duelOutcome = null;
    this.opponentScore = 0;
    this.lastOpponentPoll = 0;
    this.rewardText = null;
    this.doubleBtn = null;
    this.detectorBtn = null;

    const launch: SceneLaunchData = pendingLaunch ?? data ?? {};
    pendingLaunch = null;

    if (launch.blitz) {
      this.runMode = 'blitz';
      this.runDuration = BALANCE.blitzDurationMs;
      this.shift = s.shiftNumber;
      this.seed = newShiftSeed(launchCounter++);
    } else if (launch.duel) {
      this.runMode = 'duel';
      this.runDuration = launch.durationMs ?? BALANCE.duelDurationMs;
      this.shift = s.shiftNumber;
      this.seed = launch.seed ?? newShiftSeed(launchCounter++);
      this.duelMatchId = launch.matchId ?? null;
      this.duelStartAt = launch.startAt ?? Date.now() + BALANCE.duelCountdownMs;
      this.duelOpponentName = launch.opponentName ?? 'Соперник';
      // API дуэли: HTTP-клиент к бандл-серверу или бот (probe ~0.8 с)
      void createMatchAPI().then((api) => {
        this.matchApi = api;
      });
    } else if (s.currentShift) {
      // Продолжение незавершённой смены — та же очередь, та же заявка (ГДД разд. 9)
      this.runMode = 'shift';
      const p = s.currentShift;
      this.isDaily = p.isDaily;
      this.isNight = p.isNight;
      this.shift = p.shift;
      this.seed = p.seed;
      this.index = p.appIndex;
      this.correct = p.correct;
      this.errors = p.errors;
      this.earnedTokens = p.earnedTokens;
      this.earnedXp = p.earnedXp;
      this.fastCount = p.fastCount;
    } else {
      this.runMode = 'shift';
      this.shift = s.shiftNumber;
      this.seed = newShiftSeed(launchCounter++);
    }

    const total = this.runMode === 'shift' ? undefined : BALANCE.blitzApps;
    const generated = generateShift(
      this.seed,
      this.shift,
      this.runMode === 'shift' && s.currentShift ? s.currentShift.today : sessionToday(),
      total,
    );
    this.queue = generated.apps;
    this.rules = generated.rules;
    this.index = Math.min(this.index, this.queue.length - 1);
    console.info(
      `[shift] ${this.runMode}, сид ${this.seed}, заявок ${this.queue.length}`,
    );

    if (s.tools.detector) this.detectorCharges = BALANCE.detectorFreeCharges;

    if (this.runMode === 'shift' && !s.currentShift) {
      s.currentShift = {
        seed: this.seed,
        shift: this.shift,
        isDaily: this.isDaily,
        isNight: this.isNight,
        today: sessionToday(),
        appIndex: 0,
        correct: 0,
        errors: 0,
        earnedTokens: 0,
        earnedXp: 0,
        fastCount: 0,
      };
      void flushSession();
    }

    this.boothView = drawBooth(this, width, 'game');

    this.boardView = drawRuleBoard(this, this.rules, width / 2, BOARD_CY, BOARD_W);
    this.boardView.pulse();

    this.patienceBar = this.add
      .rectangle(40, BAR_Y, width - 80, 8, THEME.SUCCESS)
      .setOrigin(0, 0.5);
    this.barFrame = this.add.graphics();
    this.barFrame.lineStyle(3, THEME.INK, 0.6);
    this.barFrame.strokeRoundedRect(34, BAR_Y - 9, width - 68, 18, 9);

    this.counter = this.add
      .text(40, COUNTER_Y, '', {
        fontFamily: FONT,
        fontSize: '22px',
        color: INK_HEX,
        fontStyle: 'bold',
        backgroundColor: '#ffffff',
        padding: { x: 10, y: 5 },
      })
      .setOrigin(0, 0.5);

    if (this.runMode === 'duel') {
      this.opponentText = this.add
        .text(width - 40, COUNTER_Y, 'Соперник: 0', {
          fontFamily: FONT,
          fontSize: '20px',
          color: INK_HEX,
          backgroundColor: '#ffffff',
          padding: { x: 10, y: 5 },
        })
        .setOrigin(1, 0.5);
    }

    this.approveBtn = makeButton(
      this,
      width / 2 - 175,
      BTN_Y,
      'Пропустить',
      () => this.decide('approve'),
      { color: THEME.SUCCESS, width: 330 },
    );
    this.rejectBtn = makeButton(
      this,
      width / 2 + 175,
      BTN_Y,
      'Развернуть',
      () => this.decide('reject'),
      { color: THEME.ERROR, width: 330 },
    );

    if (s.tools.detector && this.runMode === 'shift') this.createDetectorButton(width);

    // выход в кабинет из любого режима (спека: «закончить игру»)
    makeButton(this, 44, 40, 'Меню', () => this.exitToMenu(), {
      secondary: true,
      width: 72,
      height: 72,
      fontSize: 16,
    });

    // Блиц стартует сразу; дуэль — по startAt (отсчёт в onSceneUpdate)
    if (this.runMode === 'blitz') {
      this.runStarted = true;
      this.runEndAt = this.time.now + this.runDuration;
    } else if (this.runMode === 'duel') {
      this.countdownText = this.add
        .text(width / 2, height / 2, '', {
          fontFamily: FONT,
          fontSize: '54px',
          color: INK_HEX,
          fontStyle: 'bold',
          backgroundColor: '#ffffff',
          padding: { x: 24, y: 12 },
        })
        .setOrigin(0.5)
        .setDepth(20);
    }

    // Таймер забега и опрос соперника — на каждый кадр сцены
    this.events.off(Phaser.Scenes.Events.UPDATE, this.onSceneUpdate, this);
    this.events.on(Phaser.Scenes.Events.UPDATE, this.onSceneUpdate, this);

    this.showApplication();
  }

  /** Глобальный таймер блица/дуэли, старт по startAt, опрос соперника. */
  private onSceneUpdate(): void {
    if (this.runMode === 'shift' || this.runEnded) return;

    if (!this.runStarted) {
      // дуэль ждёт startAt (общий для обоих игроков момент старта)
      const waitMs = this.duelStartAt - Date.now();
      if (waitMs > 0) {
        this.countdownText?.setText(`Старт через ${Math.ceil(waitMs / 1000)}`);
        return;
      }
      this.startRun();
    }

    const remaining = Math.max(0, this.runEndAt - this.time.now);
    if (this.patienceBar) this.patienceBar.scaleX = remaining / this.runDuration;
    if (this.patienceBar) {
      this.patienceBar.fillColor = remaining > this.runDuration * 0.25 ? THEME.SUCCESS : THEME.ERROR;
    }
    this.updateCounter(remaining);

    if (this.runMode === 'duel' && Date.now() - this.lastOpponentPoll > 2000) {
      this.lastOpponentPoll = Date.now();
      void this.pollOpponent();
    }

    if (remaining <= 0) this.endRun();
  }

  /** «Закончить игру»: выход в кабинет с честными последствиями для каждого режима. */
  private exitToMenu(): void {
    if (this.runEnded) return; // на экранах результатов есть свои кнопки
    const s = session();
    if (this.runMode === 'shift') {
      // прервать смену: выплата за верные сохраняется (ГДД разд. 5)
      s.tokens += this.earnedTokens;
      s.xp += this.earnedXp;
      s.currentShift = null;
      void flushSession();
    } else if (this.runMode === 'blitz') {
      // заброс блица досрочно: без результата и лидербордов
    } else {
      // выход из дуэли = техническое поражение (план мультиплеера, фаза 2)
      s.mp.duelLosses += 1;
      s.mp.duelRating = Math.max(0, s.mp.duelRating + BALANCE.duelLossDelta);
      void flushSession();
    }
    s.currentShift = this.runMode === 'shift' ? s.currentShift : null;
    this.scene.start('Menu');
  }

  private startRun(): void {
    this.runStarted = true;
    this.runEndAt = this.time.now + this.runDuration;
    this.countdownText?.destroy();
    this.countdownText = null;
    // вход гостя завершился ещё во время отсчёта — кнопки обязаны включиться
    this.setButtonsEnabled(true);
  }

  private updateCounter(remainingMs?: number): void {
    if (this.runMode === 'shift') {
      const label = this.isDaily ? 'Дневная смена' : this.isNight ? 'Ночная смена' : `Смена ${this.shift}`;
      // Ошибки из брошенного сейва могут быть выше лимита — в интерфейсе не показываем «4/3»
      const shownErrors = Math.min(this.errors, MAX_ERRORS);
      this.counter?.setText(
        `${label} · Заявка ${this.index + 1}/${this.queue.length} · Ошибки: ${shownErrors}/${MAX_ERRORS}`,
      );
      return;
    }
    const label = this.runMode === 'blitz' ? 'Блиц' : 'Дуэль';
    const secs = remainingMs === undefined ? '' : `${Math.ceil(remainingMs / 1000)} с · `;
    this.counter?.setText(`${label} · ${secs}Верно: ${this.correct} · Ошибки: ${this.errors}`);
  }

  private async pollOpponent(): Promise<void> {
    if (!this.matchApi || !this.duelMatchId) return;
    try {
      const poll = await this.matchApi.pollMatch(this.duelMatchId);
      this.opponentScore = poll.opponentScore;
      this.opponentText?.setText(`Соперник: ${poll.opponentScore}`);
    } catch {
      // сетевая ошибка — попробуем на следующем опросе
    }
  }

  private createDetectorButton(width: number): void {
    this.detectorBtn?.destroy();
    const label =
      this.detectorCharges > 0
        ? `Детектор (${this.detectorCharges})`
        : this.detectorAdUses < BALANCE.detectorAdCharges
          ? 'Детектор +AD'
          : 'Детектор —';
    this.detectorBtn = makeButton(this, width - 125, DETECTOR_Y, label, () => this.useDetector(), {
      secondary: true,
      width: 210,
      height: 64,
      fontSize: 20,
    });
  }

  /** Rewarded с паузой и заглушением звука (п. 4.7 правил Яндекса). */
  private async showRewardedSafe(onReward: () => void): Promise<'shown' | 'failed'> {
    const wasBusy = this.busy;
    this.setButtonsEnabled(false);
    sfx.setMuted(true);
    try {
      return await getPlatform().showRewarded(onReward);
    } finally {
      sfx.setMuted(false);
      if (!wasBusy) this.setButtonsEnabled(true);
    }
  }

  private useDetector(): void {
    if (this.busy) return;
    if (this.detectorCharges <= 0) {
      if (this.detectorAdUses >= BALANCE.detectorAdCharges) {
        this.toast('Заряды детектора на смену исчерпаны');
        return;
      }
      // Rewarded: доп. заряд (ГДД разд. 7) — награда только за onRewarded
      void this.showRewardedSafe(() => {
        this.detectorCharges += 1;
        this.detectorAdUses += 1;
        this.createDetectorButton(this.scale.width);
      }).then((r) => {
        if (r === 'shown') this.toast('Заряд детектора получен');
      });
      return;
    }

    this.detectorCharges -= 1;
    this.createDetectorButton(this.scale.width);
    const app = this.queue[this.index];
    if (app.reason === 'forgery') {
      const { field } = describeForgery(app);
      this.card?.flashField(field);
      this.toast('Несовпадение подсвечено');
    } else {
      this.toast('Документ верен — проверяй правила дня');
    }
  }

  private toast(text: string): void {
    const t = this.add
      .text(this.scale.width / 2, 950, text, {
        fontFamily: FONT,
        fontSize: '24px',
        color: INK_HEX,
        backgroundColor: '#ffffff',
        padding: { x: 16, y: 8 },
      })
      .setOrigin(0.5);
    this.tweens.add({ targets: t, alpha: 0, delay: 1400, duration: 400, onComplete: () => t.destroy() });
  }

  /** Всплывающий текст начисления (ГДД: «жетоны летят в счётчик»). */
  private floatText(text: string, color: string): void {
    const t = this.add
      .text(this.scale.width / 2, 1090, text, {
        fontFamily: FONT,
        fontSize: '34px',
        color,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.tweens.add({
      targets: t,
      y: 1020,
      alpha: 0,
      duration: 800,
      ease: 'Cubic.easeOut',
      onComplete: () => t.destroy(),
    });
  }

  private setButtonsEnabled(on: boolean): void {
    this.busy = !on;
    const alpha = on ? 1 : 0.35;
    this.approveBtn?.setAlpha(alpha);
    this.rejectBtn?.setAlpha(alpha);
    this.detectorBtn?.setAlpha(on ? 1 : 0.35);
  }

  private showApplication(): void {
    const { width } = this.scale;
    const app = this.queue[this.index];
    this.updateCounter();
    this.setButtonsEnabled(false);
    this.guest?.destroy();
    this.card?.destroy();

    // Bounce-вход слева: слайд + overshoot масштаба (спека §4.3 №8)
    this.guest = drawCharacter(this, app.guest, -80, GUEST_Y, GUEST_SCALE);
    // Тень в нише появляется вместе с гостем и уходит с ним — не висит в пустой нише
    const guestShadow = this.boothView?.guestShadow;
    if (guestShadow) {
      guestShadow.setAlpha(0);
      this.tweens.add({ targets: guestShadow, alpha: 1, duration: 250 });
    }
    this.card = new PassCard(this, app.doc, width / 2, CARD_Y, {
      interactiveFields: session().tools.lens,
      onFieldTap: (field: DocFieldId) => {
        if (this.guest) highlightField(this.guest, field);
        this.card?.softHighlight(field);
        sfx.tap();
      },
    }).setAlpha(0);
    sfx.whoosh();

    this.tweens.add({ targets: this.guest, x: width / 2, duration: 260, ease: 'Quad.easeOut' });
    this.tweens.add({
      targets: this.guest,
      scale: { from: 0.2, to: GUEST_SCALE },
      duration: 320,
      ease: 'Back.easeOut',
    });
    this.tweens.add({
      targets: this.card,
      alpha: 1,
      duration: 200,
      delay: 250,
      onComplete: () => {
        this.decisionStart = Date.now();
        if (this.runMode === 'shift') {
          this.setButtonsEnabled(true);
          this.startPatience();
        } else if (this.runStarted) {
          this.setButtonsEnabled(true);
        }
        if (this.guest) startBreathing(this.guest, GUEST_SCALE);
      },
    });
  }

  /** Терпение (ГДД разд. 2) — только в обычных сменах; в блице/дуэле глобальный таймер. */
  private startPatience(): void {
    this.stopPatience();
    if (!this.patienceBar) return;
    if (this.index >= this.queue.length - 1) {
      // Последняя заявка: терпения нет — прячу полосу вместе с рамкой
      this.patienceBar.setVisible(false);
      this.barFrame?.setVisible(false);
      return;
    }
    this.patienceBar.setVisible(true);
    this.barFrame?.setVisible(true);
    this.patienceBar.scaleX = 1;
    this.patienceBar.fillColor = THEME.PANEL_DARK;
    this.tweens.add({ targets: this.patienceBar, scaleX: 0, duration: PATIENCE_MS, ease: 'Linear' });
    this.patienceEvent = this.time.delayedCall(PATIENCE_MS, () => this.patienceExpired());
  }

  private stopPatience(): void {
    this.patienceEvent?.remove(false);
    this.patienceEvent = null;
    if (this.patienceBar) this.tweens.killTweensOf(this.patienceBar);
  }

  private patienceExpired(): void {
    if (this.busy) return;
    this.stopPatience();
    this.setButtonsEnabled(false);
    session().currentStreak = 0;
    this.trackProgress();
    this.flash(THEME.NICHE_FLOOR);
    this.time.delayedCall(500, () => this.leaveGuest('timeout'));
  }

  private decide(decision: Decision): void {
    if (this.busy) return;
    if (this.runMode !== 'shift' && !this.runStarted) return; // дуэль: ждём startAt
    const app = this.queue[this.index];
    const fast = Date.now() - this.decisionStart <= BALANCE.speedBonusMs;
    const ok = decision === app.expected;
    this.stopPatience();
    this.setButtonsEnabled(false);
    this.card?.showStamp(decision === 'approve'); // штамп = решение игрока
    sfx.stamp();

    if (ok) {
      this.correct += 1;
      if (this.runMode === 'shift') {
        const base = correctReward(fast);
        const reward = this.isNight ? nightReward(base) : base;
        this.earnedTokens += reward;
        this.earnedXp += BALANCE.xpPerCorrect;
        if (fast) this.fastCount += 1;
        const s = session();
        s.currentStreak += 1;
        if (s.currentStreak > s.bestStreak) s.bestStreak = s.currentStreak;
        if (this.guest) guestReact(this.guest, 'ok');
        this.trackProgress();
        this.time.delayedCall(300, () => {
          this.flash(THEME.SUCCESS);
          sfx.chip();
          sfx.success();
          sfx.coin();
          confetti(this, this.scale.width / 2, 480);
          bulbWave(this, this.signBulbs);
          this.floatText(`+${reward}`, '#3ec46d');
        });
        this.time.delayedCall(800, () => this.leaveGuest('ok'));
      } else {
        // блиц/дуэль: чистый скор, без жетонов и XP
        if (this.guest) guestReact(this.guest, 'ok');
        this.time.delayedCall(300, () => {
          this.flash(THEME.SUCCESS);
          sfx.chip();
          sfx.success();
          confetti(this, this.scale.width / 2, 480);
          bulbWave(this, this.signBulbs);
        });
        this.time.delayedCall(800, () => this.leaveGuest('ok'));
      }
    } else {
      session().currentStreak = 0;
      if (this.guest) {
        guestReact(this.guest, 'reject');
        guestDeflate(this.guest);
      }
      if (this.runMode !== 'shift') {
        // ошибка в блице/дуэле съедает время забега (план мультиплеера, фаза 1)
        this.runEndAt -= BALANCE.blitzMistakePenaltyMs;
      }
      this.time.delayedCall(300, () => {
        this.flash(THEME.ERROR);
        sfx.fail();
      });
      this.time.delayedCall(700, () => this.showMistake(app));
    }
  }

  /** Прогресс смены после каждой закрытой заявки — только для обычных смен. */
  private trackProgress(): void {
    if (this.runMode !== 'shift') return;
    session().currentShift = {
      seed: this.seed,
      shift: this.shift,
      isDaily: this.isDaily,
      isNight: this.isNight,
      today: sessionToday(),
      appIndex: this.index + 1,
      correct: this.correct,
      errors: this.errors,
      earnedTokens: this.earnedTokens,
      earnedXp: this.earnedXp,
      fastCount: this.fastCount,
    };
    commitSession();
  }

  private leaveGuest(kind: 'ok' | 'reject' | 'timeout' = 'ok'): void {
    const { width } = this.scale;
    const guestShadow = this.boothView?.guestShadow;
    if (guestShadow) {
      this.tweens.add({ targets: guestShadow, alpha: 0, duration: 250 });
    }
    if (this.guest) {
      if (kind === 'reject') {
        // «Сдувание» уже сыграло — держим грусть, затем уводим с наклоном (спека §4.3 №9)
        this.time.delayedCall(420, () => {
          this.tweens.add({
            targets: this.guest,
            x: width + 220,
            rotation: (Math.random() < 0.5 ? -1 : 1) * Phaser.Math.DegToRad(10),
            duration: 400,
            ease: 'Quad.easeIn',
          });
        });
        this.time.delayedCall(840, () => this.next());
      } else {
        this.tweens.add({ targets: this.guest, x: width + 220, duration: 450, ease: 'Quad.easeIn' });
        this.time.delayedCall(550, () => this.next());
      }
    } else {
      this.next();
    }
  }

  private next(): void {
    this.index += 1;
    if (this.runMode !== 'shift' && this.runEnded) return; // время вышло посреди перехода
    if (this.index >= this.queue.length) {
      if (this.runMode === 'shift') this.finish();
      else this.endRun();
    } else {
      this.showApplication();
    }
  }

  private flash(color: number): void {
    const { width, height } = this.scale;
    const rect = this.add.rectangle(width / 2, height / 2, width, height, color, THEME.FLASH_A);
    this.tweens.add({ targets: rect, alpha: 0, duration: 150, onComplete: () => rect.destroy() });
  }

  /** Карточка объяснения — без объяснения игра не продолжается (столп «Ошибка учит»). */
  private showMistake(app: Application): void {
    const { width, height } = this.scale;
    const counted = !app.training;
    if (counted) this.errors += 1;
    this.updateCounter();
    if (counted && this.guest) spawnThought(this, this.guest);

    const dim = this.add
      .rectangle(width / 2, height / 2, width, height, 0x000000, 0.5)
      .setInteractive();

    const info: { text: string; field?: DocFieldId } =
      app.reason === 'forgery' ? describeForgery(app) : describeViolation(app, this.rules);

    const title = counted ? 'Ошибка' : 'Обучение';
    const limitReached =
      counted && this.errors >= MAX_ERRORS && !this.isNight && this.runMode === 'shift';
    // Панель выше, когда в ней два ряда кнопок (прощение + завершение) — кнопки не вылезают за край
    const half = limitReached && !this.forgivenThisShift ? 200 : 170;
    const panel = this.add.container(width / 2, height / 2);
    const g = this.add.graphics();
    drawHardShadow(g, -290, -half, 580, half * 2, 18);
    g.fillStyle(THEME.PAPER, 1);
    g.fillRoundedRect(-290, -half, 580, half * 2, 18);
    g.lineStyle(5, THEME.INK, 1);
    g.strokeRoundedRect(-290, -half, 580, half * 2, 18);
    g.fillStyle(THEME.ACCENT, 1);
    g.fillRoundedRect(-130, -half + 12, 260, 46, 12);
    g.lineStyle(3, THEME.INK, 1);
    g.strokeRoundedRect(-130, -half + 12, 260, 46, 12);
    panel.add(g);
    panel.add(
      this.add
        .text(0, -half + 35, title, { fontFamily: FONT, fontSize: '30px', color: '#ffffff', fontStyle: 'bold' })
        .setOrigin(0.5)
        .setStroke(INK_HEX, 3),
    );
    panel.add(
      this.add
        .text(0, -40, info.text, {
          fontFamily: FONT,
          fontSize: '25px',
          color: INK_HEX,
          align: 'center',
          wordWrap: { width: 520 },
        })
        .setOrigin(0.5),
    );

    if (limitReached && !this.forgivenThisShift) {
      // Прощение ошибки за rewarded: ошибка аннулируется, смена продолжается (ГДД разд. 7)
      panel.add(
        makeButton(this, 0, 50, 'Продолжить за рекламу', () => this.forgive(info, dim, panel), {
          color: THEME.SUCCESS,
          width: 380,
          fontSize: 26,
        }),
      );
      panel.add(
        makeButton(
          this,
          0,
          148,
          'Завершить смену',
          () => {
            dim.destroy();
            panel.destroy();
            this.showInterrupted();
          },
          { secondary: true, width: 380, fontSize: 26 },
        ),
      );
    } else if (limitReached) {
      panel.add(
        makeButton(
          this,
          0,
          110,
          'Понятно',
          () => {
            dim.destroy();
            panel.destroy();
            this.showInterrupted();
          },
          { secondary: true, width: 260 },
        ),
      );
    } else {
      const extra =
        this.runMode !== 'shift' && counted
          ? `Минус ${BALANCE.blitzMistakePenaltyMs / 1000} с к таймеру`
          : null;
      if (extra) {
        panel.add(
          this.add
            .text(0, 40, extra, { fontFamily: FONT, fontSize: '22px', color: '#e27474', fontStyle: 'bold' })
            .setOrigin(0.5),
        );
      }
      panel.add(
        makeButton(
          this,
          0,
          110,
          'Понятно',
          () => {
            dim.destroy();
            panel.destroy();
            if (info.field) this.card?.flashField(info.field);
            this.leaveGuest('reject');
          },
          { secondary: true, width: 260 },
        ),
      );
    }
  }

  /** Rewarded-прощение: ошибка 3→2, смена и бонус под угрозой сохранены (ГДД разд. 7). */
  private forgive(
    info: { field?: DocFieldId },
    dim: Phaser.GameObjects.Rectangle,
    panel: Phaser.GameObjects.Container,
  ): void {
    void this.showRewardedSafe(() => {
      this.forgivenThisShift = true;
      this.errors = MAX_ERRORS - 1;
      this.updateCounter();
      this.trackProgress();
      dim.destroy();
      panel.destroy();
      if (info.field) this.card?.flashField(info.field);
      this.toast('Ошибка прощена — смена продолжается');
      this.leaveGuest('reject');
    }).then((r) => {
      if (r === 'failed') this.toast('Реклама недоступна — смена будет завершена');
    });
  }

  /** 3 ошибки — смена прервана: выплата за верные сохраняется, бонус сгорает (ГДД разд. 5). */
  private showInterrupted(): void {
    const { width, height } = this.scale;
    const s = session();
    s.tokens += this.earnedTokens;
    s.xp += this.earnedXp;
    s.currentShift = null;
    void getPlatform().submitScore(BOARD_IDS.streak, s.bestStreak);
    void flushSession();

    const cy = height / 2;
    this.add.rectangle(width / 2, cy, width, height, 0x000000, 0.5);
    const g = this.add.graphics();
    drawHardShadow(g, width / 2 - 290, cy - 200, 580, 400, 18);
    g.fillStyle(THEME.PAPER, 1);
    g.fillRoundedRect(width / 2 - 290, cy - 200, 580, 400, 18);
    g.lineStyle(5, THEME.INK, 1);
    g.strokeRoundedRect(width / 2 - 290, cy - 200, 580, 400, 18);
    g.fillStyle(THEME.ERROR, 1);
    g.fillRoundedRect(width / 2 - 165, cy - 188, 330, 46, 12);
    g.lineStyle(3, THEME.INK, 1);
    g.strokeRoundedRect(width / 2 - 165, cy - 188, 330, 46, 12);
    this.add
      .text(width / 2, cy - 165, 'Смена прервана', {
        fontFamily: FONT,
        fontSize: '28px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setStroke(INK_HEX, 3);
    this.add
      .text(width / 2, cy - 80, `Допущено ошибок: ${Math.min(this.errors, MAX_ERRORS)} из ${MAX_ERRORS}`, {
        fontFamily: FONT,
        fontSize: '26px',
        color: INK_HEX,
      })
      .setOrigin(0.5);
    this.add
      .text(width / 2, cy - 30, `Жетоны: +${this.earnedTokens} · XP: +${this.earnedXp}`, {
        fontFamily: FONT,
        fontSize: '24px',
        color: INK_HEX,
      })
      .setOrigin(0.5);
    makeButton(this, width / 2, cy + 50, 'Новая смена', () => this.scene.restart(), {
      color: THEME.SUCCESS,
      width: 320,
    });
    makeButton(this, width / 2, cy + 145, 'В меню', () => this.scene.start('Menu'), {
      secondary: true,
      width: 280,
    });
  }

  private finish(): void {
    const { width, height } = this.scale;
    const s = session();
    const clean = this.errors === 0;
    this.finishTokenTotal = this.earnedTokens + (clean ? BALANCE.cleanBonus : 0);
    this.finishXpTotal = this.earnedXp + (clean ? BALANCE.xpCleanShift : 0);

    s.tokens += this.finishTokenTotal;
    s.xp += this.finishXpTotal;
    s.currentShift = null;
    s.shiftNumber += 1;

    void getPlatform().submitScore(BOARD_IDS.streak, s.bestStreak);
    void flushSession();

    const rankAfter = rankFor(s.xp);
    const cy = height / 2;
    const title = this.isDaily
      ? 'Дневная смена завершена'
      : this.isNight
        ? 'Ночная смена завершена'
        : `Смена ${this.shift} завершена`;

    this.add.rectangle(width / 2, cy, width, height, 0x000000, 0.5);
    const g = this.add.graphics();
    drawHardShadow(g, 60, cy - 360, 600, 720, 24);
    g.fillStyle(THEME.PAPER, 1);
    g.fillRoundedRect(60, cy - 360, 600, 720, 24);
    g.lineStyle(5, THEME.INK, 1);
    g.strokeRoundedRect(60, cy - 360, 600, 720, 24);
    g.fillStyle(THEME.ACCENT, 1);
    g.fillRoundedRect(width / 2 - 210, cy - 335, 420, 56, 14);
    g.lineStyle(3, THEME.INK, 1);
    g.strokeRoundedRect(width / 2 - 210, cy - 335, 420, 56, 14);
    this.add
      .text(width / 2, cy - 307, title, {
        fontFamily: FONT,
        fontSize: '28px',
        color: '#ffffff',
        fontStyle: 'bold',
        wordWrap: { width: 400 },
        align: 'center',
      })
      .setOrigin(0.5)
      .setStroke(INK_HEX, 3);
    this.add
      .text(
        width / 2,
        cy - 230,
        `Верно: ${this.correct} из ${this.queue.length} · ошибок: ${Math.min(this.errors, MAX_ERRORS)}`,
        {
          fontFamily: FONT,
          fontSize: '26px',
          color: INK_HEX,
        },
      )
      .setOrigin(0.5);
    this.rewardText = this.add
      .text(width / 2, cy - 180, `Жетоны: +${this.finishTokenTotal} · XP: +${this.finishXpTotal}`, {
        fontFamily: FONT,
        fontSize: '27px',
        color: INK_HEX,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    if (this.isDaily) {
      this.add
        .text(width / 2, cy - 130, `Скор дневной смены: ${dailyScore(this.correct, this.fastCount, this.errors)}`, {
          fontFamily: FONT,
          fontSize: '22px',
          color: INK_HEX,
        })
        .setOrigin(0.5);
    }
    if (rankAfter.index > this.rankIndexStart) {
      this.add
        .text(width / 2, cy - 80, `Новое звание: ${rankAfter.title}`, {
          fontFamily: FONT,
          fontSize: '27px',
          color: '#2f9e5f',
          fontStyle: 'bold',
        })
        .setOrigin(0.5);
    }

    // Без строк скор/звание середина панели остаётся пустой — поднимаю блок кнопок
    const extras = (this.isDaily ? 1 : 0) + (rankAfter.index > this.rankIndexStart ? 1 : 0);
    const lift = extras === 0 ? 100 : extras === 1 ? 55 : 0;

    // ×2 жетоны за rewarded (ГДД разд. 7) — один раз, всегда доступно
    this.doubleBtn = makeButton(
      this,
      width / 2,
      cy + 110 - lift,
      '×2 жетоны за рекламу',
      () => this.applyDoubleReward(),
      { color: THEME.PANEL_DARK, width: 380, fontSize: 26 },
    );
    makeButton(this, width / 2, cy + 215 - lift, 'Следующая смена', () => this.scene.restart(), {
      color: THEME.ACCENT,
      width: 340,
    });
    makeButton(this, width / 2, cy + 305 - lift, 'В меню', () => this.scene.start('Menu'), {
      secondary: true,
      width: 280,
    });
  }

  /** ×2 жетонов за rewarded: начисляем вторую половину (ГДД разд. 7). */
  private applyDoubleReward(): void {
    if (this.doubled) return;
    void this.showRewardedSafe(() => {
      this.doubled = true;
      session().tokens += this.finishTokenTotal;
      void flushSession();
      sfx.coin();
      this.doubleBtn?.destroy();
      this.doubleBtn = null;
      this.rewardText?.setText(`Жетоны: +${this.finishTokenTotal * 2} · XP: +${this.finishXpTotal}`);
    });
  }

  /** Время забега вышло — конец блица/дуэли. */
  private endRun(): void {
    if (this.runEnded) return;
    this.runEnded = true;
    this.busy = true;
    this.stopPatience();
    this.setButtonsEnabled(false);
    const score = this.runScore();
    if (this.runMode === 'blitz') this.finishBlitz(score);
    else this.finishDuel(score);
  }

  /** Скор блица/дуэли — существующие очки смены (план мультиплеера, фаза 1). */
  private runScore(): number {
    return this.correct * 10 + this.fastCount;
  }

  /** Блиц: скор в лидерборды Яндекса (blitzDay/blitzBest) и свой рекорд в сейв. */
  private finishBlitz(score: number): void {
    const s = session();
    s.mp.blitzRuns += 1;
    s.mp.blitzBest = Math.max(s.mp.blitzBest, score);
    void getPlatform().submitScore(BALANCE.boardIds.blitzDay, score);
    void getPlatform().submitScore(BALANCE.boardIds.blitzBest, s.mp.blitzBest);
    void flushSession();

    const { width, height } = this.scale;
    const cy = height / 2;
    this.add.rectangle(width / 2, cy, width, height, 0x000000, 0.5);
    const g = this.add.graphics();
    drawHardShadow(g, 60, cy - 300, 600, 600, 24);
    g.fillStyle(THEME.PAPER, 1);
    g.fillRoundedRect(60, cy - 300, 600, 600, 24);
    g.lineStyle(5, THEME.INK, 1);
    g.strokeRoundedRect(60, cy - 300, 600, 600, 24);
    g.fillStyle(THEME.ACCENT, 1);
    g.fillRoundedRect(width / 2 - 190, cy - 275, 380, 56, 14);
    g.lineStyle(3, THEME.INK, 1);
    g.strokeRoundedRect(width / 2 - 190, cy - 275, 380, 56, 14);
    this.add
      .text(width / 2, cy - 247, 'Блиц завершён', {
        fontFamily: FONT,
        fontSize: '30px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setStroke(INK_HEX, 3);
    this.add
      .text(width / 2, cy - 160, `Верно: ${this.correct} · ошибок: ${this.errors}`, {
        fontFamily: FONT,
        fontSize: '26px',
        color: INK_HEX,
      })
      .setOrigin(0.5);
    this.add
      .text(width / 2, cy - 100, `Скор: ${score}`, {
        fontFamily: FONT,
        fontSize: '40px',
        color: INK_HEX,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.add
      .text(width / 2, cy - 40, `Личный рекорд: ${s.mp.blitzBest}`, {
        fontFamily: FONT,
        fontSize: '22px',
        color: INK_HEX,
      })
      .setOrigin(0.5);
    makeButton(this, width / 2, cy + 60, 'Ещё раз', () => {
      pendingLaunch = { blitz: true };
      this.scene.restart();
    }, { color: THEME.ACCENT, width: 340 });
    makeButton(this, width / 2, cy + 145, 'В меню', () => this.scene.start('Menu'), {
      secondary: true,
      width: 280,
    });
  }

  /** Дуэль: отправить свой скор и дождаться итога (план мультиплеера, фаза 2). */
  private finishDuel(score: number): void {
    const { width, height } = this.scale;
    const cy = height / 2;
    this.add.rectangle(width / 2, cy, width, height, 0x000000, 0.5);
    const waiting = this.add
      .text(width / 2, cy, 'Ожидание результата соперника…', {
        fontFamily: FONT,
        fontSize: '26px',
        color: INK_HEX,
        backgroundColor: '#ffffff',
        padding: { x: 20, y: 10 },
      })
      .setOrigin(0.5);

    void (async () => {
      let outcome: MatchOutcome | null = null;
      let poll: MatchPoll | null = null;
      if (this.matchApi && this.duelMatchId) {
        if (!this.duelReported) {
          this.duelOutcome = await this.matchApi.reportResult(this.duelMatchId, score);
          this.duelReported = true;
        }
        outcome = this.duelOutcome;
        // ждём результат соперника (для бота известен сразу)
        let waited = 0;
        while (waited < 45000) {
          poll = await this.matchApi.pollMatch(this.duelMatchId);
          if (poll.winner !== null) break;
          await new Promise<void>((r) => setTimeout(r, 1000));
          waited += 1000;
        }
      }
      waiting.destroy();
      this.showDuelResult(score, outcome, poll?.winner ?? null, poll?.ratingDelta ?? null);
    })().catch((e) => {
      console.error('[duel] не удалось завершить матч', e);
      waiting.destroy();
      this.add
        .text(width / 2, cy, 'Ошибка сети — матч не завершён', {
          fontFamily: FONT,
          fontSize: '26px',
          color: INK_HEX,
          backgroundColor: '#ffffff',
          padding: { x: 16, y: 8 },
        })
        .setOrigin(0.5);
      makeButton(this, width / 2, cy + 90, 'В меню', () => this.scene.start('Menu'), {
        secondary: true,
        width: 280,
      });
    });
  }

  private showDuelResult(
    score: number,
    outcome: MatchOutcome | null,
    winner: 'me' | 'opponent' | 'draw' | null,
    ratingDelta: number | null,
  ): void {
    const { width, height } = this.scale;
    const cy = height / 2;
    const s = session();
    const opponentScore = outcome?.opponentScore ?? this.opponentScore;
    const finalWinner: 'me' | 'opponent' | 'draw' =
      winner ?? (score > opponentScore ? 'me' : score < opponentScore ? 'opponent' : 'draw');
    const delta = ratingDelta ?? duelDelta(score, opponentScore);

    s.mp.duelRating = Math.max(0, s.mp.duelRating + delta);
    if (finalWinner === 'me') s.mp.duelWins += 1;
    else if (finalWinner === 'opponent') s.mp.duelLosses += 1;
    else s.mp.duelDraws += 1;
    void flushSession();

    const title = finalWinner === 'me' ? 'ПОБЕДА' : finalWinner === 'opponent' ? 'ПОРАЖЕНИЕ' : 'НИЧЬЯ';

    this.add.rectangle(width / 2, cy, width, height, 0x000000, 0.5);
    const g = this.add.graphics();
    drawHardShadow(g, 60, cy - 300, 600, 600, 24);
    g.fillStyle(THEME.PAPER, 1);
    g.fillRoundedRect(60, cy - 300, 600, 600, 24);
    g.lineStyle(5, THEME.INK, 1);
    g.strokeRoundedRect(60, cy - 300, 600, 600, 24);
    g.fillStyle(finalWinner === 'me' ? THEME.SUCCESS : finalWinner === 'opponent' ? THEME.ERROR : THEME.GOLD, 1);
    g.fillRoundedRect(width / 2 - 190, cy - 275, 380, 56, 14);
    g.lineStyle(3, THEME.INK, 1);
    g.strokeRoundedRect(width / 2 - 190, cy - 275, 380, 56, 14);
    this.add
      .text(width / 2, cy - 247, title, {
        fontFamily: FONT,
        fontSize: '30px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setStroke(INK_HEX, 3);
    this.add
      .text(width / 2, cy - 160, `Ты: ${score} · ${this.duelOpponentName}: ${opponentScore}`, {
        fontFamily: FONT,
        fontSize: '27px',
        color: INK_HEX,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.add
      .text(width / 2, cy - 100, `Рейтинг: ${s.mp.duelRating} (${delta >= 0 ? '+' : ''}${delta})`, {
        fontFamily: FONT,
        fontSize: '26px',
        color: INK_HEX,
      })
      .setOrigin(0.5);
    makeButton(this, width / 2, cy + 60, 'В меню', () => this.scene.start('Menu'), {
      secondary: true,
      width: 280,
    });
  }
}
