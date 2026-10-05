// Roster penalties a commissioner can switch on (both default Off, and both only ever apply to
// weeks played after the change):
//
//  * Empty-slot floor: every empty slot costs at least a set amount, even when most of the
//    credits were staked elsewhere.
//  * Invalid-roster penalty: an extra pick that breaks a roster rule (the same player in two
//    slots, a correlated pair, when that rule is on) is voided and its whole stake is lost, and
//    a roster that is spread over too few games or has such a pick also pays a flat fee.
//
// settle-week applies the same rules when a week is final (supabase/functions/settle-week/
// index.ts, "Roster penalties"). Keep the two in step. Nothing here touches the store or network.
import type { CorrelationRule, LeagueSettings, MarketKey, WeeklyRoster } from '../types';
import { findAllCorrelatedPairs } from './duplicatePicks';

/** A pick's NFL team is the first part of its player id (KC-rashee-rice). */
export function playerTeamFromId(playerId: string): string | undefined {
  const head = playerId.split('-')[0]?.toUpperCase();
  return head && /^[A-Z]{2,3}$/.test(head) ? head : undefined;
}

export interface PenaltyPick {
  slotId: string;
  gameId: string;
  marketKey: MarketKey;
  side: string;
  playerId?: string;
  playerName?: string;
  stake: number;
  placedAt: string;
}

export type PenaltySettings = Pick<
  LeagueSettings,
  | 'weeklyCredits'
  | 'lineupSlots'
  | 'emptySlotFloor'
  | 'invalidRosterPenaltyEnabled'
  | 'invalidRosterFee'
  | 'minGamesPerRoster'
  | 'correlationBlockEnabled'
  | 'correlationRules'
>;

const totalSlots = (s: Pick<LeagueSettings, 'lineupSlots'>) => Object.values(s.lineupSlots).reduce((a, b) => a + b, 0);

/** The floor actually used: never more than credits split evenly across the slots, so a roster
 * with every slot empty can never lose more than it would without the floor. Null when Off. */
export function effectiveEmptyFloor(s: Pick<LeagueSettings, 'weeklyCredits' | 'lineupSlots' | 'emptySlotFloor'>): number | null {
  const floor = s.emptySlotFloor;
  if (floor == null || !(floor > 0)) return null;
  const slots = totalSlots(s);
  if (slots <= 0) return null;
  return Math.min(floor, s.weeklyCredits / slots);
}

export interface RuleCheck {
  /** Picks that are voided: the later-placed one of each clash. */
  invalidSlotIds: string[];
  reasons: string[];
  /** Filled slots spread over fewer games than the roster needs. */
  tooFewGames: boolean;
  /** True when the flat fee applies. */
  feeApplies: boolean;
}

const byPlaced = (a: PenaltyPick, b: PenaltyPick) => (a.placedAt < b.placedAt ? -1 : a.placedAt > b.placedAt ? 1 : a.slotId < b.slotId ? -1 : 1);

export function checkRosterRules(picks: PenaltyPick[], s: PenaltySettings): RuleCheck {
  const invalid = new Set<string>();
  const reasons: string[] = [];
  const bySlot = new Map(picks.map((p) => [p.slotId, p]));

  // Same player in more than one slot: the first one placed stands, the rest are voided.
  const byPlayer = new Map<string, PenaltyPick[]>();
  for (const p of picks) if (p.playerId) byPlayer.set(p.playerId, [...(byPlayer.get(p.playerId) ?? []), p]);
  for (const group of byPlayer.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort(byPlaced);
    for (const extra of sorted.slice(1)) invalid.add(extra.slotId);
    reasons.push(`${sorted[0].playerName ?? 'A player'} is in more than one slot`);
  }

  // Correlated pairs (only when that rule is on): the later-placed pick of each pair is voided.
  if (s.correlationBlockEnabled) {
    const pairs = findAllCorrelatedPairs(
      picks.map((p) => ({ slotId: p.slotId, marketKey: p.marketKey, side: p.side, playerId: p.playerId, gameId: p.gameId })),
      s.correlationRules as CorrelationRule[],
      playerTeamFromId,
    );
    for (const [a, b] of pairs) {
      const [first, second] = [bySlot.get(a)!, bySlot.get(b)!].sort(byPlaced);
      void first;
      invalid.add(second.slotId);
    }
    if (pairs.length > 0) reasons.push('Correlated picks are not allowed');
  }

  const games = new Set(picks.map((p) => p.gameId));
  const need = s.minGamesPerRoster ?? 2;
  const tooFewGames = picks.length > 0 && games.size < need;
  if (tooFewGames) reasons.push(`Needs picks from at least ${need} different games`);

  return { invalidSlotIds: [...invalid], reasons, tooFewGames, feeApplies: invalid.size > 0 || tooFewGames };
}

export function picksOf(roster: WeeklyRoster): PenaltyPick[] {
  const picks: PenaltyPick[] = [];
  for (const slot of roster.slots) {
    const w = slot.wager;
    if (!w) continue;
    picks.push({ slotId: slot.slotId, gameId: w.gameId, marketKey: w.marketKey, side: w.side, playerId: w.playerId, playerName: w.playerName, stake: w.stake, placedAt: w.placedAt });
  }
  return picks;
}

export interface RosterPenalties {
  /** Slots whose stake is lost no matter how the pick does. */
  invalidSlotIds: Set<string>;
  /** Stake lost on those slots (a positive number of dollars). */
  invalidStakeLost: number;
  fee: number;
  /** Extra loss from the empty-slot floor, on top of the unspent credits. */
  floorExtra: number;
  reasons: string[];
}

/** What the penalty settings add for a roster as it stands. Empty when both are Off. */
export function rosterPenalties(roster: WeeklyRoster, s: PenaltySettings): RosterPenalties {
  const none: RosterPenalties = { invalidSlotIds: new Set(), invalidStakeLost: 0, fee: 0, floorExtra: 0, reasons: [] };
  const reasons: string[] = [];

  let floorExtra = 0;
  const floor = effectiveEmptyFloor(s);
  const empty = roster.slots.filter((x) => !x.wager).length;
  if (floor != null && empty > 0) {
    const allocated = roster.slots.reduce((sum, x) => sum + (x.wager?.stake ?? 0), 0);
    const unallocated = Math.max(0, s.weeklyCredits - allocated);
    floorExtra = Math.max(0, floor * empty - unallocated);
    if (floorExtra > 0) reasons.push(`${empty} empty slot${empty > 1 ? 's' : ''} (at least $${floor.toFixed(2)} each)`);
  }

  if (!s.invalidRosterPenaltyEnabled) return { ...none, floorExtra, reasons };
  const picks = picksOf(roster);
  const check = checkRosterRules(picks, s);
  const stakeBySlot = new Map(picks.map((p) => [p.slotId, p.stake]));
  const invalidSlotIds = new Set(check.invalidSlotIds);
  const invalidStakeLost = check.invalidSlotIds.reduce((sum, id) => sum + (stakeBySlot.get(id) ?? 0), 0);
  const fee = check.feeApplies ? Math.max(0, s.invalidRosterFee) : 0;
  reasons.push(...check.reasons);
  return { invalidSlotIds, invalidStakeLost, fee, floorExtra, reasons };
}
