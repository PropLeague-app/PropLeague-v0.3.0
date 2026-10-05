// Extra league-wide boards for the Leaderboards screen, built from the same per-team numbers the
// My Stats screen uses so the two always agree.
import type { League, MarketKey, NFLGame } from '../types';
import { collectTeamBets, computeIndividualStats, type IndividualStats, type RecordPL } from './stats';
import { perfectWeeksForTeam } from './perfectWeek';

export interface TeamValue {
  teamId: string;
  value: number;
}

export interface MarketSpecialist {
  market: MarketKey;
  teamId: string;
  roi: number;
  /** Settled bets that team has in this market. */
  bets: number;
  /** Everything the whole league wagered in this market, used to order the list. */
  leagueWagered: number;
}

export interface SkillBoards {
  /** Actual win rate minus the win rate the odds implied, in points. Needs a few decided bets. */
  hitRateEdge: TeamValue[];
  longestWinStreak: TeamValue[];
  biggestWin: TeamValue[];
  perfectWeeks: TeamValue[];
  marketSpecialists: MarketSpecialist[];
}

export const MIN_DECIDED_FOR_EDGE = 5;
export const MIN_BETS_FOR_MARKET_SPECIALIST = 3;

const byValueDesc = (a: TeamValue, b: TeamValue) => b.value - a.value;

export function computeSkillBoards(league: League, gameLookup: (gameId: string) => NFLGame | undefined): SkillBoards {
  const perTeam: { teamId: string; stats: IndividualStats }[] = league.teams.map((t) => ({
    teamId: t.id,
    stats: computeIndividualStats(collectTeamBets(league, t.id), gameLookup),
  }));

  const hitRateEdge = perTeam
    .filter((t) => t.stats.wins + t.stats.losses >= MIN_DECIDED_FOR_EDGE)
    .map((t) => ({ teamId: t.teamId, value: (t.stats.winRate - t.stats.impliedWinRate) * 100 }))
    .sort(byValueDesc);

  const longestWinStreak = perTeam.map((t) => ({ teamId: t.teamId, value: t.stats.longestWinStreak })).filter((t) => t.value > 0).sort(byValueDesc);
  const biggestWin = perTeam.map((t) => ({ teamId: t.teamId, value: t.stats.biggestWin })).filter((t) => t.value > 0).sort(byValueDesc);
  const perfectWeeks = league.teams
    .map((t) => ({ teamId: t.id, value: perfectWeeksForTeam(league, t.id).length }))
    .filter((t) => t.value > 0)
    .sort(byValueDesc);

  const markets = new Set<MarketKey>();
  for (const t of perTeam) for (const k of Object.keys(t.stats.byMarket) as MarketKey[]) markets.add(k);
  const marketSpecialists: MarketSpecialist[] = [];
  for (const market of markets) {
    const rows = perTeam
      .map((t) => ({ teamId: t.teamId, rec: t.stats.byMarket[market] as RecordPL | undefined }))
      .filter((r): r is { teamId: string; rec: RecordPL } => !!r.rec && r.rec.wagered > 0);
    const leagueWagered = rows.reduce((s, r) => s + r.rec.wagered, 0);
    const qualified = rows
      .filter((r) => r.rec.wins + r.rec.losses + r.rec.pushes >= MIN_BETS_FOR_MARKET_SPECIALIST)
      .sort((a, b) => b.rec.pl / b.rec.wagered - a.rec.pl / a.rec.wagered);
    const best = qualified[0];
    if (best) marketSpecialists.push({ market, teamId: best.teamId, roi: best.rec.pl / best.rec.wagered, bets: best.rec.wins + best.rec.losses + best.rec.pushes, leagueWagered });
  }
  marketSpecialists.sort((a, b) => b.leagueWagered - a.leagueWagered);

  return { hitRateEdge, longestWinStreak, biggestWin, perfectWeeks, marketSpecialists };
}

/** Scores for one week from the matchups (live while the week is in progress), best first. */
export function weekScoreboard(league: Pick<League, 'matchupsByWeek'>, week: string | number): TeamValue[] {
  const rows: TeamValue[] = [];
  for (const m of league.matchupsByWeek[String(week)] ?? []) {
    if (m.teamAScore != null) rows.push({ teamId: m.teamAId, value: m.teamAScore });
    if (m.teamBScore != null) rows.push({ teamId: m.teamBId, value: m.teamBScore });
  }
  return rows.sort(byValueDesc);
}
