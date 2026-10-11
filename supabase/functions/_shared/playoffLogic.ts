// Server-side (Deno edge function) port of src/engine/playoffs.ts + the
// standings-tiebreaker and prize-pool-multiplier pieces of
// src/engine/standings.ts / src/engine/prizePool.ts that settle-week needs to
// run the season on its own (no client, no commissioner button).
//
// This is a deliberate, careful copy rather than a cross-directory import --
// `supabase functions deploy` bundles each function (plus anything under
// `_shared/`) independently, and importing straight from `src/engine/*` would
// reach outside that bundle. Keep this in sync with the client copies by hand
// if the bracket/tiebreaker/multiplier rules ever change -- there is no other
// mechanism enforcing that today.
//
// Weekly Moments (the awards) are not in this file: they live in
// _shared/momentsReal.ts, which settle-week runs on real wagers.

export type WeekId = number | 'WC' | 'DIV' | 'CONF';
export type PlayoffFieldSize = 2 | 4 | 6 | 8 | 16;
export const ALL_FIELD_SIZES: PlayoffFieldSize[] = [2, 4, 6, 8, 16];

export type MatchSource = { type: 'seed'; seed: number } | { type: 'winner'; matchId: string } | { type: 'loser'; matchId: string };

export interface BracketMatch {
  id: string;
  side: 'W' | 'L' | 'F' | 'RESET';
  label: string;
  sourceA: MatchSource;
  sourceB: MatchSource;
  teamAId: string | null;
  teamBId: string | null;
  teamAScore: number | null;
  teamBScore: number | null;
  winnerId: string | null;
  weekId: WeekId | null;
}

export interface PlayoffBracket {
  fieldSize: PlayoffFieldSize;
  eliminationType: 'single' | 'double';
  seeds: string[];
  matches: BracketMatch[];
  championId: string | null;
}

export interface PoolWeekEntry {
  week: WeekId;
  poolBefore: number;
  poolAfter: number;
  netRealPL: number;
  /** Each team's real-dollar impact that week and the multiplier it carried (1.2.11). */
  byTeam?: Record<string, { impact: number; multiplier: number }>;
}

export interface PrizePool {
  initial: number;
  current: number;
  locked: boolean;
  history: PoolWeekEntry[];
}

export interface StandingLine {
  teamId: string;
  wins: number;
  losses: number;
  ties: number;
  totalPL: number;
  betsWon: number;
  betsLost: number;
  bestWeekPL: number;
}

export interface MatchupLine {
  teamAId: string;
  teamBId: string;
  winnerId: string | null;
}

// --- Bracket construction (verbatim port of src/engine/playoffs.ts) --------

function seed(n: number): MatchSource {
  return { type: 'seed', seed: n };
}
function winnerOf(matchId: string): MatchSource {
  return { type: 'winner', matchId };
}
function loserOf(matchId: string): MatchSource {
  return { type: 'loser', matchId };
}
function bareMatch(id: string, side: BracketMatch['side'], label: string, sourceA: MatchSource, sourceB: MatchSource): BracketMatch {
  return { id, side, label, sourceA, sourceB, teamAId: null, teamBId: null, teamAScore: null, teamBScore: null, winnerId: null, weekId: null };
}

