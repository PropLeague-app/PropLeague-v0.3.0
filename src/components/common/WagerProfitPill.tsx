import type { WagerStatus } from '../../types';
import { formatCents } from '../../engine/oddsMath';

/** Advanced-mode replacement for the plain "Won"/"Lost" StatusPill on a settled
 * pick (see chat, Sept 2026 -- the McCaffrey cell where you couldn't tell what
 * a loss actually cost you). Shows the real settled_profit dollar amount
 * instead of the status word: green "+$X.XX" for a win, red "-$X.XX" for a
 * loss. Push and voided are always exactly $0, and both now carry the same
 * color their StatusPill does rather than a muted treatment, so Advanced never
 * looks unstyled next to Simple. Voided went first (see chat, Sept 2026 -- the
 * Iosivas void fix) with bg-accent/20 text-accent; push followed for the same
 * reason (see chat, Oct 2026 -- the tied Giants moneyline), with bg-primary/20
 * text-primary to match Simple mode's blue "P" pill and the accent-colored
 * score that sits beside it. This reverses push's original muted styling.
 * Only ever rendered for a settled wager (pending/live keep the word-based
 * StatusPill, which has nothing meaningful to put a dollar figure on yet). */
export function WagerProfitPill({ status, profit }: { status: Exclude<WagerStatus, 'pending'>; profit: number }) {
  const amountText = status === 'won' ? `+${formatCents(profit)}` : formatCents(profit);
  const styleClass =
    status === 'won'
      ? 'bg-profit/20 text-profit'
      : status === 'lost'
        ? 'bg-loss/20 text-loss'
        : status === 'voided'
          ? 'bg-accent/20 text-accent'
          : status === 'push'
            ? 'bg-primary/20 text-primary'
            : 'bg-bg-raised text-text-muted';
  return <span className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap tabular-nums ${styleClass}`}>{amountText}</span>;
}
