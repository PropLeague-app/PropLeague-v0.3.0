import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ticket } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { formatCents } from '../engine/oddsMath';
import { isWagerVisibleToViewer } from '../engine/stats';
import { getGame } from '../services/oddsService';
import { OddsDisplay } from '../components/common/OddsDisplay';
import { StatusPill } from '../components/common/StatusPill';
import { PositionBadge } from '../components/common/PositionBadge';
import { EmptyState } from '../components/common/EmptyState';
import { BackHeader } from '../components/layout/BackHeader';
import { MemberSelector } from '../components/common/MemberSelector';
import { MARKET_LABELS, wagerLineDescription } from '../data/propsGenerator';
import { weekLabel, weekOrder, type SlotPosition, type WagerStatus, type WeekId } from '../types';

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
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));
  const userTeam = league?.teams.find((t) => t.isUser);

  // manual v0.3.0 §5: browse any league member's bet history, defaulting to the
  // signed-in user's own team.
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const viewedTeam = league?.teams.find((t) => t.id === selectedTeamId) ?? userTeam;
  const isOwnTeam = !!viewedTeam && !!userTeam && viewedTeam.id === userTeam.id;

  const [weekFilter, setWeekFilter] = useState<'all' | string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all');
  const [positionFilter, setPositionFilter] = useState<PositionFilter>('all');
  const [search, setSearch] = useState('');

  const allBets = useMemo(() => {
    if (!league || !viewedTeam) return [];
    return Object.values(league.rostersByTeamWeek)
      .filter((r) => r.teamId === viewedTeam.id)
      .flatMap((r) => r.slots.map((s) => ({ week: r.week, slot: s })))
      .filter((b) => b.slot.wager)
      .filter(({ week, slot }) =>
        isWagerVisibleToViewer({
          isOwnTeam,
          hidePicks: league.settings.hidePicks,
          wagerWeek: week,
          currentWeek: league.currentWeek,
          wagerStatus: slot.wager!.status,
          gameStarted: getGame(slot.wager!.gameId, league.currentWeek, league.settings.lineMovementEnabled, league.manualGameOverrides)?.status !== 'upcoming',
        }),
      )
      .sort((a, b) => (b.slot.wager!.placedAt > a.slot.wager!.placedAt ? 1 : -1));
  }, [league, viewedTeam, isOwnTeam]);

  const weekOptions = useMemo(() => {
    const weeks = new Map<string, WeekId>();
    for (const b of allBets) weeks.set(String(b.week), b.week);
    return [...weeks.values()].sort((a, b) => weekOrder(a) - weekOrder(b));
  }, [allBets]);

  const anyFilterActive =
    weekFilter !== 'all' || statusFilter !== 'all' || resultFilter !== 'all' || positionFilter !== 'all' || search !== '';

  const bets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allBets.filter(({ week, slot }) => {
      const wager = slot.wager!;
      if (weekFilter !== 'all' && String(week) !== weekFilter) return false;
      if (statusFilter === 'open' && wager.status !== 'pending') return false;
      if (statusFilter === 'settled' && wager.status === 'pending') return false;
      if (resultFilter !== 'all' && wager.status !== resultFilter) return false;
      if (positionFilter !== 'all' && slot.position !== positionFilter) return false;
      if (q && !(wager.playerName ?? wager.side).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allBets, weekFilter, statusFilter, resultFilter, positionFilter, search]);

  if (!league || !viewedTeam) return null;

  const settled = bets.filter((b) => b.slot.wager!.status !== 'pending');
  const won = settled.filter((b) => b.slot.wager!.status === 'won').length;
  const lost = settled.filter((b) => b.slot.wager!.status === 'lost').length;
  const totalPL = settled.reduce((sum, b) => sum + (b.slot.wager!.settledProfit ?? 0), 0);
  const totalWagered = bets.reduce((sum, b) => sum + b.slot.wager!.stake, 0);
  const winRate = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : 0;
  const title = isOwnTeam ? 'My Bets' : `${viewedTeam.teamName}'s Bets`;

  function clearAll() {
    setWeekFilter('all');
    setStatusFilter('all');
    setResultFilter('all');
    setPositionFilter('all');
    setSearch('');
  }

  return (
    <div className="flex flex-col">
      <BackHeader title={title} fallback="/home" />
      <div className="p-4 space-y-4">
        <MemberSelector teams={league.teams} selectedTeamId={viewedTeam.id} onSelect={setSelectedTeamId} />
        <div className="grid grid-cols-4 gap-2 text-center">
          <Stat label="Record" value={`${won}-${lost}`} />
          <Stat label="Win Rate" value={`${winRate}%`} />
          <Stat label="Wagered" value={formatCents(totalWagered)} />
          <Stat label="Net P/L" value={formatCents(totalPL)} valueClass={totalPL >= 0 ? 'text-profit' : 'text-loss'} />
        </div>

        <button onClick={() => navigate('/my-stats')} className="text-xs text-primary font-medium">
          View advanced stats →
        </button>

        <div className="space-y-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search player or team"
            className="w-full bg-bg-card border border-border rounded-lg px-3 py-2 text-sm"
          />
          <div className="flex gap-2 overflow-x-auto pb-1">
            <select
              value={weekFilter}
              onChange={(e) => setWeekFilter(e.target.value)}
              className="bg-bg-card border border-border rounded-lg px-2 py-1.5 text-xs shrink-0"
            >
              <option value="all">All weeks</option>
              {weekOptions.map((w) => (
                <option key={String(w)} value={String(w)}>
                  {weekLabel(w)}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="bg-bg-card border border-border rounded-lg px-2 py-1.5 text-xs shrink-0"
            >
              <option value="all">Open & settled</option>
              <option value="open">Open only</option>
              <option value="settled">Settled only</option>
            </select>
            <select
              value={resultFilter}
              onChange={(e) => setResultFilter(e.target.value as ResultFilter)}
              className="bg-bg-card border border-border rounded-lg px-2 py-1.5 text-xs shrink-0"
            >
              {RESULT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              value={positionFilter}
              onChange={(e) => setPositionFilter(e.target.value as PositionFilter)}
              className="bg-bg-card border border-border rounded-lg px-2 py-1.5 text-xs shrink-0"
            >
              {POSITION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {anyFilterActive && (
              <button onClick={clearAll} className="text-xs text-primary font-semibold shrink-0 px-1">
                Clear all
              </button>
            )}
          </div>
        </div>

        {bets.length === 0 ? (
          <EmptyState
            icon={<Ticket size={36} strokeWidth={1.5} />}
            title={anyFilterActive ? 'No bets match those filters' : 'No bets yet'}
            subtitle={anyFilterActive ? 'Try clearing a filter or two.' : 'Wagers you place will show up here with full ticket detail.'}
          />
        ) : (
          <div className="space-y-2">
            {bets.map(({ week, slot }) => {
              const wager = slot.wager!;
              return (
                <div key={wager.id} className="bg-bg-card border border-border rounded-xl p-3 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <PositionBadge position={slot.position} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{wager.playerName ?? MARKET_LABELS[wager.marketKey]}</p>
                        <p className="text-xs text-text-muted truncate">{wagerLineDescription(wager)}</p>
                      </div>
                    </div>
                    <StatusPill status={wager.status} />
                  </div>
                  <div className="flex justify-between text-xs text-text-muted pt-1.5 border-t border-border">
                    <span>{weekLabel(week)}</span>
                    <span>{new Date(wager.placedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                  </div>
                  <div className="flex justify-between text-xs">
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
    <div className="bg-bg-card border border-border rounded-lg py-2">
      <p className={`text-sm font-bold ${valueClass}`}>{value}</p>
      <p className="text-[10px] text-text-muted">{label}</p>
    </div>
  );
}