function buildWinnersBracket(fieldSize: PlayoffFieldSize): BracketMatch[] {
  switch (fieldSize) {
    case 2:
      return [bareMatch('F', 'F', 'Championship', seed(1), seed(2))];
    case 4:
      return [
        bareMatch('W1-1', 'W', 'Semifinal', seed(1), seed(4)),
        bareMatch('W1-2', 'W', 'Semifinal', seed(2), seed(3)),
        bareMatch('F', 'F', 'Championship', winnerOf('W1-1'), winnerOf('W1-2')),
      ];
    case 6:
      return [
        bareMatch('W1-1', 'W', 'Round 1', seed(3), seed(6)),
        bareMatch('W1-2', 'W', 'Round 1', seed(4), seed(5)),
        bareMatch('W2-1', 'W', 'Semifinal', seed(1), winnerOf('W1-2')),
        bareMatch('W2-2', 'W', 'Semifinal', seed(2), winnerOf('W1-1')),
        bareMatch('F', 'F', 'Championship', winnerOf('W2-1'), winnerOf('W2-2')),
      ];
    case 8:
      return [
        bareMatch('W1-1', 'W', 'Quarterfinal', seed(1), seed(8)),
        bareMatch('W1-2', 'W', 'Quarterfinal', seed(4), seed(5)),
        bareMatch('W1-3', 'W', 'Quarterfinal', seed(3), seed(6)),
        bareMatch('W1-4', 'W', 'Quarterfinal', seed(2), seed(7)),
        bareMatch('W2-1', 'W', 'Semifinal', winnerOf('W1-1'), winnerOf('W1-2')),
        bareMatch('W2-2', 'W', 'Semifinal', winnerOf('W1-3'), winnerOf('W1-4')),
        bareMatch('F', 'F', 'Championship', winnerOf('W2-1'), winnerOf('W2-2')),
      ];
    case 16: {
      const pairs: [number, number][] = [
        [1, 16], [8, 9], [5, 12], [4, 13], [3, 14], [6, 11], [7, 10], [2, 15],
      ];
      const r1 = pairs.map(([a, b], i) => bareMatch(`W1-${i + 1}`, 'W', 'Round 1', seed(a), seed(b)));
      const r2 = Array.from({ length: 4 }, (_, i) =>
        bareMatch(`W2-${i + 1}`, 'W', 'Quarterfinal', winnerOf(`W1-${i * 2 + 1}`), winnerOf(`W1-${i * 2 + 2}`)),
      );
      const r3 = Array.from({ length: 2 }, (_, i) =>
        bareMatch(`W3-${i + 1}`, 'W', 'Semifinal', winnerOf(`W2-${i * 2 + 1}`), winnerOf(`W2-${i * 2 + 2}`)),
      );
      const final = bareMatch('F', 'F', 'Championship', winnerOf('W3-1'), winnerOf('W3-2'));
      return [...r1, ...r2, ...r3, final];
    }
  }
}

function buildLosersBracket(fieldSize: 2 | 4 | 8): BracketMatch[] {
  if (fieldSize === 2) return [];
  if (fieldSize === 4) {
    return [
      bareMatch('L1-1', 'L', 'Losers Round 1', loserOf('W1-1'), loserOf('W1-2')),
      bareMatch('L2-1', 'L', 'Losers Final', winnerOf('L1-1'), loserOf('F')),
    ];
  }
  return [
    bareMatch('L1-1', 'L', 'Losers Round 1', loserOf('W1-1'), loserOf('W1-2')),
    bareMatch('L1-2', 'L', 'Losers Round 1', loserOf('W1-3'), loserOf('W1-4')),
    bareMatch('L2-1', 'L', 'Losers Round 2', winnerOf('L1-1'), loserOf('W2-1')),
    bareMatch('L2-2', 'L', 'Losers Round 2', winnerOf('L1-2'), loserOf('W2-2')),
    bareMatch('L3-1', 'L', 'Losers Semifinal', winnerOf('L2-1'), winnerOf('L2-2')),
    bareMatch('L4-1', 'L', 'Losers Final', winnerOf('L3-1'), loserOf('F')),
  ];
}

export function doubleEliminationAvailable(fieldSize: PlayoffFieldSize): boolean {
  return fieldSize === 2 || fieldSize === 4 || fieldSize === 8;
}

export function buildBracket(seeds: string[], fieldSize: PlayoffFieldSize, requestedEliminationType: 'single' | 'double'): PlayoffBracket {
  const winners = buildWinnersBracket(fieldSize);
  const useDouble = requestedEliminationType === 'double' && doubleEliminationAvailable(fieldSize);
  let matches = winners;
  if (useDouble) {
    const losers = buildLosersBracket(fieldSize as 2 | 4 | 8);
    matches = [...winners, ...losers];
    if (losers.length > 0) {
      const lbFinalId = losers[losers.length - 1].id;
      matches.push(bareMatch('TRUE-FINAL', 'F', 'True Final', winnerOf('F'), winnerOf(lbFinalId)));
    }
    if (fieldSize === 2) {
      matches.push(bareMatch('TRUE-FINAL', 'F', 'Decider', winnerOf('F'), loserOf('F')));
    }
  }
  return { fieldSize, eliminationType: useDouble ? 'double' : 'single', seeds: seeds.slice(0, fieldSize), matches, championId: null };
}

