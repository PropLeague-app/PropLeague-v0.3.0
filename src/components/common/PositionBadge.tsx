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

export function PositionBadge({ position }: { position: SlotPosition }) {
  return (
    <span
      className={`inline-flex items-center justify-center text-[11px] font-bold px-1.5 py-0.5 rounded border ${POSITION_CLASSES[position]}`}
    >
      {position}
    </span>
  );
}
