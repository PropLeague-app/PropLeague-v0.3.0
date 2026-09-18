import { useState } from 'react';
import { refreshPlayerProps } from '../services/supabaseOdds';

/** The edge function's per-game error is `${status} ${rawResponseBody}` -- often
 * a full JSON error body from The Odds API repeated once per failed game (see
 * chat: "This is A LOT of text"). Reduces that to "404: Event not found" or
 * similar -- enough to know what happened without dumping the whole response. */
function summarizeOddsError(raw: string): string {
  const spaceIdx = raw.indexOf(' ');
  const status = spaceIdx === -1 ? raw : raw.slice(0, spaceIdx);
  const body = spaceIdx === -1 ? '' : raw.slice(spaceIdx + 1);
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.message === 'string') {
      return `${status}: ${parsed.message.split('.')[0]}`;
    }
  } catch {
    // Not JSON -- fall through to a truncated raw snippet below.
  }
  return `${status}: ${body.slice(0, 60)}`;
}

/** Most batches that have any failures at all fail for the SAME reason (e.g. a
 * handful of far-out games whose event ids haven't stabilized yet) -- listing
 * that reason once instead of once per game is what keeps this readable. */
function summarizeGameErrors(gameErrors: { matchup: string; error: string }[]): string {
  const summarized = gameErrors.map((e) => ({ matchup: e.matchup, reason: summarizeOddsError(e.error) }));
  const uniqueReasons = new Set(summarized.map((e) => e.reason));
  const matchups = summarized.map((e) => e.matchup).join(', ');
  if (uniqueReasons.size === 1) {
    return `${gameErrors.length} game${gameErrors.length === 1 ? '' : 's'} failed (${summarized[0].reason}): ${matchups}`;
  }
  return summarized.map((e) => `${e.matchup} (${e.reason})`).join('; ');
}

/** Shared "Refresh Odds" trigger + status state -- originally only lived on
 * MarketBrowser (reachable via an empty roster slot), which meant a user with
 * a fully-submitted lineup had no way to manually refresh player-props odds
 * (see chat, Sept 2026). Extracted here so NFLSlate can offer the same button
 * without duplicating the handler, the two summarize helpers, or the three
 * pieces of status state. The 15-minute refresh cooldown is enforced
 * server-side and keyed only by function name (see
 * fetch-nfl-player-props/index.ts, try_claim_refresh_cooldown) -- not
 * per-user or per-league -- so it's safe for multiple screens to each have
 * their own "Refresh Odds" button hitting the same global cooldown.
 *
 * `onSuccess` lets each screen supply its own post-refresh refetch (e.g.
 * reloading the current week's real games) without this hook needing to know
 * which screen it's running in. */
export function useOddsRefresh(onSuccess?: () => void) {
  const [refreshing, setRefreshing] = useState(false);
  // Kept as two separate pieces of state -- not one string -- specifically so
  // "Refreshed real odds for N games" never has to share a text color with a
  // failure list (see chat: the whole line was going red just because SOME of
  // the batch failed, even though the refresh itself genuinely succeeded).
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [refreshErrorDetail, setRefreshErrorDetail] = useState<string | null>(null);

  async function handleRefreshOdds() {
    setRefreshing(true);
    setRefreshMessage(null);
    setRefreshErrorDetail(null);
    const result = await refreshPlayerProps();
    setRefreshing(false);
    if (result.onCooldown) {
      const minutes = Math.ceil((result.secondsRemaining ?? 0) / 60);
      setRefreshMessage(`Odds were just refreshed — try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
      return;
    }
    if (!result.ok) {
      setRefreshErrorDetail(result.error ?? 'Could not refresh odds.');
      return;
    }
    setRefreshMessage(`Refreshed real odds for ${result.gamesUpdated ?? 0} game${result.gamesUpdated === 1 ? '' : 's'}.`);
    // The edge function always reported per-game failures in its response --
    // this just wasn't surfaced anywhere in the UI, so a game failing mid-batch
    // was invisible without a direct SQL check. Condensed and deduped (see the
    // helpers above) rather than dumping each game's full raw API error body.
    if (result.gameErrors && result.gameErrors.length > 0) {
      setRefreshErrorDetail(summarizeGameErrors(result.gameErrors));
    }
    onSuccess?.();
  }

  return { refreshing, refreshMessage, refreshErrorDetail, handleRefreshOdds };
}
