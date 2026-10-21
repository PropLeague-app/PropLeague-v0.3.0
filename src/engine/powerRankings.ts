import type { DaySlot, League, NFLGame, WeeklyRoster, WeekId } from '../types';
import { weekOrder } from '../types';
import { rosterKey } from './rosterSlots';
import { americanToImpliedProbability } from './oddsMath';
import { computeStandings, sortStandings } from './standings';
import { DAY_SLOT_ORDER } from './dayWindows';

/** How sharp a bettor is, as opposed to how their season is going.
 *
 * Standings answer "who is winning", which in an eight-team league is heavily schedule luck: you
 * can lose a matchup with the second-best week in the league. This answers "who is actually good at
 * this", and it is built from one quantity per settled bet (see chat, Oct 2026):
 *
 *     stake x (result - impliedProbability(price))
 *
 * `result` is 1 for a win and 0 for a loss. A pick at -200 is priced to win 66.7% of the time, so
 * landing it earns only a third of the stake in credit while missing it costs two thirds; a +300
 * longshot is the reverse. Summed, the figure says how much better or worse someone did than the
 * prices they took said they would, weighted by how much they put behind each call. Stake-weighting
 * is deliberate: spreading 100 credits across eight slots is part of the skill, so backing your best
 * look harder should count for more than picking it flat.
 *
 * Three properties worth knowing:
 *
 * - Zero is not break-even. A -110 price implies 52.4% while the fair probability is about 50%, so
 *   the vig drags everyone slightly negative. Beating the price you actually took is the bar, and
 *   de-vigging properly would need the other side's price, which a wager does not store.
 * - It is a running sum rather than a rate, so someone three bets into a season physically cannot be
 *   far from zero while someone fifty bets in has room to separate. Early noise shows up as lines
 *   starting together and fanning out, which is what the trajectory graph is for.
 * - Every team fills the same slots every week, so sample sizes stay near-identical across a league
 *   and nobody needs shrinking toward the mean.
 *
 * Pushes and voids are skipped. A push is not a judgment on the pick and a void is a rules artifact,
 * and the app's existing hit-rate-vs-odds figure counts wins and losses only, so this matches it.
 */

/** One team's standing at one point in the season. */
export interface PowerPoint {
  week: WeekId;
  /** Which window within the week this point closes, when the series is stepped by game day. */
  slot?: DaySlot;
  /** Cumulative stake-weighted edge through this week. */
  score: number;
  /** 1-based position in the league at this week, by score. */
  rank: number;
  /** Settled bets counted so far, so a thin early sample can be shown as such. */
  bets: number;
}

/** What a settled wager contributes. Returns 0 for anything not decided. */
export function betEdge(wager: { status: string; stake: number; oddsAtPlacement: number }): number {
  if (wager.status !== 'won' && wager.status !== 'lost') return 0;
  const result = wager.status === 'won' ? 1 : 0;
  return wager.stake * (result - americanToImpliedProbability(wager.oddsAtPlacement));
}

/** Settled picks in a roster, optionally only those whose game sits in one day window. */
function rosterEdge(
  roster: WeeklyRoster | undefined,
  gamesById?: Record<string, NFLGame>,
  onlySlot?: DaySlot,
): { edge: number; bets: number } {
  if (!roster) return { edge: 0, bets: 0 };
  let edge = 0;
  let bets = 0;
  for (const slot of roster.slots) {
    const w = slot.wager;
    if (!w || (w.status !== 'won' && w.status !== 'lost')) continue;
    if (onlySlot) {
      const game = gamesById?.[w.gameId];
      // A pick whose game is not loaded cannot be placed in a day window; it lands in the last one
      // so it is still counted rather than silently dropped from the season.
      const where = game?.daySlot ?? DAY_SLOT_ORDER[DAY_SLOT_ORDER.length - 1];
      if (where !== onlySlot) continue;
    }
    edge += betEdge(w);
    bets += 1;
  }
  return { edge, bets };
}

/** Weeks that have actually produced a result, in season order.
 *
 * Scheduled weeks are not enough: a league's schedule runs to Week 18 from the day it starts, so
 * keying off matchupsByWeek alone drew every line flat across a dozen weeks that have not happened
 * (see chat, Oct 2026). A week counts once any team in the league has a settled pick in it, so the
 * trajectory ends where the season has actually reached and extends as the weeks land. */
export function leagueWeeks(league: League): WeekId[] {
  const scheduled = Object.keys(league.matchupsByWeek)
    .filter((w) => (league.matchupsByWeek[w] ?? []).length > 0)
    .map((w) => (Number.isNaN(Number(w)) ? (w as WeekId) : (Number(w) as WeekId)))
    .sort((a, b) => weekOrder(a) - weekOrder(b));

  return scheduled.filter((week) =>
    league.teams.some((t) => {
      const roster = league.rostersByTeamWeek[rosterKey(t.id, week)];
      return roster?.slots.some((s) => s.wager && (s.wager.status === 'won' || s.wager.status === 'lost'));
    }),
  );
}

