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
 * the same value reused, specifically because of that difference in scale. */
const POSITION_FILL_CLASSES: Record<SlotPosition, { borderSubtle: string; borderLit: string; bgSubtle: string; bgLit: string }> = {
  QB: { borderSubtle: 'border-pos-qb/40', borderLit: 'border-pos-qb', bgSubtle: 'bg-pos-qb/5', bgLit: 'bg-pos-qb/10' },
  RB: { borderSubtle: 'border-pos-rb/40', borderLit: 'border-pos-rb', bgSubtle: 'bg-pos-rb/5', bgLit: 'bg-pos-rb/10' },
  WR: { borderSubtle: 'border-pos-wr/40', borderLit: 'border-pos-wr', bgSubtle: 'bg-pos-wr/5', bgLit: 'bg-pos-wr/10' },
  TE: { borderSubtle: 'border-pos-te/40', borderLit: 'border-pos-te', bgSubtle: 'bg-pos-te/5', bgLit: 'bg-pos-te/10' },
  K: { borderSubtle: 'border-pos-k/40', borderLit: 'border-pos-k', bgSubtle: 'bg-pos-k/5', bgLit: 'bg-pos-k/10' },
  ML: { borderSubtle: 'border-pos-ml/40', borderLit: 'border-pos-ml', bgSubtle: 'bg-pos-ml/5', bgLit: 'bg-pos-ml/10' },
};

export function positionFillClasses(position: SlotPosition) {
  return POSITION_FILL_CLASSES[position];
}

export function PositionBadge({ position }: { position: SlotPosition }) {
  return (
    <span
      className={`inline-flex items-center justify-center text-[11px] font-bold px-1.5 py-0.5 rounded border ${POSITION_CLASSES[position]}`}
    >
      {position}
    </span>
  );
}