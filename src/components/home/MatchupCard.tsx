import { useNavigate } from 'react-router-dom';
import type { League, LeagueTeam, Matchup } from '../../types';
import { rosterKey } from '../../engine/rosterSlots';
import { expectedWeeklyScore, winProbability, type DecidedGameLookup } from '../../engine/scoring';
import { getGame } from '../../services/oddsService';
import { resultForGame } from '../../data/seed';
import { AnimatedNumber } from '../common/AnimatedNumber';
import { Card } from '../common/Card';
import { TeamLogo } from '../common/TeamLogo';

export function MatchupCard({ league, matchup, highlightTeamId }: { league: League; matchup: Matchup; highlightTeamId?: string }) {
  const navigate = useNavigate();
  const teamA = league.teams.find((t) => t.id === matchup.teamAId);
  const teamB = league.teams.find((t) => t.id === matchup.teamBId);
  if (!teamA || !teamB) return null;

  const rosterA = league.rostersByTeamWeek[rosterKey(teamA.id, matchup.week)];
  const rosterB = league.rostersByTeamWeek[rosterKey(teamB.id, matchup.week)];

  const decided: DecidedGameLookup = {
    isDecided: (gameId) =>
      getGame(gameId, league.currentWeek, league.settings.lineMovementEnabled, league.manualGameOverrides)?.status !== 'upcoming',
    resultFor: (gameId) => resultForGame(gameId),
  };
  const scoreA = matchup.teamAScore ?? (rosterA ? expectedWeeklyScore(rosterA, league.settings, decided) : 0);
  const scoreB = matchup.teamBScore ?? (rosterB ? expectedWeeklyScore(rosterB, league.settings, decided) : 0);
  const isFinal = matchup.teamAScore != null;

  const prob = winProbability(scoreA, scoreB);

  return (
    <Card onClick={() => navigate(`/matchup/${matchup.id}`)} className="space-y-3">
      <div className="flex items-center justify-between">
        <TeamBlock team={teamA} highlighted={teamA.id === highlightTeamId} />
        <span className="text-text-muted text-xs font-bold">VS</span>
        <TeamBlock team={teamB} highlighted={teamB.id === highlightTeamId} reverse />
      </div>

      <div className="flex items-center justify-between text-xl font-bold">
        <AnimatedNumber value={scoreA} />
        <AnimatedNumber value={scoreB} />
      </div>

      <div>
        <div className="h-1.5 rounded-full bg-loss/30 overflow-hidden flex">
          <div className="h-full bg-primary transition-all duration-500" style={{ width: `${prob * 100}%` }} />
        </div>
        <p className="text-[11px] text-text-muted text-center mt-1">
          {isFinal ? 'Final' : `${teamA.abbrev} win probability: ${Math.round(prob * 100)}%`}
        </p>
      </div>
    </Card>
  );
}

function TeamBlock({ team, highlighted, reverse }: { team: LeagueTeam; highlighted?: boolean; reverse?: boolean }) {
  return (
    <div className={`flex items-center gap-2 min-w-0 ${reverse ? 'flex-row-reverse text-right' : ''}`}>
      <TeamLogo team={team} />
      <p className={`text-xs font-medium truncate max-w-[80px] ${highlighted ? 'text-primary' : ''}`}>{team.teamName}</p>
    </div>
  );
}
