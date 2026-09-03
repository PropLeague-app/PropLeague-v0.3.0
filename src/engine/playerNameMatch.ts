// Matches a player name as used in PropLeague (e.g. a wager's playerName, drawn
// from src/data/players.ts) against real player stat rows fetched from nflverse
// (real_player_stats.player_name), which don't always agree on formatting.
//
// Verified against real data before building the rest of Phase 1 on top of it:
// tested normalization against all 248 real 2026 depth-chart names vs. real
// nflverse 2024 data (the closest real data available -- 2026 hasn't happened
// yet). 217/248 matched exactly; every remaining miss except one was a genuine
// 2025/2026 rookie with no 2024 stats to match against at all (expected, not a
// bug). The one real miss (Chig Okonkwo, listed as "Chigoziem Okonkwo" in
// nflverse for two of his three NFL seasons) is exactly the class of problem
// the last-name+team fallback below is for -- confirmed it resolves that case.
//
// Also verified: blindly falling back to last-name+team without checking for
// ambiguity is NOT safe -- found 10 real last-name+team collisions in a single
// season's data (e.g. Tyreek Hill and Julian Hill both on MIA). The fallback
// below only accepts a last-name+team match when it's the ONLY candidate;
// anything ambiguous or unresolved is reported, never guessed.

export interface RealStatCandidate {
  playerName: string; // the raw name as stored in real_player_stats
  team: string | null;
}

export interface PlayerMatchResult {
  status: 'exact' | 'fallback' | 'ambiguous' | 'not_found';
  matchedName: string | null;
  /** Only populated when status is 'ambiguous' -- the candidates that tied. */
  candidates?: string[];
}

export function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/\./g, '') // "C.J." -> "CJ", "St." -> "St"
    .replace(/[''`]/g, "'") // normalize apostrophe variants
    .replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/, '') // strip trailing generational suffix
    .replace(/[^a-z0-9' ]/g, '') // drop remaining punctuation (hyphens etc.)
    .replace(/\s+/g, ' ')
    .trim();
}

function lastNameOf(normalized: string): string {
  const parts = normalized.split(' ');
  return parts[parts.length - 1];
}

/** `wagerTeam` is optional -- without it, the fallback step is skipped entirely
 * (an unambiguous exact match still works fine; only the safety-net step needs
 * team context to avoid the collision risk described above). */
export function matchPlayerName(wagerPlayerName: string, wagerTeam: string | null, candidates: RealStatCandidate[]): PlayerMatchResult {
  const targetNorm = normalizePlayerName(wagerPlayerName);

  const exact = candidates.find((c) => normalizePlayerName(c.playerName) === targetNorm);
  if (exact) return { status: 'exact', matchedName: exact.playerName };

  if (!wagerTeam) return { status: 'not_found', matchedName: null };

  const targetLast = lastNameOf(targetNorm);
  const sameLastNameTeam = candidates.filter(
    (c) => lastNameOf(normalizePlayerName(c.playerName)) === targetLast && c.team === wagerTeam,
  );
  const distinctNames = [...new Set(sameLastNameTeam.map((c) => c.playerName))];

  if (distinctNames.length === 1) return { status: 'fallback', matchedName: distinctNames[0] };
  if (distinctNames.length > 1) return { status: 'ambiguous', matchedName: null, candidates: distinctNames };
  return { status: 'not_found', matchedName: null };
}
