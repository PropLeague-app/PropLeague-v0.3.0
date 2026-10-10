// Swapping a pick that is already in a slot (1.2.10). The ⇄ button on a filled slot opens the market
// list for that slot; the slot keeps its pick until a new one is confirmed, and place_wager replaces
// it in one step (so a refused swap leaves the old pick and its odds untouched).
import type { RosterSlotState, Wager } from '../types';
import { americanToDecimal } from './oddsMath';

/** The pick being chosen, in the shape the bet slip has. */
export interface CandidatePick {
  gameId: string;
  marketKey: string;
  playerId?: string | null;
  side: string;
  point?: number | null;
  price: number;
}

/**
 * How a candidate relates to the pick held in the slot:
 *  new        nothing is held (an ordinary new pick)
 *  different  another pick altogether
 *  line       same pick (game, market, player, side) at a different line
 *  odds       same pick and line, different price
 *  same       exactly what is held: nothing to replace
 */
export type SwapKind = 'new' | 'different' | 'line' | 'odds' | 'same';

const samePoint = (a: number | null | undefined, b: number | null | undefined) => (a ?? null) === (b ?? null);

export function isSamePick(held: Pick<Wager, 'gameId' | 'marketKey' | 'playerId' | 'side'>, next: Pick<CandidatePick, 'gameId' | 'marketKey' | 'playerId' | 'side'>): boolean {
  return held.gameId === next.gameId && held.marketKey === next.marketKey && (held.playerId ?? null) === (next.playerId ?? null) && held.side === next.side;
}

export function swapKind(held: Wager | null | undefined, next: CandidatePick): SwapKind {
  if (!held) return 'new';
  if (!isSamePick(held, next)) return 'different';
  if (!samePoint(held.point, next.point)) return 'line';
  return held.oddsAtPlacement === next.price ? 'same' : 'odds';
}

/** 1 when `price` pays more than `held`, -1 when it pays less, 0 when equal (works across +/- odds). */
export function compareOdds(price: number, held: number): -1 | 0 | 1 {
  const a = americanToDecimal(price);
  const b = americanToDecimal(held);
  if (Math.abs(a - b) < 1e-9) return 0;
  return a > b ? 1 : -1;
}

/** Another empty slot of the same position, so a new pick can go there instead of replacing. */
export function openSiblingSlot(slots: RosterSlotState[], slotId: string): RosterSlotState | null {
  const from = slots.find((s) => s.slotId === slotId);
  if (!from) return null;
  return slots.find((s) => s.slotId !== slotId && s.position === from.position && !s.wager) ?? null;
}

/**
 * The small "Yours" tag on the market list while swapping: on the box for the same pick (same side),
 * whichever line is showing. Tone compares the price only when the line is the same; a different
 * line just names the line you hold.
 */
export function heldTag(held: Wager | null | undefined, next: Omit<CandidatePick, 'price'> & { price: number }): { point: number | null; odds: number | null; tone: 'better' | 'worse' | 'same' | 'line' } | null {
  if (!held || !isSamePick(held, next)) return null;
  if (!samePoint(held.point, next.point)) return { point: held.point ?? null, odds: null, tone: 'line' };
  const c = compareOdds(next.price, held.oddsAtPlacement);
  return { point: null, odds: held.oddsAtPlacement, tone: c > 0 ? 'better' : c < 0 ? 'worse' : 'same' };
}

/**
 * Where a pick for this position could go, for the bet slip's slot choice: the first empty slot,
 * every filled slot whose pick can still be swapped (pending, game not started), and the filled slot
 * that already holds this same pick (game, market, player, side), if any. A same-pick slot is the
 * only sensible target: the pick is re-locked there at the new line or odds.
 */
export function swapChoices(
  slots: RosterSlotState[],
  position: RosterSlotState['position'],
  candidate: Pick<CandidatePick, 'gameId' | 'marketKey' | 'playerId' | 'side'>,
  isLocked: (w: Wager) => boolean,
): { openSlotId: string | null; filledSlotIds: string[]; samePickSlotId: string | null } {
  const ofPosition = slots.filter((s) => s.position === position);
  const open = ofPosition.find((s) => !s.wager) ?? null;
  const filled = ofPosition.filter((s) => s.wager && s.wager.status === 'pending' && !isLocked(s.wager));
  const same = filled.find((s) => isSamePick(s.wager!, candidate)) ?? null;
  return { openSlotId: open?.slotId ?? null, filledSlotIds: filled.map((s) => s.slotId), samePickSlotId: same?.slotId ?? null };
}

/** heldTag across a whole lineup (Game Details, where any slot may hold a pick from this game). */
export function heldTagInSlots(slots: RosterSlotState[], next: CandidatePick): ReturnType<typeof heldTag> {
  for (const s of slots) {
    const tag = s.wager && s.wager.status === 'pending' ? heldTag(s.wager, next) : null;
    if (tag) return tag;
  }
  return null;
}