function offsetSeed(source: MatchSource, offset: number): MatchSource {
  return source.type === 'seed' ? { type: 'seed', seed: source.seed + offset } : source;
}
function prefixMatch(m: BracketMatch, prefix: string, seedOffset = 0): BracketMatch {
  function fix(s: MatchSource): MatchSource {
    const withOffset = offsetSeed(s, seedOffset);
    return withOffset.type === 'seed' ? withOffset : { ...withOffset, matchId: `${prefix}${withOffset.matchId}` };
  }
  return { ...m, id: `${prefix}${m.id}`, sourceA: fix(m.sourceA), sourceB: fix(m.sourceB) };
}

export function conferenceBracketSupported(fieldSize: PlayoffFieldSize, eliminationType: 'single' | 'double', conferenceCount: number): boolean {
  return conferenceCount === 2 && eliminationType === 'single' && [2, 4, 8, 16].includes(fieldSize);
}

export function buildConferenceBracket(conferenceSeeds: [string[], string[]], fieldSize: PlayoffFieldSize): PlayoffBracket {
  const perConf = (fieldSize / 2) as 1 | 2 | 4 | 8;
  const seeds = [...conferenceSeeds[0].slice(0, perConf), ...conferenceSeeds[1].slice(0, perConf)];
  if (perConf === 1) return buildBracket(seeds, 2, 'single');
  const subA = buildWinnersBracket(perConf).map((m) => prefixMatch(m, 'A-'));
  const subB = buildWinnersBracket(perConf).map((m) => prefixMatch(m, 'B-', perConf));
  const final = bareMatch('F', 'F', 'Championship', winnerOf('A-F'), winnerOf('B-F'));
  return { fieldSize, eliminationType: 'single', seeds, matches: [...subA, ...subB, final], championId: null };
}

function resolveSource(bracket: PlayoffBracket, source: MatchSource): string | null {
  if (source.type === 'seed') return bracket.seeds[source.seed - 1] ?? null;
  const match = bracket.matches.find((m) => m.id === source.matchId);
  if (!match || !match.winnerId) return null;
  if (source.type === 'winner') return match.winnerId;
  return match.teamAId === match.winnerId ? match.teamBId : match.teamAId;
}


export function advanceBracket(bracket: PlayoffBracket, settledWeek: WeekId | null, scoresFor: (teamId: string) => number | null, nextWeekId: WeekId): PlayoffBracket {
  let matches = bracket.matches.map((m) => {
    if (m.weekId !== settledWeek || m.winnerId) return m;
    const a = m.teamAId ? scoresFor(m.teamAId) : null;
    const b = m.teamBId ? scoresFor(m.teamBId) : null;
    if (a == null || b == null) return m;
    const winnerId = a === b ? (m.teamAId as string) : a > b ? m.teamAId : m.teamBId;
    return { ...m, teamAScore: a, teamBScore: b, winnerId };
  });

  // No bracket reset (1.2.11): the True Final decides the title, so the championship lands exactly
  // on the week the commissioner picked. RESET is still read below for brackets saved before.

  matches = matches.map((m) => {
    if (m.weekId != null) return m;
    const teamAId = resolveSource({ ...bracket, matches }, m.sourceA);
    const teamBId = resolveSource({ ...bracket, matches }, m.sourceB);
    if (teamAId == null || teamBId == null) return m;
    return { ...m, teamAId, teamBId, weekId: nextWeekId };
  });

  const finalMatchId = matches.some((m) => m.id === 'RESET') ? 'RESET' : matches.some((m) => m.id === 'TRUE-FINAL') ? 'TRUE-FINAL' : 'F';
  const finalMatch = matches.find((m) => m.id === finalMatchId);
  const championId = finalMatch?.winnerId ?? null;

  return { ...bracket, matches, championId };
}

export function teamsActiveInWeek(bracket: PlayoffBracket, weekId: WeekId): string[] {
  const ids = new Set<string>();
  for (const m of bracket.matches) {
    if (m.weekId !== weekId) continue;
    if (m.teamAId) ids.add(m.teamAId);
    if (m.teamBId) ids.add(m.teamBId);
  }
  return [...ids];
}

