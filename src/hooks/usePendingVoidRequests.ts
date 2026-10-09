import { useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useUIStore } from '../store/useUIStore';
import { fetchVoidRequests } from '../services/voidFlags';

const POLL_MS = 60_000;

/**
 * Keeps useUIStore.pendingVoidRequests current for the commissioner of the current league: on
 * mount, when the league or week changes, whenever the app comes back to the foreground, and once
 * a minute while it is open. Anyone who is not the commissioner reads zero. The Void Requests card
 * also writes the count the moment it loads or the commissioner answers a request, so the badge
 * does not lag behind what the card shows. Call once, from the tab bar.
 */
export function usePendingVoidRequests(): void {
  const leagueId = useAppStore((s) => s.currentLeagueId);
  const week = useAppStore((s) => (s.currentLeagueId ? s.leagues[s.currentLeagueId]?.currentWeek : undefined));
  const isCommissioner = useAppStore((s) => {
    const league = s.currentLeagueId ? s.leagues[s.currentLeagueId] : undefined;
    const team = league?.teams.find((t) => t.isUser);
    return !!league && !!team && team.id === league.commissionerTeamId;
  });
  const setCount = useUIStore((s) => s.setPendingVoidRequests);

  useEffect(() => {
    if (!leagueId || week == null || !isCommissioner) {
      setCount(0);
      return;
    }
    let cancelled = false;
    async function refresh() {
      const res = await fetchVoidRequests(leagueId as string, String(week));
      if (cancelled || !res.ok) return; // a failed check keeps the last count
      setCount(res.rows.filter((r) => r.status === 'pending').length);
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [leagueId, week, isCommissioner, setCount]);
}
