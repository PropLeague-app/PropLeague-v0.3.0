import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { weekLabel, weekOrder, type WeekId } from '../types';
import { formatCents } from '../engine/oddsMath';
import { Card } from '../components/common/Card';
import { BackHeader } from '../components/layout/BackHeader';
import { TeamLogo } from '../components/common/TeamLogo';
import { MemberSelector } from '../components/common/MemberSelector';
import { useEnsureSettledWeekRosters } from '../components/common/useEnsureWeekRosters';
import { isTeamWeekPerfect } from '../engine/perfectWeek';

function toWeekId(week: string): WeekId {
  return Number.isNaN(Number(week)) ? (week as WeekId) : Number(week);
}

/** Mirrors the gate in supabase/functions/settle-week/index.ts (see chat,
 * 0013_season_start_week.sql): null seasonStartWeek, or a week number before
 * it, means this week was never actually played by this league -- settle-week
 * never scores or penalizes it, so the UI shouldn't claim it was a result
 * either, even if an older/unrepaired matchup row still has a phantom
 * winner/score sitting in it. A non-numeric week (playoff round labels) is
 * never gated -- the season obviously already started by then. */
function isBeforeSeasonStart(week: string, seasonStartWeek: string | null): boolean {
  const weekNum = Number(week);
  if (!Number.isFinite(weekNum)) return false;
  if (seasonStartWeek == null) return true;
  const startNum = Number(seasonStartWeek);
  return Number.isFinite(startNum) && weekNum < startNum;
}

export function ScheduleView() {
  const navigate = useNavigate();
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));
  const userTeam = league?.teams.find((t) => t.isUser);

  // manual v0.1.1 §6 #10: view any league member's full season schedule, defaulting to
  // the signed-in user's own team.
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  // Past weeks' rosters are what tell us whether a week was perfect (the flame on its score).
  useEnsureSettledWeekRosters(league);

  if (!league || !userTeam) return null;

  const viewedTeam = league.teams.find((t) => t.id === selectedTeamId) ?? userTeam;

  const weeks = Object.entries(league.matchupsByWeek)
    .map(([week, matchups]) => ({
      week,
      matchup: matchups.find((m) => m.teamAId === viewedTeam.id || m.teamBId === viewedTeam.id),
    }))
    .filter((w) => w.matchup)
    .sort((a, b) => weekOrder(toWeekId(a.week)) - weekOrder(toWeekId(b.week)));

  // A league that started mid-season has real matchup rows sitting in
  // matchupsByWeek for the weeks before it existed (the schedule is generated
  // for the whole season up front -- see leagueService.buildSeasonSchedule).
  // Per-week "Season not started" cards for each of those (the previous
  // version of this screen) just repeats the same fact N times before the
  // list gets to anything real -- collapsed into one line instead (see chat,
  // Sept 2026: "entirely remove the W1 matchup... to say Season Not Started
  // until W_"). isBeforeSeasonStart itself is unchanged and still the single
  // source of truth for the cutoff, shared with settle-week's gate.
  const notStartedWeeks = weeks.filter(({ week }) => isBeforeSeasonStart(week, league.seasonStartWeek));
  const playedWeeks = weeks.filter(({ week }) => !isBeforeSeasonStart(week, league.seasonStartWeek));

  return (
    <div className="flex flex-col">
      <BackHeader title="Season Schedule" fallback="/home" />
      <div className="p-4 space-y-3">
      <MemberSelector teams={league.teams} selectedTeamId={viewedTeam.id} onSelect={setSelectedTeamId} />
      <div className="space-y-2">
        {notStartedWeeks.length > 0 && (
          <Card className="flex items-center justify-center py-4">
            <p className="text-sm text-text-muted">
              {league.seasonStartWeek != null
                ? `Season not started until ${weekLabel(toWeekId(league.seasonStartWeek))}`
                : 'Season not started'}
            </p>
          </Card>
        )}
        {playedWeeks.map(({ week, matchup }) => {
          if (!matchup) return null;
          const oppId = matchup.teamAId === viewedTeam.id ? matchup.teamBId : matchup.teamAId;
          const opponent = league.teams.find((t) => t.id === oppId);
          const myScore = matchup.teamAId === viewedTeam.id ? matchup.teamAScore : matchup.teamBScore;
          const oppScore = matchup.teamAId === viewedTeam.id ? matchup.teamBScore : matchup.teamAScore;
          // matchup.teamAScore/teamBScore update live all week as picks settle (see
          // chat), so "has a score" doesn't mean "is final" -- winnerId/isTie only get
          // set once the whole week is actually complete. Same fix as MatchupCard.tsx.
          // notStarted is never true here -- these are exactly the weeks filtered out
          // of notStartedWeeks above -- so isFinal only depends on the actual result.
          const isFinal = matchup.winnerId != null || matchup.isTie;
          const won = isFinal && myScore != null && oppScore != null && myScore > oppScore;
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
                      <span className={isTeamWeekPerfect(league, viewedTeam.id, toWeekId(week)) ? 'pl-fire font-semibold' : ''}>{formatCents(myScore!)}</span>
                      {' - '}
                      <span className={opponent && isTeamWeekPerfect(league, opponent.id, toWeekId(week)) ? 'pl-fire font-semibold' : ''}>{formatCents(oppScore!)}</span>
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
