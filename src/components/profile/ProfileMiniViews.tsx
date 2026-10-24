import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Gauge, Ticket, TrendingUp } from 'lucide-react';
import type { IndividualStats, RecordPL, TeamBet } from '../../engine/stats';
import type { MarketKey } from '../../types';
import { MARKET_LABELS } from '../../data/propsGenerator';
import type { League } from '../../types';
import { powerSeries } from '../../engine/powerRankings';
import { MovementTriangle } from '../common/MovementTriangle';
import { Card } from '../common/Card';
import { formatCents } from '../../engine/oddsMath';

/** The small views that turn the profile from a menu into a hub.
 *
 * Each is the same bargain League Home already makes: show the thing, say where the rest of it
 * lives, let a tap go there. They sit two to a row, because a full-width card for eight coloured
 * blocks was most of a screen spent on one number (see chat, Oct 2026). At half width the marks have
 * to earn their pixels, which is why the form pips are thin and the week bars are drawn to a fixed
 * small width rather than stretched to fill.
 */

function MiniCard({ icon, title, onClick, children }: { icon: ReactNode; title: string; onClick: () => void; children: ReactNode }) {
  return (
    // h-full with the footer pushed down by mt-auto: two cards side by side with different numbers of
    // rows should still have one bottom edge.
    <Card onClick={onClick} dense className="h-full flex flex-col gap-1.5">
      {/* The chevron rides in the header, not the footer. In the footer it sat on the same line as
          the last figure and pushed it out of line with the card beside it (see chat, Oct 2026). */}
      <div className="flex items-center gap-1.5">
        <span className="text-text-muted shrink-0 flex items-center">{icon}</span>
        <p className="font-semibold text-[11px] truncate flex-1 min-w-0">{title}</p>
        <ChevronRight size={13} className="text-text-muted shrink-0" />
      </div>
      {children}
    </Card>
  );
}

/** What this person is actually good at, by market.
 *
 * Replaces a row of green and red pips for the last few picks, which said nothing their own last
 * matchup does not already say (see chat, Oct 2026). This is the question the rest of the app never
 * answers at a glance: not how the last five went, but which kinds of bet they keep winning and
 * which keep costing them.
 *
 * Ranked by profit, and only among markets with enough settled picks to mean anything. Two bets on
 * one market is a coin toss wearing a label, so a market under the floor is left out entirely rather
 * than ranked on noise. The worst one is shown alongside the best, because a card that only ever
 * flatters is not worth looking at twice.
 */
export const MIN_PICKS = 3;

/** The single best market, among those with enough settled picks to mean anything.
 *
 *  Was the best two plus the worst, which made this card twice the height of the one beside it for
 *  information nobody needed at a glance (see chat, Oct 2026). One line and the ROI under it says
 *  what kind of bettor this is; the Markets tab says the rest. */
export function rankMarkets(byMarket: Partial<Record<MarketKey, RecordPL>>): [MarketKey, RecordPL][] {
  const ranked = (Object.entries(byMarket) as [MarketKey, RecordPL][])
    .filter(([, rec]) => rec.wins + rec.losses + rec.pushes >= MIN_PICKS)
    .sort((a, b) => b[1].pl - a[1].pl);
  return ranked.slice(0, 1);
}

export function Strengths({ stats, to }: { stats: IndividualStats; to: string }) {
  const navigate = useNavigate();
  const rows = rankMarkets(stats.byMarket);
  const roi = stats.roi;

  return (
    <MiniCard icon={<Ticket size={13} />} title="Bets" onClick={() => navigate(to, { state: { statsTab: 'markets' } })}>
      {rows.length === 0 ? (
        <p className="text-[10px] text-text-muted leading-snug">Needs {MIN_PICKS} settled picks on one market.</p>
      ) : (
        <div className="flex items-baseline justify-between gap-1.5">
          <span className="text-[11px] truncate min-w-0">{MARKET_LABELS[rows[0][0]]}</span>
          <span className={`text-[11px] font-bold tabular-nums shrink-0 ${rows[0][1].pl >= 0 ? 'text-profit' : 'text-loss'}`}>
            {formatCents(rows[0][1].pl)}
          </span>
        </div>
      )}
      <div className="flex items-baseline justify-between gap-1.5 mt-auto">
        <span className="text-[10px] text-text-muted tabular-nums">{stats.settledBets} settled</span>
        <span className={`text-[11px] font-bold tabular-nums ${roi >= 0 ? 'text-profit' : 'text-loss'}`}>
          {roi >= 0 ? '+' : ''}
          {(roi * 100).toFixed(1)}%
        </span>
      </div>
    </MiniCard>
  );
}

/** Profit by week as bars either side of a centre line. The season's shape, which the single Season
 *  P/L figure cannot show: +$90 built steadily and +$90 off one lucky week look identical there and
 *  nothing alike here.
 *
 *  Drawn as an SVG on a fixed viewBox rather than as flex children, so a full 18-week season packs
 *  into the same half-width card a 4-week one uses, with the bars simply getting thinner. */
