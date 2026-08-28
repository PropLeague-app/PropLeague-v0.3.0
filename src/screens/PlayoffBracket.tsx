import { useAppStore } from '../store/useAppStore';
import { BracketView } from '../components/playoffs/BracketView';
import { EmptyState } from '../components/common/EmptyState';
import { BackHeader } from '../components/layout/BackHeader';

export function PlayoffBracket() {
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));

  if (!league) return null;

  return (
    <div className="flex flex-col">
      <BackHeader title="Playoff Bracket" fallback="/home" />
      <div className="p-4 space-y-4">
        {league.bracket ? (
          <BracketView league={league} bracket={league.bracket} />
        ) : (
          <EmptyState
            icon="🗓️"
            title="Bracket not set yet"
            subtitle="The top 4 teams are seeded once the 18-week regular season wraps up."
          />
        )}
      </div>
    </div>
  );
}
