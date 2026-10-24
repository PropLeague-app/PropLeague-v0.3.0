import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, CircleHelp, DollarSign, Lock, Medal, Trophy } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { formatCents } from '../engine/oddsMath';
import { activeMultipliers, championAndRunnerUp, computePayouts, poolTeamCount } from '../engine/prizePool';
import { findWeek, liveWeekEntry, poolHasDetail, poolHighlights, poolWithLiveWeek, seasonImpacts, weekImpacts, type PoolImpactRow } from '../engine/poolView';
import { poolTimeline, weekEndIndex, weekStartValue, type PoolTimelinePoint } from '../engine/poolTimeline';
import { weekLabel, type League, type PoolWeekEntry, type WeekId } from '../types';
import { BackHeader } from '../components/layout/BackHeader';
import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { TeamLogo } from '../components/common/TeamLogo';
import { usePlStyle } from '../components/common/usePlStyle';
import { HowItWorksSheet } from '../components/common/HowItWorksSheet';
import { ShareButton } from '../share/ShareButton';
import { useEnsureSettledWeekRosters } from '../components/common/useEnsureWeekRosters';
import { PoolShareCard } from '../share/cards/PoolShareCard';

const signed = (n: number) => `${n >= 0 ? '+' : ''}${formatCents(n)}`;
/** Green or red first, so a gain is colored in every P/L mode; the scaled and mono styles layer on top. */
const plClass = (n: number) => (n >= 0 ? 'text-profit' : 'text-loss');

/** What the screen is looking at: the whole season (null), the pool as created ('start'), or one week. */
type PoolPoint = WeekId | 'start' | null;

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
 * The pool over the season as a filled area against the starting pool, stepped by game window
 * (engine/poolTimeline.ts): a dot closes each settled week, the steps between are the Thursday,
 * Sunday and Monday games inside it. Drag (or tap) to hold any moment, the way Power Rankings works.
 * The week still being played is drawn dashed and hollow so it never reads as a settled result.
 */
function PoolChart({
  points,
  initial,
  held,
  onHold,
}: {
  points: PoolTimelinePoint[];
  initial: number;
  /** Index of the moment being held, or null for the whole season. */
  held: number | null;
  onHold: (index: number) => void;
}) {
  const W = 320;
  const H = 110;
  const PAD = 10;
  const values = points.map((p) => p.value);
  const hi = Math.max(...values, initial);
  const lo = Math.min(...values, initial);
  const span = Math.max(hi - lo, 1);
  const x = (i: number) => (points.length > 1 ? PAD + (i * (W - PAD * 2)) / (points.length - 1) : W / 2);
  const y = (v: number) => PAD + (1 - (v - lo) / span) * (H - PAD * 2);
  const firstLive = points.findIndex((p) => p.live);
  // The settled line stops where the week in progress begins; from there it is drawn dashed.
  const solidEnd = firstLive < 0 ? points.length : firstLive;
  const line = points.slice(0, solidEnd).map((p, i) => `${x(i)},${y(p.value)}`).join(' ');
  const liveLine = firstLive > 0 ? points.slice(firstLive - 1).map((p, i) => `${x(firstLive - 1 + i)},${y(p.value)}`).join(' ') : null;
  const area = `${PAD},${H} ${points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')} ${x(points.length - 1)},${H}`;
  const baseY = y(initial);
  const up = points[points.length - 1].value >= initial;
  const stroke = up ? 'var(--color-profit)' : 'var(--color-loss)';

  /** Nearest point to the finger, through the element's rect since the plot is scaled to its width. */
  const indexAt = (clientX: number, el: SVGSVGElement) => {
    const rect = el.getBoundingClientRect();
    const fx = ((clientX - rect.left) / Math.max(1, rect.width)) * W;
    const i = Math.round(((fx - PAD) / Math.max(1, W - PAD * 2)) * (points.length - 1));
    return Math.max(0, Math.min(points.length - 1, i));
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-28 touch-none"
      role="img"
      aria-label="Prize pool over the season"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        onHold(indexAt(e.clientX, e.currentTarget));
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) onHold(indexAt(e.clientX, e.currentTarget));
      }}
      onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
    >
      <defs>
        <linearGradient id="poolFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#poolFill)" />
      {/* The starting pool, so above and below the line read at a glance. */}
      <line x1={PAD} y1={baseY} x2={W - PAD} y2={baseY} stroke="var(--color-border)" strokeWidth="1" strokeDasharray="4 4" />
      {solidEnd > 1 && <polyline points={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
      {liveLine && <polyline points={liveLine} fill="none" stroke={stroke} strokeWidth="2" strokeDasharray="4 3" strokeLinecap="round" opacity="0.8" />}
      {points.map((p, i) =>
        // A dot closes each week; the steps inside a week are just the line.
        p.weekEnd && i !== held ? (
          <circle
            key={i}
            cx={x(i)}
            cy={y(p.value)}
            r="2.5"
            // Hollow while the week is still being played, filled once it has settled.
            fill={p.live ? 'var(--color-bg-card)' : stroke}
            stroke={p.live ? stroke : undefined}
            strokeWidth={p.live ? 1.5 : undefined}
          />
        ) : null,
      )}
      {held != null && points[held] && (
        <g>
          {/* The held moment gets a dropline and a halo, so it reads as held even at a glance. */}
          <line x1={x(held)} y1={y(points[held].value)} x2={x(held)} y2={H} stroke="var(--color-primary)" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
          <circle cx={x(held)} cy={y(points[held].value)} r="8" fill="var(--color-primary)" opacity="0.2" />
          <circle cx={x(held)} cy={y(points[held].value)} r="4.5" fill="var(--color-primary)" stroke="var(--color-bg-card)" strokeWidth="1.5" />
        </g>
      )}
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
      <span className={`shrink-0 text-xs font-semibold tabular-nums ${plClass(row.impact)}`} style={plStyle(row.impact, scaleRef)}>
        {signed(row.impact)}
      </span>
    </div>
  );
}