export function championAndRunnerUp(bracket: PlayoffBracket | null): { championId: string | null; runnerUpId: string | null } {
  if (!bracket?.championId) return { championId: null, runnerUpId: null };
  const decidingId = bracket.matches.some((m) => m.id === 'RESET') ? 'RESET' : bracket.matches.some((m) => m.id === 'TRUE-FINAL') ? 'TRUE-FINAL' : 'F';
  const deciding = bracket.matches.find((m) => m.id === decidingId);
  if (!deciding) return { championId: bracket.championId, runnerUpId: null };
  const runnerUpId = deciding.teamAId === bracket.championId ? deciding.teamBId : deciding.teamAId;
  return { championId: bracket.championId, runnerUpId };
}

export function countPlayoffWeeksNeeded(fieldSize: PlayoffFieldSize, eliminationType: 'single' | 'double'): number {
  const dummySeeds = Array.from({ length: fieldSize }, (_, i) => `seed${i + 1}`);
  let bracket = buildBracket(dummySeeds, fieldSize, eliminationType);
  bracket = advanceBracket(bracket, null, () => null, 0);
  let currentWeek: WeekId = 0;
  let weeks = 0;
  while (bracket.championId == null && weeks < 30) {
    weeks += 1;
    const nextWeek: WeekId = weeks;
    const scoresFor = (teamId: string): number | null => {
      const match = bracket.matches.find((m) => m.weekId === currentWeek && (m.teamAId === teamId || m.teamBId === teamId));
      if (!match) return null;
      if (match.id === 'TRUE-FINAL') return teamId === match.teamBId ? 1 : 0;
      return teamId === match.teamAId ? 1 : 0;
    };
    bracket = advanceBracket(bracket, currentWeek, scoresFor, nextWeek);
    currentWeek = nextWeek;
  }
  return weeks;
}

export function regularSeasonWeeksFor(fieldSize: PlayoffFieldSize, eliminationType: 'single' | 'double'): number {
  const weeksNeeded = countPlayoffWeeksNeeded(fieldSize, eliminationType);
  return 18 - Math.max(0, weeksNeeded - 3);
}

/** The bracket games set for `week` with both teams known. Each one is a real row in `matchups` for that
 * week (written by settle-week), so playoff games show and score like any other matchup. Team A and B
 * keep the bracket's order, which matters for ties (see playoffWinner). */
export function playoffPairingsForWeek(bracket: PlayoffBracket | null | undefined, week: string): { matchId: string; teamAId: string; teamBId: string }[] {
  if (!bracket) return [];
  return bracket.matches
    .filter((m) => m.weekId != null && String(m.weekId) === week && m.teamAId && m.teamBId)
    .map((m) => ({ matchId: m.id, teamAId: m.teamAId as string, teamBId: m.teamBId as string }));
}

/** Whether a `matchups` row is a playoff game. Standings (the regular-season record) skip these. */
export function isPlayoffPairing(bracket: PlayoffBracket | null | undefined, week: string, teamAId: string, teamBId: string): boolean {
  return playoffPairingsForWeek(bracket, week).some(
    (p) => (p.teamAId === teamAId && p.teamBId === teamBId) || (p.teamAId === teamBId && p.teamBId === teamAId),
  );
}

/** A playoff game always has a winner: on a tie, team A (the better seed or the winners-bracket side)
 * advances, the same rule as advanceBracket. */
export function playoffWinner(teamAId: string, teamBId: string, aScore: number, bScore: number): string {
  return aScore >= bScore ? teamAId : teamBId;
}

export function playoffWeekSequence(fieldSize: PlayoffFieldSize, eliminationType: 'single' | 'double'): WeekId[] {
  const weeksNeeded = countPlayoffWeeksNeeded(fieldSize, eliminationType);
  const named: WeekId[] = ['WC', 'DIV', 'CONF'];
  if (weeksNeeded <= 3) return named.slice(3 - weeksNeeded);
  const extra = weeksNeeded - 3;
  const numeric: WeekId[] = Array.from({ length: extra }, (_, i) => 18 - extra + 1 + i);
  return [...numeric, ...named];
}

// ---- Season calendar (1.2.11) ----
// A league plays a run of consecutive weeks with no gaps: the regular season from its start week,
// then the playoff rounds, ending on the championship week the commissioner picks (any week up to the
// NFL Conference Championship; the Super Bowl has one game, too thin for a lineup). Small fields can
// play regular-season weeks during the NFL playoffs; a short season can end as early as the field
// allows (at least one regular-season week).

