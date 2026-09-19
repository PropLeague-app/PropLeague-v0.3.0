import { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import type { DaySlot, WeekId } from '../types';
import { WeekSelector } from '../components/slate/WeekSelector';
import { GameCard } from '../components/slate/GameCard';
import { SkeletonCard } from '../components/common/SkeletonLoader';
import { EmptyState } from '../components/common/EmptyState';
import { useOddsRefresh } from '../hooks/useOddsRefresh';
import { useOddsFreshness, oddsFreshnessMessage } from '../hooks/useOddsFreshness';

const DAY_LABELS: Record<DaySlot, string> = {
  WED: 'Wednesday',
  TNF: 'Thursday Night',
  SAT: 'Saturday',
  SUN_EARLY: 'Sunday Early',
  SUN_LATE: 'Sunday Late',
  SNF: 'Sunday Night',
  MNF: 'Monday Night',
};

const DAY_ORDER: DaySlot[] = ['WED', 'TNF', 'SAT', 'SUN_EARLY', 'SUN_LATE', 'SNF', 'MNF'];

export function NFLSlate() {
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));
  const [week, setWeek] = useState<WeekId | null>(null);
  // Tracks the real_games fetch itself (not a fixed timer) -- see chat, Sept
  // 2026: this screen used to fall back to the fully-fabricated data/seed.ts
  // slate (fake teams, fake odds) for any week The Odds API hasn't posted yet,
  // which is every week more than ~1-2 out, and is flatly impossible for
  // WC/DIV/CONF since the real bracket isn't seeded until those rounds are
  // actually reached. That fallback is gone -- a week with no real rows yet
  // shows an honest "not posted" empty state instead of invented matchups.
  const [gamesLoading, setGamesLoading] = useState(true);
  const realGamesForWeek = useAppStore((s) => s.realGamesByWeek[String(week ?? league?.currentWeek ?? 1)]);
  const loadRealGamesForWeek = useAppStore((s) => s.loadRealGamesForWeek);

  const activeWeek = week ?? league?.currentWeek ?? 1;
  // Player-props odds refresh is manual-only (see fetch-nfl-player-props),
  // and used to only be reachable from MarketBrowser, which requires an
  // empty roster slot to even open -- a user with a full/submitted lineup
  // had no way to trigger it at all (see chat, Sept 2026). This screen has
  // no such requirement, so it's a natural second entry point; the 15-min
  // refresh cooldown is global and server-side, so two buttons hitting it
  // is safe (see useOddsRefresh).
  const { refreshing, refreshMessage, refreshErrorDetail, handleRefreshOdds } = useOddsRefresh(() => {
    loadRealGamesForWeek(activeWeek);
  });

  useEffect(() => {
    let cancelled = false;
    setGamesLoading(true);
    loadRealGamesForWeek(activeWeek).finally(() => {
      if (!cancelled) setGamesLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWeek]);

  const games = realGamesForWeek ?? [];

  const freshness = useOddsFreshness(games);
  const freshnessMessage = oddsFreshnessMessage(freshness);

  const grouped = DAY_ORDER.map((day) => ({
    day,
    // Sorted by kickoff within each day slot -- the real-data source doesn't
    // guarantee an order, so without this, games inside a day (e.g. the
    // early/late Sunday windows) could list out of kickoff order.
    games: games.filter((g) => g.daySlot === day).sort((a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime()),
  })).filter((g) => g.games.length > 0);

  return (
    <>
      <div className="px-4 pt-2 pb-3 space-y-3 sticky top-0 bg-bg-raised z-10">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold flex-1">NFL Slate</h1>
          <button
            onClick={handleRefreshOdds}
            disabled={refreshing}
            className="text-xs text-primary font-medium border border-border rounded-lg px-2.5 py-1.5 disabled:opacity-40 shrink-0"
          >
            {refreshing ? 'Refreshing…' : 'Refresh Odds'}
          </button>
        </div>
        {freshnessMessage && <p className="text-[11px] text-warning font-medium">{freshnessMessage}</p>}
        {(refreshMessage || refreshErrorDetail) && (
          <div className="space-y-0.5">
            {refreshMessage && <p className="text-xs text-text-muted">{refreshMessage}</p>}
            {refreshErrorDetail && <p className="text-xs text-loss">{refreshErrorDetail}</p>}
          </div>
        )}
        <WeekSelector value={activeWeek} onChange={setWeek} />
      </div>

      <div className="px-4 pb-4">
        {gamesLoading ? (
          <div className="space-y-2">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : grouped.length === 0 ? (
          <EmptyState
            icon={<CalendarClock size={36} strokeWidth={1.5} />}
            title="Schedule not posted yet"
            subtitle="Odds usually go up about a week before kickoff -- playoff matchups aren't set until the bracket is seeded. Check back closer to game day."
          />
        ) : (
          <div className="space-y-4">
            {grouped.map(({ day, games: dayGames }) => (
              <div key={day}>
                <p className="text-xs font-semibold text-text-muted mb-2 uppercase tracking-wide">
                  {DAY_LABELS[day]}
                  {dayGames[0] && ` · ${new Date(dayGames[0].kickoff).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
                </p>
                <div className="space-y-2">
                  {dayGames.map((game) => (
                    <GameCard key={game.id} game={game} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