/** A small tile under the chart: a label, the week it points at, and the amount. Tapping it picks that
 * week, so the season view is three taps away from any week worth looking at. */
function WeekTile({
  label,
  entry,
  onPick,
  plStyle,
  scaleRef,
}: {
  label: string;
  entry: PoolWeekEntry | null;
  onPick: () => void;
  plStyle: (amount: number, reference?: number) => CSSProperties | undefined;
  scaleRef: number;
}) {
  if (!entry) {
    return (
      <div className="rounded-lg bg-bg-raised/60 px-2 py-1.5">
        <p className="text-[10px] text-text-muted">{label}</p>
        <p className="text-xs text-text-muted">None yet</p>
      </div>
    );
  }
  return (
    <button type="button" onClick={onPick} className="rounded-lg bg-bg-raised px-2 py-1.5 text-left active:opacity-80">
      <p className="text-[10px] text-text-muted truncate">{label}</p>
      <p className={`text-xs font-semibold tabular-nums ${plClass(entry.netRealPL)}`} style={plStyle(entry.netRealPL, scaleRef)}>
        {signed(entry.netRealPL)}
      </p>
      <p className="text-[10px] text-text-muted truncate">{weekLabel(entry.week)}</p>
    </button>
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
  // The moment held on the chart, as an index into the timeline. Null is the whole season. The week
  // it falls in drives everything under the chart, so scrubbing and the week stepper are one control.
  const [held, setHeld] = useState<number | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const pool = league?.prizePool;
  // Every settled week's rosters, which is what lets the line step through each week by game window
  // (engine/poolTimeline.ts). Re-read once a session, so picks cached before they carried their
  // game window pick it up on the first visit.
  useEnsureSettledWeekRosters(league);

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

  // The week being played, as a provisional entry on the end of the history (engine/poolView). The
  // chart, the week picker and the per-week impacts all read the pool with it attached; the hero,
  // the season totals and the payouts stay on the stored pool, so nothing provisional is ever
  // presented as a settled number.
  const live = useMemo(() => (league && pool ? liveWeekEntry(league, pool) : null), [league, pool]);
  const viewPool = useMemo(() => (pool ? poolWithLiveWeek(pool, live) : pool), [pool, live]);
  const timeline = useMemo(() => (league && viewPool ? poolTimeline(league, viewPool, live?.week ?? null) : []), [league, viewPool, live]);
  const heldPt = held != null ? timeline[Math.min(held, timeline.length - 1)] : undefined;
  const point: PoolPoint = heldPt ? heldPt.week : null;
  const week = point === 'start' ? null : point;
  const atStart = point === 'start';
  const entry: PoolWeekEntry | undefined = useMemo(() => findWeek(viewPool, week), [viewPool, week]);
  /** The held moment is in the week still being played, so its numbers are provisional. */
  const atLive = !!heldPt?.live;
  /** Held inside a week rather than at its close: the numbers are the pool at that moment. */
  const midWeek = !!heldPt && !heldPt.weekEnd;
  const setPoint = (p: PoolPoint) => {
    if (p == null) return setHeld(null);
    const i = weekEndIndex(timeline, p);
    setHeld(i >= 0 ? i : null);
  };
  const season = useMemo(() => seasonImpacts(pool), [pool]);
  const marks = useMemo(() => poolHighlights(pool), [pool]);

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
  // The stepper moves week to week: the created pool, then each week's close. From inside a week,
  // back goes to the previous close and forward to this week's own.
  const closes = timeline.map((p, i) => (p.weekEnd ? i : -1)).filter((i) => i >= 0);
  const stepTo = (by: number): number | undefined => {
    if (held == null) return undefined;
    const target = by < 0 ? [...closes].reverse().find((i) => i < held) : closes.find((i) => i > held);
    return target;
  };
  const when = heldPt?.kickoff ? new Date(heldPt.kickoff) : null;
  const heldLabel = !heldPt
    ? 'Season'
    : atStart
      ? 'Pool created'
      : when && heldPt.slot
        ? `${when.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${weekLabel(heldPt.week as WeekId)}`
        : weekLabel(heldPt.week as WeekId);
  const from = pool.history[0] ? weekLabel(pool.history[0].week) : null;
  // The held moment against the pool its week started from: the whole week at a close, part of it
  // when held inside one.
  const weekSoFar = held != null && heldPt && !atStart ? (heldPt.weekEnd ? (entry?.netRealPL ?? 0) : heldPt.value - weekStartValue(timeline, held)) : 0;

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
              {/* The pool itself is plain unless it is actually above what the league put in. */}
              <p className={`text-3xl font-bold tabular-nums leading-tight ${pool.current > pool.initial ? 'text-profit' : ''}`}>
                {formatCents(pool.current)}
              </p>
              <p className={`text-xs font-semibold tabular-nums mt-0.5 ${plClass(delta)}`} style={plStyle(delta, Math.max(1, pool.initial))}>
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
              {/* The stepper and Back to season stay in the layout while hidden, so holding a moment
                  never shifts the chart (the same fix as Power Rankings' Today button, backlog C2). */}
              <div className="flex items-center gap-1 min-w-0">
                <button
                  type="button"
                  aria-label="Previous week"
                  aria-hidden={held == null}
                  tabIndex={held == null ? -1 : undefined}
                  disabled={held == null || stepTo(-1) === undefined}
                  onClick={() => setHeld(stepTo(-1) ?? held)}
                  className={`shrink-0 text-text-muted disabled:opacity-30 active:opacity-60 ${held == null ? 'invisible' : ''}`}
                >
                  <ChevronLeft size={16} />
                </button>
                <p className="text-xs font-semibold truncate">{heldLabel}</p>
                <button
                  type="button"
                  aria-label="Next week"
                  aria-hidden={held == null}
                  tabIndex={held == null ? -1 : undefined}
                  disabled={held == null || stepTo(1) === undefined}
                  onClick={() => setHeld(stepTo(1) ?? held)}
                  className={`shrink-0 text-text-muted disabled:opacity-30 active:opacity-60 ${held == null ? 'invisible' : ''}`}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
              <button
                type="button"
                onClick={() => setHeld(null)}
                aria-hidden={held == null}
                tabIndex={held == null ? -1 : undefined}
                className={`shrink-0 text-[11px] font-semibold text-primary ${held == null ? 'invisible' : ''}`}
              >
                Back to season
              </button>
            </div>
            <PoolChart points={timeline} initial={pool.initial} held={held} onHold={setHeld} />
            {/* Under the chart: the picked point on its own, or the season in three tiles. Tapping the
                chart is how any other week is reached, so the list never grows to eighteen rows. */}
            {point != null ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-bg-raised px-2 py-1.5">
                  <p className="text-[10px] text-text-muted">{atStart ? 'Buy-in' : atLive || midWeek ? 'Week so far' : 'That week'}</p>
                  {atStart ? (
                    <p className="text-sm font-semibold tabular-nums">
                      {poolTeamCount(league)} × {formatCents(league.settings.buyInAmount)}
                    </p>
                  ) : (
                    <p
                      className={`text-sm font-semibold tabular-nums ${plClass(weekSoFar)}`}
                      style={plStyle(weekSoFar, Math.max(1, pool.initial))}
                    >
                      {signed(weekSoFar)}
                    </p>
                  )}
                </div>
                <div className="rounded-lg bg-bg-raised px-2 py-1.5">
                  <p className="text-[10px] text-text-muted">{atLive && !midWeek ? 'Pool right now' : midWeek ? 'Pool then' : 'Pool after'}</p>
                  <p className="text-sm font-semibold tabular-nums">{formatCents(atStart ? pool.initial : (heldPt?.value ?? pool.current))}</p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {live && (
                  <button
                    type="button"
                    onClick={() => setPoint(live.week)}
                    className="w-full rounded-lg border border-dashed border-border bg-bg-raised px-2.5 py-1.5 flex items-center gap-2 text-left active:bg-bg-card"
                  >
                    <span className="text-[10px] text-text-muted shrink-0">This week so far</span>
                    <span className="text-[10px] text-text-muted shrink-0">{weekLabel(live.week)}</span>
                    <span className="flex-1" />
                    <span
                      className={`text-sm font-semibold tabular-nums ${plClass(live.netRealPL)}`}
                      style={plStyle(live.netRealPL, Math.max(1, pool.initial))}
                    >
                      {signed(live.netRealPL)}
                    </span>
                  </button>
                )}
                <div className="grid grid-cols-3 gap-2">
                  <WeekTile label="Last week" entry={marks.last} onPick={() => marks.last && setPoint(marks.last.week)} plStyle={plStyle} scaleRef={Math.max(1, pool.initial)} />
                  <WeekTile label="Best week" entry={marks.best} onPick={() => marks.best && setPoint(marks.best.week)} plStyle={plStyle} scaleRef={Math.max(1, pool.initial)} />
                  <WeekTile label="Worst week" entry={marks.worst} onPick={() => marks.worst && setPoint(marks.worst.week)} plStyle={plStyle} scaleRef={Math.max(1, pool.initial)} />
                </div>
              </div>
            )}
          </Card>
        )}

        {atStart && (
          <Card className="space-y-1.5">
            <p className="text-xs font-semibold">Before the season</p>
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-muted">{poolTeamCount(league)} teams bought in</span>
              <span className="font-semibold tabular-nums">
                {poolTeamCount(league)} × {formatCents(league.settings.buyInAmount)}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-muted">Starting pool</span>
              <span className="font-semibold tabular-nums">{formatCents(pool.initial)}</span>
            </div>
            <p className="text-[11px] text-text-muted">
              Nothing had been played yet{from ? `; tracking starts in ${from}` : ''}. Every week after this moves the pool by what the league wins or
              loses on its picks.
            </p>
          </Card>
        )}

        {/* Who moved it: the picked week, or the whole season. */}
        {!atStart && (entry ? rows.length > 0 : season.length > 0) && (
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

        {!atStart && entry && rows.length === 0 && (
          <Card>
            <p className="text-[11px] text-text-muted text-center py-3">
              {weekLabel(entry.week)} was settled before per-team tracking. It fills in the next time the pool is recalculated.
            </p>
          </Card>
        )}

        {/* Current multipliers, only in the season view: a picked week shows its own in the list above. */}
        {point == null && league.settings.poolMultipliers.enabled && (
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
                    <span
                      className={`shrink-0 w-12 text-right text-xs font-semibold tabular-nums ${multiplier >= 1 ? 'text-profit' : 'text-loss'}`}
                      style={plStyle(multiplier - 1, 0.5)}
                    >
                      {multiplier.toFixed(2)}x
                    </span>
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
