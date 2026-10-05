// Stats that go beyond the per-bet breakdowns in stats.ts: week-by-week trend, players, unspent
// credits, and the matchup side of the season (points, head-to-head, all-play). All pure, built from
// data the app already holds, so nothing new is stored.
import type { League, WeekId } from '../types';
import { weekOrder } from '../types';
import { rosterKey } from './rosterSlots';
import type { TeamBet } from './stats';

export interface WeeklyPL {
  week: WeekId;
  pl: number;
  wagered: number;
  /** Settled bets that week (won, lost, push). */
  bets: number;
}

/** P/L per week from settled bets, oldest to newest. Voids count as $0 and stay out of `bets`. */
export function weeklyPL(bets: TeamBet[]): WeeklyPL[] {
  const byWeek = new Map<string, WeeklyPL>();
  for (const b of bets) {
    if (b.status === 'pending') continue;
    const key = String(b.week);
    const row = byWeek.get(key) ?? { week: b.week, pl: 0, wagered: 0, bets: 0 };
    row.pl += b.settledProfit ?? 0;
    if (b.status !== 'voided') {
      row.wagered += b.stake;
      row.bets += 1;
    }
    byWeek.set(key, row);
  }
  return [...byWeek.values()].sort((a, b) => weekOrder(a.week) - weekOrder(b.week));
}

export function bestAndWorstWeek(weeks: WeeklyPL[]): { best: WeeklyPL | null; worst: WeeklyPL | null } {
  if (weeks.length === 0) return { best: null, worst: null };
  let best = weeks[0];
  let worst = weeks[0];
  for (const w of weeks) {
    if (w.pl > best.pl) best = w;
    if (w.pl < worst.pl) worst = w;
  }
  return { best, worst };
}

export interface PlayerRecord {
  playerName: string;
  wins: number;
  losses: number;
  pushes: number;
  /** Every bet on him, settled or not. */
  picks: number;
  pl: number;
  wagered: number;
}

/** Record per player across all bets that name one (game-line bets have no player). */
export function playerRecords(bets: TeamBet[]): PlayerRecord[] {
  const map = new Map<string, PlayerRecord>();
  for (const b of bets) {
    if (!b.playerName) continue;
    const row = map.get(b.playerName) ?? { playerName: b.playerName, wins: 0, losses: 0, pushes: 0, picks: 0, pl: 0, wagered: 0 };
    row.picks += 1;
    if (b.status === 'won') row.wins += 1;
    else if (b.status === 'lost') row.losses += 1;
    else if (b.status === 'push') row.pushes += 1;
    if (b.status === 'won' || b.status === 'lost' || b.status === 'push') {
      row.pl += b.settledProfit ?? 0;
      row.wagered += b.stake;
    }
    map.set(b.playerName, row);
  }
  return [...map.values()];
}

/** Most picked, and best / worst by profit. Best and worst need a couple of settled bets so one lucky
 * or unlucky pick does not top the list. */
export function playerHighlights(records: PlayerRecord[], limit = 3, minSettled = 2) {
  const settled = (r: PlayerRecord) => r.wins + r.losses + r.pushes;
  const mostPicked = [...records].sort((a, b) => b.picks - a.picks || b.pl - a.pl).slice(0, limit);
  const eligible = records.filter((r) => settled(r) >= minSettled);
  const best = [...eligible].filter((r) => r.pl > 0).sort((a, b) => b.pl - a.pl).slice(0, limit);
  const worst = [...eligible].filter((r) => r.pl < 0).sort((a, b) => a.pl - b.pl).slice(0, limit);
  return { mostPicked, best, worst };
}

const isFinal = (m: { winnerId: string | null; isTie: boolean }) => m.winnerId != null || m.isTie;

export interface UnspentCredits {
  total: number;
  /** Weeks that left credits on the table, oldest first. */
  weeks: { week: WeekId; unspent: number }[];
}

/** Credits a team left unspent across weeks that are over. A week with no roster at all means no
 * picks were placed, so the whole weekly allowance went unspent. */
export function unspentCredits(league: Pick<League, 'matchupsByWeek' | 'rostersByTeamWeek' | 'settings'>, teamId: string): UnspentCredits {
  const weeks: { week: WeekId; unspent: number }[] = [];
  for (const matchups of Object.values(league.matchupsByWeek)) {
    const m = matchups.find((x) => x.teamAId === teamId || x.teamBId === teamId);
    if (!m || !isFinal(m)) continue;
    const roster = league.rostersByTeamWeek[rosterKey(teamId, m.week)];
    const staked = roster ? roster.slots.reduce((sum, s) => sum + (s.wager?.stake ?? 0), 0) : 0;
    const unspent = Math.max(0, league.settings.weeklyCredits - staked);
    if (unspent > 0.005) weeks.push({ week: m.week, unspent });
  }
  weeks.sort((a, b) => weekOrder(a.week) - weekOrder(b.week));
  return { total: weeks.reduce((s, w) => s + w.unspent, 0), weeks };
}

export interface Rec {
  wins: number;
  losses: number;
  ties: number;
}

export interface HeadToHead extends Rec {
  opponentId: string;
  pointsFor: number;
  pointsAgainst: number;
}

export interface MatchupStats {
  record: Rec;
  pointsFor: number;
  pointsAgainst: number;
  headToHead: HeadToHead[];
  /** Each finished week scored against every other team's score that week. */
  allPlay: Rec;
  weeks: number;
}

/** Season matchup picture for one team, from finished matchups only. */
export function matchupStats(league: Pick<League, 'matchupsByWeek'>, teamId: string): MatchupStats {
  const out: MatchupStats = { record: { wins: 0, losses: 0, ties: 0 }, pointsFor: 0, pointsAgainst: 0, headToHead: [], allPlay: { wins: 0, losses: 0, ties: 0 }, weeks: 0 };
  const h2h = new Map<string, HeadToHead>();
  for (const [, matchups] of Object.entries(league.matchupsByWeek)) {
    const mine = matchups.find((m) => m.teamAId === teamId || m.teamBId === teamId);
    if (!mine || !isFinal(mine) || mine.teamAScore == null || mine.teamBScore == null) continue;
    const isA = mine.teamAId === teamId;
    const myScore = isA ? mine.teamAScore : mine.teamBScore;
    const oppScore = isA ? mine.teamBScore : mine.teamAScore;
    const oppId = isA ? mine.teamBId : mine.teamAId;
    out.weeks += 1;
    out.pointsFor += myScore;
    out.pointsAgainst += oppScore;
    const row = h2h.get(oppId) ?? { opponentId: oppId, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 };
    row.pointsFor += myScore;
    row.pointsAgainst += oppScore;
    if (mine.isTie) {
      out.record.ties += 1;
      row.ties += 1;
    } else if (mine.winnerId === teamId) {
      out.record.wins += 1;
      row.wins += 1;
    } else {
      out.record.losses += 1;
      row.losses += 1;
    }
    h2h.set(oppId, row);

    for (const other of matchups) {
      if (!isFinal(other) || other.teamAScore == null || other.teamBScore == null) continue;
      for (const [id, score] of [[other.teamAId, other.teamAScore], [other.teamBId, other.teamBScore]] as const) {
        if (id === teamId) continue;
        if (myScore > score) out.allPlay.wins += 1;
        else if (myScore < score) out.allPlay.losses += 1;
        else out.allPlay.ties += 1;
      }
    }
  }
  out.headToHead = [...h2h.values()].sort((a, b) => b.wins - a.wins || a.losses - b.losses || b.pointsFor - b.pointsAgainst - (a.pointsFor - a.pointsAgainst));
  return out;
}
