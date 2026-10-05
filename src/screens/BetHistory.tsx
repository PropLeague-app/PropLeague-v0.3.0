import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search, Ticket, X } from 'lucide-react';
import { ShareButton } from '../share/ShareButton';
import { SlipShareCard, type SlipRow } from '../share/cards/SlipShareCard';
import type { ShareStatus } from '../share/palette';
import { useAppStore } from '../store/useAppStore';
import { formatCents, formatOdds } from '../engine/oddsMath';
import { isWagerVisibleToViewer, LEAGUE_VIEW_ID } from '../engine/stats';
import { resolveGame, gameHasStarted } from '../services/oddsService';
import { OddsDisplay } from '../components/common/OddsDisplay';
import { StatusPill } from '../components/common/StatusPill';
import { WagerResultTicker } from '../components/common/WagerResultTicker';
import { PositionBadge } from '../components/common/PositionBadge';
import { TeamLogo } from '../components/common/TeamLogo';
import { EmptyState } from '../components/common/EmptyState';
import { BackHeader } from '../components/layout/BackHeader';
import { MemberSelector } from '../components/common/MemberSelector';
import { PillSelect } from '../components/common/PillSelect';
import { CompactInput } from '../components/common/CompactInput';
import { MARKET_LABELS, wagerLineDescription } from '../data/propsGenerator';
import { weekLabel, weekOrder, type MarketKey, type SlotPosition, type WagerStatus, type WeekId } from '../types';
import {
  BET_SORT_OPTIONS,
  ODDS_BUCKET_LABELS,
  oddsBucket,
  sortBets,
  stakeSizeLabel,
  type BetPreset,
  type BetSort,
  type OddsBucket,
  type StakeSize,
} from '../engine/betFilters';
import { stakeBucket } from '../engine/stats';

type StatusFilter = 'all' | 'open' | 'settled';
type ResultFilter = 'all' | WagerStatus;
type PositionFilter = 'all' | SlotPosition;

