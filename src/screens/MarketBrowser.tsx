import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { buildEmptyRoster, rosterKey } from '../engine/rosterSlots';
import { getSlate, getPlayerPropGroups } from '../services/oddsService';
import { refreshPlayerProps } from '../services/supabaseOdds';
import { nflTeamById } from '../data/nflTeams';
import { MARKETS_BY_POSITION, MARKET_LABELS } from '../data/propsGenerator';
import { PlayerPropsCard } from '../components/roster/PlayerPropsCard';
import { GameLinesTable } from '../components/roster/GameLinesTable';
import { TeamMark } from '../components/common/TeamMark';
import { BetSlipSheet, type BetSlipTarget } from '../components/roster/BetSlipSheet';
import { EmptyState } from '../components/common/EmptyState';
import { goBack } from '../components/layout/BackHeader';
import { findClaimingTeam, claimBlockReason, claimHolders } from '../engine/duplicatePicks';
import { activeMultipliers } from '../engine/prizePool';
import type { LeagueTeam, MarketKey, NFLTeam, OddsOutcome } from '../types';

/** Matches a search query against a team's city, nickname, full name, or
 * abbreviation -- so "Kans", "Chie", "KC", "Kansas City Chiefs", or the
 * completed individual words all find the Kansas City Chiefs,
 * case-insensitively. */
function teamMatchesSearch(team: NFLTeam, query: string): boolean {
  const q = query.trim().toLowerCase();
  return (
    team.city.toLowerCase().includes(q) ||
    team.name.toLowerCase().includes(q) ||
    team.abbrev.toLowerCase().includes(q) ||
    `${team.city} ${team.name}`.toLowerCase().includes(q)
  );
}

