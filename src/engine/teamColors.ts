// Readable team colors for text and tints that sit on the app's cards.
//
// A team's own color is a brand color: some are nearly black (Raiders, Saints), some pale
// (Steelers gold), and either one disappears on one of the two themes. This nudges a color
// toward the theme's text color just far enough to clear a contrast target against the card (3.5:1, enough for bold, large text on a tinted pill), so
// it still looks like the team but is always legible. The card/text values mirror index.css.
import type { ResolvedTheme } from '../types';
import { NFL_TEAMS } from '../data/nflTeams';

const CARD: Record<ResolvedTheme, string> = { dark: '#1e2a3d', light: '#fbfcfe', graphite: '#1c1c1f' };
const TEXT: Record<ResolvedTheme, string> = { dark: '#e8ecf5', light: '#202838', graphite: '#ececee' };

type RGB = [number, number, number];

function parseHex(hex: string): RGB {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

function toHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

function luminance([r, g, b]: RGB): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(parseHex(a));
  const lb = luminance(parseHex(b));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function mix(from: RGB, to: RGB, t: number): RGB {
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];
}

/** The color, pulled toward the theme's text color only as far as needed to reach `target`
 * contrast against the card. `amount` is how far it moved (0 = untouched, 1 = fully text color). */
export function readableOnCard(hex: string, mode: ResolvedTheme, target = 3.5): { color: string; amount: number } {
  const card = CARD[mode];
  const text = parseHex(TEXT[mode]);
  const base = parseHex(hex);
  for (let step = 0; step <= 20; step++) {
    const t = step / 20;
    const candidate = toHex(mix(base, text, t));
    if (contrastRatio(candidate, card) >= target) return { color: candidate, amount: t };
  }
  return { color: TEXT[mode], amount: 1 };
}

/** The color to use for a team on a card: its primary color, unless that needed a big shove
 * and the secondary color is a better fit. Unknown team returns null. */
export function teamAccent(abbrev: string | null | undefined, mode: ResolvedTheme): string | null {
  if (!abbrev) return null;
  const team = NFL_TEAMS.find((t) => t.abbrev === abbrev.toUpperCase());
  if (!team) return null;
  const primary = readableOnCard(team.primaryColor, mode);
  if (primary.amount <= 0.35) return primary.color;
  const secondary = readableOnCard(team.secondaryColor, mode);
  return secondary.amount < primary.amount ? secondary.color : primary.color;
}

/** NFL team code from a pick's player id ('KC-rashee-rice' -> 'KC'), if it looks like one. */
export function nflTeamFromPlayerId(playerId: string | null | undefined): string | null {
  const code = (playerId ?? '').split('-')[0]?.toUpperCase() ?? '';
  return /^[A-Z]{2,3}$/.test(code) ? code : null;
}