/** Every week a league can play, in order. */
export const SEASON_CALENDAR: WeekId[] = [...Array.from({ length: 18 }, (_, i) => i + 1), 'WC', 'DIV', 'CONF'];

/** Position of a week in SEASON_CALENDAR, or -1. Accepts a WeekId or its text form ("7", "WC"). */
export function calendarIndex(week: WeekId | string | null | undefined): number {
  if (week == null) return -1;
  return SEASON_CALENDAR.findIndex((w) => String(w) === String(week));
}

export interface SeasonPlan {
  regularWeeks: WeekId[];
  playoffWeeks: WeekId[];
  championshipWeek: WeekId;
}

/** The league's weeks: regular season from `startWeek` (Week 1 when not started), then the playoff
 * rounds ending on `championshipWeek`. A championship too early to leave one regular-season week is
 * moved later, as far as the calendar allows. */
export function seasonPlan(
  startWeek: WeekId | string | null | undefined,
  championshipWeek: WeekId | string | null | undefined,
  fieldSize: PlayoffFieldSize,
  eliminationType: 'single' | 'double',
): SeasonPlan {
  const last = SEASON_CALENDAR.length - 1;
  const rounds = countPlayoffWeeksNeeded(fieldSize, eliminationType);
  const startIdx = Math.max(0, calendarIndex(startWeek));
  let champIdx = calendarIndex(championshipWeek);
  if (champIdx < 0) champIdx = last;
  champIdx = Math.min(last, Math.max(champIdx, startIdx + rounds));
  const firstPlayoff = Math.max(0, champIdx - rounds + 1);
  return {
    regularWeeks: SEASON_CALENDAR.slice(startIdx, Math.max(startIdx, firstPlayoff)),
    playoffWeeks: SEASON_CALENDAR.slice(firstPlayoff, champIdx + 1),
    championshipWeek: SEASON_CALENDAR[champIdx],
  };
}

/** Championship weeks a commissioner can pick: early enough for one regular-season week after the
 * start, and late enough that the playoffs begin after the current week. */
export function championshipWeekOptions(
  startWeek: WeekId | string | null | undefined,
  currentWeek: WeekId | string | null | undefined,
  fieldSize: PlayoffFieldSize,
  eliminationType: 'single' | 'double',
): WeekId[] {
  const rounds = countPlayoffWeeksNeeded(fieldSize, eliminationType);
  const base = Math.max(0, calendarIndex(startWeek), calendarIndex(currentWeek));
  return SEASON_CALENDAR.slice(Math.min(SEASON_CALENDAR.length - 1, base + rounds));
}

/** The calendar week after `week`, or null after the last one. */
export function nextCalendarWeek(week: WeekId | string): WeekId | null {
  const i = calendarIndex(week);
  return i >= 0 && i + 1 < SEASON_CALENDAR.length ? SEASON_CALENDAR[i + 1] : null;
}

// --- Standings tiebreaker (port of src/engine/standings.ts's sortStandings) -

function winPct(s: StandingLine): number {
  const played = s.wins + s.losses + s.ties;
  if (played === 0) return 0;
  return (s.wins + s.ties * 0.5) / played;
}

function headToHead(aId: string, bId: string, allMatchups: MatchupLine[]): number {
  let aWins = 0;
  let bWins = 0;
  for (const m of allMatchups) {
    const involves = (m.teamAId === aId && m.teamBId === bId) || (m.teamAId === bId && m.teamBId === aId);
    if (!involves || !m.winnerId) continue;
    if (m.winnerId === aId) aWins++;
    else if (m.winnerId === bId) bWins++;
  }
  return bWins - aWins;
}

/** Tiebreaker chain: overall W-L -> season P/L -> bet W/L record -> head-to-head -> best single week. */
export function sortStandings(standings: StandingLine[], allMatchups: MatchupLine[]): StandingLine[] {
  return [...standings].sort((a, b) => {
    const pctDiff = winPct(b) - winPct(a);
    if (Math.abs(pctDiff) > 1e-9) return pctDiff;
    if (a.totalPL !== b.totalPL) return b.totalPL - a.totalPL;
    const aBetRec = a.betsWon - a.betsLost;
    const bBetRec = b.betsWon - b.betsLost;
    if (aBetRec !== bBetRec) return bBetRec - aBetRec;
    const h2h = headToHead(a.teamId, b.teamId, allMatchups);
    if (h2h !== 0) return h2h;
    return b.bestWeekPL - a.bestWeekPL;
  });
}