export function SeasonShape({ bets, to }: { bets: TeamBet[]; to: string }) {
  const navigate = useNavigate();
  const byWeek = new Map<number, number>();
  for (const b of bets) {
    if (b.status === 'pending') continue;
    const w = Number(b.week);
    if (!Number.isFinite(w)) continue;
    byWeek.set(w, (byWeek.get(w) ?? 0) + (b.settledProfit ?? 0));
  }
  const weeks = [...byWeek.keys()].sort((a, b) => a - b);
  if (weeks.length < 2) return null;
  const peak = Math.max(1, ...weeks.map((w) => Math.abs(byWeek.get(w) ?? 0)));
  const total = weeks.reduce((sum, w) => sum + (byWeek.get(w) ?? 0), 0);

  const W = 100;
  const H = 24;
  const mid = H / 2;
  const slot = W / weeks.length;
  const barW = Math.max(1.2, slot * 0.68);

  return (
    <MiniCard icon={<TrendingUp size={13} />} title="Stats" onClick={() => navigate(to)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-7" role="img" aria-label="Profit by week">
        <line x1="0" y1={mid} x2={W} y2={mid} stroke="currentColor" strokeWidth="0.8" className="text-text-muted" opacity="0.45" />
        {weeks.map((w, i) => {
          const v = byWeek.get(w) ?? 0;
          // Every bar keeps a visible stub at zero so a flat week reads as a week, not as a gap.
          const h = Math.max(0.8, (Math.abs(v) / peak) * (mid - 1));
          const x = i * slot + (slot - barW) / 2;
          return (
            <rect
              key={w}
              x={x}
              y={v >= 0 ? mid - h : mid}
              width={barW}
              height={h}
              rx="0.5"
              className={v >= 0 ? 'fill-profit' : 'fill-loss'}
            />
          );
        })}
      </svg>
      <div className="flex items-baseline justify-between gap-1.5 mt-auto">
        <span className="text-[10px] text-text-muted tabular-nums truncate">Wk {weeks[0]}-{weeks[weeks.length - 1]}</span>
        <span className={`text-[11px] font-bold tabular-nums ${total >= 0 ? 'text-profit' : 'text-loss'}`}>
          {formatCents(total)}
        </span>
      </div>
    </MiniCard>
  );
}

/** Where this team sits in the league's power rankings, and the shape of how it got there.
 *
 * Deliberately built from powerSeries(league) with no games passed, which gives one point a week.
 * The full screen steps by game day, and that needs every settled pick's game loaded, which is a
 * fetch per game on a cold open because real games are kept out of the persisted store on purpose
 * (their scores go stale). That is what makes the full screen say "Loading the season" for a moment.
 * A sparkline has no use for day-level detail, so this one asks for none and draws immediately (see
 * chat, Oct 2026).
 */
export function PowerMini({ league, teamId, to }: { league: League; teamId: string; to: string }) {
  const navigate = useNavigate();
  const series = powerSeries(league);
  const points = series[teamId] ?? [];
  if (points.length === 0) return null;

  const now = points[points.length - 1];
  const before = points.length > 1 ? points[points.length - 2] : undefined;
  const movement = before ? before.rank - now.rank : null;

  // The last stretch only. Over a full season a weekly swing is a wobble against the season's whole
  // range; over the recent run it is the shape of how they are playing now (see chat, Oct 2026).
  const WINDOW = 8;
  const shown = points.slice(-WINDOW);
  const first = shown[0];

  // Scaled to this team's own range, not the league's. Against the league a mid-table team is a flat
  // line in the middle of the card whatever it did.
  const mine = shown.map((p) => p.score);
  let lo = Math.min(...mine);
  let hi = Math.max(...mine);
  if (hi - lo < 1) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.12;
  lo -= pad;
  hi += pad;

  const W = 100;
  const H = 30;
  const x = (i: number) => (shown.length <= 1 ? W : (i * W) / (shown.length - 1));
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const d = shown.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(' ');
  const team = league.teams.find((t) => t.id === teamId);

  // Two greys for reference, drawn only when they fall inside this team's own range: where they
  // started this stretch, and the break-even line. Without them a line scaled to its own min and max
  // always touches both edges and so never looks like it moved at all.
  const startY = y(first.score);
  const zeroY = y(0);
  const inRange = (v: number) => v > 1 && v < H - 1;

  return (
    <Card onClick={() => navigate(to)} dense className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-text-muted shrink-0 flex items-center">
          <Gauge size={13} />
        </span>
        <p className="font-semibold text-[11px] truncate flex-1 min-w-0">Power Rankings</p>
        <ChevronRight size={13} className="text-text-muted shrink-0" />
      </div>
      <div className="flex items-center gap-3">
        <div className="shrink-0 text-center w-10">
          <p className="text-base font-bold tabular-nums leading-none">{ordinalShort(now.rank)}</p>
          <p className="text-[9px] text-text-muted leading-none mt-0.5">of {league.teams.length}</p>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="flex-1 min-w-0 h-8" role="img" aria-label="Power score by week">
          {inRange(zeroY) && (
            <line x1="0" y1={zeroY} x2={W} y2={zeroY} stroke="currentColor" strokeWidth="1" className="text-text-muted" opacity="0.45" vectorEffect="non-scaling-stroke" />
          )}
          {inRange(startY) && (
            <line
              x1="0"
              y1={startY}
              x2={W}
              y2={startY}
              stroke="currentColor"
              strokeWidth="1"
              strokeDasharray="3 3"
              className="text-text-muted"
              opacity="0.3"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <path
            d={d}
            fill="none"
            stroke={team?.logoColor ?? 'currentColor'}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div className="shrink-0 flex items-center gap-1">
          <MovementTriangle value={movement} />
          <span className={`text-sm font-bold tabular-nums ${now.score >= 0 ? 'text-profit' : 'text-loss'}`}>
            {now.score >= 0 ? '+' : ''}
            {now.score.toFixed(1)}
          </span>
        </div>
      </div>
    </Card>
  );
}

const ordinalShort = (n: number) => {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};
