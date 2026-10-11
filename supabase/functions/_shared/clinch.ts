// Exact copy of src/engine/clinch.ts (1.2.11), used by settle-week to post "clinched" news. Keep the
// two the same; src/engine/__tests__/clinch.test.ts checks it.

export type ClinchStatus = 'top' | 'bye' | 'playoffs' | 'out';

export interface ClinchTeam {
  id: string;
  /** Teams compete for spots within a group: the whole league, or a conference. */
  group: string;
  wins: number;
  losses: number;
  ties: number;
  /** Regular-season games still to be decided. */
  remaining: number;
}

/**
 * Who has locked up what, counting a tie in the standings against the team (so a marker can come a
 * week late, never wrongly):
 * - clinched a spot among the top k: even losing every remaining game, fewer than k other teams in its
 *   group could still reach its total;
 * - eliminated: at least `spots` teams are already certain to finish above its best possible total.
 * Totals count a tie as half a win. `top` is the #1 seed, `bye` a first-round bye (byesPerGroup > 0).
 */
export function clinchStatuses(teams: ClinchTeam[], spotsPerGroup: number, byesPerGroup: number): Map<string, ClinchStatus> {
  const out = new Map<string, ClinchStatus>();
  const pts = (t: ClinchTeam) => t.wins + t.ties * 0.5;
  for (const group of new Set(teams.map((t) => t.group))) {
    const g = teams.filter((t) => t.group === group);
    const spots = Math.min(spotsPerGroup, g.length);
    const clinchedTop = (x: ClinchTeam, k: number) => g.filter((y) => y.id !== x.id && pts(y) + y.remaining >= pts(x)).length < k;
    for (const x of g) {
      const best = pts(x) + x.remaining;
      if (spots < g.length && g.filter((y) => y.id !== x.id && pts(y) > best).length >= spots) {
        out.set(x.id, 'out');
      } else if (clinchedTop(x, 1)) {
        out.set(x.id, 'top');
      } else if (byesPerGroup > 0 && clinchedTop(x, byesPerGroup)) {
        out.set(x.id, 'bye');
      } else if (spots < g.length && clinchedTop(x, spots)) {
        out.set(x.id, 'playoffs');
      }
    }
  }
  return out;
}
