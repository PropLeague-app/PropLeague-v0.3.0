// Server-side (Deno edge function) copy of src/engine/playerNameMatch.ts --
// same duplicated-not-imported pattern as playoffLogic.ts (see that file's
// header for why: `supabase functions deploy` bundles each function plus
// _shared/ independently, a cross-directory import into src/ wouldn't reach).
//
// Ported into settle-week (see chat, Sept 2026 -- the Travis Kelce case: a
// real 71-yard game, clearly present in real_player_stats, whose wager stayed
// stuck 'pending'/void-grace anyway) because settle-week's actual stat lookup
// was NOT using this at all -- just a bare `.trim().toLowerCase()` compare
// between wagers.player_name and real_player_stats.player_name. Those two
// columns come from genuinely different upstream sources (the odds/props
// feed's own player-name text vs. balldontlie's `first_name + " " +
// last_name`), so anything beyond byte-identical formatting -- an accent, a
// suffix, punctuation -- silently missed, landed in the "no stat row" branch,
// and either sat pending or (after VOID_GRACE_MS) got wrongly voided despite
// a real, present stat line. This is exactly the class of mismatch
// normalizePlayerName was written and verified against (see the original
// file's header: tested against all 248 real 2026 depth-chart names).
//
// NOT ported here: matchPlayerName's last-name+team fallback tier. That tier
// needs the PLAYER's real NFL team as a disambiguator (to avoid a same-
// last-name collision, e.g. two Hills on the same roster) -- settle-week
// doesn't currently carry that on a wager row, only game_id/market_key/
// player_name, so wiring it in safely would mean plumbing team context
// through first, not guessing at it now. What's ported (exact normalized
// match only) already covers the accent/suffix/punctuation/case class of
// miss -- the fallback tier exists for a narrower, rarer collision case.

export function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/\./g, '') // "C.J." -> "CJ", "St." -> "St"
    .replace(/[''`]/g, "'") // normalize apostrophe variants
    .replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/, '') // strip trailing generational suffix
    .replace(/[^a-z0-9' ]/g, '') // drop remaining punctuation (hyphens etc.)
    .replace(/\s+/g, ' ')
    .trim();
}
