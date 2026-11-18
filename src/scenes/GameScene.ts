import Phaser from 'phaser';
import { getPlatform } from '../platform';
import { describeForgery, describeViolation } from '../game/application';
import type { Application, Decision, DocFieldId } from '../game/application';
import {
  BALANCE,
  blitzRatingUpdate,
  BOARD_IDS,
  correctReward,
  dailyScore,
  duelDelta,
  nightReward,
  rankFor,
  shouldShowInterstitial,
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
import { drawBooth, LIGHT_STAGES } from '../render/booth';
import type { BoothView } from '../render/booth';
import { createWorldWindow, type WorldWindow } from '../render/worldWindow';
import {
  applyCamera,
  layoutOffLeft,
  layoutOffRight,
  OVERLAY,
  screenCenter,
  DESIGN_CX,
  DESIGN_W,
} from '../render/layout';
import { bulbWave, spawnThought } from '../render/juice';
import * as vfx from '../render/vfx';
import { PassCard } from '../render/passCard';
import { drawRuleBoard } from '../render/ruleBoard';
import { drawHardShadow, FONT, INK_HEX, THEME } from '../render/theme';
import { fadeIn, fadeToScene } from '../render/transition';
import { t } from '../i18n';
import type { TranslationKey } from '../i18n';
import { bumpMissions } from '../game/missions';
import { dailySeed, dateKey } from '../game/save';
import { rngFor } from '../game/rng';
import { sfx } from '../systems/sfx';
import { makeButton } from '../ui/button';
import { makeLangButton } from '../ui/langPicker';
import { createMatchAPI, getPlayerIdentity } from '../net/matchApi';
import type { MatchAPI, MatchOutcome, MatchPoll } from '../net/matchApi';
import { reportMyProfile } from '../net/top50';

const BOARD_W = 540; // зазоры от кнопок «Меню» и языка по краям
const BOARD_CY = 130;
const GUEST_Y = 370;
const GUEST_SCALE = 0.8;
const CARD_Y = 690;
const BAR_Y = 1016;
const COUNTER_Y = 965; // одна линия с детектором — над полосой терпения, не на столешнице
const TOOL_Y = 965; // основная линия инструментов — над полосой терпения
const TOOL_X_OFF = 105; // отступ от правого края: левый край кнопок правее угла карты (510)
const TOOL_LUPA_Y = 895; // Лупа над детектором, когда куплены оба
const BTN_Y = 1150;
const PIPELINE_Y = 1044; // точки очереди под полосой терпения
const PATIENCE_MS = BALANCE.patienceMs;
const MAX_ERRORS = BALANCE.maxErrors;

/** Линейная интерполяция 0xRRGGBB — для «палитры угрозы» терпения-бара. */
function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

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
  /** Готовый API матча из лобби: P2P-сессия/бот живут в его экземпляре. */
  api?: MatchAPI;
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
  private lensBtn: Phaser.GameObjects.Container | null = null;
  private finishTokenTotal = 0;
  private finishXpTotal = 0;
  private doubled = false;
  private rewardText: Phaser.GameObjects.Text | null = null;
  private doubleBtn: Phaser.GameObjects.Container | null = null;
  /** Оверлей ожидания рекламы: гасит экран, блокирует клики, крутит спиннер. */
  private adOverlay: {
    dim: Phaser.GameObjects.Rectangle;
    spinner: Phaser.GameObjects.Graphics;
  } | null = null;
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
  private boardView: { board: Phaser.GameObjects.Container; pulse(): void; markRule(ruleId: number): void } | null = null;
  // Пайплайн смены (UX-директор №4): цель видна точками, ошибки — красными слотами
  private pipelineDots: Phaser.GameObjects.Arc[] = [];
  private mistakeSlots: Phaser.GameObjects.Arc[] = [];
  private pipelineRing: Phaser.GameObjects.Arc | null = null;
  /** Маршрут первого гостя показан — не повторяется до перезагрузки страницы. */
  private introDone = false;
  private introUi: Phaser.GameObjects.GameObject[] = [];
  // Окно мира + VIP-церемония (план v2 А1/А2)
  private worldWindow: WorldWindow | null = null;
  private lightStage = 0;
  private entourage: Phaser.GameObjects.Container[] = [];
  private vipRibbon: Phaser.GameObjects.Container | null = null;
  private ghostFlicker: Phaser.Tweens.Tween | null = null;
  // План v2 П3/П4: мини-цель, овертайм, сценарий дня, счётчик подделок, перчатка
  private shiftGoal: { ruleId: number; count: number; bonus: number; broken: boolean } | null = null;
  private goalChip: Phaser.GameObjects.Text | null = null;
  private overtimeActive = false;
  private overtimeOffered = false;
  private overtimeUi: Phaser.GameObjects.GameObject[] = [];
  private fakesCaught = 0;
  private scenario = -1;
  private maxErrorsN = MAX_ERRORS;
  // Блиц/дуэль: глобальный таймер забега вместо терпения на заявку
  private runDuration = BALANCE.blitzDurationMs;
  private runEndAt = 0;
  private runStarted = false;
  private runEnded = false;
  /** Результат забега/смены показан — «Меню» в углу больше не производит выплаты. */
  private resultShown = false;
  private duelMatchId: string | null = null;
  private duelStartAt = 0;
  private duelOpponentName = t('opponentDefault');
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

  private onKeyLeft = (): void => this.decide('approve');
  private onKeyRight = (): void => this.decide('reject');

  create(data?: SceneLaunchData): void {
    // Адаптивный вьюпорт: зум камеры под фактический размер окна (layout.ts)
    applyCamera(this);
    fadeIn(this);
    sfx.startMusic('shift');
    const width = DESIGN_W; // сцены живут в дизайн-координатах 720×1280
    const s = session();
    this.isDaily = false;
    this.isNight = false;
    this.runEnded = false;
    this.runStarted = false;
    this.resultShown = false;
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
    this.lensBtn = null;

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
      this.duelOpponentName = launch.opponentName ?? t('opponentDefault');
      // API дуэли из лобби (P2P-сессия живёт в его экземпляре); иначе — своя фабрика
      if (launch.api) this.matchApi = launch.api;
      else void createMatchAPI().then((api) => {
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

    // План v2 В1: мини-цель смены — активное правило с ≥2 носителями в очереди
    if (this.runMode === 'shift') {
      let best: { ruleId: number; count: number; difficulty: number } | null = null;
      for (const rule of this.rules) {
        const count = this.queue.filter((a) => a.ruleId === rule.id).length;
        if (count >= 2 && (!best || count > best.count)) {
          best = { ruleId: rule.id, count, difficulty: rule.difficulty };
        }
      }
      if (best) {
        this.shiftGoal = {
          ruleId: best.ruleId,
          count: best.count,
          bonus: best.difficulty >= 4 ? BALANCE.goalRareBonus : BALANCE.goalBonus,
          broken: false,
        };
      }
    }
    // План v2 В6: сценарий дня — runtime-модификаторы карьерных смен (сид-генерация не тронута)
    this.scenario = Math.floor(rngFor(dailySeed(dateKey()), 'scenario')() * 4);
    // План v2 В5: перчатка — +1 доп. ошибка, только карьерные смены
    this.maxErrorsN = MAX_ERRORS + (this.runMode === 'shift' && s.tools.glove ? BALANCE.gloveBonusErrors : 0);

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

    this.boothView = drawBooth(this, 'game');
    if (this.isNight) {
      // ночная смена видна глазом: холодный тинт фона (арт-директор №9)
      this.add
        .rectangle(OVERLAY.x, OVERLAY.y, OVERLAY.width, OVERLAY.height, 0x2a2e6e, 0.16)
        .setDepth(-7);
    }
    // Ambient-пар из чашки на стойке (VFX-слой, тех-художник)
    vfx.steamAmbient(this, 617, 1000);
    // Окно мира: погода смены из сида — у всех игроков одинаковая (план v2 А1)
    this.worldWindow = createWorldWindow(this, this.seed);

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

    // Пайплайн смены: цель видна точками, слоты ошибок справа (UX-директор №4)
    if (this.runMode === 'shift') {
      const n = this.queue.length;
      const gap = 19;
      const startX = width / 2 - ((n - 1) * gap) / 2;
      for (let i = 0; i < n; i++) {
        this.pipelineDots.push(
          this.add
            .circle(startX + i * gap, PIPELINE_Y, 7, THEME.PAPER)
            .setStrokeStyle(3, THEME.INK, 0.45),
        );
      }
      const slotsX = startX + (n - 1) * gap + 34;
      for (let m = 0; m < this.maxErrorsN; m++) {
        this.mistakeSlots.push(
          this.add
            .circle(slotsX + m * 26, PIPELINE_Y, 8, THEME.PAPER)
            .setStrokeStyle(3, THEME.ERROR, 0.3),
        );
      }
      this.pipelineRing = this.add.circle(startX, PIPELINE_Y, 12).setStrokeStyle(3, THEME.GOLD, 0.9);
      this.tweens.add({
        targets: this.pipelineRing,
        scale: { from: 1, to: 1.18 },
        duration: 450,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });

      // Мини-цель смены: чип у счётчика (план v2 В1)
      if (this.shiftGoal) {
        const goalRule = this.rules.find((r) => r.id === this.shiftGoal?.ruleId);
        const ruleLabel = goalRule?.label ?? t(`rule_${this.shiftGoal.ruleId}` as TranslationKey);
        this.goalChip = this.add
          .text(40, 994, t('goalChip', { r: ruleLabel, n: this.shiftGoal.count }), {
            fontFamily: FONT,
            fontSize: '15px',
            color: INK_HEX,
            fontStyle: 'bold',
            backgroundColor: '#ffc93c',
            padding: { x: 8, y: 4 },
          })
          .setOrigin(0, 0.5);
      }
    }

    if (this.runMode === 'duel') {
      this.opponentText = this.add
        .text(width - 40, COUNTER_Y, t('opponentScore', { score: 0 }), {
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
      t('approve'),
      () => this.decide('approve'),
      { color: THEME.SUCCESS, width: 330 },
    );
    this.rejectBtn = makeButton(
      this,
      width / 2 + 175,
      BTN_Y,
      t('reject'),
      () => this.decide('reject'),
      { color: THEME.ERROR, width: 330 },
    );

    this.createToolButtons();

    // Смена языка — в обычной смене (в блице/дуэли рестарт сбросил бы забег)
    if (this.runMode === 'shift') makeLangButton(this, width - 48, 44);

    // выход в кабинет из любого режима (спека: «закончить игру»)
    makeButton(this, 44, 40, t('menu'), () => this.exitToMenu(), {
      secondary: true,
      width: 72,
      height: 72,
      fontSize: 16,
    });

    // Клавиатура для десктопа (UX-директор №5); стрелки — без конфликтов с CG.
    // off/on как у UPDATE: рестарт сцены не пересоздаёт экземпляр — копим не копим листенеры
    if (!this.sys.game.device.input.touch) {
      const kb = this.input.keyboard;
      if (kb) {
        kb.off('keydown-LEFT', this.onKeyLeft);
        kb.off('keydown-RIGHT', this.onKeyRight);
        kb.on('keydown-LEFT', this.onKeyLeft);
        kb.on('keydown-RIGHT', this.onKeyRight);
      }
      this.add
        .text(width / 2 - 175, BTN_Y + 60, '←', {
          fontFamily: FONT,
          fontSize: '22px',
          color: INK_HEX,
        })
        .setOrigin(0.5)
        .setAlpha(0.45);
      this.add
        .text(width / 2 + 175, BTN_Y + 60, '→', {
          fontFamily: FONT,
          fontSize: '22px',
          color: INK_HEX,
        })
        .setOrigin(0.5)
        .setAlpha(0.45);
    }

    // Блиц стартует на первом update (Clock сцены bootится после create); дуэль — по startAt
    if (this.runMode === 'duel') {
      this.countdownText = this.add
        .text(DESIGN_CX, screenCenter().y, '', {
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
      if (this.runMode === 'blitz') {
        // В create Clock ещё не bootится и time.now = 0 — таймер там сгорал мгновенно
        // у страниц, открытых дольше длительности забега. Выставляем здесь, где clock живой.
        this.runStarted = true;
        this.runEndAt = this.time.now + this.runDuration;
        return;
      }
      // дуэль ждёт startAt (общий для обоих игроков момент старта)
      const waitMs = this.duelStartAt - Date.now();
      if (waitMs > 0) {
        this.countdownText?.setText(t('startIn', { s: Math.ceil(waitMs / 1000) }));
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
    if (this.runEnded || this.resultShown) return; // на экранах результатов есть свои кнопки
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
    fadeToScene(this, 'Menu');
  }

  private startRun(): void {
    this.runStarted = true;
    this.runEndAt = this.time.now + this.runDuration;
    this.countdownText?.destroy();
    this.countdownText = null;
    // вход гостя завершился ещё во время отсчёта — кнопки обязаны включиться
    this.setButtonsEnabled(true);
    getPlatform().gameplayStart();
  }

  private updateCounter(remainingMs?: number): void {
    if (this.runMode === 'shift') {
      const label = this.isDaily ? t('dailyName') : this.isNight ? t('nightName') : t('shiftN', { n: this.shift });
      // Ошибки из брошенного сейва могут быть выше лимита — в интерфейсе не показываем «4/3»
      const shownErrors = Math.min(this.errors, this.maxErrorsN);
      this.counter?.setText(
        `${label} · ${t('entryOf', { i: this.index + 1, n: this.queue.length })} · ${t('errorsOf', { e: shownErrors, m: MAX_ERRORS })}`,
      );
      return;
    }
    const label = this.runMode === 'blitz' ? t('blitzName') : t('duelName');
    const secs = remainingMs === undefined ? '' : t('secLeft', { s: Math.ceil(remainingMs / 1000) });
    this.counter?.setText(`${label} · ${secs}${t('runCounter', { c: this.correct, e: this.errors })}`);
  }

  private async pollOpponent(): Promise<void> {
    if (!this.matchApi || !this.duelMatchId) return;
    try {
      const poll = await this.matchApi.pollMatch(this.duelMatchId);
      this.opponentScore = poll.opponentScore;
      this.opponentText?.setText(t('opponentScore', { score: poll.opponentScore }));
    } catch {
      // сетевая ошибка — попробуем на следующем опросе
    }
  }

  /** Правая колонка инструментов: Лупа (подсказка полей) над Детектором (заряды). */
  private createToolButtons(): void {
    const width = DESIGN_W;
    this.lensBtn?.destroy();
    this.detectorBtn?.destroy();

    const lens = session().tools.lens;
    const detector = session().tools.detector && this.runMode === 'shift';
    // Когда инструментов два (или в дуэли занята нижняя строка) — Лупа над Детектором
    const opponentRow = this.runMode === 'duel';
    const lensY = lens && (detector || opponentRow) ? TOOL_LUPA_Y : TOOL_Y;
    const detectorY = TOOL_Y;

    if (lens) {
      this.lensBtn = makeButton(this, width - TOOL_X_OFF, lensY, t('lensName'), () => this.showLensHint(), {
        secondary: true,
        width: 200,
        height: 56,
        fontSize: 18,
      });
    }
    if (detector) {
      const ads = getPlatform().adsSupported;
      const label =
        this.detectorCharges > 0
          ? t('detectorCharges', { n: this.detectorCharges })
          : ads && this.detectorAdUses < BALANCE.detectorAdCharges
            ? t('detectorAd')
            : t('detectorNone');
      this.detectorBtn = makeButton(this, width - TOOL_X_OFF, detectorY, label, () => this.useDetector(), {
        secondary: true,
        width: 200,
        height: 56,
        fontSize: 20,
      });
    }
  }

  /** Лупа: подсветить все поля пропуска — подсказка, куда можно тапать. */
  private showLensHint(): void {
    if (this.busy) return;
    this.card?.highlightAllFields();
    sfx.tap();
  }

  /** Оверлей ожидания рекламы: гасит экран, блокирует клики, крутит спиннер. */
  private showAdOverlay(): void {
    if (this.adOverlay) return;
    const dim = this.add
      .rectangle(OVERLAY.x, OVERLAY.y, OVERLAY.width, OVERLAY.height, 0x000000, 0.55)
      .setInteractive() // не пускает клики к кнопкам сцены на время аукциона рекламы
      .setDepth(90);
    const spinner = this.add.graphics().setDepth(91);
    spinner.setPosition(DESIGN_CX, screenCenter().y);
    spinner.lineStyle(7, THEME.PAPER, 1);
    spinner.beginPath();
    spinner.arc(0, 0, 26, 0, Math.PI * 1.4);
    spinner.strokePath();
    this.tweens.add({ targets: spinner, angle: 360, duration: 900, repeat: -1 });
    this.adOverlay = { dim, spinner };
  }

  private hideAdOverlay(): void {
    if (!this.adOverlay) return;
    this.tweens.killTweensOf(this.adOverlay.spinner);
    this.adOverlay.dim.destroy();
    this.adOverlay.spinner.destroy();
    this.adOverlay = null;
  }

  /**
   * Rewarded с паузой и блокировкой UI (требование CG: UI заблокирован до
   * adFinished/adError; звук глушится платформой в момент реального старта
   * рекламы, не в момент запроса).
   */
  private async showRewardedSafe(onReward: () => void): Promise<'shown' | 'failed'> {
    const wasBusy = this.busy;
    this.setButtonsEnabled(false);
    this.showAdOverlay();
    try {
      const result = await getPlatform().showRewarded(onReward, () => sfx.setMuted(true));
      if (result === 'shown') {
        // Минимальный интервал interstitial отсчитывается и от rewarded (ГДД разд. 7)
        session().ad.lastAdAt = Date.now();
        void flushSession();
      }
      return result;
    } finally {
      this.hideAdOverlay();
      sfx.setMuted(!session().soundOn);
      if (!wasBusy) this.setButtonsEnabled(true);
    }
  }

  /** Выход в кабинет с экрана результата — единственное место interstitial (ГДД разд. 7). */
  private exitToMenuAfterResults(): void {
    const s = session();
    if (!shouldShowInterstitial(s.ad, this.shift, Date.now())) {
      fadeToScene(this, 'Menu');
      return;
    }
    s.ad.lastAdAt = Date.now();
    s.ad.shiftsSince = 0;
    void flushSession();
    // Требование CG: игра на паузе — UI заблокирован (оверлей+спиннер), пока
    // идёт аукцион и показ; звук — только с момента реального старта рекламы
    this.showAdOverlay();
    void getPlatform()
      .showInterstitial(() => sfx.setMuted(true))
      .finally(() => {
        this.hideAdOverlay();
        sfx.setMuted(!s.soundOn);
        fadeToScene(this, 'Menu');
      });
  }

  private useDetector(): void {
    if (this.busy) return;
    if (this.detectorCharges <= 0) {
      const ads = getPlatform().adsSupported;
      if (!ads || this.detectorAdUses >= BALANCE.detectorAdCharges) {
        this.toast(t('toastDetectorDone'));
        // Без рекламы кнопка «пустышка» не нужна
        if (!ads) this.detectorBtn?.destroy();
        return;
      }
      // Rewarded: доп. заряд (ГДД разд. 7) — награда только за onRewarded
      void this.showRewardedSafe(() => {
        this.detectorCharges += 1;
        this.detectorAdUses += 1;
        this.createToolButtons();
      }).then((r) => {
        // Adblock/unfilled: кнопка не должна «молчать» — объясняем, почему награды нет
        if (r === 'shown') this.toast(t('toastChargeGot'));
        else this.toast(t('toastAdUnavailable'));
      });
      return;
    }

    this.detectorCharges -= 1;
    this.createToolButtons();
    const app = this.queue[this.index];
    if (app.reason === 'forgery') {
      const { field } = describeForgery(app);
      this.card?.flashField(field);
      this.toast(t('toastMismatch'));
    } else {
      this.toast(t('toastDocOk'));
    }
  }

  private toast(text: string): void {
    const t = this.add
      .text(DESIGN_CX, 1052, text, {
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
      .text(DESIGN_CX, 1090, text, {
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
    this.lensBtn?.setAlpha(on ? 1 : 0.35);
  }

  private showApplication(): void {
    const width = DESIGN_W;
    const app = this.queue[this.index];
    this.updateCounter();
    this.setButtonsEnabled(false);
    this.guest?.destroy();
    this.entourage.forEach((e) => e.destroy());
    this.entourage = [];
    this.vipRibbon?.destroy();
    this.vipRibbon = null;
    this.card?.destroy();

    const guestScale = app.vip ? GUEST_SCALE * 1.15 : GUEST_SCALE;

    // VIP-церемония (план v2 А2): машина замирает у окна, ковровая дорожка, волна лампочек —
    // гость с сопровождающими входит после
    if (app.vip) {
      this.worldWindow?.stopCar();
      bulbWave(this, this.signBulbs);
      const road = this.add
        .rectangle(width / 2 + 250, GUEST_Y + 130, width / 2 + 400, 54, THEME.ACCENT_DARK)
        .setOrigin(1, 0.5)
        .setDepth(-6);
      road.setScale(0, 1);
      this.tweens.add({ targets: road, scaleX: 1, duration: 550, ease: 'Sine.easeOut' });
    }

    // Bounce-вход слева: слайд + overshoot масштаба (спека §4.3 №8).
    // На широких экранах заходим от левого края ВИДИМОЙ области, а не от −80
    this.guest = drawCharacter(this, app.guest, layoutOffLeft(), GUEST_Y, guestScale);
    // Гость-невидимка (план v2 А3): alpha-мерцание, проявляется проверкой поля
    if (app.ghost) {
      this.guest.setAlpha(0.22);
      this.ghostFlicker = this.tweens.add({
        targets: this.guest,
        alpha: { from: 0.22, to: 0.32 },
        duration: 500,
        yoyo: true,
        repeat: -1,
      });
    }
    // Свита VIP: мини-гости следом (уходят вместе с гостем — leaveGuest)
    if (app.vip) {
      for (const [dx, dy, sc] of [
        [-95, 24, 0.45],
        [-160, 40, 0.4],
      ] as const) {
        const mini = drawCharacter(this, app.guest, layoutOffLeft() + dx, GUEST_Y + dy, sc);
        this.entourage.push(mini);
      }
    }
    // Тень в нише появляется вместе с гостем и уходит с ним — не висит в пустой нише
    const guestShadow = this.boothView?.guestShadow;
    if (guestShadow) {
      guestShadow.setAlpha(0);
      this.tweens.add({ targets: guestShadow, alpha: 1, duration: 250 });
    }
    this.card = new PassCard(this, app.doc, width / 2, CARD_Y, {
      interactiveFields: session().tools.lens,
      onFieldTap: (field: DocFieldId) => {
        if (app.ghost) this.revealGhost();
        if (this.guest) highlightField(this.guest, field);
        this.card?.softHighlight(field);
        sfx.tap();
      },
    }).setAlpha(0);
    sfx.whoosh();
    if (app.vip) {
      // золотая лента VIP на пропуске (план v2 А2)
      const ribbon = this.add.container(width / 2 + 138, CARD_Y - 108).setDepth(11);
      const rb = this.add.graphics();
      rb.fillStyle(THEME.GOLD, 1);
      rb.fillRoundedRect(-52, -20, 104, 40, 8);
      rb.lineStyle(3, THEME.INK, 1);
      rb.strokeRoundedRect(-52, -20, 104, 40, 8);
      ribbon.add([rb, this.add.text(0, 0, 'VIP', { fontFamily: FONT, fontSize: '22px', color: INK_HEX, fontStyle: 'bold' }).setOrigin(0.5)]);
      ribbon.setScale(0);
      this.tweens.add({ targets: ribbon, scale: 1, duration: 300, delay: 450, ease: 'Back.easeOut' });
      this.vipRibbon = ribbon;
    }

    this.tweens.add({
      targets: this.guest,
      x: width / 2,
      duration: 260,
      ease: 'Quad.easeOut',
      onComplete: () => vfx.walkPuff(this, width / 2, GUEST_Y + 120 * guestScale),
    });
    this.tweens.add({
      targets: this.guest,
      scale: { from: 0.2, to: guestScale },
      duration: 320,
      ease: 'Back.easeOut',
    });
    if (app.vip) {
      // свита доезжает вслед за VIP
      this.entourage.forEach((mini, i) => {
        const targetX = width / 2 - 95 - i * 65;
        this.tweens.add({
          targets: mini,
          x: targetX,
          duration: 300,
          delay: 120 + i * 90,
          ease: 'Quad.easeOut',
        });
      });
    }
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
          getPlatform().gameplayStart();
        } else if (this.runStarted) {
          this.setButtonsEnabled(true);
          getPlatform().gameplayStart();
        }
        if (this.guest) startBreathing(this.guest, GUEST_SCALE);
        // Онбординг (UX-директор №1–2): маршрут первого гостя + idle-подсказка на подделке
        if (this.runMode === 'shift' && this.shift === 1) {
          if (this.index === 0 && !this.introDone) {
            this.introDone = true;
            this.playIntro();
          } else if (this.index === 1 && this.queue[1]?.training) {
            this.time.delayedCall(7000, () => {
              if (!this.busy && this.guest) highlightField(this.guest, 'head');
            });
          }
        }
      },
    });
  }

  /** Онбординг первого гостя: кольцо на госте → пульс кнопок вердикта. Чистится любым вводом. */
  private playIntro(): void {
    if (!this.guest) return;
    const ring = this.add.circle(DESIGN_CX, GUEST_Y, 120).setStrokeStyle(5, THEME.GOLD, 0.9).setDepth(12);
    this.introUi.push(ring);
    this.tweens.add({
      targets: ring,
      scale: { from: 0.9, to: 1.1 },
      alpha: { from: 0.9, to: 0.5 },
      duration: 700,
      yoyo: true,
      repeat: 2,
      onComplete: () => this.clearIntro(),
    });
    this.time.delayedCall(900, () => {
      if (!this.introUi.length) return;
      for (const btn of [this.approveBtn, this.rejectBtn]) {
        if (!btn) continue;
        this.tweens.add({ targets: btn, scale: { from: 1, to: 1.07 }, duration: 350, yoyo: true, repeat: 2 });
      }
    });
  }

  /** Убрать онбординг-оверлеи (любое решение/тайм-аут). */
  private clearIntro(): void {
    for (const obj of this.introUi) obj.destroy();
    this.introUi = [];
    if (this.approveBtn) this.tweens.killTweensOf(this.approveBtn);
    if (this.rejectBtn) this.tweens.killTweensOf(this.rejectBtn);
    this.approveBtn?.setScale(1);
    this.rejectBtn?.setScale(1);
  }

  /** Проявление гостя-невидимки (план v2 А3): мерцание стоп, полный альфа. */
  private revealGhost(): void {
    if (!this.ghostFlicker) return;
    this.ghostFlicker.stop();
    this.ghostFlicker = null;
    this.guest?.setAlpha(1);
  }

  /** Мини-цель (план v2 В1): ошибка на носителе правила бьёт билет. */
  private breakGoalIfHit(app: Application): void {
    if (!this.shiftGoal || this.shiftGoal.broken) return;
    if (app.ruleId === this.shiftGoal.ruleId) {
      this.shiftGoal.broken = true;
      this.goalChip?.setStyle({ backgroundColor: '#ff4757' });
      this.goalChip?.setColor('#ffffff');
      this.goalChip?.setAlpha(0.85);
    }
  }

  /** Оффер овертайма (план v2 В3): +3 заявки ×2, ошибка — конец. */
  private offerOvertime(): void {
    const width = DESIGN_W;
    const cy = screenCenter().y;
    const dim = this.add
      .rectangle(OVERLAY.x, OVERLAY.y, OVERLAY.width, OVERLAY.height, 0x000000, 0.5)
      .setInteractive();
    const panel = this.add.container(width / 2, cy).setScale(0.85).setAlpha(0);
    const g = this.add.graphics();
    drawHardShadow(g, -300, -180, 600, 360, 20);
    g.fillStyle(THEME.PAPER, 1);
    g.fillRoundedRect(-300, -180, 600, 360, 20);
    g.lineStyle(5, THEME.INK, 1);
    g.strokeRoundedRect(-300, -180, 600, 360, 20);
    g.fillStyle(THEME.ACCENT, 1);
    g.fillRoundedRect(-170, -168, 340, 50, 12);
    g.lineStyle(3, THEME.INK, 1);
    g.strokeRoundedRect(-170, -168, 340, 50, 12);
    panel.add(g);
    panel.add(
      this.add
        .text(0, -143, t('overtimeTitle'), {
          fontFamily: FONT,
          fontSize: '26px',
          color: '#ffffff',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setStroke(INK_HEX, 3),
    );
    panel.add(
      this.add
        .text(0, -40, t('overtimeDesc'), {
          fontFamily: FONT,
          fontSize: '21px',
          color: INK_HEX,
          wordWrap: { width: 480 },
          align: 'center',
        })
        .setOrigin(0.5),
    );
    panel.setScale(0.85);
    panel.setAlpha(0);
    this.tweens.add({ targets: panel, scale: 1, alpha: 1, duration: 280, ease: 'Back.easeOut' });
    this.overtimeUi = [dim, panel];
    makeButton(this, width / 2, cy + 40, t('overtimeYes'), () => this.startOvertime(), {
      color: THEME.SUCCESS,
      width: 320,
    });
    makeButton(this, width / 2, cy + 130, t('overtimeNo'), () => this.clearOvertimeUi(), {
      secondary: true,
      width: 320,
    });
  }

  /** Принять овертайм: доп. заявки из сольта сида, ×2 зарплата. */
  private startOvertime(): void {
    this.clearOvertimeUi();
    this.overtimeActive = true;
    const extra = generateShift((this.seed ^ BALANCE.overtimeSeedSalt) >>> 0, this.shift, sessionToday(), BALANCE.overtimeApps);
    this.queue = this.queue.concat(extra.apps);
    sfx.purchase();
    this.showApplication();
  }

  /** Убрать оффер (отказ или принятие). */
  private clearOvertimeUi(): void {
    for (const obj of this.overtimeUi) obj.destroy();
    this.overtimeUi = [];
  }

  /** Камера-панч вердикта поверх существующего shake: лёгкий zoom-in/out (арт-директор №9). */
  private punch(): void {
    const cam = this.cameras.main;
    cam.zoomTo(1.015, 90, 'Sine.easeInOut', true);
    this.time.delayedCall(90, () => cam.zoomTo(1, 90, 'Sine.easeInOut', true));
  }

  /** Обновить пайплайн смены: пройденное заливаем, текущее — под золотым кольцом. */
  private updatePipeline(): void {
    for (let i = 0; i < this.pipelineDots.length; i++) {
      const dot = this.pipelineDots[i];
      if (i < this.index) dot.fillColor = dot.getData('ok') ? THEME.SUCCESS : THEME.ERROR;
      else if (i === this.index) dot.fillColor = THEME.PAPER;
    }
    this.pipelineRing?.setPosition(
      DESIGN_W / 2 - ((this.pipelineDots.length - 1) * 19) / 2 + this.index * 19,
      PIPELINE_Y,
    );
    for (let m = 0; m < this.mistakeSlots.length; m++) {
      this.mistakeSlots[m].fillColor = m < this.errors ? THEME.ERROR : THEME.PAPER;
    }
    // Живое освещение: стена проживает смену — 4 стадии по прогрессу (план v2 А4)
    const total = Math.max(2, this.queue.length);
    const stage = Math.min(3, Math.floor((this.index / (total - 1)) * 4));
    if (stage !== this.lightStage) {
      this.lightStage = stage;
      this.boothView?.redraw(LIGHT_STAGES[stage]);
    }
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
    // Спешащий VIP: терпение ×0.5 (план v2 В4)
    const patienceMs = Math.round(
      PATIENCE_MS *
        (this.queue[this.index]?.vip ? 0.5 : 1) *
        (this.scenario === 1 ? 0.75 : 1) +
        (session().tools.coffee ? BALANCE.coffeeBonusMs : 0),
    );
    this.tweens.add({ targets: this.patienceBar, scaleX: 0, duration: patienceMs, ease: 'Linear' });
    // Палитра угрозы: последние 30% — GOLD→ACCENT→ERROR, читается периферией (арт-директор №8)
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: patienceMs,
      onUpdate: (tw) => {
        const p = tw.getValue() ?? 0;
        const bar = this.patienceBar;
        if (!bar) return;
        if (p < 0.7) bar.fillColor = THEME.PANEL_DARK;
        else if (p < 0.85) bar.fillColor = lerpColor(THEME.GOLD, THEME.ACCENT, (p - 0.7) / 0.15);
        else bar.fillColor = lerpColor(THEME.ACCENT, THEME.ERROR, (p - 0.85) / 0.15);
      },
    });
    this.patienceEvent = this.time.delayedCall(patienceMs, () => this.patienceExpired());
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
    this.clearIntro();
    this.pipelineDots[this.index]?.setData('ok', false);
    this.updatePipeline();
    this.breakGoalIfHit(this.queue[this.index]);
    if (this.overtimeActive) {
      this.errors += 1;
      this.time.delayedCall(450, () => this.finish());
      this.flash(THEME.NICHE_FLOOR);
      return;
    }
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
    this.clearIntro();
    if (app.ghost) this.revealGhost();
    this.card?.showStamp(decision === 'approve'); // штамп = решение игрока
    vfx.stampShock(this, DESIGN_CX, CARD_Y);
    vfx.stampInk(this, DESIGN_CX, CARD_Y);
    sfx.stamp();

    if (ok) {
      this.correct += 1;
      // Живой счёт сопернику по P2P-каналу (в блице и смене получателя нет)
      if (this.runMode === 'duel') {
        this.matchApi?.notifyProgress?.(this.duelMatchId ?? '', this.runScore());
      }
      if (this.runMode === 'shift') {
        const base = correctReward(fast) + (fast && this.scenario === 2 ? BALANCE.speedPayBonus : 0); // В6: двойная плата за скорость
        let reward = this.isNight ? nightReward(base) : base;
        if (app.vip) reward *= 2; // спешащий VIP платит двойную (план v2 В4)
        if (this.scenario === 0) reward = Math.ceil(reward * 1.25); // В6: премиальный день
        if (app.reason === 'forgery') this.fakesCaught += 1;
        this.earnedTokens += reward;
        this.earnedXp += BALANCE.xpPerCorrect;
        if (fast) this.fastCount += 1;
        const s = session();
        s.currentStreak += 1;
        if (s.currentStreak > s.bestStreak) s.bestStreak = s.currentStreak;
        if (this.guest) guestReact(this.guest, 'ok');
        this.pipelineDots[this.index]?.setData('ok', true);
        this.updatePipeline();
        this.trackProgress();
        this.time.delayedCall(300, () => {
          this.flash(THEME.SUCCESS);
          sfx.duckMusic();
          sfx.chip();
          sfx.success();
          sfx.coin();
          vfx.confettiSalvo(this);
          bulbWave(this, this.signBulbs);
          this.punch();
          if (fast) vfx.speedlines(this, this.guest?.x ?? DESIGN_CX, GUEST_Y);
          this.floatText(t('floatPlus', { n: reward }), '#3ec46d');
          // комбо-эскалация (гейм-дизайнер №1): серия видна и слышна, экономика не тронута
          if (s.currentStreak >= 3) {
            this.time.delayedCall(300, () =>
              this.floatText(t('streakLine', { n: s.currentStreak }), '#ffc93c'),
            );
          }
          if (this.scenario === 3 && s.currentStreak % 5 === 0) {
            this.earnedTokens += 2;
            this.time.delayedCall(500, () => this.floatText('+2', '#ffc93c'));
          }
        });
        this.time.delayedCall(800, () => this.leaveGuest('ok'));
      } else {
        // блиц/дуэль: чистый скор, без жетонов и XP; «быстрые» дают +1 к скору
        if (fast) this.fastCount += 1;
        if (this.guest) guestReact(this.guest, 'ok');
        this.time.delayedCall(300, () => {
          this.flash(THEME.SUCCESS);
          sfx.chip();
          sfx.success();
          vfx.confettiSalvo(this);
          bulbWave(this, this.signBulbs);
        });
        this.time.delayedCall(800, () => this.leaveGuest('ok'));
      }
    } else {
      session().currentStreak = 0;
      this.pipelineDots[this.index]?.setData('ok', false);
      this.updatePipeline();
      this.breakGoalIfHit(app);
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
        sfx.duckMusic();
        sfx.fail();
        this.punch();
      });
      if (this.overtimeActive) {
        // Овертайм (план v2 В3): ошибка — смена сразу закрывается, бонус 50 сгорает
        this.errors += 1;
        this.updatePipeline();
        this.time.delayedCall(700, () => this.finish());
        return;
      }
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
    // Уводим гостя за ПРАВЫЙ край видимой области (на широких экранах он дальше 940)
    const offRight = layoutOffRight();
    const guestShadow = this.boothView?.guestShadow;
    if (guestShadow) {
      this.tweens.add({ targets: guestShadow, alpha: 0, duration: 250 });
    }
    // Свита VIP уходит следом; окно мира возобновляет трафик (план v2 А2)
    for (const mini of this.entourage) {
      this.tweens.add({ targets: mini, x: offRight, duration: 450, ease: 'Quad.easeIn' });
      this.time.delayedCall(500, () => mini.destroy());
    }
    this.entourage = [];
    this.vipRibbon?.destroy();
    this.vipRibbon = null;
    this.worldWindow?.resumeCar();
    if (this.guest) {
      if (kind === 'reject') {
        // «Сдувание» уже сыграло — держим грусть, затем уводим с наклоном (спека §4.3 №9)
        this.time.delayedCall(420, () => {
          this.tweens.add({
            targets: this.guest,
            x: offRight,
            rotation: (Math.random() < 0.5 ? -1 : 1) * Phaser.Math.DegToRad(10),
            duration: 400,
            ease: 'Quad.easeIn',
          });
        });
        this.time.delayedCall(840, () => this.next());
      } else {
        this.tweens.add({ targets: this.guest, x: offRight, duration: 450, ease: 'Quad.easeIn' });
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
      // Овертайм (план v2 В3): карьерная смена ≥2 — предложение +3 заявок за ×2
      if (
        this.runMode === 'shift' &&
        !this.isDaily &&
        !this.isNight &&
        this.shift >= 2 &&
        !this.overtimeOffered &&
        !this.overtimeActive
      ) {
        this.overtimeOffered = true;
        this.offerOvertime();
        return;
      }
      if (this.runMode === 'shift') this.finish();
      else this.endRun();
    } else {
      this.showApplication();
    }
  }

  private flash(color: number): void {
    // Оверлей больше видимой области любого аспекта — вспышка заливает весь экран
    const rect = this.add.rectangle(
      OVERLAY.x,
      OVERLAY.y,
      OVERLAY.width,
      OVERLAY.height,
      color,
      THEME.FLASH_A,
    );
    this.tweens.add({ targets: rect, alpha: 0, duration: 150, onComplete: () => rect.destroy() });
  }

  /** Карточка объяснения — без объяснения игра не продолжается (столп «Ошибка учит»). */
  private showMistake(app: Application): void {
    getPlatform().gameplayStop(); // игрок читает — активный геймплей приостановлен
    const counted = !app.training;
    if (counted) this.errors += 1;
    this.updateCounter();
    this.updatePipeline();
    // В8: горячая метка правила — золотая точка на доске у лидера поимок
    if (counted && app.ruleId) {
      const sess = session();
      sess.ruleCatch[String(app.ruleId)] = (sess.ruleCatch[String(app.ruleId)] ?? 0) + 1;
      let bestId = app.ruleId;
      let bestN = 0;
      for (const [k, v] of Object.entries(sess.ruleCatch)) {
        if (v > bestN && this.rules.some((r) => r.id === Number(k))) {
          bestId = Number(k);
          bestN = v;
        }
      }
      this.boardView?.markRule(bestId);
    }
    if (counted && this.guest) spawnThought(this, this.guest);

    const dim = this.add
      .rectangle(OVERLAY.x, OVERLAY.y, OVERLAY.width, OVERLAY.height, 0x000000, 0.5)
      .setInteractive();

    const info: { text: string; field?: DocFieldId } =
      app.reason === 'forgery' ? describeForgery(app) : describeViolation(app, this.rules);

    const title = counted ? t('mistake') : t('training');
    const limitReached =
      counted && this.errors >= this.maxErrorsN && !this.isNight && this.runMode === 'shift';
    // Прощение за рекламу — только на платформах с рекламой (ГДД разд. 7)
    const forgivePossible =
      limitReached && !this.forgivenThisShift && getPlatform().adsSupported;
    // Панель выше, когда в ней два ряда кнопок (прощение + завершение) — кнопки не вылезают за край
    const half = forgivePossible ? 200 : 170;
    const panel = this.add.container(DESIGN_CX, screenCenter().y);
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

    if (forgivePossible) {
      // Прощение ошибки за rewarded: ошибка аннулируется, смена продолжается (ГДД разд. 7)
      panel.add(
        makeButton(this, 0, 50, t('continueAd'), () => this.forgive(info, dim, panel), {
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
          t('finishShift'),
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
          t('ok'),
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
          ? t('penalty', { s: BALANCE.blitzMistakePenaltyMs / 1000 })
          : null;
      if (extra) {
        panel.add(
          this.add
            .text(0, 40, t('penalty', { s: BALANCE.blitzMistakePenaltyMs / 1000 }), { fontFamily: FONT, fontSize: '22px', color: '#e27474', fontStyle: 'bold' })
            .setOrigin(0.5),
        );
      }
      panel.add(
        makeButton(
          this,
          0,
          110,
          t('ok'),
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
      this.toast(t('toastForgiven'));
      this.leaveGuest('reject');
    }).then((r) => {
      if (r === 'failed') this.toast(t('toastAdFailed'));
    });
  }

  /** 3 ошибки — смена прервана: выплата за верные сохраняется, бонус сгорает (ГДД разд. 5). */
  private showInterrupted(): void {
    const width = DESIGN_W;
    const s = session();
    getPlatform().gameplayStop();
    s.tokens += this.earnedTokens;
    s.xp += this.earnedXp;
    s.currentShift = null;
    s.ad.shiftsSince += 1;
    void getPlatform().submitScore(BOARD_IDS.streak, s.bestStreak);
    bumpMissions(s, { correct: this.correct, clean: false, fakes: this.fakesCaught });
    void flushSession();
    this.resultShown = true;

    const cy = screenCenter().y;
    // интерактивный dim: не пускает клики к кнопкам сцены за панелью результата
    this.add
      .rectangle(OVERLAY.x, OVERLAY.y, OVERLAY.width, OVERLAY.height, 0x000000, 0.5)
      .setInteractive();

    // Панель-контейнер: единый pop-in (арт-директор №2)
    const panel = this.add.container(width / 2, cy).setScale(0.85).setAlpha(0);
    this.tweens.add({ targets: panel, scale: 1, alpha: 1, duration: 280, ease: 'Back.easeOut' });

    const g = this.add.graphics();
    drawHardShadow(g, -290, -200, 580, 400, 18);
    g.fillStyle(THEME.PAPER, 1);
    g.fillRoundedRect(-290, -200, 580, 400, 18);
    g.lineStyle(5, THEME.INK, 1);
    g.strokeRoundedRect(-290, -200, 580, 400, 18);
    g.fillStyle(THEME.ERROR, 1);
    g.fillRoundedRect(-165, -188, 330, 46, 12);
    g.lineStyle(3, THEME.INK, 1);
    g.strokeRoundedRect(-165, -188, 330, 46, 12);
    panel.add(g);
    panel.add(
      this.add
        .text(0, -165, t('interrupted'), {
          fontFamily: FONT,
          fontSize: '28px',
          color: '#ffffff',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setStroke(INK_HEX, 3),
    );

    // 3/3 — штампуем ошибки прямо на панели (UX-директор №8)
    for (let m = 0; m < this.maxErrorsN; m++) {
      const xg = this.add.graphics();
      xg.lineStyle(6, THEME.ERROR, 1);
      xg.lineBetween(-16, -16, 16, 16);
      xg.lineBetween(-16, 16, 16, -16);
      const slot = this.add.container(-120 + m * 110, -112, [xg]).setScale(0);
      panel.add(slot);
      this.tweens.add({
        targets: slot,
        scale: 1,
        duration: 220,
        delay: 350 + m * 140,
        ease: 'Back.easeOut',
      });
    }

    panel.add(
      this.add
        .text(0, -75, t('interruptedErrors', { e: Math.min(this.errors, this.maxErrorsN), m: MAX_ERRORS }), {
          fontFamily: FONT,
          fontSize: '26px',
          color: INK_HEX,
        })
        .setOrigin(0.5),
    );
    panel.add(
      this.add
        .text(0, -30, t('rewardsLine', { t: this.earnedTokens, x: this.earnedXp }), {
          fontFamily: FONT,
          fontSize: '24px',
          color: INK_HEX,
        })
        .setOrigin(0.5),
    );
    makeButton(this, width / 2, cy + 50, t('newShift'), () => fadeToScene(this, 'Game'), {
      color: THEME.SUCCESS,
      width: 320,
    });
    makeButton(this, width / 2, cy + 145, t('toMenu'), () => this.exitToMenuAfterResults(), {
      secondary: true,
      width: 280,
    });
  }

  private finish(): void {
    const width = DESIGN_W;
    const s = session();
    getPlatform().gameplayStop();
    const clean = this.errors === 0;
    const goalBonus = this.shiftGoal && !this.shiftGoal.broken ? this.shiftGoal.bonus : 0;
    this.finishTokenTotal = this.earnedTokens + (clean ? BALANCE.cleanBonus : 0) + goalBonus;
    this.finishXpTotal = this.earnedXp + (clean ? BALANCE.xpCleanShift : 0);

    s.tokens += this.finishTokenTotal;
    s.xp += this.finishXpTotal;
    s.currentShift = null;
    s.shiftNumber += 1;
    s.ad.shiftsSince += 1; // для «не чаще 1 interstitial на 3 смены» (ГДД разд. 7)

    void getPlatform().submitScore(BOARD_IDS.streak, s.bestStreak);
    if (this.isDaily) {
      void getPlatform().submitScore(BOARD_IDS.daily, dailyScore(this.correct, this.fastCount, this.errors));
    }
    bumpMissions(s, { correct: this.correct, clean, fakes: this.fakesCaught });
    void flushSession();
    this.resultShown = true;

    const rankAfter = rankFor(s.xp);
    const cy = screenCenter().y;
    const title = this.isDaily
      ? t('dailyDone')
      : this.isNight
        ? t('nightDone')
        : t('shiftDone', { n: this.shift });

    this.add
      .rectangle(OVERLAY.x, OVERLAY.y, OVERLAY.width, OVERLAY.height, 0x000000, 0.5)
      .setInteractive();

    // Панель-контейнер: единый pop-in + звёзды чистоты (арт-директор №2, UX №6)
    const panel = this.add.container(width / 2, cy).setScale(0.85).setAlpha(0);
    this.tweens.add({ targets: panel, scale: 1, alpha: 1, duration: 280, ease: 'Back.easeOut' });
    vfx.confettiSalvo(this);

    const g = this.add.graphics();
    drawHardShadow(g, -300, -360, 600, 720, 24);
    g.fillStyle(THEME.PAPER, 1);
    g.fillRoundedRect(-300, -360, 600, 720, 24);
    g.lineStyle(5, THEME.INK, 1);
    g.strokeRoundedRect(-300, -360, 600, 720, 24);
    g.fillStyle(THEME.ACCENT, 1);
    g.fillRoundedRect(-210, -335, 420, 56, 14);
    g.lineStyle(3, THEME.INK, 1);
    g.strokeRoundedRect(-210, -335, 420, 56, 14);
    panel.add(g);
    panel.add(
      this.add
        .text(0, -307, title, {
          fontFamily: FONT,
          fontSize: '28px',
          color: '#ffffff',
          fontStyle: 'bold',
          wordWrap: { width: 400 },
          align: 'center',
        })
        .setOrigin(0.5)
        .setStroke(INK_HEX, 3),
    );
    panel.add(
      this.add
        .text(
          0,
          -230,
          t('doneStats', { c: this.correct, n: this.queue.length, e: Math.min(this.errors, this.maxErrorsN) }),
          {
            fontFamily: FONT,
            fontSize: '26px',
            color: INK_HEX,
          },
        )
        .setOrigin(0.5),
    );
    this.rewardText = this.add
      .text(0, -180, t('rewardsLine', { t: 0, x: this.finishXpTotal }), {
        fontFamily: FONT,
        fontSize: '27px',
        color: INK_HEX,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    panel.add(this.rewardText);
    // Count-up награды: цифры «доплачиваются» на глазах (арт-директор №2)
    const countUp = { v: 0 };
    this.tweens.add({
      targets: countUp,
      v: this.finishTokenTotal,
      duration: 700,
      delay: 250,
      ease: 'Cubic.easeOut',
      onUpdate: () => {
        this.rewardText?.setText(t('rewardsLine', { t: Math.round(countUp.v), x: this.finishXpTotal }));
      },
    });
    if (clean) {
      panel.add(
        this.add
          .text(215, -180, t('bonusChip'), {
            fontFamily: FONT,
            fontSize: '18px',
            color: '#ffffff',
            fontStyle: 'bold',
            backgroundColor: '#3ec46d',
            padding: { x: 8, y: 4 },
          })
          .setOrigin(0.5),
      );
    }
    if (this.isDaily) {
      panel.add(
        this.add
          .text(0, -130, t('dailyScoreLine', { s: dailyScore(this.correct, this.fastCount, this.errors) }), {
            fontFamily: FONT,
            fontSize: '22px',
            color: INK_HEX,
          })
          .setOrigin(0.5),
      );
    }
    if (rankAfter.index > this.rankIndexStart) {
      panel.add(
        this.add
          .text(0, -80, t('newRank', { r: rankAfter.title }), {
            fontFamily: FONT,
            fontSize: '27px',
            color: '#2f9e5f',
            fontStyle: 'bold',
          })
          .setOrigin(0.5),
      );
      // Новое звание — праздник достижений на CrazyGames
      getPlatform().happytime();
    }
    // Звёзды чистоты: 3 при нуле ошибок, 2 при одной, 1 дальше (UX №6)
    const starCount = this.errors === 0 ? 3 : this.errors === 1 ? 2 : 1;
    for (let i = 0; i < 3; i++) {
      const filled = i < starCount;
      const star = this.add
        .circle((i - 1) * 56, -40, 16, filled ? THEME.GOLD : THEME.NICHE)
        .setStrokeStyle(4, THEME.INK, 1);
      star.setScale(0);
      panel.add(star);
      this.tweens.add({
        targets: star,
        scale: 1,
        duration: 240,
        delay: 420 + i * 150,
        ease: 'Back.easeOut',
      });
    }

    // Без строк скор/звание середина панели остаётся пустой — поднимаю блок кнопок
    const extras = (this.isDaily ? 1 : 0) + (rankAfter.index > this.rankIndexStart ? 1 : 0);
    const lift = extras === 0 ? 100 : extras === 1 ? 55 : 0;
    const ads = getPlatform().adsSupported;

    // ×2 жетоны за rewarded (ГДД разд. 7) — один раз, всегда доступно; на itch рекламы нет
    if (ads) {
      this.doubleBtn = makeButton(
        this,
        width / 2,
        cy + 110 - lift,
        t('doubleAd'),
        () => this.applyDoubleReward(),
        { color: THEME.PANEL_DARK, width: 380, fontSize: 26 },
      );
    }
    const nextY = cy + (ads ? 210 : 200) - lift;
    const menuY = cy + (ads ? 305 : 295) - lift;
    makeButton(this, width / 2, nextY, t('nextShift'), () => fadeToScene(this, 'Game'), {
      color: THEME.ACCENT,
      width: 340,
    });
    makeButton(this, width / 2, menuY, t('toMenu'), () => this.exitToMenuAfterResults(), {
      secondary: true,
      width: 280,
    });
  }

  /** ×2 жетонов за rewarded: начисляем вторую половину (ГДД разд. 7). */
  private applyDoubleReward(): void {
    if (this.doubled || !getPlatform().adsSupported) return;
    void this.showRewardedSafe(() => {
      this.doubled = true;
      session().tokens += this.finishTokenTotal;
      void flushSession();
      sfx.coin();
      this.doubleBtn?.destroy();
      this.doubleBtn = null;
      this.rewardText?.setText(t('rewardsLine', { t: this.finishTokenTotal * 2, x: this.finishXpTotal }));
    }).then((r) => {
      // Adblock/unfilled: объясняем, почему удвоения не случилось (кнопка не «пустышка»)
      if (r === 'failed') this.toast(t('toastAdUnavailable'));
    });
  }

  /** Время забега вышло — конец блица/дуэли. */
  private endRun(): void {
    if (this.runEnded) return;
    this.runEnded = true;
    this.busy = true;
    getPlatform().gameplayStop();
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

  /** Профиль в глобальный топ-50 (рейтинги обновлены); без сервера — тихо офлайн. */
  private reportProfile(): void {
    const s = session();
    void reportMyProfile({
      name: getPlayerIdentity().name,
      blitzRating: s.mp.blitzRating,
      duelRating: s.mp.duelRating,
      blitzBest: s.mp.blitzBest,
      duelWins: s.mp.duelWins,
      duelLosses: s.mp.duelLosses,
      duelDraws: s.mp.duelDraws,
    });
  }

  /** Блиц: скор в лидерборды Яндекса (blitzDay/blitzBest), рекорд и рейтинг в сейв. */
  private finishBlitz(score: number): void {
    const s = session();
    const previousBest = s.mp.blitzBest;
    s.mp.blitzRuns += 1;
    s.mp.blitzBest = Math.max(s.mp.blitzBest, score);
    // Новый личный рекорд — праздник достижений на CrazyGames (редкое событие)
    if (score > previousBest) getPlatform().happytime();
    const br = blitzRatingUpdate(s.mp.blitzRating, score);
    s.mp.blitzRating = br.rating;
    this.reportProfile();
    void getPlatform().submitScore(BALANCE.boardIds.blitzDay, score);
    void getPlatform().submitScore(BALANCE.boardIds.blitzBest, s.mp.blitzBest);
    void flushSession();

    const width = DESIGN_W;
    const cy = screenCenter().y;
    this.add
      .rectangle(OVERLAY.x, OVERLAY.y, OVERLAY.width, OVERLAY.height, 0x000000, 0.5)
      .setInteractive();
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
      .text(width / 2, cy - 247, t('blitzDone'), {
        fontFamily: FONT,
        fontSize: '30px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setStroke(INK_HEX, 3);
    this.add
      .text(width / 2, cy - 160, t('runStats', { c: this.correct, e: this.errors }), {
        fontFamily: FONT,
        fontSize: '26px',
        color: INK_HEX,
      })
      .setOrigin(0.5);
    this.add
      .text(width / 2, cy - 100, t('scoreLine', { s: score }), {
        fontFamily: FONT,
        fontSize: '40px',
        color: INK_HEX,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.add
      .text(width / 2, cy - 40, t('bestLine', { s: s.mp.blitzBest }), {
        fontFamily: FONT,
        fontSize: '22px',
        color: INK_HEX,
      })
      .setOrigin(0.5);
    this.add
      .text(width / 2, cy - 8, t('blitzRatingLine', { r: s.mp.blitzRating, d: `${br.delta >= 0 ? '+' : ''}${br.delta}` }), {
        fontFamily: FONT,
        fontSize: '22px',
        color: INK_HEX,
      })
      .setOrigin(0.5);
    makeButton(this, width / 2, cy + 60, t('again'), () => {
      pendingLaunch = { blitz: true };
      fadeToScene(this, 'Game');
    }, { color: THEME.ACCENT, width: 340 });
    makeButton(this, width / 2, cy + 152, t('toMenu'), () => this.exitToMenuAfterResults(), {
      secondary: true,
      width: 280,
    });
  }

  /** Дуэль: отправить свой скор и дождаться итога (план мультиплеера, фаза 2). */
  private finishDuel(score: number): void {
    const width = DESIGN_W;
    const cy = screenCenter().y;
    this.add
      .rectangle(OVERLAY.x, OVERLAY.y, OVERLAY.width, OVERLAY.height, 0x000000, 0.5)
      .setInteractive();
    const waiting = this.add
      .text(width / 2, cy, t('waitingResult'), {
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
        .text(width / 2, cy, t('duelNetError'), {
          fontFamily: FONT,
          fontSize: '26px',
          color: INK_HEX,
          backgroundColor: '#ffffff',
          padding: { x: 16, y: 8 },
        })
        .setOrigin(0.5);
      makeButton(this, width / 2, cy + 90, t('toMenu'), () => fadeToScene(this, 'Menu'), {
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
    const width = DESIGN_W;
    const cy = screenCenter().y;
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
    this.reportProfile();
    // Победа в дуэли — праздник достижений на CrazyGames
    if (finalWinner === 'me') getPlatform().happytime();

    const title = finalWinner === 'me' ? t('win') : finalWinner === 'opponent' ? t('lose') : t('draw');

    this.add
      .rectangle(OVERLAY.x, OVERLAY.y, OVERLAY.width, OVERLAY.height, 0x000000, 0.5)
      .setInteractive();
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
      .text(width / 2, cy - 160, t('duelScore', { s: score, opp: this.duelOpponentName, os: opponentScore }), {
        fontFamily: FONT,
        fontSize: '27px',
        color: INK_HEX,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.add
      .text(width / 2, cy - 100, t('ratingLine', { r: s.mp.duelRating, d: `${delta >= 0 ? '+' : ''}${delta}` }), {
        fontFamily: FONT,
        fontSize: '26px',
        color: INK_HEX,
      })
      .setOrigin(0.5);
    makeButton(this, width / 2, cy + 60, t('toMenu'), () => this.exitToMenuAfterResults(), {
      secondary: true,
      width: 280,
    });
  }
}
