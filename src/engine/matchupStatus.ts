import type { Matchup, RosterSlotState, WeeklyRoster } from '../types';

/** Where a matchup stands, for any surface that labels it Upcoming, Live or Final. */
export type MatchupStatus = 'upcoming' | 'live' | 'final';

/** winnerId and isTie are only set once the whole week is complete. Scores update all week as
 * picks settle, so having a score does not mean final. */
export function isMatchupFinal(matchup: Pick<Matchup, 'winnerId' | 'isTie'>): boolean {
  return matchup.winnerId != null || matchup.isTie;
}

/** A pick is live once it has settled, or once its game has started. An empty slot never is.
 * `hasGameStarted` should treat a game it cannot resolve yet as not started. */
export function isSlotLive(slot: RosterSlotState, hasGameStarted: (gameId: string) => boolean): boolean {
  if (!slot.wager) return false;
  if (slot.wager.status !== 'pending') return true;
  return hasGameStarted(slot.wager.gameId);
}

/**
 * A matchup is Live as soon as any pick on either side has gone live, not when some game in the
 * week starts or when the week rolls over. Before that it is Upcoming, even mid-week with every
 * slot empty or pending. Final once the week's result is set.
 */
export function matchupStatus(
  matchup: Pick<Matchup, 'winnerId' | 'isTie'>,
  rosters: (WeeklyRoster | undefined)[],
  hasGameStarted: (gameId: string) => boolean,
): MatchupStatus {
  if (isMatchupFinal(matchup)) return 'final';
  const anyLive = rosters.some((r) => r?.slots.some((s) => isSlotLive(s, hasGameStarted)));
  return anyLive ? 'live' : 'upcoming';
}
