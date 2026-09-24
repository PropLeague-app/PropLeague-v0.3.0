import type { SlotPosition } from '../../types';

const POSITION_CLASSES: Record<SlotPosition, string> = {
  QB: 'bg-pos-qb/15 text-pos-qb border-pos-qb',
  RB: 'bg-pos-rb/15 text-pos-rb border-pos-rb',
  WR: 'bg-pos-wr/15 text-pos-wr border-pos-wr',
  TE: 'bg-pos-te/15 text-pos-te border-pos-te',
  K: 'bg-pos-k/15 text-pos-k border-pos-k',
  ML: 'bg-pos-ml/15 text-pos-ml border-pos-ml',
};

export function positionBorderClass(position: SlotPosition): string {
  const map: Record<SlotPosition, string> = {
    QB: 'border-l-pos-qb',
    RB: 'border-l-pos-rb',
    WR: 'border-l-pos-wr',
    TE: 'border-l-pos-te',
    K: 'border-l-pos-k',
    ML: 'border-l-pos-ml',
  };
  return map[position];
}

/** Full-card border/fill treatment for a lineup slot -- borderSubtle/bgSubtle for
 * an empty, not-yet-picked slot; borderLit/bgLit for one with a pick in it (the
 * "lights up" effect). Kept much lower-opacity than the small position badge's own
 * bg-{color}/15 fill: filling an entire card at that same intensity would be
 * visually loud in a way a small badge isn't -- these are separate constants, not
 * the same value reused, specifically because of that difference in scale.
 *
 * bgSubtle/bgLit reference the --pos-x-subtle-bg/--pos-x-lit-bg color-mix() custom
 * properties (index.css) via Tailwind's arbitrary-value syntax, rather than
 * Tailwind's own bg-{color}/5 and bg-{color}/10 opacity-modifier utilities. Those
 * utilities bake a fixed alpha at build time, which read fine mixed toward dark
 * mode's near-black background but nearly vanished mixed toward light mode's --
 * empty lineup slots were reported as "barely visible" in light mode (see chat,
 * Sept 2026). The CSS variables carry a theme-conditional override instead, so
 * each theme mixes toward its own base. borderSubtle/borderLit are untouched --
 * colored borders already read fine on light backgrounds, no change needed there. */
const POSITION_FILL_CLASSES: Record<SlotPosition, { borderSubtle: string; borderLit: string; bgSubtle: string; bgLit: string }> = {
  QB: { borderSubtle: 'border-pos-qb/40', borderLit: 'border-pos-qb', bgSubtle: 'bg-[var(--pos-qb-subtle-bg)]', bgLit: 'bg-[var(--pos-qb-lit-bg)]' },
  RB: { borderSubtle: 'border-pos-rb/40', borderLit: 'border-pos-rb', bgSubtle: 'bg-[var(--pos-rb-subtle-bg)]', bgLit: 'bg-[var(--pos-rb-lit-bg)]' },
  WR: { borderSubtle: 'border-pos-wr/40', borderLit: 'border-pos-wr', bgSubtle: 'bg-[var(--pos-wr-subtle-bg)]', bgLit: 'bg-[var(--pos-wr-lit-bg)]' },
  TE: { borderSubtle: 'border-pos-te/40', borderLit: 'border-pos-te', bgSubtle: 'bg-[var(--pos-te-subtle-bg)]', bgLit: 'bg-[var(--pos-te-lit-bg)]' },
  K: { borderSubtle: 'border-pos-k/40', borderLit: 'border-pos-k', bgSubtle: 'bg-[var(--pos-k-subtle-bg)]', bgLit: 'bg-[var(--pos-k-lit-bg)]' },
  ML: { borderSubtle: 'border-pos-ml/40', borderLit: 'border-pos-ml', bgSubtle: 'bg-[var(--pos-ml-subtle-bg)]', bgLit: 'bg-[var(--pos-ml-lit-bg)]' },
};

export function positionFillClasses(position: SlotPosition) {
  return POSITION_FILL_CLASSES[position];
}

export function PositionBadge({ position }: { position: SlotPosition }) {
  return (
    // min-w keeps every badge the same footprint regardless of label length (K vs.
    // QB/RB/WR/TE/ML) -- without it, a screen laying out one badge per row in its own
    // grid (MatchupDetail.tsx's matchup rows, e.g.) ends up with visibly uneven row
    // widths, since each row's "auto" badge column resolves to a different size.
    <span
      className={`inline-flex items-center justify-center min-w-[32px] text-[11px] font-bold px-1.5 py-0.5 rounded border ${POSITION_CLASSES[position]}`}
    >
      {position}
    </span>
  );
}