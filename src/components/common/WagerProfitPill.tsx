import type { WagerStatus } from '../../types';
import { formatCents } from '../../engine/oddsMath';

/** Advanced-mode replacement for the plain "Won"/"Lost" StatusPill on a settled
 * pick (see chat, Sept 2026 -- the McCaffrey cell where you couldn't tell what
 * a loss actually cost you). Shows the real settled_profit dollar amount
 * instead of the status word: green "+$X.XX" for a win, red "-$X.XX" for a
 * loss. Push and voided are always exactly $0 -- Hunter's explicit call was
 * that's fine to show but shouldn't fight for attention, so both get the same
 * quiet, muted treatment rather than their old distinct push/voided colors.
 * Only ever rendered for a settled wager (pending/live keep the word-based
 * StatusPill, which has nothing meaningful to put a dollar figure on yet). */
export function WagerProfitPill({ status, profit }: { status: Exclude<WagerStatus, 'pending'>; profit: number }) {
  const amountText = status === 'won' ? `+${formatCents(profit)}` : formatCents(profit);
  const styleClass =
    status === 'won' ? 'bg-profit/20 text-profit' : status === 'lost' ? 'bg-loss/20 text-loss' : 'bg-bg-raised text-text-muted';
  return <span className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${styleClass}`}>{amountText}</span>;
}
