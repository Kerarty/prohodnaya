import Phaser from 'phaser';
import { getPlatform } from '../platform';
import { describeForgery, describeViolation } from '../game/application';
import type { Application, Decision, DocFieldId } from '../game/application';
import { BALANCE, BOARD_IDS, correctReward, dailyScore, nightReward, rankFor } from '../game/economy';
import { generateShift } from '../game/generation';
import { newShiftSeed } from '../game/rng';
import { dateKey, dailySeed } from '../game/save';
import type { Rule } from '../game/rules';
import { commitSession, flushSession, session, sessionRank, sessionToday } from '../game/session';
import {
  drawCharacter,
  guestDeflate,
  guestReact,
  highlightField,
  startBreathing,
} from '../render/characterRenderer';
import { drawBooth } from '../render/booth';
import { bulbWave, confetti, spawnThought } from '../render/juice';
import { PassCard } from '../render/passCard';
import { drawRuleBoard } from '../render/ruleBoard';
import type { RuleBoardView } from '../render/ruleBoard';
import { drawHardShadow, FONT, INK_HEX, THEME } from '../render/theme';
import { sfx } from '../systems/sfx';
import { makeButton } from '../ui/button';

const BOARD_W = 560;
const BOARD_CY = 130;
const GUEST_Y = 370;
const GUEST_SCALE = 0.8;
const CARD_Y = 690;
const BAR_Y = 1010;
const COUNTER_Y = 1050;
const BTN_Y = 1150;
const PATIENCE_MS = BALANCE.patienceMs;
const MAX_ERRORS = BALANCE.maxErrors;

/** Счётчик запусков для смешивания сидов (ГДД разд. 3.3). */
let launchCounter = 0;

export interface SceneLaunchData {
  /** Новая дневная смена — кабинет уже проставил флаг в сейве. */
  daily?: boolean;
  /** Новая ночная смена — кабинет уже проставил флаг в сейве. */
  night?: boolean;
}

/**
 * Кор-сцена «Мульт-поп»: booth-фон, смена по сиду, экономика, стрик,
 * восстановление смены, монетизация (дни 5–6 + арт-апгрейд).
 */
export class GameScene extends Phaser.Scene {
  private queue: Application[] = [];
  private rules: Rule[] = [];
  private shift = 1;
  private seed = 0;
  private isDaily = false;
  private isNight = false;
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
  private patienceEvent: Phaser.Time.TimerEvent | null = null;
  private signBulbs: Phaser.GameObjects.Arc[] = [];
  private boardView: RuleBoardView | null = null;

  constructor() {
    super('Game');
  }

