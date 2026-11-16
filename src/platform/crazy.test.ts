import { describe, expect, it } from 'vitest';
import { CrazyPlatform } from './crazy';

/** Фейк SDK.data/ad: проверяет контракт, который обещает CrazyPlatform. */
function makeFakeSdk(options: { adError?: boolean } = {}) {
  const store = new Map<string, string>();
  const calls: string[] = [];
  const sdk = {
    game: {
      loadingStart: () => calls.push('loadingStart'),
      loadingComplete: () => calls.push('loadingComplete'),
      gameplayStart: () => calls.push('gameplayStart'),
      gameplayStop: () => calls.push('gameplayStop'),
    },
    ad: {
      requestAd: (type: 'midgame' | 'rewarded', cb: { adFinished?(): void; adError?(): void }) => {
        calls.push(`ad:${type}`);
        if (options.adError) cb.adError?.();
        else cb.adFinished?.();
      },
    },
    data: {
      setItem: (k: string, v: string) => void store.set(k, v),
      getItem: (k: string) => store.get(k) ?? null,
    },
  };
  return { sdk, store, calls };
}

function platformWith(sdk: ReturnType<typeof makeFakeSdk>['sdk']): CrazyPlatform {
  const p = new CrazyPlatform();
  (p as unknown as { sdk: unknown }).sdk = sdk;
  return p;
}

describe('CrazyPlatform', () => {
  it('сейвы идут через Data Module и читаются обратно', async () => {
    const fake = makeFakeSdk();
    const p = platformWith(fake.sdk);
    await p.save({ version: 1, tokens: 42 } as never);
    expect(fake.store.get('save')).toContain('"tokens":42');
    const loaded = await p.load();
    expect(loaded).toMatchObject({ tokens: 42 });
  });

  it('rewarded: награда выдаётся только в adFinished', async () => {
    const ok = platformWith(makeFakeSdk().sdk);
    let rewarded = 0;
    const shown = await ok.showRewarded(() => {
      rewarded += 1;
    });
    expect(shown).toBe('shown');
    expect(rewarded).toBe(1);

    const err = platformWith(makeFakeSdk({ adError: true }).sdk);
    let rewarded2 = 0;
    const failed = await err.showRewarded(() => {
      rewarded2 += 1;
    });
    expect(failed).toBe('failed');
    expect(rewarded2).toBe(0); // adError — награды нет (требование платформы)
  });

  it('interstitial завершается и в adFinished, и в adError (unfilled не блокирует игру)', async () => {
    const ok = platformWith(makeFakeSdk().sdk);
    await expect(ok.showInterstitial()).resolves.toBeUndefined();
    const err = platformWith(makeFakeSdk({ adError: true }).sdk);
    await expect(err.showInterstitial()).resolves.toBeUndefined();
  });

  it('без SDK методы безопасно деградируют', async () => {
    const p = new CrazyPlatform(); // sdk = null (init не вызван)
    await expect(p.save({ version: 1 } as never)).resolves.toBeUndefined();
    await expect(p.load()).resolves.toBeFalsy();
    await expect(p.showInterstitial()).resolves.toBeUndefined();
    const r = await p.showRewarded(() => {});
    expect(r).toBe('failed');
    expect(() => p.gameplayStart()).not.toThrow();
    expect(() => p.ready()).not.toThrow();
  });
});
