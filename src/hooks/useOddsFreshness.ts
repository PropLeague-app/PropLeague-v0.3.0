import { useMemo } from 'react';
import type { NFLGame } from '../types';

/** How long a manual player-props refresh is allowed to go stale before the
 * UI warns about it (see chat, Sept 2026: "Odds have not been refreshed in
 * N hours" on MarketBrowser/NFLSlate). Picked from the low end of the
 * suggested 12-24 hour range since these are live betting lines, not
 * something safe to default to letting drift a full day -- easy to retune. */
const STALE_THRESHOLD_HOURS = 12;

export interface OddsFreshness {
  /** True once it's been more than STALE_THRESHOLD_HOURS since the freshest
      props refresh among the games passed in -- or immediately, if at least
      one of them has never been refreshed at all. False when there's simply
      nothing relevant to judge (no upcoming games with odds loaded yet). */
  stale: boolean;
  /** Hours since the most recent refresh, rounded down -- null when none of
      the games passed in has ever had its props manually refreshed
      (propsUpdatedAt is null for a game created before this tracking
      existed, or a brand-new game nobody has pressed Refresh Odds for yet). */
  hoursSinceRefresh: number | null;
}

/** Derives a staleness signal for the "Refresh Odds" warning from whatever
 * real games are currently loaded, using each game's `propsUpdatedAt` --
 * deliberately NOT `updated_at`, which fetch-nfl-odds's automatic hourly
 * cron also bumps for game-level lines (h2h/spreads/totals) even though it
 * leaves player-prop markets untouched. Using updated_at here would make
 * every game look freshly-refreshed within the hour no matter how stale its
 * props actually are (see 0009_props_updated_at.sql). */
export function useOddsFreshness(games: NFLGame[]): OddsFreshness {
  return useMemo(() => {
    const relevant = games.filter((g) => g.status === 'upcoming' && g.bookmakers.length > 0);
    if (relevant.length === 0) return { stale: false, hoursSinceRefresh: null };

    const timestamps = relevant
      .map((g) => g.propsUpdatedAt)
      .filter((ts): ts is string => !!ts)
      .map((ts) => new Date(ts).getTime());
    if (timestamps.length === 0) return { stale: true, hoursSinceRefresh: null };

    const mostRecentMs = Math.max(...timestamps);
    const hoursSinceRefresh = Math.floor((Date.now() - mostRecentMs) / (60 * 60 * 1000));
    return { stale: hoursSinceRefresh >= STALE_THRESHOLD_HOURS, hoursSinceRefresh };
  }, [games]);
}

/** Renders the freshness signal as the exact warning copy requested (see
 * chat) -- null when nothing should be shown, so callers can do
 * `{message && <p>...}` without their own null-handling branch. */
export function oddsFreshnessMessage(freshness: OddsFreshness): string | null {
  if (!freshness.stale) return null;
  if (freshness.hoursSinceRefresh == null) return 'Odds have not been manually refreshed yet.';
  const h = freshness.hoursSinceRefresh;
  return `Odds have not been refreshed in ${h} hour${h === 1 ? '' : 's'}.`;
}
