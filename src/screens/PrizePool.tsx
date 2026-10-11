import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CircleHelp, DollarSign, Lock, Medal, Trophy } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { formatCents } from '../engine/oddsMath';
import { activeMultipliers, championAndRunnerUp, computePayouts, poolTeamCount } from '../engine/prizePool';
import { biggestSwing, findWeek, poolHasDetail, seasonImpacts, weekImpacts, type PoolImpactRow } from '../engine/poolView';
import { weekLabel, type League, type PoolWeekEntry, type PrizePool as Pool, type WeekId } from '../types';
import { BackHeader } from '../components/layout/BackHeader';
import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { TeamLogo } from '../components/common/TeamLogo';
import { usePlStyle } from '../components/common/usePlStyle';
import { HowItWorksSheet } from '../components/common/HowItWorksSheet';
import { ShareButton } from '../share/ShareButton';
import { PoolShareCard } from '../share/cards/PoolShareCard';

const signed = (n: number) => `${n >= 0 ? '+' : ''}${formatCents(n)}`;

function placeLabel(place: number): ReactNode {
  if (place === 1)
    return (
      <span className="inline-flex items-center gap-1">
        <Trophy size={13} /> Champion
      </span>
    );
  if (place === 2)
    return (
      <span className="inline-flex items-center gap-1">
        <Medal size={13} /> Runner-up
      </span>
    );
  if (place === 3) return '3rd Place';
  return `${place}th Place`;
}

function placeLabelPlain(place: number): string {
  if (place === 1) return 'Champion';
  if (place === 2) return 'Runner-up';
  if (place === 3) return '3rd';
  return `${place}th`;
}

/** The payout split as chips: "75% Champion", "25% Top P/L". */
function payoutChips(league: League): string[] {
  const splits = league.settings.payoutSplits.map((pct, i) => `${pct}% ${placeLabelPlain(i + 1)}`);
  const topPL = league.settings.payoutTopPLPct ?? 0;
  return topPL > 0 ? [...splits, `${topPL}% Top P/L`] : splits;
}

/**
 * The pool over the season as a filled area against the starting pool, with a point per settled week.
 * Tapping a point picks that week (tapping the picked one again clears it). Wide invisible columns do
 * the catching, so a point is easy to hit with a thumb.
 */
