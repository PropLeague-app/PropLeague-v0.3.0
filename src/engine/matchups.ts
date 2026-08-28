import { createRng, shuffle } from './random';

/** Circle-method round robin: n-1 rounds (or n rounds with a bye if n is odd), each a
 * perfect matching covering every team exactly once. */
function buildRounds(teamIds: string[]): [string, string][][] {
  const ids = [...teamIds];
  const hasBye = ids.length % 2 !== 0;
  if (hasBye) ids.push('__BYE__');
  const n = ids.length;
  const rotating = ids.slice(1);
  const fixed = ids[0];
  const rounds: [string, string][][] = [];

  for (let r = 0; r < n - 1; r++) {
    const order = [fixed, ...rotating];
    const pairings: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = order[i];
      const b = order[n - 1 - i];
      if (a !== '__BYE__' && b !== '__BYE__') pairings.push([a, b]);
    }
    rounds.push(pairings);
    rotating.unshift(rotating.pop()!);
  }
  return rounds;
}

/** Balanced-rotation round robin (circle method) H2H schedule generator. */
export function generateMatchupSchedule(teamIds: string[], totalWeeks: number): Record<number, [string, string][]> {
  const rounds = buildRounds(teamIds);
  const schedule: Record<number, [string, string][]> = {};
  for (let week = 1; week <= totalWeeks; week++) {
    const i = week - 1;
    const roundIdx = i % rounds.length;
    const cycle = Math.floor(i / rounds.length);
    let pairings = rounds[roundIdx];
    if (cycle % 2 === 1) pairings = pairings.map(([a, b]) => [b, a]);
    schedule[week] = pairings;
  }
  return schedule;
}

/** Greedy weighted pairing, one week at a time, driven by a per-team running quota
 * rather than raw pair-repeat decay: each team tracks how many in-conference vs.
 * cross-conference games it still "needs" to stay on pace for a 2:1 season split
 * (spec §3.1: "targeting roughly 2 in-conference games for every 1 cross-conference
 * game"), and every candidate opponent is scored by how much both sides' remaining
 * quota it would satisfy. A pure repeat-count decay (tried first) doesn't work here:
 * a team with only 3 in-conference rivals exhausts that small pool's "freshness"
 * fast while its 4+ cross rivals stay fresh longer, so repeat-avoidance alone
 * actively drags the ratio toward cross-conference instead of holding 2:1. Quota
 * tracking fixes that by biasing toward whichever category a team is behind on,
 * regardless of how many distinct rivals are available in it. Handles any
 * conference sizes, including uneven ones a straight round-robin split can't. */
export function generateConferenceWeightedSchedule(
  teamIds: string[],
  conferenceOf: Record<string, string>,
  totalWeeks: number,
  seed: string,
): Record<number, [string, string][]> {
  const rng = createRng(seed);
  const pairPlayed = new Map<string, number>();
  const inConfPlayed = new Map<string, number>(teamIds.map((id) => [id, 0]));
  const crossPlayed = new Map<string, number>(teamIds.map((id) => [id, 0]));
  const inConfTarget = Math.round((totalWeeks * 2) / 3);
  const crossTarget = totalWeeks - inConfTarget;
  const schedule: Record<number, [string, string][]> = {};

  function pairKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }
  function remaining(team: string, sameConf: boolean): number {
    const target = sameConf ? inConfTarget : crossTarget;
    const played = (sameConf ? inConfPlayed : crossPlayed).get(team) ?? 0;
    return Math.max(0, target - played);
  }

  for (let week = 1; week <= totalWeeks; week++) {
    const available = shuffle(rng, teamIds);
    const pairings: [string, string][] = [];
    while (available.length >= 2) {
      const a = available.shift()!;
      let bestIdx = 0;
      let bestScore = -Infinity;
      for (let i = 0; i < available.length; i++) {
        const b = available[i];
        const sameConf = conferenceOf[a] != null && conferenceOf[a] === conferenceOf[b];
        const urgency = remaining(a, sameConf) + remaining(b, sameConf) + 1;
        const played = pairPlayed.get(pairKey(a, b)) ?? 0;
        const score = urgency / (1 + played * 0.3) + rng() * 0.01;
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
      const b = available.splice(bestIdx, 1)[0];
      pairings.push([a, b]);
      const sameConf = conferenceOf[a] != null && conferenceOf[a] === conferenceOf[b];
      const bucket = sameConf ? inConfPlayed : crossPlayed;
      bucket.set(a, (bucket.get(a) ?? 0) + 1);
      bucket.set(b, (bucket.get(b) ?? 0) + 1);
      pairPlayed.set(pairKey(a, b), (pairPlayed.get(pairKey(a, b)) ?? 0) + 1);
    }
    schedule[week] = pairings;
  }
  return schedule;
}
