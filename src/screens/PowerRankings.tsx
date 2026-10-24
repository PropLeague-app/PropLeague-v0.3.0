import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ChevronDown, TrendingUp } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { BackHeader } from '../components/layout/BackHeader';
import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { TeamLogo } from '../components/common/TeamLogo';
import { PowerTrajectory } from '../components/power/PowerTrajectory';
import { gamesReadyForSeries, pointDate, powerBreakdown, powerSeries } from '../engine/powerRankings';
import { MovementTriangle } from '../components/common/MovementTriangle';
import { weekLabel } from '../types';
import { useEnsureSettledWeekRosters } from '../components/common/useEnsureWeekRosters';
import { usePlStyle } from '../components/common/usePlStyle';
import { ShareButton } from '../share/ShareButton';
import { PowerShareCard } from '../share/cards/PowerShareCard';

const signed = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/** Who is actually the sharpest bettor in the league, as opposed to who the schedule has been kind
 * to. The metric itself is documented in engine/powerRankings.ts.
 *
 * Opens on your own team, or on whoever's profile sent you here. Selecting a row moves the
 * highlighted line and the working below it, so the graph and the explanation always describe the
 * same team. */
export function PowerRankings() {
  const { teamId } = useParams();
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));
  // Real games carry each pick's day window, which is what lets the line step on Thursday, Sunday
  // and Monday rather than jumping once a week (see chat, Oct 2026).
  const realGamesById = useAppStore((s) => s.realGamesById);
  const loadRealGame = useAppStore((s) => s.loadRealGame);
  useEnsureSettledWeekRosters(league);

  // Without the games the day window of each pick is unknown, and the trajectory quietly collapses
  // back to one point a week. Every team's settled picks matter here, not just one team's, because
  // the whole league is plotted (same loading pattern as My Stats).
  useEffect(() => {
    if (!league) return;
    const ids = new Set<string>();
    for (const roster of Object.values(league.rostersByTeamWeek)) {
      for (const slot of roster.slots) {
        const w = slot.wager;
        // Picks now carry their own day window (backlog C3); only ones cached before that need a game.
        if (w && (w.status === 'won' || w.status === 'lost') && !w.daySlot) ids.add(w.gameId);
      }
    }
    for (const id of ids) if (!realGamesById[id]) loadRealGame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league]);

  const userTeam = league?.teams.find((t) => t.isUser);
  const [selected, setSelected] = useState<string | null>(teamId ?? null);
  const [workingOpen, setWorkingOpen] = useState(false);
  // Which week the reader is holding on the graph. Null means "as it stands".
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const plStyle = usePlStyle();
  const selectedId = selected ?? teamId ?? userTeam?.id ?? league?.teams[0]?.id ?? '';

  if (!league) return null;

  const series = powerSeries(league, realGamesById);
  // Index into the series, not into the weeks: once a week is stepped by game day it holds several
  // points, and keying off the week count pointed at the wrong moment entirely.
  const pointCount = Math.max(0, ...league.teams.map((t) => (series[t.id] ?? []).length));
  const atIndex = scrubIndex == null ? pointCount - 1 : Math.min(scrubIndex, pointCount - 1);
  const heldPoint = atIndex >= 0 ? (series[league.teams[0]?.id ?? ''] ?? [])[atIndex] : undefined;
  // Dragging to the far right lands on today, which should read as today rather than as a past
  // point you still have to come back from.
  const atLatest = scrubIndex == null || scrubIndex >= pointCount - 1;
  const when = pointDate(heldPoint, realGamesById, league);
  const dateLabel = when
    ? `${when.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${weekLabel(heldPoint!.week)}`
    : heldPoint
      ? weekLabel(heldPoint.week)
      : '';

  // The table reads the same moment the graph is showing, so scrubbing moves both together.
  const rows = league.teams
    .map((t) => {
      const pts = series[t.id] ?? [];
      const at = atIndex >= 0 ? pts[Math.min(atIndex, pts.length - 1)] : undefined;
      // Movement is week on week, not step on step: with several points inside a week the previous
      // point is usually the same week's earlier game day, which is not what an arrow means here.
      const here = Math.min(atIndex, pts.length - 1);
      let j = here - 1;
      while (j >= 0 && pts[j].week === pts[here]?.week) j -= 1;
      const before = j >= 0 ? pts[j] : undefined;
      return {
        teamId: t.id,
        score: at?.score ?? 0,
        rank: at?.rank ?? 0,
        bets: at?.bets ?? 0,
        movement: at && before ? before.rank - at.rank : null,
      };
    })
    .sort((a, b) => a.rank - b.rank || b.score - a.score);

  const breakdown = powerBreakdown(league, selectedId, heldPoint, realGamesById);
  const team = league.teams.find((t) => t.id === selectedId);
  const anySettled = rows.some((r) => r.bets > 0);
  // The series steps by game day, and the games arrive asynchronously. Drawing before they land
  // gives the weekly shape and then visibly redraws, so the chart waits one beat instead (see chat,
  // Oct 2026). Everything else on the screen is already correct, so only the plot waits.
  const chartReady = gamesReadyForSeries(league, realGamesById);
  // The ramp spans the league's widest score, so Scaled P/L colouring reads across the table the
  // same way it does everywhere else in the app.
  const scoreRef = Math.max(1, ...rows.map((r) => Math.abs(r.score)));

  return (
    <div className="flex flex-col">
      <BackHeader
        title="Power Rankings"
        fallback="/profile"
        right={
          <ShareButton
            title="Power Rankings"
            label="Share power rankings"
            disabled={!anySettled}
            // A snapshot of the view (backlog C1): the selected team, the chart as it stands (or held
            // where it is scrubbed to) and the table at that moment, side by side.
            renderCard={() => (
              <PowerShareCard
                league={league}
                subtitle={dateLabel || undefined}
                series={series}
                selectedTeamId={selectedId}
                scrubIndex={atLatest ? null : atIndex}
                rows={rows}
                scoreRef={scoreRef}
                head={breakdown}
              />
            )}
          />
        }
      />
      <div className="p-4 space-y-4">
        {!anySettled ? (
          <EmptyState
            icon={<TrendingUp size={36} strokeWidth={1.5} />}
            title="Nothing settled yet"
            subtitle="Power rankings build up as picks settle, so they appear once the first week is in."
          />
        ) : (
          <>
            <Card className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-bold truncate min-w-0">{team?.teamName}</p>
                <p
                  className={`text-sm font-bold tabular-nums ${breakdown.score >= 0 ? 'text-profit' : 'text-loss'}`}
                  style={plStyle(breakdown.score, scoreRef)}
                >
                  {signed(breakdown.score)}
                </p>
              </div>
              <div className="flex items-center justify-between gap-2 -mt-1">
                <span className="text-[11px] text-text-muted truncate min-w-0">{dateLabel}</span>
                {/* Always in the layout, only hidden at today, so the row keeps its height and the chart
                    below never jumps while scrubbing (backlog C2). */}
                <button
                  onClick={() => setScrubIndex(null)}
                  aria-hidden={atLatest}
                  tabIndex={atLatest ? -1 : undefined}
                  className={`shrink-0 text-[11px] font-semibold text-primary border border-primary/50 rounded-full px-2.5 py-0.5 active:opacity-80 ${atLatest ? 'invisible' : ''}`}
                >
                  Today
                </button>
              </div>
              {chartReady ? (
              <PowerTrajectory
                league={league}
                series={series}
                selectedTeamId={selectedId}
                onSelect={setSelected}
                scrubIndex={scrubIndex}
                onScrub={setScrubIndex}
              />
              ) : (
                <div className="h-[240px] flex items-center justify-center">
                  <p className="text-xs text-text-muted">Loading the season…</p>
                </div>
              )}
            </Card>

            {/* At a glance it is one sentence: how often these picks were meant to land against how
                often they did. The full derivation is a tap away rather than always on screen, so
                the number is checkable without the screen being a worksheet (see chat, Oct 2026). */}
            <Card className="space-y-2">
              <button
                onClick={() => setWorkingOpen((v) => !v)}
                aria-expanded={workingOpen}
                className="w-full flex items-center gap-2 text-left"
              >
                {team && <TeamLogo team={team} size="md" />}
                <span className="flex-1 min-w-0 truncate text-[11px]">
                  <span className="tabular-nums font-semibold">{pct(breakdown.hitRate)}</span>
                  <span className="text-text-muted"> hit vs </span>
                  <span className="tabular-nums font-semibold">{pct(breakdown.impliedRate)}</span>
                  <span className="text-text-muted"> priced</span>
                </span>
                <span className={`shrink-0 text-xs font-bold tabular-nums ${breakdown.edgePts >= 0 ? 'text-profit' : 'text-loss'}`}>
                  {signed(breakdown.edgePts)} pts
                </span>
                <ChevronDown size={15} className={`shrink-0 text-text-muted transition-transform ${workingOpen ? 'rotate-180' : ''}`} />
              </button>

              {workingOpen && (
                <>
                  <p className="text-[11px] text-text-muted leading-relaxed">
                    Every settled pick scores its stake times how far the result landed from what the
                    price said. Landing a heavy favourite earns little, missing one costs plenty, and
                    the reverse for a longshot.
                  </p>
                  <dl className="space-y-1 text-[11px]">
                    <Line label="Settled picks" value={`${breakdown.settled} (${breakdown.wins}-${breakdown.losses})`} />
                    <Line label="Credits staked on them" value={breakdown.staked.toFixed(2)} />
                    <Line label="The prices said these would land" value={pct(breakdown.impliedRate)} />
                    <Line label="They actually landed" value={pct(breakdown.hitRate)} />
                    <div className="h-px bg-border my-1" />
                    <Line label="Earned on the picks that landed" value={signed(breakdown.fromWins)} className="text-profit" />
                    <Line label="Given back on the ones that did not" value={signed(breakdown.fromLosses)} className="text-loss" />
                    <Line
                      label="Power score"
                      value={signed(breakdown.score)}
                      className={`font-bold ${breakdown.score >= 0 ? 'text-profit' : 'text-loss'}`}
                    />
                  </dl>
                  <p className="text-[10px] text-text-muted leading-relaxed">
                    Zero is not break even. A -110 price implies 52.4% while the fair chance is about
                    50%, so the book's margin pulls everyone slightly negative. Beating the price you
                    took is the bar.
                  </p>
                </>
              )}
            </Card>

            <div className="space-y-1.5">
              <p className="text-xs font-semibold">League</p>
              {rows.map((row) => {
                const t = league.teams.find((x) => x.id === row.teamId);
                if (!t) return null;
                const isSel = row.teamId === selectedId;
                return (
                  <button
                    key={row.teamId}
                    onClick={() => setSelected(row.teamId)}
                    aria-pressed={isSel}
                    className={`w-full flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                      isSel ? 'border-primary bg-bg-raised' : 'border-border bg-bg-card active:bg-bg-raised'
                    }`}
                  >
                    <span className="w-5 shrink-0 text-xs text-text-muted tabular-nums text-right">{row.rank}</span>
                    <TeamLogo team={t} size="xs" />
                    <span className="flex-1 min-w-0 truncate text-sm font-semibold">{t.teamName}</span>
                    <MovementTriangle value={row.movement} className="w-9 justify-end" />
                    <span
                      className={`shrink-0 text-sm font-bold tabular-nums ${row.score >= 0 ? 'text-profit' : 'text-loss'}`}
                      style={plStyle(row.score, scoreRef)}
                    >
                      {signed(row.score)}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Line({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-text-muted min-w-0">{label}</dt>
      <dd className={`m-0 tabular-nums shrink-0 ${className}`}>{value}</dd>
    </div>
  );
}
