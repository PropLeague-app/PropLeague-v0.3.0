import { OddsDisplay } from '../common/OddsDisplay';
import type { heldTag } from '../../engine/pickSwap';

export type HeldTagInfo = NonNullable<ReturnType<typeof heldTag>>;

const BANNER: Record<HeldTagInfo['tone'], string> = {
  better: 'bg-profit/10 border-profit/40 text-profit',
  worse: 'bg-loss/10 border-loss/40 text-loss',
  same: 'bg-primary/10 border-primary/40 text-primary',
  line: 'bg-primary/10 border-primary/40 text-primary',
};

/** Border for the odds box above a HeldTag, in the same tone, so box and tag read as one piece. */
export function heldBoxBorder(info: HeldTagInfo): string {
  return info.tone === 'better' ? 'border-profit/50' : info.tone === 'worse' ? 'border-loss/50' : 'border-primary/50';
}

/**
 * Attached under an odds box while swapping, the same way the claim banner is: marks the pick you
 * already hold and what you hold it at. Green when the board now pays more than your price, red when
 * it pays less. On a different line it names your line instead (odds on two lines do not compare).
 */
export function HeldTag({ info }: { info: HeldTagInfo }) {
  // Just the number you hold (no label: the tinted tag and border already say "yours"), so it fits
  // the narrow 64px box in either odds format.
  return (
    <div
      aria-label={info.odds != null ? `Your pick, held at ${info.odds}` : `Your pick, on the ${info.point} line`}
      className={`flex items-center justify-center h-[18px] px-1 border border-t-0 rounded-b-lg text-[10px] font-semibold whitespace-nowrap tabular-nums ${BANNER[info.tone]}`}
    >
      {info.odds != null ? <OddsDisplay odds={info.odds} /> : info.point != null ? info.point : null}
    </div>
  );
}
