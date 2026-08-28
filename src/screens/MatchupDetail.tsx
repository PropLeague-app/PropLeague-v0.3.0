import { useParams } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { rosterKey, buildEmptyRoster } from '../engine/rosterSlots';
import { getGame } from '../services/oddsService';
import { resultForGame } from '../data/seed';
import { expectedWeeklyScore, type DecidedGameLookup } from '../engine/scoring';
import { PositionBadge } from '../components/common/PositionBadge';
import { StatusPill } from '../components/common/StatusPill';
import { TeamLogo } from '../components/common/TeamLogo';
import { BackHeader } from '../components/layout/BackHeader';
import { formatCents } from '../engine/oddsMath';
import { wagerLineDescription } from '../data/propsGenerator';
import type { League, RosterSlotState } from '../types';
import { weekLabel } from '../types';

export function MatchupDetail() {
  const { matchupId } = useParams<{ matchupId: string }>();
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));

  if (!league) return null;

  const matchup = Object.values(league.matchupsByWeek)
    .flat()
    .find((m) => m.id === matchupId);
  if (!matchup) return <div className="p-4 text-text-muted text-sm">Matchup not found.</div>;

  const teamA = league.teams.find((t) => t.id === matchup.teamAId);
  const teamB = league.teams.find((t) => t.id === matchup.teamBId);
  if (!teamA || !teamB) return null;

  const rosterA =
    league.rostersByTeamWeek[rosterKey(teamA.id, matchup.week)] ??
    buildEmptyRoster(teamA.id, matchup.week, league.settings.lineupSlots);
  const rosterB =
    league.rostersByTeamWeek[rosterKey(teamB.id, matchup.week)] ??
    buildEmptyRoster(teamB.id, matchup.week, league.settings.lineupSlots);

  const hidePicks = league.settings.hidePicks;

  // manual v0.2.1 §5 #8: teamAScore/teamBScore stay null until the week fully settles,
  // so live/in-progress weeks otherwise show "—" here. Fall back to the same
  // expectedWeeklyScore/DecidedGameLookup pattern MatchupCard.tsx already uses on the
  // home matchup card, so this screen shows a consistent current P/L for live weeks too.
  const decided: DecidedGameLookup = {
    isDecided: (gameId) =>
      getGame(gameId, league.currentWeek, league.settings.lineMovementEnabled, league.manualGameOverrides)?.status !== 'upcoming',
    resultFor: (gameId) => resultForGame(gameId),
  };
  const scoreA = matchup.teamAScore ?? expectedWeeklyScore(rosterA, league.settings, decided);
  const scoreB = matchup.teamBScore ?? expectedWeeklyScore(rosterB, league.settings, decided);
  const isFinal = matchup.teamAScore != null;

  return (
    <div className="flex flex-col">
      <BackHeader title="Matchup" fallback="/home" />
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <TeamHeader team={teamA} score={scoreA} isFinal={isFinal} />
          <span className="text-xs text-text-muted">{weekLabel(matchup.week)}</span>
          <TeamHeader team={teamB} score={scoreB} isFinal={isFinal} reverse />
        </div>

        <div className="space-y-2">
          {rosterA.slots.map((slotA, idx) => {
            const slotB = rosterB.slots[idx];
            return (
              <div key={slotA.slotId} className="grid grid-cols-[1fr_auto_1fr] gap-2 items-stretch">
                <SlotMini
                  slot={slotA}
                  league={league}
                  isUser={teamA.isUser}
                  hidePicks={hidePicks}
                />
                <div className="flex items-center justify-center px-1">
                  <PositionBadge position={slotA.position} />
                </div>
                <SlotMini
                  slot={slotB}
                  league={league}
                  isUser={teamB.isUser}
                  hidePicks={hidePicks}
                  reverse
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TeamHeader({
  team,
  score,
  isFinal,
  reverse,
}: {
  team: League['teams'][number];
  score: number;
  isFinal: boolean;
  reverse?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 ${reverse ? 'flex-row-reverse text-right' : ''}`}>
      <TeamLogo team={team} size="sm" />
      <div>
        <p className="text-xs font-medium max-w-[90px] truncate">{team.teamName}</p>
        <p className={`text-sm font-bold ${score >= 0 ? 'text-profit' : 'text-loss'}`}>{formatCents(score)}</p>
        <p className="text-[10px] text-text-muted">{isFinal ? 'Final' : 'Live'}</p>
      </div>
    </div>
  );
}

function SlotMini({
  slot,
  league,
  isUser,
  hidePicks,
  reverse,
}: {
  slot: RosterSlotState;
  league: League;
  isUser: boolean;
  hidePicks: boolean;
  reverse?: boolean;
}) {
  if (!slot.wager) {
    return <div className="bg-bg-card border border-border rounded-lg p-2 text-[11px] text-text-muted flex items-center justify-center">Empty</div>;
  }
  const game = getGame(slot.wager.gameId, league.currentWeek, league.settings.lineMovementEnabled, league.manualGameOverrides);
  const gameStarted = !game || game.status !== 'upcoming';
  const shouldHide = !isUser && hidePicks && !gameStarted;

  if (shouldHide) {
    return (
      <div className={`bg-bg-card border border-border rounded-lg p-2 text-[11px] text-text-muted flex items-center justify-center gap-1 ${reverse ? 'flex-row-reverse' : ''}`}>
        🔒 Hidden
      </div>
    );
  }

  const wager = slot.wager;
  return (
    <div className={`bg-bg-card border border-border rounded-lg p-2 ${reverse ? 'text-right' : ''}`}>
      <p className="text-[11px] font-semibold truncate">{wager.playerName ?? wager.side}</p>
      <p className="text-[10px] text-text-muted truncate">
        {wagerLineDescription(wager)} · ${wager.stake.toFixed(2)}
      </p>
      <div className={`mt-1 flex ${reverse ? 'justify-end' : 'justify-start'}`}>
        <StatusPill status={wager.status === 'pending' ? (gameStarted ? 'live' : 'pending') : wager.status} />
      </div>
    </div>
  );
}