const RESULT_OPTIONS: { value: ResultFilter; label: string }[] = [
  { value: 'all', label: 'All results' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
  { value: 'push', label: 'Push' },
  { value: 'voided', label: 'Void' },
];

const POSITION_OPTIONS: { value: PositionFilter; label: string }[] = [
  { value: 'all', label: 'All slots' },
  { value: 'QB', label: 'QB' },
  { value: 'RB', label: 'RB' },
  { value: 'WR', label: 'WR' },
  { value: 'TE', label: 'TE' },
  { value: 'K', label: 'K' },
  { value: 'ML', label: 'ML' },
];

export function BetHistory() {
  const navigate = useNavigate();
  // A tapped stat row on My Stats lands here with a preset (see engine/betFilters BetPreset): the
  // bets behind that number, already filtered, with the filters showing so they can be changed.
  const preset = (useLocation().state as { preset?: BetPreset } | null)?.preset;
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));
  const userTeam = league?.teams.find((t) => t.isUser);
  const realGamesById = useAppStore((s) => s.realGamesById);
  const loadRealGame = useAppStore((s) => s.loadRealGame);
  const realPlayerStatsByWeek = useAppStore((s) => s.realPlayerStatsByWeek);
  const loadRealPlayerStatsForWeek = useAppStore((s) => s.loadRealPlayerStatsForWeek);
  const oddsFormat = useAppStore((s) => s.profile?.oddsFormat ?? 'american');

  // manual v0.3.0 §5: browse any league member's bet history, defaulting to the
  // signed-in user's own team. LEAGUE_VIEW_ID (Sept 2026 chat: "league aggregate
  // stats") is a third option alongside "my own team" and "another single team" --
  // it folds every team's bets into one list instead of picking a viewedTeam at all.
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(preset?.team ?? null);
  const isLeagueView = selectedTeamId === LEAGUE_VIEW_ID;
  const viewedTeam = isLeagueView ? undefined : (league?.teams.find((t) => t.id === selectedTeamId) ?? userTeam);
  const isOwnTeam = !!viewedTeam && !!userTeam && viewedTeam.id === userTeam.id;

  // A bet's game might span any past week, not just the current one -- unlike
  // Lineup.tsx (which only ever needs the current week's wagered games), bet
  // history needs every real game this team has ever bet on loaded, or gameStarted
  // below silently falls back to "unknown" for every past-week real wager (see
  // chat: resolveGame/gameHasStarted in oddsService.ts). In the league-aggregate
  // view that widens to every real game every team has ever bet on.
  useEffect(() => {
    if (!league || !userTeam) return;
    const gameIds = new Set<string>();
    for (const roster of Object.values(league.rostersByTeamWeek)) {
      if (!isLeagueView && roster.teamId !== viewedTeam?.id) continue;
      for (const slot of roster.slots) if (slot.wager) gameIds.add(slot.wager.gameId);
    }
    for (const gameId of gameIds) if (!realGamesById[gameId]) loadRealGame(gameId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league, userTeam, viewedTeam?.id, isLeagueView]);

  const [weekFilter, setWeekFilter] = useState<'all' | string>(preset?.week ?? 'all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(preset?.settledOnly ? 'settled' : 'all');
  const [resultFilter, setResultFilter] = useState<ResultFilter>(preset?.result ?? 'all');
  const [positionFilter, setPositionFilter] = useState<PositionFilter>(preset?.position ?? 'all');
  const [marketFilter, setMarketFilter] = useState<'all' | MarketKey>(preset?.market ?? 'all');
  const [oddsFilter, setOddsFilter] = useState<OddsBucket | null>(preset?.oddsBucket ?? null);
  const [sideFilter, setSideFilter] = useState<'over' | 'under' | null>(preset?.side ?? null);
  const [stakeFilter, setStakeFilter] = useState<StakeSize | null>(preset?.stake ?? null);
  const [sort, setSort] = useState<BetSort>('newest');
  const [search, setSearch] = useState(preset?.player ?? '');

  const allBets = useMemo(() => {
    if (!league || !userTeam) return [];
    const rosters = isLeagueView
      ? Object.values(league.rostersByTeamWeek)
      : Object.values(league.rostersByTeamWeek).filter((r) => r.teamId === viewedTeam?.id);
    return rosters
      .flatMap((r) => r.slots.map((s) => ({ week: r.week, slot: s, teamId: r.teamId })))
      .filter((b) => b.slot.wager)
      .filter(({ week, slot, teamId }) =>
        isWagerVisibleToViewer({
          isOwnTeam: teamId === userTeam.id,
          hidePicks: league.settings.hidePicks,
          wagerWeek: week,
          currentWeek: league.currentWeek,
          wagerStatus: slot.wager!.status,
          gameStarted: gameHasStarted(resolveGame(slot.wager!.gameId, realGamesById, league.currentWeek, league.settings.lineMovementEnabled, league.manualGameOverrides)),
        }),
      );
  }, [league, userTeam, viewedTeam?.id, isLeagueView, realGamesById]);

  // Markets this person has actually bet on, for the market filter.
  const marketOptions = useMemo(() => {
    const keys = new Set<MarketKey>();
    for (const b of allBets) keys.add(b.slot.wager!.marketKey);
    return [...keys].sort((a, b) => MARKET_LABELS[a].localeCompare(MARKET_LABELS[b]));
  }, [allBets]);

  const weekOptions = useMemo(() => {
    const weeks = new Map<string, WeekId>();
    for (const b of allBets) weeks.set(String(b.week), b.week);
    return [...weeks.values()].sort((a, b) => weekOrder(a) - weekOrder(b));
  }, [allBets]);

  // Powers each settled ticket's result ticker (see WagerResultTicker) --
  // unlike the real-games effect above this can span every week the viewed
  // team/league has ever bet on, not just the current one, so it loads
  // whichever of those weeks haven't been fetched yet rather than a single id.
  useEffect(() => {
    for (const week of weekOptions) {
      if (!realPlayerStatsByWeek[String(week)]) loadRealPlayerStatsForWeek(week);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekOptions]);

  const anyFilterActive =
    weekFilter !== 'all' ||
    statusFilter !== 'all' ||
    resultFilter !== 'all' ||
    positionFilter !== 'all' ||
    marketFilter !== 'all' ||
    oddsFilter != null ||
    sideFilter != null ||
    stakeFilter != null ||
    search !== '';

  const bets = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = allBets.filter(({ week, slot }) => {
      const wager = slot.wager!;
      if (weekFilter !== 'all' && String(week) !== weekFilter) return false;
      if (statusFilter === 'open' && wager.status !== 'pending') return false;
      if (statusFilter === 'settled' && wager.status === 'pending') return false;
      if (resultFilter !== 'all' && wager.status !== resultFilter) return false;
      if (positionFilter !== 'all' && slot.position !== positionFilter) return false;
      if (marketFilter !== 'all' && wager.marketKey !== marketFilter) return false;
      if (oddsFilter && oddsBucket(wager.oddsAtPlacement) !== oddsFilter) return false;
      if (sideFilter && wager.side.toLowerCase() !== sideFilter) return false;
      if (stakeFilter && stakeBucket(wager.stake) !== stakeFilter) return false;
      if (q && !(wager.playerName ?? wager.side).toLowerCase().includes(q)) return false;
      return true;
    });
    return sortBets(filtered, sort, ({ week, slot }) => ({
      placedAt: slot.wager!.placedAt,
      stake: slot.wager!.stake,
      odds: slot.wager!.oddsAtPlacement,
      profit: slot.wager!.settledProfit,
      week,
    }));
  }, [allBets, weekFilter, statusFilter, resultFilter, positionFilter, marketFilter, oddsFilter, sideFilter, stakeFilter, search, sort]);

  if (!league || !userTeam || (!isLeagueView && !viewedTeam)) return null;

  const settled = bets.filter((b) => b.slot.wager!.status !== 'pending');
  const won = settled.filter((b) => b.slot.wager!.status === 'won').length;
  const lost = settled.filter((b) => b.slot.wager!.status === 'lost').length;
  const totalPL = settled.reduce((sum, b) => sum + (b.slot.wager!.settledProfit ?? 0), 0);
  const totalWagered = bets.reduce((sum, b) => sum + b.slot.wager!.stake, 0);
  const winRate = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : 0;
  const title = isLeagueView ? 'League Bets' : isOwnTeam ? 'My Bets' : `${viewedTeam!.teamName}'s Bets`;

  // Share: a slip of the bets currently on screen (filters included), or one ticket on its own.
  const gameStartedFor = (gameId: string) =>
    gameHasStarted(resolveGame(gameId, realGamesById, league.currentWeek, league.settings.lineMovementEnabled, league.manualGameOverrides));
  const toSlipRow = ({ slot, teamId }: (typeof bets)[number]): SlipRow => {
    const wager = slot.wager!;
    const betTeam = isLeagueView ? league.teams.find((t) => t.id === teamId) : undefined;
    return {
      id: wager.id,
      position: slot.position,
      name: wager.playerName ?? MARKET_LABELS[wager.marketKey],
      line: wagerLineDescription(wager),
      who: betTeam ? (betTeam.isUser ? 'You' : betTeam.teamName) : null,
      status: wager.status === 'pending' ? (gameStartedFor(wager.gameId) ? 'live' : 'pending') : (wager.status as ShareStatus),
      stake: wager.stake,
      oddsText: formatOdds(wager.oddsAtPlacement, oddsFormat),
      profit: wager.settledProfit ?? null,
    };
  };
  const slipTotals = (items: typeof bets) => {
    const done = items.filter((b) => b.slot.wager!.status !== 'pending' && b.slot.wager!.status !== 'voided');
    const w = done.filter((b) => b.slot.wager!.status === 'won').length;
    const l = done.filter((b) => b.slot.wager!.status === 'lost').length;
    const p = done.filter((b) => b.slot.wager!.status === 'push').length;
    return {
      record: `${w}-${l}${p > 0 ? `-${p}` : ''}`,
      voids: items.filter((b) => b.slot.wager!.status === 'voided').length,
      wagered: items.reduce((sum, b) => sum + b.slot.wager!.stake, 0),
      net: done.length > 0 ? done.reduce((sum, b) => sum + (b.slot.wager!.settledProfit ?? 0), 0) : null,
    };
  };
  const filteredWeek = weekFilter !== 'all' ? weekOptions.find((w) => String(w) === weekFilter) : undefined;
  // Say what the slip is filtered to (market first, since that is what people ask about), so the
  // image makes sense on its own. The share frame turns each " · " piece into a chip. With no
  // filters it starts with "All weeks".
  const filterParts: string[] = [];
  if (marketFilter !== 'all') filterParts.push(MARKET_LABELS[marketFilter]);
  if (positionFilter !== 'all') filterParts.push(positionFilter === 'ML' ? 'Moneyline slot' : `${positionFilter} slot`);
  if (filteredWeek != null) filterParts.push(weekLabel(filteredWeek));
  if (resultFilter !== 'all') filterParts.push(RESULT_OPTIONS.find((o) => o.value === resultFilter)?.label ?? resultFilter);
  if (statusFilter !== 'all') filterParts.push(statusFilter === 'open' ? 'Open only' : 'Settled only');
  if (sideFilter) filterParts.push(sideFilter === 'over' ? 'Overs only' : 'Unders only');
  if (oddsFilter) filterParts.push(ODDS_BUCKET_LABELS[oddsFilter]);
  if (stakeFilter) filterParts.push(stakeSizeLabel(stakeFilter));
  if (search.trim()) filterParts.push(`"${search.trim()}"`);
  const pickCount = `${bets.length} pick${bets.length === 1 ? '' : 's'}`;
  const slipSubtitle = [...(filterParts.length > 0 ? filterParts : ['All weeks']), pickCount].join(' · ');

  function clearAll() {
    setWeekFilter('all');
    setStatusFilter('all');
    setResultFilter('all');
    setPositionFilter('all');
    setMarketFilter('all');
    setOddsFilter(null);
    setSideFilter(null);
    setStakeFilter(null);
    setSearch('');
  }

  return (
    <div className="flex flex-col">
      <BackHeader
        title={title}
        fallback="/home"
        right={
          <ShareButton
            title={title}
            disabled={bets.length === 0}
            label="Share these bets"
            renderCard={() => (
              <SlipShareCard leagueName={league.name} title={title} subtitle={slipSubtitle} rows={bets.map(toSlipRow)} totals={slipTotals(bets)} />
            )}
          />
        }
      />
      <div className="p-4 space-y-4">
        <MemberSelector teams={league.teams} selectedTeamId={selectedTeamId ?? userTeam.id} onSelect={setSelectedTeamId} showLeagueOption />
        <div className="grid grid-cols-4 gap-2 text-center">
          <Stat label="Record" value={`${won}-${lost}`} />
          <Stat label="Win Rate" value={`${winRate}%`} />
          <Stat label="Wagered" value={formatCents(totalWagered)} />
          <Stat label="Net P/L" value={formatCents(totalPL)} valueClass={totalPL >= 0 ? 'text-profit' : 'text-loss'} />
        </div>

        <button
          onClick={() => navigate('/my-stats', isLeagueView ? { state: { view: 'league' } } : undefined)}
          className="text-xs text-primary font-medium"
        >
          {isLeagueView ? 'View league stats →' : 'View advanced stats →'}
        </button>

        <div className="space-y-2">
          <CompactInput value={search} onChange={setSearch} placeholder="Search player or team" icon={<Search size={16} />} />
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            <PillSelect
              ariaLabel="Sort bets"
              value={sort}
              onChange={setSort}
              options={BET_SORT_OPTIONS}
              label={`Sort: ${BET_SORT_OPTIONS.find((o) => o.value === sort)?.label}`}
              active
            />
            <PillSelect
              ariaLabel="Filter by market"
              value={marketFilter}
              onChange={setMarketFilter}
              active={marketFilter !== 'all'}
              options={[{ value: 'all', label: 'All markets' }, ...marketOptions.map((m) => ({ value: m, label: MARKET_LABELS[m] }))]}
            />
            <PillSelect
              ariaLabel="Filter by week"
              value={weekFilter}
              onChange={setWeekFilter}
              active={weekFilter !== 'all'}
              options={[{ value: 'all', label: 'All weeks' }, ...weekOptions.map((w) => ({ value: String(w), label: weekLabel(w) }))]}
            />
            <PillSelect
              ariaLabel="Filter by status"
              value={statusFilter}
              onChange={setStatusFilter}
              active={statusFilter !== 'all'}
              options={[
                { value: 'all', label: 'Open & settled' },
                { value: 'open', label: 'Open only' },
                { value: 'settled', label: 'Settled only' },
              ]}
            />
            <PillSelect ariaLabel="Filter by result" value={resultFilter} onChange={setResultFilter} active={resultFilter !== 'all'} options={RESULT_OPTIONS} />
            <PillSelect ariaLabel="Filter by slot" value={positionFilter} onChange={setPositionFilter} active={positionFilter !== 'all'} options={POSITION_OPTIONS} />
            {anyFilterActive && (
              <button onClick={clearAll} className="text-[11px] text-primary font-semibold shrink-0 px-1">
                Clear all
              </button>
            )}
          </div>
          {(oddsFilter || sideFilter || stakeFilter) && (
            <div className="flex flex-wrap gap-1.5">
              {oddsFilter && <FilterChip label={ODDS_BUCKET_LABELS[oddsFilter]} onClear={() => setOddsFilter(null)} />}
              {sideFilter && <FilterChip label={sideFilter === 'over' ? 'Overs only' : 'Unders only'} onClear={() => setSideFilter(null)} />}
              {stakeFilter && <FilterChip label={stakeSizeLabel(stakeFilter)} onClear={() => setStakeFilter(null)} />}
            </div>
          )}
        </div>

        {bets.length === 0 ? (
          <EmptyState
            icon={<Ticket size={36} strokeWidth={1.5} />}
            title={anyFilterActive ? 'No bets match those filters' : 'No bets yet'}
            subtitle={anyFilterActive ? 'Try clearing a filter or two.' : 'Wagers you place will show up here with full ticket detail.'}
          />
        ) : (
          <div className="space-y-2">
            {bets.map(({ week, slot, teamId }) => {
              const wager = slot.wager!;
              // Only shown in the league-aggregate view -- with every team's bets
              // mixed into one list, whose pick this is stops being obvious
              // otherwise (see chat: "league aggregate stats").
              const betTeam = isLeagueView ? league.teams.find((t) => t.id === teamId) : undefined;
              return (
                <div key={wager.id} className="bg-bg-card border border-border rounded-xl p-2.5 space-y-1">
                  {betTeam && (
                    <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
                      <TeamLogo team={betTeam} size="xs" />
                      <span className="truncate">{betTeam.isUser ? 'You' : betTeam.teamName}</span>
                    </div>
                  )}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <PositionBadge position={slot.position} />
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold truncate">{wager.playerName ?? MARKET_LABELS[wager.marketKey]}</p>
                        <p className="text-[11px] text-text-muted truncate">{wagerLineDescription(wager)}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <StatusPill status={wager.status} />
                      <WagerResultTicker
                        marketKey={wager.marketKey}
                        status={wager.status}
                        stat={
                          wager.playerName
                            ? realPlayerStatsByWeek[String(week)]?.[wager.playerName.trim().toLowerCase()]
                            : undefined
                        }
                        game={(() => {
                          const g = resolveGame(wager.gameId, realGamesById, league.currentWeek, league.settings.lineMovementEnabled, league.manualGameOverrides);
                          return g ? { homeScore: g.homeScore, awayScore: g.awayScore } : undefined;
                        })()}
                      />
                    </div>
                  </div>
                  <div className="flex justify-between text-[11px] text-text-muted pt-1 border-t border-border">
                    <span>{weekLabel(week)}</span>
                    <span className="flex items-center gap-2">
                      {new Date(wager.placedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      <ShareButton
                        size="sm"
                        title="Bet Slip"
                        label="Share this bet"
                        renderCard={() => (
                          <SlipShareCard
                            leagueName={league.name}
                            title="Bet Slip"
                            subtitle={`${weekLabel(week)} · ${league.teams.find((t) => t.id === teamId)?.teamName ?? ''}`}
                            rows={[toSlipRow({ week, slot, teamId })]}
                            totals={slipTotals([{ week, slot, teamId }])}
                          />
                        )}
                      />
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span>
                      Stake ${wager.stake.toFixed(2)} @ <OddsDisplay odds={wager.oddsAtPlacement} />
                    </span>
                    <span className={wager.settledProfit == null ? 'text-text-muted' : wager.settledProfit >= 0 ? 'text-profit' : 'text-loss'}>
                      {wager.settledProfit == null ? 'Pending' : formatCents(wager.settledProfit)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, valueClass = '' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="bg-bg-card border border-border rounded-lg py-2 px-1">
      <p className={`text-sm font-bold whitespace-nowrap ${valueClass}`}>{value}</p>
      <p className="text-[10px] text-text-muted">{label}</p>
    </div>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button onClick={onClear} className="flex items-center gap-1 bg-primary/10 text-primary text-[11px] font-semibold rounded-full pl-2.5 pr-1.5 py-1">
      {label}
      <X size={12} />
    </button>
  );
}
