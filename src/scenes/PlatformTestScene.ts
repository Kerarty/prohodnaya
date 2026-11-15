import Phaser from 'phaser';
import { getPlatform } from '../platform';
import { FONT, INK_HEX } from '../render/theme';
import { makeButton } from '../ui/button';

/**
 * День 1: ручная проверка интеграции платформы прямо в черновике Яндекса
 * (сейв туда-обратно, rewarded, interstitial, язык, debug-индикатор IT/IF внизу слева).
 * Сцена-однодневка — уйдёт, когда появятся реальные сцены.
 */
export class PlatformTestScene extends Phaser.Scene {
  constructor() {
    super('PlatformTest');
  }

  create(): void {
    const { width } = this.scale;
    const api = getPlatform();

    const lines: string[] = [`Платформа: ${api.name}`, `Язык: ${api.getLang()}`];
    const status = this.add
      .text(width / 2, 240, lines.join('\n'), {
        fontFamily: FONT,
        fontSize: '26px',
        color: INK_HEX,
        align: 'center',
      })
      .setOrigin(0.5);

    const log = (line: string): void => {
      lines.push(line);
      status.setText(lines.join('\n'));
    };

    // Круговой тест сейва: write -> read -> сравнение
    void (async () => {
      const stamp = { version: 1, ts: Date.now() };
      await api.save(stamp);
      const loaded = await api.load();
      log(
        loaded && loaded.ts === stamp.ts
          ? `Сейв: OK (${new Date(stamp.ts).toLocaleTimeString()})`
          : 'Сейв: НЕ ПРОШЁЛ',
      );
    })();

    makeButton(this, width / 2, 620, 'Rewarded-видео', () => {
      void api.showRewarded(() => log('Rewarded: награда выдана')).then((r) =>
        log(`Rewarded: ${r}`),
      );
    }, { secondary: true });

    makeButton(this, width / 2, 740, 'Interstitial', () => {
      void api.showInterstitial().then(() => log('Interstitial: показан'));
    }, { secondary: true });

    makeButton(this, width / 2, 860, 'Сброс сейва', () => {
      void api.save({ version: 1, ts: 0 }).then(() => log('Сейв: сброшен'));
    }, { secondary: true });

    makeButton(this, width / 2, 1020, 'НАЗАД', () => this.scene.start('Menu'), {
      secondary: true,
    });
  }
}