/**
 * The full trajectory: for each team, their cumulative score and rank after every week.
 *
 * Ranks are resolved across the league at each week rather than per team, so the lines on a graph
 * are mutually consistent. Ties share the better rank, the way standings positions normally read.
 */
export function powerSeries(
  league: League,
  /** Real games, so each week can be stepped by the day its picks actually settled. Without them
   *  the series falls back to one point per week, which is all the data supports. */
  gamesById?: Record<string, NFLGame>,
): Record<string, PowerPoint[]> {
  const weeks = leagueWeeks(league);
  const teamIds = league.teams.map((t) => t.id);
  const out: Record<string, PowerPoint[]> = Object.fromEntries(teamIds.map((id) => [id, []]));
  const running = new Map(teamIds.map((id) => [id, { score: 0, bets: 0 }]));

  /** Close off one point in time: everyone's running total, ranked against each other. */
  const mark = (week: WeekId, slot?: DaySlot) => {
    const ordered = [...teamIds].sort((a, b) => running.get(b)!.score - running.get(a)!.score);
    const rankOf = new Map<string, number>();
    ordered.forEach((id, i) => {
      const prev = i > 0 ? ordered[i - 1] : null;
      rankOf.set(id, prev && running.get(prev)!.score === running.get(id)!.score ? rankOf.get(prev)! : i + 1);
    });
    for (const id of teamIds) {
      const cur = running.get(id)!;
      out[id].push({ week, slot, score: cur.score, rank: rankOf.get(id)!, bets: cur.bets });
    }
  };

  for (const week of weeks) {
    if (!gamesById) {
      for (const id of teamIds) {
        const { edge, bets } = rosterEdge(league.rostersByTeamWeek[rosterKey(id, week)]);
        const cur = running.get(id)!;
        cur.score += edge;
        cur.bets += bets;
      }
      mark(week);
      continue;
    }

    // Step the week by game day, so a Thursday result moves the line on Thursday rather than the
    // whole week landing at once (see chat, Oct 2026). Only windows this week's picks actually
    // used get a point, so a week with everything on Sunday stays one step.
    const used = DAY_SLOT_ORDER.filter((slot) =>
      teamIds.some((id) => rosterEdge(league.rostersByTeamWeek[rosterKey(id, week)], gamesById, slot).bets > 0),
    );
    for (const slot of used.length > 0 ? used : [undefined]) {
      for (const id of teamIds) {
        const { edge, bets } = rosterEdge(league.rostersByTeamWeek[rosterKey(id, week)], gamesById, slot);
        const cur = running.get(id)!;
        cur.score += edge;
        cur.bets += bets;
      }
      mark(week, slot);
    }
  }

  return out;
}

export interface PowerRow {
  teamId: string;
  score: number;
  rank: number;
  bets: number;
  /** Rank last week minus rank now: positive is a climb. Null in the first week with any data. */
  movement: number | null;
}

/** The current table, with how far each team has moved since the previous week. */
export function powerRankings(league: League): PowerRow[] {
  const series = powerSeries(league);
  const rows: PowerRow[] = league.teams.map((t) => {
    const points = series[t.id] ?? [];
    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    return {
      teamId: t.id,
      score: last?.score ?? 0,
      rank: last?.rank ?? 0,
      bets: last?.bets ?? 0,
      movement: last && prev ? prev.rank - last.rank : null,
    };
  });
  return rows.sort((a, b) => a.rank - b.rank || b.score - a.score);
}

/**
 * Standings as they stood at the end of a given week.
 *
 * No new data: computeStandings already walks matchupsByWeek, so handing it a filtered set of weeks
 * replays the season to that point. This is what the up and down arrows on the Standings screen are
 * built from, and it is why that feature needs no migration.
 */
export function standingsThroughWeek(league: League, week: WeekId): string[] {
  const upTo = weekOrder(week);
  const matchups: Record<string, typeof league.matchupsByWeek[string]> = {};
  for (const [key, list] of Object.entries(league.matchupsByWeek)) {
    const w = (Number.isNaN(Number(key)) ? key : Number(key)) as WeekId;
    if (weekOrder(w) <= upTo) matchups[key] = list;
  }
  const table = computeStandings(
    league.teams.map((t) => t.id),
    matchups,
    league.rostersByTeamWeek,
  );
  return sortStandings(table, matchups).map((s) => s.teamId);
}

/**
 * How far each team has moved in the standings since the previous week.
 *
 * Positive is a climb. Null means there is no previous week to compare against, which is every team
 * in the first week of a season rather than a missing value.
 */
