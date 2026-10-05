// P/L coloring.
//
// Classic: any gain is green and any loss is red (what the app always did).
// Scaled (opt-in, per device): a loss is tinted by how big it is next to the worst loss in the
// same comparison (that week's scores, or the season standings). The worst loss is the reddest
// and everything else scales toward $0. If even the worst is tiny, nothing gets red: the
// reference never drops below a share of what was at risk (see scaleReference). In a
// league where most teams finish the season in the red, that stops everything below $0 from
// looking equally dire. Gains are never scaled: any +$ is solid profit green, and the minus
// sign always stays on the number itself.
//
// The three stops are theme CSS variables (--pl-loss-lo / -mid / -hi in index.css), each tuned
// separately for dark and light mode so every step stays readable on its card.
import type { CSSProperties } from 'react';
import type { League, LeagueSettings } from '../types';

export type PlColorScale = 'classic' | 'scaled';

/** A loss this share of what was at risk counts as "full red" at the least, so a week where
 * the worst score is only a few dollars down stays yellow instead of painting a small dip red. */
export const REFERENCE_FLOOR_SHARE = 0.25;

/** The loss that counts as full red: the worst loss in the comparison, but never less than a
 * quarter of what was at risk. Both inputs positive. */
export function scaleReference(worstLoss: number, atRisk: number): number {
  return Math.max(Math.abs(worstLoss), REFERENCE_FLOOR_SHARE * Math.max(0, atRisk));
}

/** Loss as a share of the reference loss, 0 to 1. Zero for a gain, a push, or no reference. */
export function lossIntensity(amount: number, reference: number): number {
  if (!(amount < 0) || !(reference > 0)) return 0;
  return Math.min(1, -amount / reference);
}

/** Where the scale sits: yellow at 0, orange by here, red by the next stop. Reaching red well before
 * the worst loss means moderate losses already read as a real hit. */
export const ORANGE_AT = 0.3;
export const RED_AT = 0.65;

/** CSS color for a loss of the given intensity (0 = barely, 1 = the worst in the comparison):
 * yellow, through orange, to red. Two blends across three theme-aware stops. */
export function lossColor(intensity: number): string {
  const t = Math.max(0, Math.min(1, intensity));
  if (t <= ORANGE_AT) {
    const pct = Math.round((t / ORANGE_AT) * 100);
    return `color-mix(in oklab, var(--pl-loss-mid) ${pct}%, var(--pl-loss-lo))`;
  }
  const pct = Math.round(Math.min(1, (t - ORANGE_AT) / (RED_AT - ORANGE_AT)) * 100);
  return `color-mix(in oklab, var(--pl-loss-hi) ${pct}%, var(--pl-loss-mid))`;
}

/** Inline style that overrides the default green/red class for a scaled loss, or undefined
 * when the classic look should apply (classic mode, a gain, or no basis to scale against). */
export function plStyleFor(amount: number, scale: PlColorScale, reference: number): CSSProperties | undefined {
  if (scale !== 'scaled' || !(amount < 0) || !(reference > 0)) return undefined;
  return { color: lossColor(lossIntensity(amount, reference)) };
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

/** Reference loss for one week's scores: the worst score that week across the league (live scores
 * included, plus any the caller is about to show), floored at a quarter of the weekly credits. */
export function weekScaleRef(
  league: Pick<League, 'matchupsByWeek' | 'settings'>,
  week: string | number,
  extraScores: number[] = [],
): number {
  const scores = [...extraScores];
  for (const m of league.matchupsByWeek[String(week)] ?? []) {
    if (m.teamAScore != null) scores.push(m.teamAScore);
    if (m.teamBScore != null) scores.push(m.teamBScore);
  }
  return scaleReference(-Math.min(0, ...scores), weeklyAtRisk(league.settings));
}

/** Reference loss for season totals: the worst team P/L in the standings, floored at a quarter of
 * what a team has put at risk so far (the most weeks any team has played). */
export function seasonScaleRef(league: Pick<League, 'standings' | 'settings'>): number {
  const worst = -Math.min(0, ...league.standings.map((s) => s.totalPL));
  const weeks = Math.max(0, ...league.standings.map((s) => s.wins + s.losses + s.ties));
  return scaleReference(worst, seasonAtRisk(weeks, league.settings));
}
