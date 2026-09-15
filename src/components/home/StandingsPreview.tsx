import { useNavigate } from 'react-router-dom';
import type { League } from '../../types';
import { Card } from '../common/Card';
import { TeamLogo } from '../common/TeamLogo';
import { formatCents } from '../../engine/oddsMath';
import { sortStandings } from '../../engine/standings';

export function StandingsPreview({ league }: { league: League }) {
  const navigate = useNavigate();
  // league.standings itself is NOT stored in rank order -- see chat, Sept
  // 2026 (same bug FullStandings.tsx's default view had): sort here with the
  // real W-L -> P/L -> bet record tiebreaker chain before taking the top 4,
  // rather than slicing whatever order the store happens to hold.
  const ranked = sortStandings(league.standings, league.matchupsByWeek);
  const top4 = ranked.slice(0, 4);
  const userTeam = league.teams.find((t) => t.isUser);
  const userRank = userTeam ? ranked.findIndex((s) => s.teamId === userTeam.id) + 1 : 0;
  const userInTop4 = userRank > 0 && userRank <= 4;

  return (
    <Card onClick={() => navigate('/standings')} className="space-y-2">
      <div className="flex justify-between items-center">
        <p className="font-semibold text-sm">Standings</p>
        <span className="text-primary text-xs">See full standings →</span>
      </div>
      <div className="space-y-1.5">
        {top4.map((s, i) => {
          const team = league.teams.find((t) => t.id === s.teamId);
          if (!team) return null;
          return (
            <div key={s.teamId} className={`flex items-center justify-between text-xs ${team.isUser ? 'text-primary font-semibold' : ''}`}>
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="shrink-0">{i + 1}.</span>
                <TeamLogo team={team} size="sm" />
                <span className="truncate">{team.teamName}</span>
              </span>
              <span className="text-text-muted shrink-0">
                {s.wins}-{s.losses}
                {s.ties ? `-${s.ties}` : ''} · {formatCents(s.totalPL)}
              </span>
            </div>
          );
        })}
        {!userInTop4 && userTeam && (
          <div className="flex items-center justify-between text-xs text-primary font-semibold pt-1 border-t border-border">
            <span className="flex items-center gap-1.5">
              <span>{userRank}.</span>
              <TeamLogo team={userTeam} size="sm" />
              {userTeam.teamName}
            </span>
            <span className="text-text-muted">
              {ranked[userRank - 1]?.wins}-{ranked[userRank - 1]?.losses}
            </span>
          </div>
        )}
      </div>
    </Card>
  );
}