// --- Prize pool (port of the relevant slice of src/engine/prizePool.ts) ----

const MULTIPLIER_SPREAD_AT_MAX = 0.5; // 1.2.11: up to 1.5x top / 0.5x bottom (was 0.2)
const MULTIPLIER_HARD_MIN = 0.5;
const MULTIPLIER_HARD_MAX = 1.5;

export type MultiplierBasis = 'rank' | 'record' | 'seasonPL';

function orderTeamsForMultiplier(standings: StandingLine[], basis: MultiplierBasis): string[] {
  if (basis === 'rank') return standings.map((s) => s.teamId);
  const rows = [...standings];
  if (basis === 'seasonPL') {
    rows.sort((a, b) => b.totalPL - a.totalPL || a.teamId.localeCompare(b.teamId));
  } else {
    rows.sort((a, b) => {
      const gamesA = a.wins + a.losses + a.ties;
      const gamesB = b.wins + b.losses + b.ties;
      const pctA = gamesA > 0 ? (a.wins + a.ties * 0.5) / gamesA : 0;
      const pctB = gamesB > 0 ? (b.wins + b.ties * 0.5) / gamesB : 0;
      return pctB - pctA || a.teamId.localeCompare(b.teamId);
    });
  }
  return rows.map((r) => r.teamId);
}

export function computeStandingMultipliers(standings: StandingLine[], basis: MultiplierBasis, spread: number): Record<string, number> {
  const n = standings.length;
  if (n === 0) return {};
  const order = orderTeamsForMultiplier(standings, basis);
  const clampedSpread = Math.max(0, Math.min(1, spread));
  const high = 1 + clampedSpread * MULTIPLIER_SPREAD_AT_MAX;
  const low = 1 - clampedSpread * MULTIPLIER_SPREAD_AT_MAX;
  const raw = order.map((_, i) => (n === 1 ? 1 : high - (high - low) * (i / (n - 1))));
  const clamped = raw.map((v) => Math.max(MULTIPLIER_HARD_MIN, Math.min(MULTIPLIER_HARD_MAX, v)));
  const sum = clamped.reduce((a, b) => a + b, 0);
  const scale = sum > 0 ? n / sum : 1;
  const result: Record<string, number> = {};
  order.forEach((teamId, i) => {
    result[teamId] = clamped[i] * scale;
  });
  return result;
}

export function initialPoolAmount(teamCount: number, buyInAmount: number): number {
  return teamCount * buyInAmount;
}

export function realDollarAmount(virtualAmount: number, weeklyCredits: number, poolBefore: number, teamCount: number): number {
  if (weeklyCredits <= 0 || teamCount <= 0) return 0;
  const perTeamShare = poolBefore / teamCount;
  return (virtualAmount / weeklyCredits) * perTeamShare;
}

export function advancePoolForWeek(
  pool: PrizePool,
  week: WeekId,
  weeklyVirtualScores: Map<string, number>,
  weeklyCredits: number,
  teamCount: number,
  multipliers: Record<string, number> = {},
): PrizePool {
  if (pool.locked) return pool;
  let netRealPL = 0;
  // Each team's own share of the move is kept with the week, so the Prize Pool screen can show who
  // moved the pool in any past week without recomputing it from rosters.
  const byTeam: Record<string, { impact: number; multiplier: number }> = {};
  for (const [teamId, score] of weeklyVirtualScores) {
    const multiplier = multipliers[teamId] ?? 1;
    const impact = realDollarAmount(score, weeklyCredits, pool.current, teamCount) * multiplier;
    byTeam[teamId] = { impact, multiplier };
    netRealPL += impact;
  }
  const poolAfter = Math.max(0, pool.current + netRealPL);
  const locked = poolAfter <= 0.01;
  return { ...pool, current: poolAfter, locked, history: [...pool.history, { week, poolBefore: pool.current, poolAfter, netRealPL, byTeam }] };
}

export function lockPool(pool: PrizePool): PrizePool {
  return pool.locked ? pool : { ...pool, locked: true };
}

