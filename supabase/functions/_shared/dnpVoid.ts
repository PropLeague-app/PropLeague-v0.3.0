// When a player prop with no stat row should be voided as a DNP (settle-week).
//
// The old rule was purely about elapsed time: void once the game had been final for 24 hours, or
// once Tuesday's reveal cutoff passed, whichever came first. That is slow for the ordinary case.
// A Sunday afternoon scratch sat "live" on everyone's matchup screen until Monday afternoon, even
// though the box score for his game had fully landed hours earlier (see chat, Oct 2026: Jordan
// Addison, 8 hours after final, with 31 Minnesota and 34 New Orleans players already ingested).
//
// The timers were really standing in for a question they could not ask: has ingestion finished for
// this game? That question has a direct answer. real_player_stats carries recent_team, so if a
// healthy number of the player's own teammates already have rows for this week, the box score is
// in, and a player with no row did not play. No waiting required.
//
// The time rules stay underneath as fallbacks, so the cases they were each added for still hold:
//   - the 3 hour floor still guards a backfill run where wall-clock time means nothing;
//   - the 24 hour ceiling and the Tuesday gate still cover a player whose team has no rows at all,
//     which is the transient-ingestion-gap case (Byron Young, Isaiah Likely) that must keep waiting.
// The new signal can only ever make a void happen sooner, never where it would not have happened.

/** A real box score lists far more than this. Enough rows to tell a finished ingest from a trickle. */
export const MIN_TEAM_STAT_ROWS = 10;

export interface DnpVoidInput {
  /** Milliseconds since the game went final, or null when it has no final_since yet. */
  msSinceFinal: number | null;
  /** The player's own NFL team, from the first part of the pick id ('MIN-jordan-addison'). */
  playerTeam: string | null;
  /** How many stat rows that team already has for this week. */
  teamStatRows: number;
  /** Tuesday's results reveal cutoff has passed (see RESULTS_REVEAL_CUTOFF_HOUR_ET). */
  pastRevealCutoff: boolean;
  graceMs: number;
  hardCeilingMs: number;
}

export interface DnpVoidDecision {
  shouldVoid: boolean;
  /** Why, for the response's `skipped` list. */
  reason: string;
}

export function dnpVoidDecision(input: DnpVoidInput): DnpVoidDecision {
  const { msSinceFinal, playerTeam, teamStatRows, pastRevealCutoff, graceMs, hardCeilingMs } = input;
  if (msSinceFinal == null) return { shouldVoid: false, reason: 'no-stat-row (game has no final time yet)' };
  if (msSinceFinal < graceMs) return { shouldVoid: false, reason: 'no-stat-row (within grace)' };

  // His team's box score is in and he is not in it: he did not play.
  if (playerTeam && teamStatRows >= MIN_TEAM_STAT_ROWS) {
    return { shouldVoid: true, reason: 'dnp (teammates ingested, no row for this player)' };
  }
  if (msSinceFinal >= hardCeilingMs) return { shouldVoid: true, reason: 'dnp (24h ceiling)' };
  if (pastRevealCutoff) return { shouldVoid: true, reason: 'dnp (past Tuesday reveal)' };
  return {
    shouldVoid: false,
    reason: playerTeam
      ? 'no-stat-row (his team has no box score yet, still ingesting)'
      : 'no-stat-row (no team on the pick, waiting on the clock)',
  };
}

/** The NFL team on a pick id like 'MIN-jordan-addison'. Null when it does not look like one. */
export function teamFromPlayerId(playerId: string | null | undefined): string | null {
  const head = (playerId ?? '').split('-')[0].toUpperCase();
  return /^[A-Z]{2,3}$/.test(head) ? head : null;
}
