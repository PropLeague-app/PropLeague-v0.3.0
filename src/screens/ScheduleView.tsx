import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { weekLabel, weekOrder, type WeekId } from '../types';
import { formatCents } from '../engine/oddsMath';
import { Card } from '../components/common/Card';
import { BackHeader } from '../components/layout/BackHeader';
import { TeamLogo } from '../components/common/TeamLogo';
import { MemberSelector } from '../components/common/MemberSelector';

function toWeekId(week: string): WeekId {
  return Number.isNaN(Number(week)) ? (week as WeekId) : Number(week);
}

export function ScheduleView() {
  const navigate = useNavigate();
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));
  const userTeam = league?.teams.find((t) => t.isUser);

  // manual v0.1.1 §6 #10: view any league member's full season schedule, defaulting to
  // the signed-in user's own team.
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  if (!league || !userTeam) return null;

  const viewedTeam = league.teams.find((t) => t.id === selectedTeamId) ?? userTeam;

  const weeks = Object.entries(league.matchupsByWeek)
    .map(([week, matchups]) => ({
      week,
      matchup: matchups.find((m) => m.teamAId === viewedTeam.id || m.teamBId === viewedTeam.id),
    }))
    .filter((w) => w.matchup)
    .sort((a, b) => weekOrder(toWeekId(a.week)) - weekOrder(toWeekId(b.week)));

  return (
    <div className="flex flex-col">
      <BackHeader title="Season Schedule" fallback="/home" />
      <div className="p-4 space-y-3">
      <MemberSelector teams={league.teams} selectedTeamId={viewedTeam.id} onSelect={setSelectedTeamId} />
      <div className="space-y-2">
        {weeks.map(({ week, matchup }) => {
          if (!matchup) return null;
          const oppId = matchup.teamAId === viewedTeam.id ? matchup.teamBId : matchup.teamAId;
          const opponent = league.teams.find((t) => t.id === oppId);
          const myScore = matchup.teamAId === viewedTeam.id ? matchup.teamAScore : matchup.teamBScore;
          const oppScore = matchup.teamAId === viewedTeam.id ? matchup.teamBScore : matchup.teamAScore;
          const isFinal = myScore != null;
          const won = isFinal && myScore! > oppScore!;
          const tied = isFinal && myScore === oppScore;

          return (
            <Card key={matchup.id} onClick={() => navigate(`/matchup/${matchup.id}`)} className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                {opponent && <TeamLogo team={opponent} size="sm" />}
                <div className="min-w-0">
                  <p className="text-xs text-text-muted">{weekLabel(toWeekId(week))}</p>
                  <p className="text-sm font-medium truncate">vs {opponent?.teamName ?? 'TBD'}</p>
                </div>
              </div>
              <div className="text-right">
                {isFinal ? (
                  <>
                    <p className={`text-sm font-bold ${won ? 'text-profit' : tied ? 'text-text-muted' : 'text-loss'}`}>
                      {won ? 'W' : tied ? 'T' : 'L'}
                    </p>
                    <p className="text-[11px] text-text-muted">
                      {formatCents(myScore!)} - {formatCents(oppScore!)}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-text-muted">Upcoming</p>
                )}
              </div>
            </Card>
          );
        })}
      </div>
      </div>
    </div>
  );
}
