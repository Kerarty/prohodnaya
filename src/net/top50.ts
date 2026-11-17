/**
 * Клиент глобального топ-50: профили игроков держит сигналинг-сервер
 * (server/p2p-signal.mjs, тот же, что ?peer=). Без сервера — офлайн:
 * панель честно показывает «недоступен» и локальные данные никто не теряет.
 *
 * Рейтинги — самоотчёт клиента: против накрутки защита только совестью
 * (для портфолио достаточно; на Яндексе параллельно есть лидерборды платформы).
 */

import { peerServerConfig } from './p2p';

export interface Top50Entry {
  name: string;
  blitzRating: number;
  duelRating: number;
  blitzBest: number;
  duelWins: number;
  duelLosses: number;
  duelDraws: number;
  ts: number;
}

export interface Top50Data {
  blitz: Top50Entry[];
  duels: Top50Entry[];
}

/** База топ-50 = сигналинг-сервер из ?peer=; без параметра — недоступен. */
function top50BaseUrl(): string | null {
  const cfg = peerServerConfig();
  if (!cfg) return null;
  return `http${cfg.secure ? 's' : ''}://${cfg.host}:${cfg.port}`;
}

/** Отчёт своего профиля (после забега блица / дуэли). null — сервер недоступен. */
export async function reportMyProfile(profile: {
  name: string;
  blitzRating: number;
  duelRating: number;
  blitzBest: number;
  duelWins: number;
  duelLosses: number;
  duelDraws: number;
}): Promise<boolean> {
  const base = top50BaseUrl();
  if (!base) return false;
  try {
    const res = await fetch(`${base}/top50/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Таблицы топ-50. null — сервер недоступен. */
export async function fetchTop50(): Promise<Top50Data | null> {
  const base = top50BaseUrl();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/top50`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Top50Data;
    if (!Array.isArray(data.blitz) || !Array.isArray(data.duels)) return null;
    return data;
  } catch {
    return null;
  }
}
