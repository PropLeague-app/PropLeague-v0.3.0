import { useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import type { League } from '../../types';

// Weeks already requested this session, so a screen re-rendering (or two screens asking) never
// refetches the same week in a loop. A failed fetch is retried on the next app launch.
const requested = new Set<string>();

/**
 * Makes sure every settled week's rosters (all teams) are loaded, so a finished week can be
 * judged for things like perfect weeks. Past rosters never change once a week is final, so
 * each week is fetched at most once per session. Weeks that already have rosters in the cache
 * (from this device having opened them) are skipped.
 */
export function useEnsureSettledWeekRosters(league: League | undefined) {
  const loadWeekRosters = useAppStore((s) => s.loadWeekRosters);
  const leagueId = league?.id;
  const weekKey = league
    ? Object.entries(league.matchupsByWeek)
        .filter(([, ms]) => ms.some((m) => m.winnerId != null || m.isTie))
        .map(([w]) => w)
        .join(',')
    : '';
  useEffect(() => {
    if (!leagueId || !weekKey) return;
    for (const week of weekKey.split(',')) {
      const key = `${leagueId}:${week}`;
      if (requested.has(key)) continue;
      requested.add(key);
      void loadWeekRosters(leagueId, (Number.isFinite(Number(week)) ? Number(week) : week) as never);
    }
  }, [leagueId, weekKey, loadWeekRosters]);
}
