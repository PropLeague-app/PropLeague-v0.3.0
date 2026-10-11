import { useEffect, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import { peekPendingPushRoute, subscribePushRoute, takePendingPushRoute } from '../../services/pushRoute';
import { leagueWeekMatchups } from '../../engine/bracketModel';
import type { WeekId } from '../../types';

/** A push and a Live Activity card both carry the week as a string ("14", "DIV"). */
function parseWeekId(raw: string): WeekId | null {
  if (raw === 'WC' || raw === 'DIV' || raw === 'CONF') return raw;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 18 ? n : null;
}

/**
 * Follows a tapped push, or a tapped Live Activity card, to its league and screen (see
 * services/pushRoute.ts). Mounted once in the
 * app shell, so it only acts after sign-in and league loading are done. A league the person is no
 * longer in is ignored and the app opens where it would have anyway.
 */
export function PushRouter() {
  const navigate = useNavigate();
  const route = useSyncExternalStore(subscribePushRoute, peekPendingPushRoute);
  const leaguesHydrated = useAppStore((s) => s.leaguesHydrated);

  useEffect(() => {
    if (!route || !leaguesHydrated) return;
    const next = takePendingPushRoute();
    if (!next) return;
    const store = useAppStore.getState();
    const league = store.leagues[next.leagueId];
    const userTeam = league?.teams.find((t) => t.isUser);
    if (!league || !userTeam) return;
    store.setCurrentLeague(league.id);

    if (next.screen === 'lineup') {
      navigate('/lineup');
      return;
    }
    if (next.screen === 'void-requests') {
      navigate('/settings?open=void-requests');
      return;
    }
    // Matchup: fetch the latest results first so the score the push talked about is on screen.
    const teamId = next.teamId ?? userTeam.id;
    void store.loadLeagueResults(league.id).then(() => {
      const fresh = useAppStore.getState().leagues[league.id];
      const weekId = parseWeekId(next.week);
      const rows = fresh && weekId != null ? leagueWeekMatchups(fresh, weekId) : [];
      const matchup = rows.find((m) => m.teamAId === teamId || m.teamBId === teamId);
      navigate(matchup ? `/matchup/${matchup.id}` : '/home');
    });
  }, [route, leaguesHydrated, navigate]);

  return null;
}
