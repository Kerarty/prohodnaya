import Phaser from 'phaser';
import { BALANCE } from '../game/economy';
import { dateKey } from '../game/save';
import { flushSession, session, sessionRank, sessionToday } from '../game/session';
import { drawBooth } from '../render/booth';
import { bulbWave } from '../render/juice';
import { FONT, INK_HEX, THEME } from '../render/theme';
import { makeButton } from '../ui/button';

/**
 * Кабинет «Мульт-поп» (ГДД разд. 5–6): вывеска-логотип с лампочками, звание,
 * полосатый XP-бар, жетоны, покупки, дневная/ночная смены. Смены безлимитны.
 */
export class MenuScene extends Phaser.Scene {
  private bulbs: Phaser.GameObjects.Arc[] = [];

  constructor() {
    super('Menu');
  }

  create(): void {
    const { width } = this.scale;
    const s = session();
    const rank = sessionRank();
    this.bulbs = [];

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
      .text(width / 2, 268, rank.title, {
        fontFamily: FONT,
        fontSize: '30px',
        color: INK_HEX,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const barW = 420;
    const barX = width / 2 - barW / 2;
    const barY = 296;
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
        .text(width / 2, 338, `${s.xp} XP · до «${BALANCE.ranks[rank.index + 1].title}» ${rank.nextXp - s.xp} XP`, {
          fontFamily: FONT,
          fontSize: '20px',
          color: INK_HEX,
        })
        .setOrigin(0.5);
    } else {
      this.add
        .text(width / 2, 338, `${s.xp} XP · максимальное звание`, {
          fontFamily: FONT,
          fontSize: '20px',
          color: INK_HEX,
        })
        .setOrigin(0.5);
    }

    // Жетоны: иконка-монета с бликом + число
    const tokens = this.add
      .text(width / 2 + 34, 404, `${s.tokens}`, {
        fontFamily: FONT,
        fontSize: '44px',
        color: INK_HEX,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    const coin = this.add.graphics();
    coin.setPosition(width / 2 + 8 - tokens.width / 2, 404);
    coin.fillStyle(THEME.GOLD, 1);
    coin.fillCircle(0, 0, 22);
    coin.lineStyle(4, THEME.INK, 1);
    coin.strokeCircle(0, 0, 22);
    coin.lineStyle(3, THEME.INK, 0.3);
    coin.strokeCircle(0, 0, 15);
    coin.fillStyle(0xffffff, 0.5);
    coin.fillCircle(-7, -8, 5);

    this.add
      .text(width / 2, 452, `День ${sessionToday()} · лучшая серия: ${s.bestStreak}`, {
        fontFamily: FONT,
        fontSize: '20px',
        color: INK_HEX,
      })
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

    const rows: Array<{ y: number; alpha: number; make: () => Phaser.GameObjects.Container }> = [
      {
        y: 510,
        alpha: 1,
        make: () =>
          makeButton(this, width / 2, 510, shiftLabel, () => this.scene.start('Game'), {
            color: THEME.ACCENT,
            width: 380,
          }),
      },
      {
        y: 622,
        alpha: !unlocked || dailyPlayed ? 0.55 : 1,
        make: () =>
          makeButton(
            this,
            width / 2,
            622,
            !unlocked
              ? 'Дневная смена (со звания Дежурный)'
              : dailyPlayed
                ? 'Дневная смена (завтра)'
                : 'Дневная смена',
            () => this.startDaily(),
            { secondary: true, width: 380, fontSize: 20 },
          ),
      },
      {
        y: 734,
        alpha: !unlocked || nightPlayed ? 0.55 : 1,
        make: () =>
          makeButton(
            this,
            width / 2,
            734,
            !unlocked
              ? 'Ночная смена (со звания Дежурный)'
              : nightPlayed
                ? 'Ночная смена (завтра)'
                : 'Ночная смена ×1.5',
            () => this.startNight(),
            { secondary: true, width: 380, fontSize: 20 },
          ),
      },
      {
        y: 846,
        alpha: s.tools.lens || s.tokens < BALANCE.lensPrice ? 0.55 : 1,
        make: () =>
          makeButton(
            this,
            width / 2,
            846,
            s.tools.lens ? 'Лупа ✓' : `Лупа — ${BALANCE.lensPrice}`,
            () => this.buy('lens'),
            { secondary: true, width: 380, fontSize: 24 },
          ),
      },
      {
        y: 958,
        alpha: s.tools.detector || s.tokens < BALANCE.detectorPrice ? 0.55 : 1,
        make: () =>
          makeButton(
            this,
            width / 2,
            958,
            s.tools.detector ? 'Детектор ✓' : `Детектор — ${BALANCE.detectorPrice}`,
            () => this.buy('detector'),
            { secondary: true, width: 380, fontSize: 24 },
          ),
      },
      {
        y: 1064,
        alpha: 1,
        make: () =>
          makeButton(this, width / 2, 1064, 'Тест платформы', () => this.scene.start('PlatformTest'), {
            secondary: true,
            width: 280,
            fontSize: 24,
          }),
      },
    ];

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
}
