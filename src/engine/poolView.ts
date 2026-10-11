import type { PoolWeekEntry, PrizePool, WeekId } from '../types';

// Reading the prize pool's stored history (1.2.11): who moved it in a given week, who has moved it most
// all season, and the week that moved it most. Weeks saved before 1.2.11 have no per-team detail; the
// next rebuild fills it in, and `poolHasDetail` is what the screen checks before offering a week view.

export interface PoolImpactRow {
  teamId: string;
  /** Real dollars this team added to (or took off) the pool. */
  impact: number;
  /** The multiplier it carried. For a season row, the average across the weeks it played. */
  multiplier: number;
  /** Weeks counted (1 for a single week). */
  weeks: number;
}

const byImpact = (a: PoolImpactRow, b: PoolImpactRow) => b.impact - a.impact;

/** True once any week in the history carries per-team detail. */
export function poolHasDetail(pool: Pick<PrizePool, 'history'> | null | undefined): boolean {
  return !!pool?.history.some((h) => h.byTeam && Object.keys(h.byTeam).length > 0);
}

/** One week's teams, biggest gain first. Empty for a week saved before 1.2.11. */
export function weekImpacts(entry: PoolWeekEntry | undefined): PoolImpactRow[] {
  if (!entry?.byTeam) return [];
  return Object.entries(entry.byTeam)
    .map(([teamId, v]) => ({ teamId, impact: v.impact, multiplier: v.multiplier, weeks: 1 }))
    .sort(byImpact);
}

/** Every team's total across the whole tracked history, biggest first. */
export function seasonImpacts(pool: Pick<PrizePool, 'history'> | null | undefined): PoolImpactRow[] {
  const totals = new Map<string, PoolImpactRow>();
  for (const h of pool?.history ?? []) {
    for (const [teamId, v] of Object.entries(h.byTeam ?? {})) {
      const row = totals.get(teamId) ?? { teamId, impact: 0, multiplier: 0, weeks: 0 };
      row.impact += v.impact;
      row.multiplier += v.multiplier;
      row.weeks += 1;
      totals.set(teamId, row);
    }
  }
  return [...totals.values()].map((r) => ({ ...r, multiplier: r.weeks > 0 ? r.multiplier / r.weeks : 1 })).sort(byImpact);
}

/** The week that moved the pool furthest in either direction. */
export function biggestSwing(pool: Pick<PrizePool, 'history'> | null | undefined): PoolWeekEntry | null {
  let best: PoolWeekEntry | null = null;
  for (const h of pool?.history ?? []) {
    if (!best || Math.abs(h.netRealPL) > Math.abs(best.netRealPL)) best = h;
  }
  return best;
}

/** The last settled week, the best one and the worst one: the season at a glance under the chart. */
export function poolHighlights(pool: Pick<PrizePool, 'history'> | null | undefined): {
  last: PoolWeekEntry | null;
  best: PoolWeekEntry | null;
  worst: PoolWeekEntry | null;
} {
  const history = pool?.history ?? [];
  let best: PoolWeekEntry | null = null;
  let worst: PoolWeekEntry | null = null;
  for (const h of history) {
    if (h.netRealPL > 0 && (!best || h.netRealPL > best.netRealPL)) best = h;
    if (h.netRealPL < 0 && (!worst || h.netRealPL < worst.netRealPL)) worst = h;
  }
  return { last: history[history.length - 1] ?? null, best, worst };
}

/** One team's own week-by-week pool impact, in calendar order (My Stats). */
export function teamWeeklyImpact(pool: Pick<PrizePool, 'history'> | null | undefined, teamId: string): { week: WeekId; impact: number; multiplier: number }[] {
  const out: { week: WeekId; impact: number; multiplier: number }[] = [];
  for (const h of pool?.history ?? []) {
    const mine = h.byTeam?.[teamId];
    if (mine) out.push({ week: h.week, impact: mine.impact, multiplier: mine.multiplier });
  }
  return out;
}

export function findWeek(pool: Pick<PrizePool, 'history'> | null | undefined, week: WeekId | string | null): PoolWeekEntry | undefined {
  if (week == null) return undefined;
  return pool?.history.find((h) => String(h.week) === String(week));
}