  create(data?: SceneLaunchData): void {
    const { width } = this.scale;
    const s = session();
    this.isDaily = false;
    this.isNight = false;
    this.rankIndexStart = sessionRank().index;
    this.signBulbs = [];

    drawBooth(this, width, 'game');

    if (data?.daily) {
      this.isDaily = true;
      this.shift = s.shiftNumber;
      this.seed = dailySeed(dateKey());
    } else if (data?.night) {
      this.isNight = true;
      this.shift = s.shiftNumber;
      this.seed = newShiftSeed(launchCounter++);
    } else if (s.currentShift) {
      // Продолжение незавершённой смены — та же очередь, та же заявка (ГДД разд. 9)
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
      this.shift = s.shiftNumber;
      this.seed = newShiftSeed(launchCounter++);
    }

    const total = this.isDaily || this.isNight ? BALANCE.dailyApps : undefined;
    const generated = generateShift(
      this.seed,
      this.shift,
      s.currentShift && !data?.daily ? s.currentShift.today : sessionToday(),
      total,
    );
    this.queue = generated.apps;
    this.rules = generated.rules;
    this.index = Math.min(this.index, this.queue.length - 1);
    console.info(
      `[shift] ${this.isDaily ? 'дневная' : this.isNight ? 'ночная' : `смена ${this.shift}`}, сид ${this.seed}, заявок ${this.queue.length}`,
    );

    if (s.tools.detector) this.detectorCharges = BALANCE.detectorFreeCharges;

    if (!s.currentShift) {
      this.trackProgress();
      void flushSession();
    }

    this.boardView = drawRuleBoard(this, this.rules, width / 2, BOARD_CY, BOARD_W);
    this.boardView.pulse();

    this.patienceBar = this.add
      .rectangle(40, BAR_Y, width - 80, 8, THEME.PANEL_DARK)
      .setOrigin(0, 0.5);
    const barFrame = this.add.graphics();
    barFrame.lineStyle(3, THEME.INK, 0.6);
    barFrame.strokeRoundedRect(34, BAR_Y - 9, width - 68, 18, 9);

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

    if (s.tools.detector) this.createDetectorButton(width);

    this.showApplication();
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

  private createDetectorButton(width: number): void {
    this.detectorBtn?.destroy();
    const label =
      this.detectorCharges > 0
        ? `Детектор (${this.detectorCharges})`
        : this.detectorAdUses < BALANCE.detectorAdCharges
          ? 'Детектор +AD'
          : 'Детектор —';
    this.detectorBtn = makeButton(this, width - 125, COUNTER_Y, label, () => this.useDetector(), {
      secondary: true,
      width: 210,
      height: 64,
      fontSize: 20,
    });
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

  private updateCounter(): void {
    const label = this.isDaily ? 'Дневная смена' : this.isNight ? 'Ночная смена' : `Смена ${this.shift}`;
    this.counter?.setText(
      `${label} · Заявка ${this.index + 1}/${this.queue.length} · Ошибки: ${this.errors}/${MAX_ERRORS}`,
    );
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
        this.setButtonsEnabled(true);
        this.decisionStart = Date.now();
        this.startPatience();
        if (this.guest) startBreathing(this.guest, GUEST_SCALE);
      },
    });
  }

  /** Терпение (ГДД разд. 2): гость уходит сам, ошибка не начисляется; у последней заявки ∞. */
  private startPatience(): void {
    this.stopPatience();
    if (!this.patienceBar) return;
    if (this.index >= this.queue.length - 1) {
      this.patienceBar.setVisible(false);
      return;
    }
    this.patienceBar.setVisible(true);
    this.patienceBar.scaleX = 1;
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
    const app = this.queue[this.index];
    const fast = Date.now() - this.decisionStart <= BALANCE.speedBonusMs;
    const ok = decision === app.expected;
    this.stopPatience();
    this.setButtonsEnabled(false);
    this.card?.showStamp(ok);
    sfx.stamp();

    if (ok) {
      const base = correctReward(fast);
      const reward = this.isNight ? nightReward(base) : base;
      this.correct += 1;
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
      session().currentStreak = 0;
      if (this.guest) {
        guestReact(this.guest, 'reject');
        guestDeflate(this.guest);
      }
      this.trackProgress();
      this.time.delayedCall(300, () => {
        this.flash(THEME.ERROR);
        sfx.fail();
      });
      this.time.delayedCall(700, () => this.showMistake(app));
    }
  }

  /** Прогресс смены после каждой закрытой заявки — облачный сейв с троттлингом (ГДД разд. 6). */
  private trackProgress(): void {
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
    if (this.index >= this.queue.length) {
      this.finish();
    } else {
      this.showApplication();
    }
  }

  /** Вспышка вердикта — 0.12 на светлом фоне (спека §5, исправление). */
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
    const panel = this.add.container(width / 2, height / 2);
    const g = this.add.graphics();
    drawHardShadow(g, -290, -170, 580, 340, 18);
    g.fillStyle(THEME.PAPER, 1);
    g.fillRoundedRect(-290, -170, 580, 340, 18);
    g.lineStyle(5, THEME.INK, 1);
    g.strokeRoundedRect(-290, -170, 580, 340, 18);
    g.fillStyle(THEME.ACCENT, 1);
    g.fillRoundedRect(-130, -158, 260, 46, 12);
    g.lineStyle(3, THEME.INK, 1);
    g.strokeRoundedRect(-130, -158, 260, 46, 12);
    panel.add(g);
    panel.add(
      this.add
        .text(0, -135, title, { fontFamily: FONT, fontSize: '30px', color: '#ffffff', fontStyle: 'bold' })
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

    const limitReached = counted && this.errors >= MAX_ERRORS && !this.isNight;
    if (limitReached && !this.forgivenThisShift) {
      // Прощение ошибки за rewarded: ошибка аннулируется, смена продолжается (ГДД разд. 7)
      panel.add(
        makeButton(this, 0, 60, 'Продолжить за рекламу', () => this.forgive(info, dim, panel), {
          color: THEME.SUCCESS,
          width: 380,
          fontSize: 26,
        }),
      );
      panel.add(
        makeButton(
          this,
          0,
          160,
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
      .text(width / 2, cy - 80, `Допущено ошибок: ${this.errors} из ${MAX_ERRORS}`, {
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
    makeButton(this, width / 2, cy + 60, 'Новая смена', () => this.scene.restart(), {
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
    if (!this.isDaily && !this.isNight) s.shiftNumber += 1;

    if (this.isDaily) {
      void getPlatform().submitScore(BOARD_IDS.daily, dailyScore(this.correct, this.fastCount, this.errors));
    }
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
      .text(width / 2, cy - 230, `Верно: ${this.correct} из ${this.queue.length} · ошибок: ${this.errors}`, {
        fontFamily: FONT,
        fontSize: '26px',
        color: INK_HEX,
      })
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

    // ×2 жетоны за rewarded (ГДД разд. 7) — один раз, всегда доступно
    this.doubleBtn = makeButton(
      this,
      width / 2,
      cy + 110,
      '×2 жетоны за рекламу',
      () => this.applyDoubleReward(),
      { color: THEME.PANEL_DARK, width: 380, fontSize: 26 },
    );
    makeButton(this, width / 2, cy + 215, 'Следующая смена', () => this.scene.restart(), {
      color: THEME.ACCENT,
      width: 340,
    });
    makeButton(this, width / 2, cy + 305, 'В меню', () => this.scene.start('Menu'), {
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
}
