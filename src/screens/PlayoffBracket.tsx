import { useEffect } from 'react';
import { Calendar } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { BracketView } from '../components/playoffs/BracketView';
import { EmptyState } from '../components/common/EmptyState';
import { BackHeader } from '../components/layout/BackHeader';

export function PlayoffBracket() {
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));
  const loadLeagueResults = useAppStore((s) => s.loadLeagueResults);

  // Covers reaching this screen directly (e.g. a deep link) without passing
  // through LeagueHome first, which is where this normally gets refreshed.
  useEffect(() => {
    if (currentLeagueId) loadLeagueResults(currentLeagueId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLeagueId]);

  if (!league) return null;

  return (
    <div className="flex flex-col">
      <BackHeader title="Playoff Bracket" fallback="/home" />
      <div className="p-4 space-y-4">
        {league.bracket ? (
          <BracketView league={league} bracket={league.bracket} />
        ) : (
          <EmptyState
            icon={<Calendar size={36} strokeWidth={1.5} />}
            title="Bracket not set yet"
            subtitle="The top 4 teams are seeded once the 18-week regular season wraps up."
          />
        )}
      </div>
    </div>
  );
}