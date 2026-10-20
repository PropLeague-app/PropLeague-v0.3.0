// Share images are drawn on a 1080px wide canvas (1350 tall at minimum, taller when a card has a lot
// to show). Colors are the app's own theme variables, so a shared picture matches whatever the sender
// sees: dark or light mode, and scaled P/L coloring. html-to-image reads the resolved values from the
// live page when it draws the picture, so nothing here has to know which theme is active. The
// fallbacks are the dark theme values from src/index.css.
export const SHARE_W = 1080;
export const SHARE_H = 1350;
/** Height of the frame's header (brand row plus the title panel with one row of chips). */
export const SHARE_HEADER_H = 200;
/** Height left for a card's own content once the frame's header and footer are in place (at the
 * minimum card height). Taller cards grow their body and keep the same header and footer. */
export const SHARE_BODY_H = 920;
/** Everything in a card that is not its body: padding, header, gaps and footer. */
export const SHARE_CHROME_H = SHARE_H - SHARE_BODY_H;

export const C = {
  bg: 'var(--color-bg, #141c29)',
  bg2: 'var(--color-bg-raised, #1b2536)',
  card: 'var(--color-bg-card, #1e2a3d)',
  raised: 'var(--color-bg-raised, #1b2536)',
  border: 'var(--color-border, #2c3a52)',
  text: 'var(--color-text, #e8ecf5)',
  muted: 'var(--color-text-muted, #8a94a8)',
  primary: 'var(--color-primary, #4c8df5)',
  accent: 'var(--color-accent, #9d4eed)',
  profit: 'var(--color-profit, #3ddc84)',
  loss: 'var(--color-loss, #f55c5c)',
  warning: 'var(--color-warning, #f5a45c)',
  gold: 'var(--color-gold, #f4c542)',
  /** The soft corner glow behind every card, tuned per theme in index.css. */
  glow: 'var(--pl-share-glow, color-mix(in srgb, var(--color-primary, #4c8df5) 22%, transparent))',
  /** Gold that stays readable as text in light mode (perfect weeks, podium). */
  goldText: 'var(--pl-gold-text, #f4c542)',
  /** The muted olive used for skunked weeks. */
  skunkText: 'var(--pl-skunk-text, #b3b184)',
} as const;

/** A theme color at some strength over whatever is behind it, like Tailwind's `bg-x/20`. */
export const tint = (color: string, percent: number) => `color-mix(in srgb, ${color} ${percent}%, transparent)`;

export const POS_COLOR: Record<string, string> = {
  QB: 'var(--color-pos-qb, #f472b6)',
  RB: 'var(--color-pos-rb, #f5a45c)',
  WR: 'var(--color-pos-wr, #4c8df5)',
  TE: 'var(--color-pos-te, #3ddc84)',
  K: 'var(--color-pos-k, #9d4eed)',
  ML: 'var(--color-pos-ml, #facc15)',
};

/** Kept in step with --font-sans in index.css by hand: share cards are rendered through
 * html-to-image off inline styles, so they never inherit the stylesheet's font. If these two drift,
 * the picture comes out in a different face than the screen it was shared from. */
export const FONT = "-apple-system, system-ui, 'Segoe UI', Roboto, sans-serif";

/** Display type: anything on a share card set at 30px or above.
 *
 * The system font is optically sized -- past roughly 20px it switches to a cut that is tighter and
 * lighter in the stroke than the one used for body text. Verdana has no such switch and stays
 * sturdy at every size, so a weight that looked solid under it reads thin and unfinished at a
 * headline size under this one (see chat, Oct 2026). Large text therefore takes a heavier cut and
 * tighter tracking than the app's default, chosen on device against the real headers.
 *
 * The screen gets this from a rule in index.css keyed off Tailwind's size classes. A share card is
 * inline-styled and inherits nothing from the stylesheet, so it spreads this instead. The two have
 * to agree, or a shared picture looks different from the screen it came from. */
export const DISPLAY = { fontWeight: 900, letterSpacing: '-0.02em' } as const;

export type ShareStatus = 'won' | 'lost' | 'push' | 'voided' | 'pending' | 'live';

export const STATUS_COLOR: Record<ShareStatus, string> = {
  won: C.profit,
  lost: C.loss,
  push: C.primary,
  voided: C.accent,
  pending: C.muted,
  live: C.loss,
};

export const STATUS_LABEL: Record<ShareStatus, string> = {
  won: 'WON',
  lost: 'LOST',
  push: 'PUSH',
  voided: 'VOID',
  pending: 'PENDING',
  live: 'LIVE',
};

export const STATUS_LETTER: Record<ShareStatus, string> = {
  won: 'W',
  lost: 'L',
  push: 'P',
  voided: 'V',
  pending: '...',
  live: 'LIVE',
};

export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Profit or loss with an explicit sign: +$12.50 / -$8.00. */
export function signedMoney(n: number): string {
  return `${n < 0 ? '-' : '+'}$${Math.abs(n).toFixed(2)}`;
}
