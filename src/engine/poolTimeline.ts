import type { DaySlot, League, PrizePool, WeekId } from '../types';
import { rosterKey } from './rosterSlots';
import { DAY_SLOT_ORDER } from './dayWindows';
import { poolTeamCount, realDollarAmount } from './prizePool';

/** One point on the prize pool's line. */
export interface PoolTimelinePoint {
  /** 'start' for the pool as created, otherwise the week this point sits in. */
  week: WeekId | 'start';
  /** The game window this point closes, when the week could be stepped by game day. */
  slot?: DaySlot;
  /** The pool at this moment. */
  value: number;
  /** The last point of its week, which is that week's settled (or, for the live week, current) pool. */
  weekEnd: boolean;
  /** Part of the week still being played: provisional, drawn dashed. */
  live: boolean;
  /** Earliest kickoff among the games in this window, for labelling the moment. */
  kickoff?: string;
}

/**
 * The prize pool over the season, stepped by game window rather than once a week (backlog C3).
 *
 * Every week starts from the previous week's closing pool (`poolBefore`) and each settled pick moves
 * it by exactly its share: profit over the week's credits, times that week's pool per team, times the
 * team's multiplier that week. That is advancePoolForWeek's own formula, split by when each pick's
 * game was played. Picks in the same game settle together, so a window (Thursday, Sunday early,
 * Sunday late, Sunday night, Monday) is one step. Steps inside a week do not compound off each other;
 * only the week's close carries into the next week.
 *
 * Each week's last step lands on the stored `poolAfter`, so the line always agrees with the settled
 * history. That last step is also where penalties appear: they are only charged when a week closes.
 *
 * A week falls back to a single point when it cannot be split honestly: no per-team detail (weeks
 * settled before 1.2.11), or a settled pick whose game window is not known yet.
 *
 * `pool` is the pool as the screen draws it, the live week included on the end (poolWithLiveWeek);
 * `liveWeek` says which entry that is.
 */
export function poolTimeline(league: League, pool: PrizePool, liveWeek: WeekId | null = null): PoolTimelinePoint[] {
  const out: PoolTimelinePoint[] = [{ week: 'start', value: pool.initial, weekEnd: true, live: false }];
  const teamCount = poolTeamCount(league);
  const credits = league.settings.weeklyCredits;

  for (const h of pool.history) {
    const live = liveWeek != null && String(h.week) === String(liveWeek);
    const end: PoolTimelinePoint = { week: h.week, value: h.poolAfter, weekEnd: true, live };
    const teams = Object.entries(h.byTeam ?? {});
    if (teams.length === 0) {
      out.push(end);
      continue;
    }

    // Each window's move, and the earliest kickoff in it.
    const moves = new Map<DaySlot, number>();
    const kickoffs = new Map<DaySlot, string>();
    let splittable = true;
    for (const [teamId, { multiplier }] of teams) {
      const roster = league.rostersByTeamWeek[rosterKey(teamId, h.week)];
      for (const s of roster?.slots ?? []) {
        const w = s.wager;
        if (!w || w.status === 'pending') continue;
        if (!w.daySlot) {
          splittable = false;
          break;
        }
        const impact = realDollarAmount(w.settledProfit ?? 0, credits, h.poolBefore, teamCount) * multiplier;
        moves.set(w.daySlot, (moves.get(w.daySlot) ?? 0) + impact);
        const seen = kickoffs.get(w.daySlot);
        if (w.kickoff && (!seen || w.kickoff < seen)) kickoffs.set(w.daySlot, w.kickoff);
      }
      if (!splittable) break;
    }

    const used = DAY_SLOT_ORDER.filter((slot) => moves.has(slot));
    if (!splittable || used.length === 0) {
      out.push(end);
      continue;
    }

    let running = h.poolBefore;
    used.forEach((slot, i) => {
      const last = i === used.length - 1;
      running += moves.get(slot)!;
      out.push({
        week: h.week,
        slot,
        // The last window lands on the stored figure: same line as the history, penalties included.
        value: last ? h.poolAfter : Math.max(0, running),
        weekEnd: last,
        live,
        kickoff: kickoffs.get(slot),
      });
    });
  }
  return out;
}

/** Index of a week's closing point, or of the 'start' point. -1 when the week is not on the line. */
export function weekEndIndex(points: PoolTimelinePoint[], week: WeekId | 'start'): number {
  return points.findIndex((p) => p.weekEnd && String(p.week) === String(week));
}

/** The pool just before a point's week began (the previous week's close). */
export function weekStartValue(points: PoolTimelinePoint[], index: number): number {
  const week = points[index]?.week;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (String(points[i].week) !== String(week)) return points[i].value;
  }
  return points[0]?.value ?? 0;
}
