// Game-level odds handling for fetch-nfl-odds. Pure, so it is unit tested from
// src/engine/__tests__/server/gameOdds.test.ts.

export interface StoredOutcome {
  name: string;
  price: number;
  point?: number;
  link?: string;
}
export type BookmakerRow = { key: string; title: string; markets: { key: string; outcomes: StoredOutcome[] }[] };

export const GAME_LEVEL_KEYS = new Set(['h2h', 'spreads', 'totals']);

// This function only ever fetches game-level markets (h2h/spreads/totals).
// fetch-nfl-player-props is what adds player-prop markets to the same
// bookmakers column. A plain upsert would overwrite the whole `bookmakers`
// value with ONLY game-level data, silently destroying any player props already
// stored there. Merging by bookmaker key, keeping any non-game-level markets
// already present, is what prevents that.
export function mergeBookmakers(existing: BookmakerRow[], fresh: BookmakerRow[]): BookmakerRow[] {
  const existingByKey = new Map(existing.map((b) => [b.key, b]));
  const freshByKey = new Map(fresh.map((b) => [b.key, b]));
  const allKeys = new Set([...existingByKey.keys(), ...freshByKey.keys()]);

  const merged: BookmakerRow[] = [];
  for (const key of allKeys) {
    const existingBookmaker = existingByKey.get(key);
    const freshBookmaker = freshByKey.get(key);
    const preservedPropMarkets = (existingBookmaker?.markets ?? []).filter((m) => !GAME_LEVEL_KEYS.has(m.key));
    const freshGameLevelMarkets = (freshBookmaker?.markets ?? []).filter((m) => GAME_LEVEL_KEYS.has(m.key));
    merged.push({
      key,
      title: freshBookmaker?.title ?? existingBookmaker?.title ?? key,
      markets: [...freshGameLevelMarkets, ...preservedPropMarkets],
    });
  }
  return merged;
}

/** True once a game has started: its kickoff has passed, or another feed has already moved it off
 * 'upcoming'. Either signal alone is enough. */
export function hasKickedOff(kickoffIso: string, storedStatus: string | null | undefined, nowMs: number): boolean {
  const kickoff = Date.parse(kickoffIso);
  if (Number.isFinite(kickoff) && kickoff <= nowMs) return true;
  return storedStatus === 'live' || storedStatus === 'final';
}

/**
 * The bookmakers value to write for one game on this run.
 *
 * The Odds API's /odds feed keeps listing a game after kickoff with in-play prices. Merging those
 * would replace the closing line with a live one (Week 7 NE@CHI stored CHI at -427). So once a game
 * has kicked off, its stored bookmakers are frozen as they were before kickoff. A game first seen
 * after kickoff has no pre-game line to keep and gets none, rather than an in-play one.
 *
 * Games stored before this guard (Oct 2026) may already carry in-play numbers. That is known and
 * was not backfilled.
 */
export function bookmakersForRun(
  existing: BookmakerRow[] | undefined,
  fresh: BookmakerRow[],
  kickedOff: boolean,
): BookmakerRow[] {
  if (kickedOff) return existing ?? [];
  return mergeBookmakers(existing ?? [], fresh);
}