export function MarketBrowser() {
  const { slotId } = useParams<{ slotId: string }>();
  const navigate = useNavigate();
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));
  const userTeam = league?.teams.find((t) => t.isUser);
  const loadWeekRosters = useAppStore((s) => s.loadWeekRosters);
  const loadRealGamesForWeek = useAppStore((s) => s.loadRealGamesForWeek);
  const realGamesForWeek = useAppStore((s) => (league ? s.realGamesByWeek[String(league.currentWeek)] : undefined));

  useEffect(() => {
    if (league) loadWeekRosters(league.id, league.currentWeek);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league?.id, league?.currentWeek]);

  useEffect(() => {
    if (league) loadRealGamesForWeek(league.currentWeek);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league?.currentWeek]);

  const [gameFilter, setGameFilter] = useState('all');
  const [propTypeFilter, setPropTypeFilter] = useState<MarketKey | 'all'>('all');
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState<BetSlipTarget | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);

  async function handleRefreshOdds() {
    setRefreshing(true);
    setRefreshMessage(null);
    const result = await refreshPlayerProps();
    setRefreshing(false);
    if (result.onCooldown) {
      const minutes = Math.ceil((result.secondsRemaining ?? 0) / 60);
      setRefreshMessage(`Odds were just refreshed — try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
      return;
    }
    if (!result.ok) {
      setRefreshMessage(result.error ?? 'Could not refresh odds.');
      return;
    }
    setRefreshMessage(`Refreshed real odds for ${result.gamesUpdated ?? 0} game${result.gamesUpdated === 1 ? '' : 's'}.`);
    if (league) loadRealGamesForWeek(league.currentWeek);
  }

  const roster = useMemo(() => {
    if (!league || !userTeam) return undefined;
    return (
      league.rostersByTeamWeek[rosterKey(userTeam.id, league.currentWeek)] ??
      buildEmptyRoster(userTeam.id, league.currentWeek, league.settings.lineupSlots)
    );
  }, [league, userTeam]);

  const slot = roster?.slots.find((s) => s.slotId === slotId);

  const games = useMemo(() => {
    if (!league) return [];
    // Real games, when we have them for this week, take priority — only games
    // that actually have real odds attached are worth showing as "real" (an
    // empty bookmakers array would mean nothing to bet on); otherwise fall back
    // to the local simulated slate, unchanged from before this existed.
    const real = realGamesForWeek?.filter((g) => g.status === 'upcoming' && g.bookmakers.length > 0);
    if (real && real.length > 0) return real;
    return getSlate(league.currentWeek, league.currentWeek, league.settings.lineMovementEnabled).filter((g) => g.status === 'upcoming');
  }, [league, realGamesForWeek]);

  const filteredGames =
    (gameFilter === 'all' ? games : games.filter((g) => g.id === gameFilter)).filter((g) =>
      slot?.position === 'ML' && search.trim()
        ? teamMatchesSearch(nflTeamById(g.homeTeamId), search) || teamMatchesSearch(nflTeamById(g.awayTeamId), search)
        : true,
    );
  const validMarketKeys = slot?.position === 'ML' ? (['h2h', 'spreads'] as MarketKey[]) : MARKETS_BY_POSITION[slot?.position as keyof typeof MARKETS_BY_POSITION] ?? [];
  const propTypeOptions = propTypeFilter === 'all' ? validMarketKeys : [propTypeFilter];

  if (!league || !userTeam || !roster || !slot) {
    return (
      <div className="flex flex-col">
        <div className="p-4 pb-2 flex items-center gap-2">
          <button onClick={() => goBack(navigate, '/lineup')} className="text-text-muted flex items-center gap-0.5">
            <span className="text-xl leading-none">‹</span>
            <span className="text-sm">Back</span>
          </button>
        </div>
        <div className="px-4 text-text-muted text-sm">Slot not found.</div>
      </div>
    );
  }

  const remainingBudget =
    league.settings.weeklyCredits - roster.slots.reduce((sum, s) => sum + (s.wager?.stake ?? 0), 0);

  /** Struck-through/red market rows (manual v0.1.1 §3 #7) — checked per-outcome so an
   * alt line the user can still take isn't hidden just because the standard line was
   * claimed by someone else. */
  const currentLeague = league;
  const currentUserTeam = userTeam;
  function checkBlockedFor(gameId: string, marketKey: MarketKey, playerId: string | undefined) {
    return (outcome: OddsOutcome): string | null => {
      const claimingTeamId = findClaimingTeam(
        currentLeague,
        currentLeague.currentWeek,
        { gameId, marketKey, playerId, side: outcome.name, point: outcome.point },
        currentUserTeam.id,
      );
      if (!claimingTeamId) return null;
      return claimBlockReason(currentLeague, claimingTeamId);
    };
  }

  /** manual v0.2.0 §3 #4: "N of cap claimed" progress indicator for leagues where
   * duplicates are limited but not yet exhausted — shown in addition to (and before)
   * the red/strikethrough full state MarketRow already renders once the cap is hit. */
  function checkClaimStatusFor(gameId: string, marketKey: MarketKey, playerId: string | undefined) {
    return (outcome: OddsOutcome): { holderTeams: LeagueTeam[]; cap: number } | null => {
      const cap = currentLeague.settings.maxDuplicatePicks;
      if (cap == null) return null;
      const holders = claimHolders(
        currentLeague,
        currentLeague.currentWeek,
        { gameId, marketKey, playerId, side: outcome.name, point: outcome.point },
        currentUserTeam.id,
      );
      if (holders.length === 0) return null;
      const holderTeams = holders.map((id) => currentLeague.teams.find((t) => t.id === id)).filter((t): t is LeagueTeam => !!t);
      return { holderTeams, cap };
    };
  }

  return (
    <div className="flex flex-col">
      <div className="p-4 pb-2 sticky top-0 bg-bg-raised z-10 border-b border-border">
        <div className="flex items-center gap-2 mb-3">
          <button onClick={() => goBack(navigate, '/lineup')} className="text-text-muted flex items-center gap-0.5">
            <span className="text-xl leading-none">‹</span>
            <span className="text-sm">Back</span>
          </button>
          <h1 className="text-lg font-bold flex-1">Add {slot.position} Pick</h1>
          <button
            onClick={handleRefreshOdds}
            disabled={refreshing}
            className="text-xs text-primary font-medium border border-border rounded-lg px-2.5 py-1.5 disabled:opacity-40 shrink-0"
          >
            {refreshing ? 'Refreshing…' : 'Refresh Odds'}
          </button>
        </div>
        {refreshMessage && <p className="text-xs text-text-muted mb-2">{refreshMessage}</p>}
        <div className="space-y-2">
          <div className="flex gap-2">
            <select
              value={gameFilter}
              onChange={(e) => setGameFilter(e.target.value)}
              className="bg-bg-card border border-border rounded-lg px-2 py-1.5 text-xs flex-1 min-w-0"
            >
              <option value="all">All games</option>
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {nflTeamById(g.awayTeamId).abbrev} @ {nflTeamById(g.homeTeamId).abbrev}
                </option>
              ))}
            </select>
            {slot.position !== 'ML' && (
              <select
                value={propTypeFilter}
                onChange={(e) => setPropTypeFilter(e.target.value as MarketKey | 'all')}
                className="bg-bg-card border border-border rounded-lg px-2 py-1.5 text-xs flex-1 min-w-0"
              >
                <option value="all">All prop types</option>
                {validMarketKeys.map((key) => (
                  <option key={key} value={key}>
                    {MARKET_LABELS[key]}
                  </option>
                ))}
              </select>
            )}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={slot.position === 'ML' ? 'Search team (name, city, or abbreviation)' : 'Search player'}
            className="w-full bg-bg-card border border-border rounded-lg px-2 py-1.5 text-xs"
          />
        </div>
      </div>

      <div className="px-4 py-2 space-y-3">
        {filteredGames.length === 0 && (
          <EmptyState icon={<Search size={36} strokeWidth={1.5} />} title="No games available" subtitle="Every game for this week has already kicked off." />
        )}

        {slot.position === 'ML'
          ? filteredGames.map((game) => {
              const away = nflTeamById(game.awayTeamId);
              const home = nflTeamById(game.homeTeamId);
              return (
                <div key={game.id} className="bg-bg-card border border-border rounded-xl p-3">
                  <GameLinesTable
                    game={game}
                    checkBlocked={(marketKey, outcome) => checkBlockedFor(game.id, marketKey, undefined)(outcome)}
                    onSelectSpread={
                      propTypeOptions.includes('spreads')
                        ? (outcome) =>
                            setTarget({
                              leagueId: league.id,
                              teamId: userTeam.id,
                              week: league.currentWeek,
                              slotId: slot.slotId,
                              slotPosition: slot.position,
                              gameId: game.id,
                              marketKey: 'spreads',
                              outcome,
                              label: `${away.abbrev} @ ${home.abbrev}`,
                            })
                        : undefined
                    }
                    onSelectMoneyline={
                      propTypeOptions.includes('h2h')
                        ? (outcome) =>
                            setTarget({
                              leagueId: league.id,
                              teamId: userTeam.id,
                              week: league.currentWeek,
                              slotId: slot.slotId,
                              slotPosition: slot.position,
                              gameId: game.id,
                              marketKey: 'h2h',
                              outcome,
                              label: `${away.abbrev} @ ${home.abbrev}`,
                            })
                        : undefined
                    }
                  />
                </div>
              );
            })
          : filteredGames.map((game) => {
              const groups = getPlayerPropGroups(game)
                .filter((g) => g.position === slot.position)
                .filter((g) => g.playerName.toLowerCase().includes(search.toLowerCase()))
                .map((g) => ({ ...g, markets: g.markets.filter((m) => propTypeOptions.includes(m.key)) }))
                .filter((g) => g.markets.length > 0);
              if (groups.length === 0) return null;
              const home = nflTeamById(game.homeTeamId);
              const away = nflTeamById(game.awayTeamId);
              return (
                <div key={game.id} className="bg-bg-card border border-border rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs text-text-muted">
                    <TeamMark team={away} size="xs" />
                    <span>{away.abbrev}</span>
                    <span>@</span>
                    <TeamMark team={home} size="xs" />
                    <span>{home.abbrev}</span>
                  </div>
                  {groups.map((group) => (
                    <PlayerPropsCard
                      key={group.playerId}
                      group={group}
                      altLinesEnabled={league.settings.altLinesEnabled}
                      checkBlocked={(market, outcome) => checkBlockedFor(game.id, market.key, group.playerId)(outcome)}
                      checkClaimStatus={(market, outcome) => checkClaimStatusFor(game.id, market.key, group.playerId)(outcome)}
                      onSelect={(market, outcome) =>
                        setTarget({
                          leagueId: league.id,
                          teamId: userTeam.id,
                          week: league.currentWeek,
                          slotId: slot.slotId,
                          slotPosition: slot.position,
                          gameId: game.id,
                          marketKey: market.key,
                          outcome,
                          playerId: group.playerId,
                          playerName: group.playerName,
                          label: group.playerName,
                        })
                      }
                    />
                  ))}
                </div>
              );
            })}
      </div>

      {target && (
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
  );
}