// ---- Prize pool rebuilt from history (1.2.11) ----
// The pool is a virtual tracking feature, so it is recalculated from stored results every time a week
// closes: from the commissioner's "track from" week through the week just closed, under the league's
// current pool rules. Turning buy-ins on mid-season, changing the buy-in or the multipliers all show up
// as if those rules had applied from the tracking week.

export interface PoolWeekInput {
  week: WeekId;
  /** Regular-season week: standing multipliers can apply (the playoffs are a flat 1.0x). */
  regular: boolean;
  /** Each team's settled bet profit for the week (the same number the live pool used). */
  betPL: Map<string, number>;
  /** Standings as of the end of this week, ranked (needed only for multipliers). */
  standings: StandingLine[];
}

export interface PoolRebuildRules {
  buyInAmount: number;
  weeklyCredits: number;
  /** Teams that buy in and move the pool (all teams, or humans only when AI teams are left out). */
  teamIds: string[];
  multipliers: { enabled: boolean; basis: MultiplierBasis; spread: number };
  /** With multipliers on but not applied to past weeks: the first week they count. Null = every week. */
  multipliersFromWeek: WeekId | null;
  /** Lock the pool at the end (the season is over). */
  lock: boolean;
}

export function rebuildPrizePool(weeks: PoolWeekInput[], rules: PoolRebuildRules): PrizePool {
  const teamCount = rules.teamIds.length;
  const initial = teamCount * rules.buyInAmount;
  let pool: PrizePool = { initial, current: initial, locked: false, history: [] };
  const inPool = new Set(rules.teamIds);
  const fromIdx = rules.multipliersFromWeek != null ? calendarIndex(rules.multipliersFromWeek) : -1;
  for (const w of weeks) {
    if (pool.locked) break;
    const scores = new Map([...w.betPL].filter(([id]) => inPool.has(id)));
    const standings = w.standings.filter((s) => inPool.has(s.teamId));
    const useMultipliers = rules.multipliers.enabled && w.regular && calendarIndex(w.week) >= fromIdx;
    const multipliers = useMultipliers ? computeStandingMultipliers(standings, rules.multipliers.basis, rules.multipliers.spread) : {};
    pool = advancePoolForWeek(pool, w.week, scores, rules.weeklyCredits, teamCount, multipliers);
  }
  return rules.lock ? lockPool(pool) : pool;
}

/** Standings as of the end of `throughWeek` (inclusive), ranked, from regular-season results and bets. */
export function standingsThrough(
  teamIds: string[],
  throughWeek: WeekId,
  matchups: { week: string; teamAId: string; teamBId: string; teamAScore: number | null; teamBScore: number | null; winnerId: string | null; isTie: boolean }[],
  betsByTeamWeek: { teamId: string; week: string; won: number; lost: number }[],
): StandingLine[] {
  const limit = calendarIndex(throughWeek);
  const lines = new Map(teamIds.map((id) => [id, { teamId: id, wins: 0, losses: 0, ties: 0, totalPL: 0, betsWon: 0, betsLost: 0, bestWeekPL: -Infinity }]));
  const decided: MatchupLine[] = [];
  for (const m of matchups) {
    if (calendarIndex(m.week) > limit || m.teamAScore == null || m.teamBScore == null) continue;
    const a = lines.get(m.teamAId);
    const b = lines.get(m.teamBId);
    if (!a || !b) continue;
    a.totalPL += m.teamAScore;
    b.totalPL += m.teamBScore;
    a.bestWeekPL = Math.max(a.bestWeekPL, m.teamAScore);
    b.bestWeekPL = Math.max(b.bestWeekPL, m.teamBScore);
    if (m.isTie) { a.ties++; b.ties++; }
    else if (m.winnerId === m.teamAId) { a.wins++; b.losses++; }
    else if (m.winnerId === m.teamBId) { b.wins++; a.losses++; }
    decided.push({ teamAId: m.teamAId, teamBId: m.teamBId, winnerId: m.winnerId });
  }
  for (const r of betsByTeamWeek) {
    if (calendarIndex(r.week) > limit) continue;
    const s = lines.get(r.teamId);
    if (!s) continue;
    s.betsWon += r.won;
    s.betsLost += r.lost;
  }
  const out = [...lines.values()].map((s) => ({ ...s, bestWeekPL: s.bestWeekPL === -Infinity ? 0 : s.bestWeekPL }));
  return sortStandings(out, decided);
}