export function standingsMovement(league: League): Record<string, number | null> {
  // Decided matchups, not settled picks. Standings are driven by who won each week, so the right
  // question is which weeks have a result, and a week can be decided with no pick of this team's
  // ever settling (a bye, a forfeit, an opponent who never filled a lineup).
  const weeks = Object.keys(league.matchupsByWeek)
    .filter((w) => (league.matchupsByWeek[w] ?? []).some((m) => m.winnerId != null || m.isTie))
    .map((w) => (Number.isNaN(Number(w)) ? (w as WeekId) : (Number(w) as WeekId)))
    .sort((a, b) => weekOrder(a) - weekOrder(b));
  const out: Record<string, number | null> = Object.fromEntries(league.teams.map((t) => [t.id, null]));
  if (weeks.length < 2) return out;

  const now = standingsThroughWeek(league, weeks[weeks.length - 1]);
  const before = standingsThroughWeek(league, weeks[weeks.length - 2]);
  const posBefore = new Map(before.map((id, i) => [id, i]));
  now.forEach((id, i) => {
    const was = posBefore.get(id);
    out[id] = was == null ? null : was - i;
  });
  return out;
}

/** The working behind one team's score, so the number can show where it came from. */
export interface PowerBreakdown {
  settled: number;
  wins: number;
  losses: number;
  /** Credits staked on settled picks. */
  staked: number;
  /** How often the prices said these picks would land, and how often they did. */
  impliedRate: number;
  hitRate: number;
  /** Percentage points of hit rate above what the prices implied. */
  edgePts: number;
  /** Credit earned on the picks that landed, and given back on the ones that did not. */
  fromWins: number;
  fromLosses: number;
  score: number;
}

/** `through` stops the sum at one point on the trajectory, for reading the season back at a moment
 * rather than only as it stands now (see chat, Oct 2026: scrubbing).
 *
 * It takes the point itself, not just a week, because a week can hold several points once the
 * series is stepped by game day. Cutting at the week instead would make the figures under the graph
 * disagree with the point the graph is showing. */
export function powerBreakdown(
  league: League,
  teamId: string,
  through?: { week: WeekId; slot?: DaySlot },
  gamesById?: Record<string, NFLGame>,
): PowerBreakdown {
  const limit = through == null ? Infinity : weekOrder(through.week);
  const cutSlot = through?.slot;
  const slotRank = (g: NFLGame | undefined) =>
    DAY_SLOT_ORDER.indexOf(g?.daySlot ?? DAY_SLOT_ORDER[DAY_SLOT_ORDER.length - 1]);
  const cutRank = cutSlot ? DAY_SLOT_ORDER.indexOf(cutSlot) : Infinity;
  let settled = 0;
  let wins = 0;
  let losses = 0;
  let staked = 0;
  let impliedSum = 0;
  let fromWins = 0;
  let fromLosses = 0;

  for (const week of leagueWeeks(league)) {
    if (weekOrder(week) > limit) break;
    const roster = league.rostersByTeamWeek[rosterKey(teamId, week)];
    if (!roster) continue;
    const partialWeek = cutSlot != null && weekOrder(week) === limit;
    for (const slot of roster.slots) {
      const w = slot.wager;
      if (!w || (w.status !== 'won' && w.status !== 'lost')) continue;
      // On the week being cut into, only the day windows up to and including the held one count.
      if (partialWeek && slotRank(gamesById?.[w.gameId]) > cutRank) continue;
      const implied = americanToImpliedProbability(w.oddsAtPlacement);
      settled += 1;
      staked += w.stake;
      impliedSum += implied;
      if (w.status === 'won') {
        wins += 1;
        fromWins += w.stake * (1 - implied);
      } else {
        losses += 1;
        fromLosses += w.stake * -implied;
      }
    }
  }

  const impliedRate = settled > 0 ? impliedSum / settled : 0;
  const hitRate = settled > 0 ? wins / settled : 0;
  return {
    settled, wins, losses, staked, impliedRate, hitRate,
    edgePts: (hitRate - impliedRate) * 100,
    fromWins, fromLosses,
    score: fromWins + fromLosses,
  };
}

/** True once every settled pick in the league has its game loaded.
 *
 * The trajectory steps by game day, and a pick whose game is missing cannot be placed in a day
 * window. Rendering before they arrive draws the weekly version and then visibly redraws a moment
 * later, so a screen can wait on this instead (see chat, Oct 2026).
 */
export function gamesReadyForSeries(league: League, gamesById: Record<string, NFLGame>): boolean {
  for (const roster of Object.values(league.rostersByTeamWeek)) {
    for (const slot of roster.slots) {
      const w = slot.wager;
      if (!w || (w.status !== 'won' && w.status !== 'lost')) continue;
      if (!gamesById[w.gameId]) return false;
    }
  }
  return true;
}

/** When a point in the trajectory happened, from the games its week and window were played in.
 * Null when the series is not stepped by day, or the games are not loaded. */
export function pointDate(
  point: { week: WeekId; slot?: DaySlot } | undefined,
  gamesById: Record<string, NFLGame> | undefined,
): Date | null {
  if (!point?.slot || !gamesById) return null;
  let earliest: number | null = null;
  for (const game of Object.values(gamesById)) {
    if (String(game.week) !== String(point.week) || game.daySlot !== point.slot) continue;
    const t = new Date(game.kickoff).getTime();
    if (Number.isNaN(t)) continue;
    if (earliest == null || t < earliest) earliest = t;
  }
  return earliest == null ? null : new Date(earliest);
}
