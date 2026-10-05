// P/L coloring.
//
// Classic: any gain is green and any loss is red (what the app always did).
// Scaled (opt-in, per device): a loss is tinted by how big it is relative to what was at risk,
// so a small dip reads as a soft red-gray and only a wipeout is the full alarm red. In a
// league where most teams finish the season in the red, that stops everything below $0 from
// looking equally dire. Gains are never scaled: any +$ is solid profit green, and the minus
// sign always stays on the number itself.
//
// The scale is built from the theme's own CSS variables (--color-loss toward --color-text-muted),
// so it follows dark and light mode with no per-theme code.
import type { CSSProperties } from 'react';
import type { League, LeagueSettings } from '../types';

export type PlColorScale = 'classic' | 'scaled';

/** Even the smallest loss keeps this much red, so it never turns into plain gray text. */
export const SCALE_FLOOR = 0.3;

/** Loss as a share of what was at risk, 0 to 1. Zero for a gain, a push, or nothing at risk. */
export function lossIntensity(amount: number, atRisk: number): number {
  if (!(amount < 0) || !(atRisk > 0)) return 0;
  return Math.min(1, -amount / atRisk);
}

/** CSS color for a loss of the given intensity (0 = barely, 1 = everything at risk). */
export function lossColor(intensity: number): string {
  const t = Math.max(0, Math.min(1, intensity));
  const pct = Math.round((SCALE_FLOOR + (1 - SCALE_FLOOR) * t) * 100);
  return `color-mix(in oklab, var(--color-loss) ${pct}%, var(--color-text-muted))`;
}

/** Inline style that overrides the default green/red class for a scaled loss, or undefined
 * when the classic look should apply (classic mode, a gain, or no basis to scale against). */
export function plStyleFor(amount: number, scale: PlColorScale, atRisk: number): CSSProperties | undefined {
  if (scale !== 'scaled' || !(amount < 0) || !(atRisk > 0)) return undefined;
  return { color: lossColor(lossIntensity(amount, atRisk)) };
}

/** What a team put at risk in one week. */
export function weeklyAtRisk(settings: Pick<LeagueSettings, 'weeklyCredits'>): number {
  return settings.weeklyCredits;
}

/** What a team put at risk over a season so far: credits for each decided week. */
export function seasonAtRisk(weeksPlayed: number, settings: Pick<LeagueSettings, 'weeklyCredits'>): number {
  return Math.max(0, weeksPlayed) * settings.weeklyCredits;
}

/** Decided weeks a team has played so far, from the standings (wins + losses + ties). */
export function teamWeeksPlayed(league: Pick<League, 'standings'>, teamId: string): number {
  const s = league.standings.find((x) => x.teamId === teamId);
  return s ? s.wins + s.losses + s.ties : 0;
}

/** What the whole league put at risk over the season so far (for league-wide totals). */
export function leagueSeasonAtRisk(league: Pick<League, 'standings' | 'settings'>): number {
  return league.standings.reduce((sum, s) => sum + seasonAtRisk(s.wins + s.losses + s.ties, league.settings), 0);
}
