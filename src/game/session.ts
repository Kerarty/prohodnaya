import type { PlatformAPI } from '../platform';
import { rankFor } from './economy';
import { defaultSave, epochDays, normalizeSave, toPlatformSave } from './save';
import type { SaveDataV1 } from './save';

let platform: PlatformAPI | null = null;
let data: SaveDataV1 | null = null;
let lastFlush = 0;

const FLUSH_INTERVAL_MS = 10_000; // троттлинг setData (лимиты Яндекса, ГДД разд. 6)

export function initSession(p: PlatformAPI): void {
  platform = p;
}

/** Полный сброс сессии (тесты, будущий выход из аккаунта). */
export function resetSession(): void {
  platform = null;
  data = null;
  lastFlush = 0;
}

export async function loadSession(): Promise<void> {
  if (!platform) throw new Error('initSession() должен быть вызван до loadSession()');
  const raw = await platform.load();
  data = normalizeSave(raw, epochDays());
  lastFlush = 0; // свежая сессия: первый прогресс уходит в сейв без задержки
}

/** Мутируемое состояние меты — изменения сохраняются через commitSession/flushSession. */
export function session(): SaveDataV1 {
  if (!data) throw new Error('loadSession() не выполнен');
  return data;
}

/** Игровой день от первого запуска (ГДД разд. 3.1). */
export function sessionToday(): number {
  return epochDays() - session().todayBase + 1;
}

/** Сброс прогресса до дефолтов (настройки) с немедленным сохранением. */
export function resetProgress(): void {
  if (!data) return;
  const fresh = defaultSave(epochDays());
  Object.assign(data, fresh);
  void flushSession();
}

export function sessionRank(): { index: number; title: string; nextXp: number | null } {
  return rankFor(session().xp);
}

/** Сохранение с троттлингом: вызывается после каждой закрытой заявки. */
export function commitSession(): void {
  if (!platform || !data) return;
  const now = Date.now();
  if (now - lastFlush < FLUSH_INTERVAL_MS) return;
  lastFlush = now;
  void platform.save(toPlatformSave(data)).catch(() => {});
}

/** Принудительное сохранение: итоги смены, покупки, прерывание, pagehide. */
export function flushSession(): Promise<void> {
  if (!platform || !data) return Promise.resolve();
  lastFlush = Date.now();
  return platform.save(toPlatformSave(data));
}
