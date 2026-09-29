import { useAppStore } from '../store/useAppStore';
import { weekLabel } from '../types';
import { BackHeader } from '../components/layout/BackHeader';
import { MatchupCard } from '../components/home/MatchupCard';

/** "See all matchups" destination off the Home screen's "Other Matchups"
 * disclosure (see chat, Sept 2026): the disclosure itself shows compact rows
 * (MatchupCard in `compact` mode) so it stays scannable in a bigger league, but
 * testers still want a way to see every matchup "in the original format" --
 * this is that screen, just the full-size MatchupCard for every matchup in the
 * current week, the user's own included (highlighted the same way Home does). */
export function WeekMatchups() {
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));
  const userTeam = league?.teams.find((t) => t.isUser);

  if (!league) return null;

  const weekMatchups = league.matchupsByWeek[String(league.currentWeek)] ?? [];

  return (
    <div className="flex flex-col">
      <BackHeader title={`${weekLabel(league.currentWeek)} Matchups`} fallback="/home" />
      <div className="p-4 space-y-2.5">
        {weekMatchups.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-8">No matchups this week.</p>
        ) : (
          weekMatchups.map((m) => <MatchupCard key={m.id} league={league} matchup={m} highlightTeamId={userTeam?.id} />)
        )}
      </div>
    </div>
  );
}
