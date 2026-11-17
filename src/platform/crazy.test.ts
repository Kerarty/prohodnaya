import { describe, expect, it } from 'vitest';
import { CrazyPlatform } from './crazy';

/** Фейк SDK.data/ad/game: проверяет контракт, который обещает CrazyPlatform. */
function makeFakeSdk(
  options: { adError?: boolean; legacyLoading?: boolean; user?: { username?: string } | null } = {},
) {
  const store = new Map<string, string>();
  const calls: string[] = [];
  const sdk = {
    environment: 'local',
    user: {
      systemInfo: undefined as { locale?: string } | undefined,
      // user === null — гость (getUser вернёт null); undefined — дефолтный демо-юзер
      getUser: () => Promise.resolve(options.user === undefined ? { username: 'SingingCheese.TLNU' } : options.user),
    },
    game: {
      loadingStart: () => calls.push('loadingStart'),
      // SDK v3; в legacy-режиме имитируем старый SDK без loadingStop
      ...(options.legacyLoading
        ? {}
        : { loadingStop: () => calls.push('loadingStop') }),
      loadingComplete: () => calls.push('loadingComplete'),
      gameplayStart: () => calls.push('gameplayStart'),
      gameplayStop: () => calls.push('gameplayStop'),
      happytime: () => calls.push('happytime'),
      updateRoom: (room: Record<string, unknown>) => calls.push(`updateRoom:${JSON.stringify(room)}`),
      leftRoom: () => calls.push('leftRoom'),
    },
    ad: {
      // Успех = реальные показы: сначала adStarted (реклама пошла), затем adFinished.
      // adError имитирует unfilled/adblock — стартовое событие не приходит вовсе.
      requestAd: (
        type: 'midgame' | 'rewarded',
        cb: { adStarted?(): void; adFinished?(): void; adError?(): void },
      ) => {
        calls.push(`ad:${type}`);
        if (options.adError) {
          cb.adError?.();
        } else {
          cb.adStarted?.();
          cb.adFinished?.();
        }
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

  it('onAdStart — только когда реклама реально началась (требование CG)', async () => {
    // Успех: adStarted → звук глушится ровно один раз
    const ok = platformWith(makeFakeSdk().sdk);
    let muted = 0;
    await ok.showRewarded(() => {}, () => {
      muted += 1;
    });
    expect(muted).toBe(1);

    // adError (unfilled/adblock): стартового события нет — звук не трогаем
    const err = platformWith(makeFakeSdk({ adError: true }).sdk);
    let muted2 = 0;
    const result = await err.showRewarded(() => {}, () => {
      muted2 += 1;
    });
    expect(result).toBe('failed');
    expect(muted2).toBe(0);

    // midgame — та же семантика
    const mid = platformWith(makeFakeSdk().sdk);
    let muted3 = 0;
    await mid.showInterstitial(() => {
      muted3 += 1;
    });
    expect(muted3).toBe(1);
    const midErr = platformWith(makeFakeSdk({ adError: true }).sdk);
    let muted4 = 0;
    await midErr.showInterstitial(() => {
      muted4 += 1;
    });
    expect(muted4).toBe(0);
  });

  it('interstitial завершается и в adFinished, и в adError (unfilled не блокирует игру)', async () => {
    const ok = platformWith(makeFakeSdk().sdk);
    await expect(ok.showInterstitial()).resolves.toBeUndefined();
    const err = platformWith(makeFakeSdk({ adError: true }).sdk);
    await expect(err.showInterstitial()).resolves.toBeUndefined();
  });

  it('Room Data: updateRoom/leftRoom пробрасываются в SDK', () => {
    const fake = makeFakeSdk();
    const p = platformWith(fake.sdk);
    p.updateRoom({ roomId: 'm-1', isJoinable: true, inviteParams: { duel: 'AB12' } });
    p.leftRoom();
    expect(fake.calls).toContain(`updateRoom:${JSON.stringify({ roomId: 'm-1', isJoinable: true, inviteParams: { duel: 'AB12' } })}`);
    expect(fake.calls).toContain('leftRoom');
  });

  it('getUserName: username из user.getUser, у гостей — null', async () => {
    const fake = makeFakeSdk();
    const p = platformWith(fake.sdk);
    await (p as unknown as { loadUserName(): Promise<void> }).loadUserName();
    expect(p.getUserName()).toBe('SingingCheese.TLNU');

    const guest = platformWith(makeFakeSdk({ user: null }).sdk);
    await (guest as unknown as { loadUserName(): Promise<void> }).loadUserName();
    expect(guest.getUserName()).toBeNull();
  });

  it('без SDK методы безопасно деградируют', async () => {
    const p = new CrazyPlatform(); // sdk = null (init не вызван)
    await expect(p.save({ version: 1 } as never)).resolves.toBeUndefined();
    await expect(p.load()).resolves.toBeFalsy();
    await expect(p.showInterstitial()).resolves.toBeUndefined();
    const r = await p.showRewarded(() => {});
    expect(r).toBe('failed');
    expect(() => p.gameplayStart()).not.toThrow();
    expect(() => p.happytime()).not.toThrow();
    expect(() => p.ready()).not.toThrow();
    expect(() => p.updateRoom({ isJoinable: true })).not.toThrow();
    expect(() => p.leftRoom()).not.toThrow();
    expect(p.getUserName()).toBeNull();
  });

  it('ready(): SDK v3 — loadingStop, легаси — фолбэк на loadingComplete', () => {
    const fakeV3 = makeFakeSdk();
    platformWith(fakeV3.sdk).ready();
    expect(fakeV3.calls).toContain('loadingStop');
    expect(fakeV3.calls).not.toContain('loadingComplete');

    const fakeLegacy = makeFakeSdk({ legacyLoading: true });
    platformWith(fakeLegacy.sdk).ready();
    expect(fakeLegacy.calls).toContain('loadingComplete');
    expect(fakeLegacy.calls).not.toContain('loadingStop');
  });

  it('happytime проходит в SDK', () => {
    const fake = makeFakeSdk();
    platformWith(fake.sdk).happytime();
    expect(fake.calls).toContain('happytime');
  });

  it('getLang: локаль из user.systemInfo (v3), фолбэк на navigator', () => {
    const fake = makeFakeSdk();
    fake.sdk.user = { systemInfo: { locale: 'de-DE' }, getUser: () => Promise.resolve(null) };
    expect(platformWith(fake.sdk).getLang()).toBe('de');
    // без systemInfo — браузерная локаль (в тестовом env navigator.language = 'en-US')
    const bare = makeFakeSdk();
    bare.sdk.user = { systemInfo: undefined, getUser: () => Promise.resolve(null) };
    expect(['en', 'ru']).toContain(platformWith(bare.sdk).getLang());
  });
});
