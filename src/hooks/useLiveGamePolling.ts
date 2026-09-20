import { useEffect } from 'react';
import type { NFLGame } from '../types';

// Middle of a "60-90s, whatever's efficient and doesn't cause lag" ask (see
// chat, Sept 2026). This only re-reads real_games from our own Supabase
// table -- it never calls The Odds API or balldontlie directly (those run on
// their own fixed server-side cron schedules regardless of how often a
// client polls), so it costs neither API budget anything. Polling faster
// than balldontlie's own 15-minute sync wouldn't get fresher data anyway.
const POLL_INTERVAL_MS = 75_000;

/** Keeps whatever real games are on screen fresh while any of them are
 * actually in progress, so a game that goes final mid-viewing clears on its
 * own instead of sitting there showing "Live" until the user force-quits and
 * reopens the app (see chat, Sept 2026 -- there's no live polling anywhere
 * in this app; a game's status only ever loaded once, on mount/week-change).
 *
 * `key` is a stable identity for whatever's being watched (a week number, a
 * single game id) -- NOT the same thing as "is anything live right now".
 * It's what the effect actually depends on for restarting the interval with
 * a fresh closure: if you switch from a week/game that's live straight to a
 * DIFFERENT week/game that's also live, `stillLive` alone never flips
 * false->true so the effect wouldn't otherwise re-run, and `refetch` would
 * keep firing against the stale, closed-over first one.
 *
 * Deliberately scoped to "only while something's actually live" rather than
 * always-on: once everything on screen is either still upcoming or already
 * final, nothing is going to change without a fresh kickoff or the next
 * stat cycle, so there's no point spending a request every ~75s in the
 * background (battery/lag consideration, not just API budget). */
export function useLiveGamePolling(stillLive: boolean, key: string | number, refetch: () => void): void {
  useEffect(() => {
    if (!stillLive) return;
    const id = setInterval(refetch, POLL_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stillLive, key]);
}

/** Convenience for the common case: "is any game in this list live right
 * now". */
export function anyGameLive(games: NFLGame[]): boolean {
  return games.some((g) => g.status === 'live');
}
