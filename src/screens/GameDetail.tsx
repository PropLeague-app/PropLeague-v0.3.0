import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { getGame, getPlayerPropGroups } from '../services/oddsService';
import { nflTeamById } from '../data/nflTeams';
import { buildEmptyRoster, rosterKey } from '../engine/rosterSlots';
import { activeMultipliers } from '../engine/prizePool';
import { GameLinesTable } from '../components/roster/GameLinesTable';
import { PlayerPropsCard } from '../components/roster/PlayerPropsCard';
import { BetSlipSheet, type BetSlipTarget } from '../components/roster/BetSlipSheet';
import { StatusPill } from '../components/common/StatusPill';
import { TeamMark } from '../components/common/TeamMark';
import { BackHeader } from '../components/layout/BackHeader';
import type { OddsMarket, OddsOutcome, Position } from '../types';

const POSITION_TABS: ('All' | Position)[] = ['All', 'QB', 'RB', 'WR', 'TE', 'K'];

export function GameDetail() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));
  const realGamesById = useAppStore((s) => s.realGamesById);
  const loadRealGame = useAppStore((s) => s.loadRealGame);
  const [target, setTarget] = useState<BetSlipTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [positionFilter, setPositionFilter] = useState<'All' | Position>('All');

  // Same real-first, simulated-fallback pattern already used in Lineup.tsx --
  // without this, a game reached from the (now real-data) NFL Slate screen
  // would only ever look itself up in the simulated dataset, which is exactly
  // why its markets/props were showing up empty.
  useEffect(() => {
    if (gameId && !realGamesById[gameId]) loadRealGame(gameId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  const game = gameId
    ? (realGamesById[gameId] ??
      getGame(gameId, league?.currentWeek ?? 1, league?.settings.lineMovementEnabled ?? true, league?.manualGameOverrides))
    : undefined;
  if (!game) {
    return (
      <div className="flex flex-col">
        <BackHeader title="Game Details" fallback="/slate" />
        <div className="p-4 text-text-muted text-sm">Game not found.</div>
      </div>
    );
  }

  const home = nflTeamById(game.homeTeamId);
  const away = nflTeamById(game.awayTeamId);
  const playerGroups = getPlayerPropGroups(game).filter((g) => positionFilter === 'All' || g.position === positionFilter);
  const userTeam = league?.teams.find((t) => t.isUser);

  function tryOpenBetSlip(marketKey: OddsMarket['key'], outcome: OddsOutcome, position: Position | 'ML', playerId?: string, playerName?: string, label?: string) {
    if (!league || !userTeam || !game) return;
    if (game.week !== league.currentWeek || game.status !== 'upcoming') {
      setNotice('This game has already locked for this season week.');
      setTimeout(() => setNotice(null), 2500);
      return;
    }
    const roster =
      league.rostersByTeamWeek[rosterKey(userTeam.id, league.currentWeek)] ??
      buildEmptyRoster(userTeam.id, league.currentWeek, league.settings.lineupSlots);
    const candidates = roster.slots.filter((s) => s.position === position && !s.wager);
    if (candidates.length === 0) {
      setNotice(`No open ${position} slot this week — clear one from your Lineup first.`);
      setTimeout(() => setNotice(null), 2500);
      return;
    }
    setTarget({
      leagueId: league.id,
      teamId: userTeam.id,
      week: league.currentWeek,
      slotId: candidates[0].slotId,
      slotPosition: position,
      gameId: game.id,
      marketKey,
      outcome,
      playerId,
      playerName,
      label: label ?? playerName ?? `${away.abbrev} @ ${home.abbrev}`,
    });
  }

  const remainingBudget =
    league && userTeam
      ? league.settings.weeklyCredits -
        (league.rostersByTeamWeek[rosterKey(userTeam.id, league.currentWeek)]?.slots.reduce(
          (sum, s) => sum + (s.wager?.stake ?? 0),
          0,
        ) ?? 0)
      : 0;

  return (
    <div className="flex flex-col">
      <BackHeader title="Game Details" fallback="/slate" />
      <div className="p-4 space-y-4">
        <div className="flex justify-between items-center gap-2">
          <div className="min-w-0">
            {/* Nicknames (not full city + name) plus a fixed truncate fallback --
             * between the two, this can't spill onto a second line regardless of
             * how long the two team names are. */}
            <p className="font-bold flex items-center gap-1.5 truncate">
              <TeamMark team={away} size="sm" />
              <span className="truncate">{away.name}</span>
              <span className="text-text-muted shrink-0">@</span>
              <TeamMark team={home} size="sm" />
              <span className="truncate">{home.name}</span>
            </p>
            <p className="text-xs text-text-muted">
              {new Date(game.kickoff).toLocaleString(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </p>
          </div>
          <StatusPill status={game.status} />
        </div>

        {notice && <p className="text-xs bg-loss/10 text-loss rounded-lg px-3 py-2">{notice}</p>}

        <div className="bg-bg-card border border-border rounded-xl p-3">
          <p className="font-semibold text-sm mb-2">Game Markets</p>
          <GameLinesTable
            game={game}
            showTotal
            onSelectSpread={(o) => tryOpenBetSlip('spreads', o, 'ML', undefined, undefined, `${away.abbrev} @ ${home.abbrev}`)}
            onSelectMoneyline={(o) => tryOpenBetSlip('h2h', o, 'ML', undefined, undefined, `${away.abbrev} @ ${home.abbrev}`)}
          />
        </div>

        <div>
          <p className="font-semibold text-sm mb-2">Player Props</p>
          <div className="flex gap-2 overflow-x-auto pb-2 mb-1">
            {POSITION_TABS.map((pos) => (
              <button
                key={pos}
                onClick={() => setPositionFilter(pos)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 ${
                  positionFilter === pos ? 'bg-primary text-white' : 'bg-bg-card text-text-muted border border-border'
                }`}
              >
                {pos}
              </button>
            ))}
          </div>
          <div className="bg-bg-card border border-border rounded-xl p-3 space-y-2">
            {playerGroups.length === 0 ? (
              <p className="text-xs text-text-muted text-center py-3">No {positionFilter === 'All' ? '' : positionFilter} props for this game.</p>
            ) : (
              playerGroups.map((group) => (
                <PlayerPropsCard
                  key={group.playerId}
                  group={group}
                  altLinesEnabled={league?.settings.altLinesEnabled}
                  onSelect={(market, o) => tryOpenBetSlip(market.key, o, group.position, group.playerId, group.playerName)}
                />
              ))
            )}
          </div>
        </div>

        {target && league && (
          <BetSlipSheet
            target={target}
            settings={league.settings}
            remainingBudget={remainingBudget}
            pool={league.prizePool}
            teamCount={league.teams.length}
            multiplier={userTeam ? (activeMultipliers(league)[userTeam.id] ?? 1) : 1}
            onClose={() => setTarget(null)}
            onConfirmed={() => {
              setTarget(null);
              navigate('/lineup');
            }}
          />
        )}
      </div>
    </div>
  );
}