function PoolChart({
  pool,
  selected,
  onSelect,
}: {
  pool: Pool;
  selected: WeekId | null;
  onSelect: (week: WeekId | null) => void;
}) {
  const W = 320;
  const H = 110;
  const PAD = 8;
  const points = [{ week: null as WeekId | null, value: pool.initial }, ...pool.history.map((h) => ({ week: h.week, value: h.poolAfter }))];
  const values = points.map((p) => p.value);
  const hi = Math.max(...values, pool.initial);
  const lo = Math.min(...values, pool.initial);
  const span = Math.max(hi - lo, 1);
  const x = (i: number) => (points.length > 1 ? PAD + (i * (W - PAD * 2)) / (points.length - 1) : W / 2);
  const y = (v: number) => PAD + (1 - (v - lo) / span) * (H - PAD * 2);
  const line = points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ');
  const area = `${PAD},${H} ${line} ${x(points.length - 1)},${H}`;
  const baseY = y(pool.initial);
  const up = pool.current >= pool.initial;
  const stroke = up ? 'var(--color-profit)' : 'var(--color-loss)';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-28" role="img" aria-label="Prize pool over the season">
      <defs>
        <linearGradient id="poolFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#poolFill)" />
      {/* The starting pool, so above and below the line read at a glance. */}
      <line x1={PAD} y1={baseY} x2={W - PAD} y2={baseY} stroke="var(--color-border)" strokeWidth="1" strokeDasharray="4 4" />
      <polyline points={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => {
        const on = p.week != null && String(p.week) === String(selected);
        return (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.value)} r={on ? 5 : 2.5} fill={on ? 'var(--color-primary)' : stroke} />
            {p.week != null && (
              <rect
                x={x(i) - (W - PAD * 2) / Math.max(points.length - 1, 1) / 2}
                y={0}
                width={(W - PAD * 2) / Math.max(points.length - 1, 1)}
                height={H}
                fill="transparent"
                onClick={() => onSelect(on ? null : p.week)}
                style={{ cursor: 'pointer' }}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** One team's line in an impact list: logo, name, its multiplier as a chip, and the dollars it moved. */
function ImpactRow({
  row,
  league,
  scaleRef,
  showMultiplier,
}: {
  row: PoolImpactRow;
  league: League;
  scaleRef: number;
  showMultiplier: boolean;
}) {
  const plStyle = usePlStyle();
  const team = league.teams.find((t) => t.id === row.teamId);
  if (!team) return null;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <TeamLogo team={team} size="sm" />
      <span className={`text-xs truncate flex-1 min-w-0 ${team.isUser ? 'text-primary font-medium' : ''}`}>{team.teamName}</span>
      {showMultiplier && Math.abs(row.multiplier - 1) > 0.004 && (
        <span className="shrink-0 rounded px-1 text-[9px] font-semibold leading-4 bg-bg-raised text-text-muted tabular-nums">
          {row.multiplier.toFixed(2)}x
        </span>
      )}
      <span className="shrink-0 text-xs font-semibold tabular-nums" style={plStyle(row.impact, scaleRef)}>
        {signed(row.impact)}
      </span>
    </div>
  );
}

/** A multiplier as a bar either side of 1.0x, so the spread reads without the numbers. */
function MultiplierBar({ value }: { value: number }) {
  const plStyle = usePlStyle();
  const pct = Math.min(1, Math.abs(value - 1) / 0.5) * 50;
  // Classic and Mono give no color for a gain, so fall back to the theme's own P/L colors.
  const color = plStyle(value - 1, 0.5)?.color ?? (value >= 1 ? 'var(--color-profit)' : 'var(--color-loss)');
  return (
    <div className="relative h-1 w-14 shrink-0 rounded-full bg-bg-raised overflow-hidden">
      <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
      <span
        className="absolute inset-y-0 rounded-full"
        style={{ left: value >= 1 ? '50%' : `${50 - pct}%`, width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}

/** The small "?" that opens the help sheet at the prize pool topic, so the screen itself stays short. */
function HelpButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" aria-label="How the prize pool works" onClick={onOpen} className="shrink-0 text-text-muted active:opacity-60">
      <CircleHelp size={14} />
    </button>
  );
}

export function PrizePool() {
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));
  const refreshPrizePool = useAppStore((s) => s.refreshPrizePool);
  const plStyle = usePlStyle();
  const [week, setWeek] = useState<WeekId | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const pool = league?.prizePool;

  // Weeks settled before 1.2.11 have no per-team detail. A rebuild writes it, so the commissioner's app
  // asks for one the first time this screen opens on an old pool; everyone else sees it once that runs.
  const askedRef = useRef(false);
  const isCommissioner = !!league && league.teams.some((t) => t.isUser && t.id === league.commissionerTeamId);
  const needsDetail = !!pool && pool.history.length > 0 && !poolHasDetail(pool);
  useEffect(() => {
    if (!league || !isCommissioner || !needsDetail || askedRef.current) return;
    askedRef.current = true;
    void refreshPrizePool(league.id);
  }, [league, isCommissioner, needsDetail, refreshPrizePool]);

  const entry: PoolWeekEntry | undefined = useMemo(() => findWeek(pool, week), [pool, week]);
  const season = useMemo(() => seasonImpacts(pool), [pool]);
  const swing = useMemo(() => biggestSwing(pool), [pool]);

  if (!league) return null;
  if (!league.settings.buyInEnabled || !pool) {
    return (
      <div className="flex flex-col">
        <BackHeader title="Prize Pool" fallback="/home" />
        <div className="p-4">
          <EmptyState
            icon={<DollarSign size={36} strokeWidth={1.5} />}
            title="Buy-ins are off"
            subtitle="Turn on Buy-in & Prize Pool in League Settings to start tracking a virtual pool."
          />
        </div>
      </div>
    );
  }

  const delta = pool.current - pool.initial;
  const pct = pool.initial > 0 ? Math.round((delta / pool.initial) * 100) : 0;
  const rows = entry ? weekImpacts(entry) : [];
  const impactRef = Math.max(1, ...[...rows, ...season].map((r) => Math.abs(r.impact)));
  const multipliers = activeMultipliers(league);
  const aiOut = league.settings.aiTeamsAffectPool === false && league.teams.some((t) => !t.isSimulated);
  const payouts = league.seasonPhase === 'complete' ? computePayouts(pool, league.bracket, league.settings, league.standings) : [];
  const { championId } = championAndRunnerUp(league.bracket);
  const chips = payoutChips(league);
  const from = pool.history[0] ? weekLabel(pool.history[0].week) : null;

  return (
    <div className="flex flex-col">
      <BackHeader
        title="Prize Pool"
        fallback="/home"
        right={
          <ShareButton
            title="Prize Pool"
            label="Share the prize pool"
            renderCard={() => (
              <PoolShareCard
                league={league}
                pool={pool}
                week={entry ?? null}
                rows={(entry ? rows : season).slice(0, 8)}
                payoutChips={chips}
              />
            )}
          />
        }
      />
      <div className="p-4 space-y-3">
        {/* Hero: the pool now, how far it has moved, and what it is made of. */}
        <Card className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] text-text-muted">Current pool</p>
              <p className="text-3xl font-bold tabular-nums leading-tight">{formatCents(pool.current)}</p>
              <p className="text-xs font-semibold tabular-nums mt-0.5" style={plStyle(delta, Math.max(1, pool.initial))}>
                {signed(delta)}
                <span className="text-text-muted font-normal"> ({pct >= 0 ? '+' : ''}{pct}% from {formatCents(pool.initial)})</span>
              </p>
            </div>
            <span
              className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                pool.locked ? 'bg-bg-raised text-text-muted' : 'bg-primary/15 text-primary'
              }`}
            >
              {pool.locked && <Lock size={10} />}
              {pool.locked ? 'Locked' : 'Active'}
            </span>
          </div>
          <p className="text-[11px] text-text-muted">
            {poolTeamCount(league)} × {formatCents(league.settings.buyInAmount)} buy-in
            {from ? ` · tracked from ${from}` : ''}
            {aiOut ? ' · AI teams out' : ''}
          </p>
          <div className="flex flex-wrap gap-1">
            {chips.map((c) => (
              <span key={c} className="rounded-full border border-border bg-bg-raised px-2 py-0.5 text-[10px] font-semibold text-text-muted">
                {c}
              </span>
            ))}
          </div>
        </Card>

        {pool.history.length === 0 ? (
          <Card>
            <p className="text-xs text-text-muted py-6 text-center">No weeks settled yet.</p>
          </Card>
        ) : (
          <Card className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold">{entry ? weekLabel(entry.week) : 'Season'}</p>
              {entry ? (
                <button type="button" onClick={() => setWeek(null)} className="text-[11px] font-semibold text-primary">
                  Back to season
                </button>
              ) : (
                swing && (
                  <button type="button" onClick={() => setWeek(swing.week)} className="text-[11px] text-text-muted">
                    Biggest week: {weekLabel(swing.week)} <span style={plStyle(swing.netRealPL, Math.max(1, pool.initial))}>{signed(swing.netRealPL)}</span>
                  </button>
                )
              )}
            </div>
            <PoolChart pool={pool} selected={week} onSelect={setWeek} />
            <div className="space-y-0.5">
              {pool.history.map((h) => {
                const on = String(h.week) === String(week);
                return (
                  <button
                    key={String(h.week)}
                    type="button"
                    onClick={() => setWeek(on ? null : h.week)}
                    className={`w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs ${on ? 'bg-primary/10' : ''}`}
                  >
                    <span className={on ? 'font-semibold' : 'text-text-muted'}>{weekLabel(h.week)}</span>
                    <span className="tabular-nums" style={plStyle(h.netRealPL, Math.max(1, pool.initial))}>
                      {signed(h.netRealPL)}
                    </span>
                    <span className="font-medium tabular-nums w-16 text-right">{formatCents(h.poolAfter)}</span>
                  </button>
                );
              })}
            </div>
          </Card>
        )}

        {/* Who moved it: the picked week, or the whole season. */}
        {(entry ? rows.length > 0 : season.length > 0) && (
          <Card className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold">{entry ? `Who moved it in ${weekLabel(entry.week)}` : 'Who has moved it'}</p>
              <HelpButton onOpen={() => setHelpOpen(true)} />
            </div>
            {(entry ? rows : season).map((r) => (
              <ImpactRow key={r.teamId} row={r} league={league} scaleRef={impactRef} showMultiplier={league.settings.poolMultipliers.enabled} />
            ))}
          </Card>
        )}

        {entry && rows.length === 0 && (
          <Card>
            <p className="text-[11px] text-text-muted text-center py-3">
              {weekLabel(entry.week)} was settled before per-team tracking. It fills in the next time the pool is recalculated.
            </p>
          </Card>
        )}

        {/* Current multipliers, only in the season view: a picked week shows its own in the list above. */}
        {!entry && league.settings.poolMultipliers.enabled && (
          <Card className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold">Impact multipliers</p>
              <HelpButton onOpen={() => setHelpOpen(true)} />
            </div>
            <p className="text-[11px] text-text-muted">
              {league.seasonPhase === 'regular' ? 'Each team moves the pool a little more or less by where it sits.' : 'Flat 1.0x in the playoffs.'}
            </p>
            {[...league.teams]
              .map((team) => ({ team, inPool: !(aiOut && team.isSimulated), multiplier: multipliers[team.id] ?? 1 }))
              .sort((x, y) => Number(y.inPool) - Number(x.inPool) || y.multiplier - x.multiplier)
              .map(({ team, inPool, multiplier }) => (
                <div key={team.id} className={`flex items-center gap-2 min-w-0 ${inPool ? '' : 'opacity-50'}`}>
                  <TeamLogo team={team} size="sm" />
                  <span className={`text-xs truncate flex-1 min-w-0 ${team.isUser ? 'text-primary font-medium' : ''}`}>{team.teamName}</span>
                  {inPool ? (
                    <>
                      <MultiplierBar value={multiplier} />
                      <span className="shrink-0 w-11 text-right text-xs font-semibold tabular-nums" style={plStyle(multiplier - 1, 0.5)}>
                        {multiplier.toFixed(2)}x
                      </span>
                    </>
                  ) : (
                    <span className="text-[11px] text-text-muted shrink-0">Not in pool</span>
                  )}
                </div>
              ))}
          </Card>
        )}

        {payouts.length > 0 && (
          <Card className="space-y-2">
            <p className="text-xs font-semibold">Season payouts</p>
            {payouts.map((p) => {
              const team = league.teams.find((t) => t.id === p.teamId);
              return (
                <div key={`${p.teamId}-${p.place}-${p.topPL ? 'pl' : ''}`} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {team && <TeamLogo team={team} size="sm" />}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{team?.teamName ?? 'Unknown'}</p>
                      <p className="text-[11px] text-text-muted">
                        {p.topPL ? 'Top season P/L' : placeLabel(p.place)} · {p.pct}%
                      </p>
                    </div>
                  </div>
                  <p className="text-sm font-bold text-profit shrink-0 tabular-nums">{formatCents(p.amount)}</p>
                </div>
              );
            })}
          </Card>
        )}

        {!championId && <p className="text-[11px] text-text-muted text-center">Paid out when the season finishes. Virtual tracking only.</p>}
      </div>
      {helpOpen && (
        <HowItWorksSheet settings={league.settings} focus={{ category: 'scoring', topic: 'Prize pool' }} onClose={() => setHelpOpen(false)} />
      )}
    </div>
  );
}
