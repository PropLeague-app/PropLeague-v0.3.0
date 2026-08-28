import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { getGame, getGameMarkets, getPlayerPropGroups } from '../services/oddsService';
import { nflTeamById } from '../data/nflTeams';
import { buildEmptyRoster, rosterKey } from '../engine/rosterSlots';
import { activeMultipliers } from '../engine/prizePool';
import { MarketRow } from '../components/roster/MarketRow';
import { BetSlipSheet, type BetSlipTarget } from '../components/roster/BetSlipSheet';
import { StatusPill } from '../components/common/StatusPill';
import { BackHeader } from '../components/layout/BackHeader';
import type { OddsMarket, OddsOutcome, Position } from '../types';

export function GameDetail() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));
  const setGameOverride = useAppStore((s) => s.setGameOverride);
  const [target, setTarget] = useState<BetSlipTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const game = gameId
    ? getGame(gameId, league?.currentWeek ?? 1, league?.settings.lineMovementEnabled ?? true, league?.manualGameOverrides)
    : undefined;
  if (!game) {
    return (
      <div className="flex flex-col">
        <BackHeader title="Game Detail" fallback="/slate" />
        <div className="p-4 text-text-muted text-sm">Game not found.</div>
      </div>
    );
  }

  const home = nflTeamById(game.homeTeamId);
  const away = nflTeamById(game.awayTeamId);
  const { h2h, spreads, totals } = getGameMarkets(game);
  const playerGroups = getPlayerPropGroups(game);
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
      <BackHeader title="Game Detail" fallback="/slate" />
      <div className="p-4 space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <p className="font-bold">{away.city} {away.name} @ {home.city} {home.name}</p>
          <p className="text-xs text-text-muted">
            {new Date(game.kickoff).toLocaleString(undefined, { weekday: 'long', hour: 'numeric', minute: '2-digit' })}
          </p>
        </div>
        <StatusPill status={game.status} />
      </div>

      {league && game.week === league.currentWeek && game.status !== 'final' && (
        <div className="flex gap-2 bg-bg-card border border-border rounded-lg p-2">
          <p className="text-[11px] text-text-muted flex-1 self-center">Dev: game stepper</p>
          {game.status === 'upcoming' && (
            <button
              onClick={() => setGameOverride(league.id, game.id, 'live')}
              className="text-xs font-semibold text-loss border border-loss/40 rounded-lg px-2.5 py-1"
            >
              Go Live
            </button>
          )}
          <button
            onClick={() => setGameOverride(league.id, game.id, 'final')}
            className="text-xs font-semibold text-primary border border-primary/40 rounded-lg px-2.5 py-1"
          >
            Go Final
          </button>
        </div>
      )}

      {notice && <p className="text-xs bg-loss/10 text-loss rounded-lg px-3 py-2">{notice}</p>}

      <div className="bg-bg-card border border-border rounded-xl p-3">
        <p className="font-semibold text-sm mb-1">Game Markets</p>
        {h2h && (
          <MarketRow
            label="Moneyline"
            market={h2h}
            onSelect={(o) => tryOpenBetSlip('h2h', o, 'ML', undefined, undefined, `${away.abbrev} @ ${home.abbrev}`)}
          />
        )}
        {spreads && (
          <MarketRow
            label="Spread"
            market={spreads}
            onSelect={(o) => tryOpenBetSlip('spreads', o, 'ML', undefined, undefined, `${away.abbrev} @ ${home.abbrev}`)}
          />
        )}
        {totals && <MarketRow label="Total" market={totals} onSelect={() => setNotice('Totals are informational only in v0.01.')} disabled />}
      </div>

      <div>
        <p className="font-semibold text-sm mb-2">Player Props</p>
        <div className="space-y-3">
          {[away.id, home.id].map((teamId) => (
            <div key={teamId} className="bg-bg-card border border-border rounded-xl p-3">
              <p className="text-xs text-text-muted mb-1">{nflTeamById(teamId).abbrev}</p>
              {playerGroups
                .filter((g) => g.teamId === teamId)
                .map((group) => (
                  <div key={group.playerId} className="mb-1 last:mb-0">
                    <div className="flex items-center gap-1.5 pt-1">
                      <p className="text-sm font-semibold">{group.playerName}</p>
                      {group.injury && (
                        <span className="text-[10px] font-bold text-loss border border-loss rounded px-1">{group.injury}</span>
                      )}
                    </div>
                    {group.markets.map((market, idx) => (
                      <MarketRow
                        key={`${market.key}-${idx}`}
                        label={group.playerName}
                        market={market}
                        altLinesEnabled={league?.settings.altLinesEnabled}
                        onSelect={(o) => tryOpenBetSlip(market.key, o, group.position, group.playerId, group.playerName)}
                      />
                    ))}
                  </div>
                ))}
            </div>
          ))}
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
