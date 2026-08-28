import { useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { DaySlot, WeekId } from '../types';
import { getSlate } from '../services/oddsService';
import { WeekSelector } from '../components/slate/WeekSelector';
import { GameCard } from '../components/slate/GameCard';
import { SkeletonCard } from '../components/common/SkeletonLoader';

const DAY_LABELS: Record<DaySlot, string> = {
  TNF: 'Thursday Night',
  SUN_EARLY: 'Sunday Early',
  SUN_LATE: 'Sunday Late',
  SNF: 'Sunday Night',
  MNF: 'Monday Night',
};

const DAY_ORDER: DaySlot[] = ['TNF', 'SUN_EARLY', 'SUN_LATE', 'SNF', 'MNF'];

export function NFLSlate() {
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));
  const [week, setWeek] = useState<WeekId | null>(null);
  const [loading, setLoading] = useState(false);

  const activeWeek = week ?? league?.currentWeek ?? 1;
  const games = useMemo(
    () => getSlate(activeWeek, league?.currentWeek ?? 1, league?.settings.lineMovementEnabled, league?.manualGameOverrides),
    [activeWeek, league?.currentWeek, league?.settings.lineMovementEnabled, league?.manualGameOverrides],
  );

  function changeWeek(w: WeekId) {
    setLoading(true);
    setWeek(w);
    setTimeout(() => setLoading(false), 250);
  }

  const grouped = DAY_ORDER.map((day) => ({ day, games: games.filter((g) => g.daySlot === day) })).filter(
    (g) => g.games.length > 0,
  );

  return (
    <div className="p-4 space-y-3">
      <h1 className="text-xl font-bold">NFL Slate</h1>
      <WeekSelector value={activeWeek} onChange={changeWeek} />

      {loading ? (
        <div className="space-y-2">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(({ day, games: dayGames }) => (
            <div key={day}>
              <p className="text-xs font-semibold text-text-muted mb-2 uppercase tracking-wide">{DAY_LABELS[day]}</p>
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
  );
}
