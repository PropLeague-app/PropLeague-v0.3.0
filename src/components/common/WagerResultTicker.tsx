import { describeWagerResult, type RealPlayerStatLine } from '../../engine/realGameResult';
import type { MarketKey, WagerStatus } from '../../types';

/** Small "how'd it actually go" readout meant to sit right next to a StatusPill
 * (Sept 2026 chat: "some frame of reference for how much someone won/lost by
 * ... it'll also make it easier to track the Lamar Jackson pass+rush bug if we
 * can see the result"). Deliberately plain text, not a second pill -- one loud
 * badge (the status) plus one quiet number reads cleaner than two badges
 * fighting for attention in the same small card.
 *
 * Colored to match the status once it's actually graded (green/red/etc., same
 * tokens StatusPill uses) so it visually reads as "this is what earned that
 * pill." While still pending/live it's shown muted instead -- a live score is
 * provisional, not a verdict yet. Renders nothing when there's genuinely no
 * data yet (see describeWagerResult's own doc comment for exactly when that
 * is) rather than a placeholder dash, so it never looks like a stuck ticker. */
export function WagerResultTicker({
  marketKey,
  status,
  stat,
  game,
}: {
  marketKey: MarketKey;
  status: WagerStatus;
  stat: RealPlayerStatLine | undefined;
  game?: { homeScore: number | null | undefined; awayScore: number | null | undefined };
}) {
  const value = describeWagerResult(marketKey, stat, game);
  if (!value) return null;
  const colorClass =
    status === 'won'
      ? 'text-profit'
      : status === 'lost'
        ? 'text-loss'
        : status === 'push'
          ? 'text-primary'
          : status === 'voided'
            ? 'text-accent'
            : 'text-text-muted'; // pending/live -- provisional, not a verdict yet
  // Deliberately lighter than the pill next to it now that the pill itself carries
  // the headline dollar amount (see WagerProfitPill, Sept 2026 matchup-screen
  // cleanup) -- this is back to being the secondary, "here's the box score line
  // that produced that number" readout it was always meant to be, not competing
  // with it for attention.
  return <span className={`text-[9px] font-normal whitespace-nowrap ${colorClass}`}>{value}</span>;
}
