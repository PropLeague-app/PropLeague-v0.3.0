import { activeMarketRules, marketBlockReason, marketSlotCapReason } from '../engine/marketRules';
import { PillSelect } from '../components/common/PillSelect';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeftRight, Lock, Search } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { buildEmptyRoster, rosterKey } from '../engine/rosterSlots';
import { getPlayerPropGroups } from '../services/oddsService';
import { useOddsRefresh } from '../hooks/useOddsRefresh';
import { useOddsFreshness, oddsFreshnessMessage } from '../hooks/useOddsFreshness';
import { nflTeamById } from '../data/nflTeams';
import { MARKETS_BY_POSITION, MARKET_LABELS } from '../data/propsGenerator';
import { PlayerPropsCard } from '../components/roster/PlayerPropsCard';
import type { ClaimStatus } from '../components/roster/MarketRow';
import { GameLinesTable } from '../components/roster/GameLinesTable';
import { TeamMark } from '../components/common/TeamMark';
import { BetSlipSheet, type BetSlipTarget } from '../components/roster/BetSlipSheet';
import { EmptyState } from '../components/common/EmptyState';
import { goBack } from '../components/layout/BackHeader';
import { findClaimingTeam, claimBlockReason, claimHolders } from '../engine/duplicatePicks';
import { activeMultipliers } from '../engine/prizePool';
import { heldTag } from '../engine/pickSwap';
import { OddsDisplay } from '../components/common/OddsDisplay';
import { formatCents } from '../engine/oddsMath';
import { PositionBadge } from '../components/common/PositionBadge';
import { pickMarket, pickTitle } from '../components/roster/pickText';
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
  const { refreshing, refreshMessage, refreshErrorDetail, handleRefreshOdds } = useOddsRefresh(() => {
    if (league) loadRealGamesForWeek(league.currentWeek);
  });

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
    // Only real games with real odds attached are ever bettable here now -- no
    // more falling back to the local simulated slate (see chat, Sept 2026: that
    // fallback let a user place a real wager on a fully fake game, keyed to a
    // data/seed.ts id that will never appear in real_games. settle-week can
    // never find that game final, so the wager would sit "pending"/"Live"
    // forever -- unfixable, since no real data for a fake game is ever coming.
    // An empty slate while odds are still posting is a much safer failure mode
    // than a wager nothing can ever settle.
    const base = (realGamesForWeek ?? []).filter((g) => g.status === 'upcoming' && g.bookmakers.length > 0);
    // Supabase doesn't guarantee kickoff order (rows come back in whatever
    // order the query happened to fetch them) -- sort explicitly so the
    // soonest games always list first.
    return [...base].sort((a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime());
  }, [league, realGamesForWeek]);

  const freshness = useOddsFreshness(games);
  const freshnessMessage = oddsFreshnessMessage(freshness);

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

  // Swap mode (the ⇄ on a filled slot): the pick stays in the slot until a new one is confirmed on
  // the bet slip. A pick whose game has started cannot be swapped (the server refuses it too).
  const held = slot.wager;
  const heldGame = held ? (realGamesForWeek ?? []).find((g) => g.id === held.gameId) : undefined;
  const heldLocked = !!held && (held.status !== 'pending' || (!!heldGame && (heldGame.status !== 'upcoming' || new Date(heldGame.kickoff).getTime() <= Date.now())));
  const heldFor = (gameId: string, marketKey: MarketKey, playerId: string | undefined) => (outcome: OddsOutcome) =>
    heldTag(held, { gameId, marketKey, playerId, side: outcome.name, point: outcome.point, price: outcome.price });

  if (held && heldLocked) {
    return (
      <div className="flex flex-col">
        <div className="p-4 pb-2 flex items-center gap-2">
          <button onClick={() => goBack(navigate, '/lineup')} className="text-text-muted flex items-center gap-0.5">
            <span className="text-xl leading-none">‹</span>
            <span className="text-sm">Back</span>
          </button>
        </div>
        <div className="px-4 flex items-center gap-2 text-text-muted text-sm">
          <Lock size={14} /> This pick's game has started, so it is locked in and cannot be swapped.
        </div>
      </div>
    );
  }

  /** Struck-through/red market rows (manual v0.1.1 §3 #7) — checked per-outcome so an
   * alt line the user can still take isn't hidden just because the standard line was
   * claimed by someone else. */
  const currentLeague = league;
  const currentUserTeam = userTeam;
  const currentRoster = roster;
  function checkBlockedFor(gameId: string, marketKey: MarketKey, playerId: string | undefined) {
    return (outcome: OddsOutcome): string | null => {
      const rules = activeMarketRules(currentLeague.settings);
      const ruleBlock =
        marketBlockReason(rules, marketKey, outcome.name) ??
        marketSlotCapReason(
          rules,
          marketKey,
          outcome.name,
          currentRoster.slots.flatMap((sl) => (sl.slotId !== slotId && sl.wager ? [{ marketKey: sl.wager.marketKey, side: sl.wager.side }] : [])),
        );
      if (ruleBlock) return ruleBlock;
      const claimingTeamId = findClaimingTeam(
        currentLeague,
        currentLeague.currentWeek,
        { gameId, marketKey, playerId, side: outcome.name, point: outcome.point },
        currentUserTeam.id,
      );
      if (!claimingTeamId) return null;
      // Every game listed here is still upcoming, so Hide Picks means the holder stays secret.
      return claimBlockReason(currentLeague, claimingTeamId, currentLeague.settings.hidePicks);
    };
  }

  /** manual v0.2.0 §3 #4: "N of cap claimed" progress indicator for leagues where
   * duplicates are limited but not yet exhausted — shown in addition to (and before)
   * the red/strikethrough full state MarketRow already renders once the cap is hit. */
  function checkClaimStatusFor(gameId: string, marketKey: MarketKey, playerId: string | undefined) {
    return (outcome: OddsOutcome): ClaimStatus | null => {
      const cap = currentLeague.settings.maxDuplicatePicks;
      if (cap == null) return null;
      const holders = claimHolders(
        currentLeague,
        currentLeague.currentWeek,
        { gameId, marketKey, playerId, side: outcome.name, point: outcome.point },
        currentUserTeam.id,
      );
      if (holders.length === 0) return null;
      const hidden = currentLeague.settings.hidePicks;
      const holderTeams = hidden ? [] : holders.map((id) => currentLeague.teams.find((t) => t.id === id)).filter((t): t is LeagueTeam => !!t);
      return { holderCount: holders.length, holderTeams, cap, hidden };
    };
  }

  return (
    <div className="flex flex-col">
      <div className="px-4 pt-2 pb-2 sticky top-0 bg-bg-raised z-10 border-b border-border">
        <div className="flex items-center gap-2 mb-3">
          <button onClick={() => goBack(navigate, '/lineup')} className="text-text-muted flex items-center gap-0.5">
            <span className="text-xl leading-none">‹</span>
            <span className="text-sm">Back</span>
          </button>
          <h1 className="text-lg font-bold flex-1 flex items-center gap-1.5 min-w-0">
            {/* Shorter than "Add ML/Spread Pick" on purpose -- this header row
                already shares space with the Back button and Refresh Odds
                button, and "Pick" doesn't add much here (see chat, Sept 2026).
                Swapping a filled slot shows the ⇄ symbol in place of "Add". */}
            {held && <ArrowLeftRight size={17} className="shrink-0 text-primary" aria-label="Swap" />}
            <span className="truncate">
              {held ? (slot.position === 'ML' ? 'ML/Spread' : `${slot.position} Pick`) : slot.position === 'ML' ? 'Add ML/Spread' : `Add ${slot.position} Pick`}
            </span>
          </h1>
          <button
            onClick={handleRefreshOdds}
            disabled={refreshing}
            className="text-xs text-primary font-medium border border-border rounded-lg px-2.5 py-1.5 disabled:opacity-40 shrink-0"
          >
            {refreshing ? 'Refreshing…' : 'Refresh Odds'}
          </button>
        </div>
        {held && (
          // The pick you hold, pinned while you look around: a compact copy of its Lineup card (same
          // position colors). It is only replaced once a new pick is confirmed on the bet slip; Back
          // leaves it as is.
          // Styled like a row of the lineup scroller on the lock screen card: plain card, the
          // position badge as the only color, the pick on one line and its market and odds under it.
          <div className="mb-2 flex items-center gap-2.5 rounded-xl border border-border bg-bg-card px-2.5 py-1.5">
            <PositionBadge position={slot.position} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold leading-tight truncate">{pickTitle(held)}</p>
              <p className="text-[10px] text-text-muted leading-tight truncate">
                {pickMarket(held)} · <OddsDisplay odds={held.oddsAtPlacement} />
              </p>
            </div>
            <div className="shrink-0 text-right leading-tight">
              <span className="block text-xs font-semibold tabular-nums">{formatCents(held.stake)}</span>
              <span className="block text-[9px] text-text-muted">Your pick</span>
            </div>
          </div>
        )}
        {freshnessMessage && <p className="mb-1.5 text-[11px] text-warning font-medium">{freshnessMessage}</p>}
        {(refreshMessage || refreshErrorDetail) && (
          <div className="mb-2 space-y-0.5">
            {refreshMessage && <p className="text-xs text-text-muted">{refreshMessage}</p>}
            {refreshErrorDetail && <p className="text-xs text-loss">{refreshErrorDetail}</p>}
          </div>
        )}
        <div className="space-y-2">
          <div className="flex gap-2">
            <PillSelect
              fill
              ariaLabel="Filter by game"
              value={gameFilter}
              onChange={setGameFilter}
              active={gameFilter !== 'all'}
              options={[
                { value: 'all', label: 'All games' },
                ...games.map((g) => ({ value: g.id, label: `${nflTeamById(g.awayTeamId).abbrev} @ ${nflTeamById(g.homeTeamId).abbrev}` })),
              ]}
            />
            {slot.position !== 'ML' && (
              <PillSelect
                fill
                ariaLabel="Filter by prop type"
                value={propTypeFilter}
                onChange={setPropTypeFilter}
                active={propTypeFilter !== 'all'}
                options={[{ value: 'all', label: 'All prop types' }, ...validMarketKeys.map((key) => ({ value: key, label: MARKET_LABELS[key] }))]}
              />
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

      <div className="px-4 pt-3 pb-2 space-y-3">
        {filteredGames.length === 0 && (
          <EmptyState
            icon={<Search size={36} strokeWidth={1.5} />}
            title="No games available"
            subtitle="Every game for this week has already kicked off, or odds haven't posted for this week yet -- try the refresh button above."
          />
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
                    checkClaimStatus={(marketKey, outcome) => checkClaimStatusFor(game.id, marketKey, undefined)(outcome)}
                    heldFor={held ? (marketKey, outcome) => heldFor(game.id, marketKey, undefined)(outcome) : undefined}
                    onSelectSpread={
                      propTypeOptions.includes('spreads')
                        ? (outcome) =>
                            setTarget({
                              leagueId: league.id,
                              teamId: userTeam.id,
                              week: league.currentWeek,
                              slotId: slot.slotId,
                              slotPosition: slot.position,
                              offerSwap: !!held,
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
                              offerSwap: !!held,
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
                      heldFor={held ? (market, outcome) => heldFor(game.id, market.key, group.playerId)(outcome) : undefined}
                      onSelect={(market, outcome) =>
                        setTarget({
                          leagueId: league.id,
                          teamId: userTeam.id,
                          week: league.currentWeek,
                          slotId: slot.slotId,
                          slotPosition: slot.position,
                          offerSwap: !!held,
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