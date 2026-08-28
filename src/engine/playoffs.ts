import type { BracketMatch, MatchSource, PlayoffBracket, PlayoffFieldSize, WeekId } from '../types';

export const ALL_FIELD_SIZES: PlayoffFieldSize[] = [2, 4, 6, 8, 16];

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

/** Fixed-slot single-elimination winners bracket per field size (spec §3.2). Byes for
 * 6-team go to the top 2 seeds, who enter directly at the second round. */
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
        [1, 16],
        [8, 9],
        [5, 12],
        [4, 13],
        [3, 14],
        [6, 11],
        [7, 10],
        [2, 15],
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

/** Losers bracket for double-elimination, built by mechanically applying the standard
 * "drop down" pattern: WB round r's losers merge into the LB at the point that keeps
 * losers-bracket team counts balanced, alternating rounds that only consolidate
 * existing LB survivors with rounds that merge in a fresh batch of WB losers. Only
 * defined for the four power-of-2 field sizes — 6-team's top-seed byes create an
 * unbalanced LB entry pattern (an odd number of one-loss teams appears partway
 * through) that doesn't fit this clean construction, so double-elim isn't offered
 * for 6-team fields (enforced in Settings). */
function buildLosersBracket(fieldSize: 2 | 4 | 8): BracketMatch[] {
  if (fieldSize === 2) {
    // Only one path: the WB final's loser gets a single rematch shot, handled by the
    // true-final/reset machinery below rather than a dedicated LB match here.
    return [];
  }
  if (fieldSize === 4) {
    return [
      bareMatch('L1-1', 'L', 'Losers Round 1', loserOf('W1-1'), loserOf('W1-2')),
      bareMatch('L2-1', 'L', 'Losers Final', winnerOf('L1-1'), loserOf('F')),
    ];
  }
  if (fieldSize === 8) {
    return [
      bareMatch('L1-1', 'L', 'Losers Round 1', loserOf('W1-1'), loserOf('W1-2')),
      bareMatch('L1-2', 'L', 'Losers Round 1', loserOf('W1-3'), loserOf('W1-4')),
      bareMatch('L2-1', 'L', 'Losers Round 2', winnerOf('L1-1'), loserOf('W2-1')),
      bareMatch('L2-2', 'L', 'Losers Round 2', winnerOf('L1-2'), loserOf('W2-2')),
      bareMatch('L3-1', 'L', 'Losers Semifinal', winnerOf('L2-1'), winnerOf('L2-2')),
      bareMatch('L4-1', 'L', 'Losers Final', winnerOf('L3-1'), loserOf('F')),
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

/** manual v0.3.0 §2: 16-team double-elimination needs 9 playoff-week passes in the
 * worst case (winners bracket + losers bracket + true final + a bracket reset) — far
 * more than the 5 weeks PropLeague's postseason can ever occupy while still landing
 * the championship on NFL Conference Championship week (WC/DIV/CONF plus at most
 * Weeks 17-18 borrowed from the regular season). It doesn't fit at any reasonable
 * cost to the season, so it's excluded outright rather than technically allowed and
 * silently eating half the year. 8-team is the largest field that's still offered,
 * per Hunter's call — it does exceed that same 5-week ceiling (needs 7), but staying
 * at the field size already shipped in v0.2.1 was the chosen tradeoff over tightening
 * the cap down to the 4-team field that's the only one which truly fits within 5. */
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
    // 2-team double-elim has no LB matches; the WB final's loser gets a direct rematch.
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

/** Conference-mode bracket (manual §3.1): each conference runs its own self-contained
 * bracket (top fieldSize/2 seeds), and only the two conference champions cross over,
 * in the final. Only supports exactly 2 conferences with fieldSize/2 in {1,2,4,8} —
 * i.e. overall field size 2/4/8/16 — and single-elimination only; 6-team's top-seed
 * byes and double-elimination's losers-bracket both add topology that doesn't
 * cleanly split per-conference, so those combinations fall back to flat (non-
 * conference-locked) seeding instead (see simulateWeek.ts). */
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

/** True final's winner is champion — UNLESS the losers-bracket side won, in which
 * case both sides now have exactly one loss and a single reset game decides it. */
function isTrueFinal(match: BracketMatch): boolean {
  return match.id === 'TRUE-FINAL';
}
function wbSideOfTrueFinal(bracket: PlayoffBracket): MatchSource | null {
  const tf = bracket.matches.find((m) => m.id === 'TRUE-FINAL');
  return tf ? tf.sourceA : null; // by construction sourceA is always winnerOf('F'), the WB path
}

/** Advances the bracket by one settlement pass: resolves any match whose team slots
 * are now known but not yet filled (assigning it to `weekId`), and — for matches whose
 * `weekId` equals the just-settled week — records scores/winners via `scoresFor`.
 * Called once per week from simulateWeek; matches with no `weekId` yet and unresolved
 * sources are simply left for a later pass once their inputs exist. */
export function advanceBracket(bracket: PlayoffBracket, settledWeek: WeekId | null, scoresFor: (teamId: string) => number | null, nextWeekId: WeekId): PlayoffBracket {
  let matches = bracket.matches.map((m) => {
    if (m.weekId !== settledWeek || m.winnerId) return m;
    const a = m.teamAId ? scoresFor(m.teamAId) : null;
    const b = m.teamBId ? scoresFor(m.teamBId) : null;
    if (a == null || b == null) return m;
    const winnerId = a === b ? (m.teamAId as string) : a > b ? m.teamAId : m.teamBId;
    return { ...m, teamAScore: a, teamBScore: b, winnerId };
  });

  // Reset game only gets created after the true final settles, if the LB side won.
  const trueFinal = matches.find((m) => m.id === 'TRUE-FINAL' && m.winnerId);
  const hasReset = matches.some((m) => m.id === 'RESET');
  if (trueFinal && !hasReset) {
    const wbSide = wbSideOfTrueFinal(bracket);
    const wbTeamId = wbSide ? resolveSource({ ...bracket, matches }, wbSide) : null;
    if (wbTeamId && trueFinal.winnerId !== wbTeamId) {
      matches = [...matches, bareMatch('RESET', 'RESET', 'Bracket Reset', winnerOf('TRUE-FINAL'), loserOf('TRUE-FINAL'))];
    }
  }

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

/** Every team involved in a match scheduled for `weekId` (used to know who's "active"
 * this playoff week and needs their roster settled). */
export function teamsActiveInWeek(bracket: PlayoffBracket, weekId: WeekId): string[] {
  const ids = new Set<string>();
  for (const m of bracket.matches) {
    if (m.weekId !== weekId) continue;
    if (m.teamAId) ids.add(m.teamAId);
    if (m.teamBId) ids.add(m.teamBId);
  }
  return [...ids];
}

/** Whether the bracket has any match still waiting to be played (used to know when a
 * league has finished its whole postseason, including any bracket-reset game). */
export function bracketInProgress(bracket: PlayoffBracket): boolean {
  return bracket.championId == null;
}

export function championAndRunnerUp(bracket: PlayoffBracket | null): { championId: string | null; runnerUpId: string | null } {
  if (!bracket?.championId) return { championId: null, runnerUpId: null };
  const decidingId = bracket.matches.some((m) => m.id === 'RESET')
    ? 'RESET'
    : bracket.matches.some((m) => m.id === 'TRUE-FINAL')
      ? 'TRUE-FINAL'
      : 'F';
  const deciding = bracket.matches.find((m) => m.id === decidingId);
  if (!deciding) return { championId: bracket.championId, runnerUpId: null };
  const runnerUpId = deciding.teamAId === bracket.championId ? deciding.teamBId : deciding.teamAId;
  return { championId: bracket.championId, runnerUpId };
}

export { isTrueFinal };

/** Runs the bracket to completion with dummy seeds/scores purely to count how many
 * calendar-week settlement passes it takes — including forcing the losers-bracket
 * side to win the true final once, so the worst case (a bracket-reset game) is
 * counted too. This is simulated with the real advanceBracket engine rather than
 * hand-derived per field size, so it can never drift out of sync with actual bracket
 * behavior. Field size/elimination type are the only inputs, so the result is the
 * same for every league with that combination — cheap enough to just recompute. */
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
      // Force the losers-bracket path to win the true final once, so the reset round
      // (the worst case) gets counted too.
      if (match.id === 'TRUE-FINAL') return teamId === match.teamBId ? 1 : 0;
      return teamId === match.teamAId ? 1 : 0;
    };
    bracket = advanceBracket(bracket, currentWeek, scoresFor, nextWeek);
    currentWeek = nextWeek;
  }
  return weeks;
}

/** How many of the 18 numbered weeks are "regular season" before this league's
 * postseason takes over — 18 unless the bracket needs more than the standard
 * WC/DIV/CONF 3 weeks, in which case it eats into the end of the numbered weeks
 * (manual §3.2: "start earlier — Week 17/18 as needed"). */
export function regularSeasonWeeksFor(fieldSize: PlayoffFieldSize, eliminationType: 'single' | 'double'): number {
  const weeksNeeded = countPlayoffWeeksNeeded(fieldSize, eliminationType);
  return 18 - Math.max(0, weeksNeeded - 3);
}

/** Ordered list of WeekIds the postseason will occupy, always ending in CONF. */
export function playoffWeekSequence(fieldSize: PlayoffFieldSize, eliminationType: 'single' | 'double'): WeekId[] {
  const weeksNeeded = countPlayoffWeeksNeeded(fieldSize, eliminationType);
  const named: WeekId[] = ['WC', 'DIV', 'CONF'];
  if (weeksNeeded <= 3) return named.slice(3 - weeksNeeded);
  const extra = weeksNeeded - 3;
  const numeric: WeekId[] = Array.from({ length: extra }, (_, i) => 18 - extra + 1 + i);
  return [...numeric, ...named];
}

/** manual v0.2.1 §3 #2: the playoff field may now reach full league capacity — an
 * 8-team league can run an 8-team bracket (every team qualifies, by design). The
 * absolute max stays 16 regardless of league size (v0.2.0 §2 #3's half-the-league cap
 * is gone, but the ceiling itself never was). Shared by both the onboarding
 * team-count slider and the settings screen's post-creation editor so the two never
 * drift out of sync. */
export function fieldSizeOptionsForTeamCount(teamCount: number): PlayoffFieldSize[] {
  return ALL_FIELD_SIZES.filter((n) => n <= teamCount);
}

/** manual v0.2.0 §2 #1: a structure remains selectable only while there's still enough
 * regular season left to reach its own required playoff start week — structures
 * needing more weeks (bigger fields, double-elim) lock earlier. Once the league has
 * entered the postseason itself (a named week), every structure is locked (the bracket
 * already exists). Pure function of the two settings + the current week, so it's cheap
 * to recompute per render for every option in a selector. */
export function structureAvailable(fieldSize: PlayoffFieldSize, eliminationType: 'single' | 'double', currentWeek: WeekId): boolean {
  if (typeof currentWeek !== 'number') return false;
  return currentWeek <= regularSeasonWeeksFor(fieldSize, eliminationType);
}
