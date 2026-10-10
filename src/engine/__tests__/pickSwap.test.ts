import { describe, it, expect } from 'vitest';
import { compareOdds, heldTag, heldTagInSlots, isSamePick, openSiblingSlot, swapChoices, swapKind } from '../pickSwap';
import { applyStakeKeyToPrefill } from '../stakeInput';
import type { RosterSlotState, Wager } from '../../types';

const held: Wager = {
  id: 'w1',
  slotId: 'QB-1',
  gameId: 'g1',
  marketKey: 'player_pass_attempts',
  playerId: 'p-smith',
  playerName: 'Geno Smith',
  side: 'Over',
  point: 31.5,
  oddsAtPlacement: 101,
  stake: 10,
  placedAt: '',
  status: 'pending',
  settledProfit: null,
};
const same = { gameId: 'g1', marketKey: 'player_pass_attempts', playerId: 'p-smith', side: 'Over', point: 31.5, price: 101 };

describe('swapKind', () => {
  it('tells a new pick, a different pick, a new line, new odds and the same pick apart', () => {
    expect(swapKind(null, same)).toBe('new');
    expect(swapKind(held, same)).toBe('same');
    expect(swapKind(held, { ...same, price: 110 })).toBe('odds');
    expect(swapKind(held, { ...same, point: 30.5, price: -113 })).toBe('line');
    expect(swapKind(held, { ...same, side: 'Under' })).toBe('different');
    expect(swapKind(held, { ...same, playerId: 'p-hurts' })).toBe('different');
    expect(swapKind(held, { ...same, marketKey: 'player_pass_yds' })).toBe('different');
    expect(swapKind(held, { ...same, gameId: 'g2' })).toBe('different');
  });
  it('treats a missing player or point as equal to null (game lines)', () => {
    const ml: Wager = { ...held, marketKey: 'h2h', playerId: undefined, playerName: undefined, side: 'Philadelphia Eagles', point: undefined, oddsAtPlacement: -150 };
    expect(isSamePick(ml, { gameId: 'g1', marketKey: 'h2h', playerId: null, side: 'Philadelphia Eagles' })).toBe(true);
    expect(swapKind(ml, { gameId: 'g1', marketKey: 'h2h', side: 'Philadelphia Eagles', point: null, price: -140 })).toBe('odds');
  });
});

describe('compareOdds', () => {
  it('compares payouts across plus and minus odds', () => {
    expect(compareOdds(110, 101)).toBe(1);
    expect(compareOdds(-113, 101)).toBe(-1);
    expect(compareOdds(-105, -110)).toBe(1);
    expect(compareOdds(100, -100)).toBe(0);
  });
});

describe('heldTag', () => {
  it('marks the held pick, green when the board pays more, red when less', () => {
    expect(heldTag(held, { ...same, price: 120 })).toEqual({ point: null, odds: 101, tone: 'better' });
    expect(heldTag(held, { ...same, price: -110 })).toEqual({ point: null, odds: 101, tone: 'worse' });
    expect(heldTag(held, same)).toEqual({ point: null, odds: 101, tone: 'same' });
  });
  it('names the held line on a different line, and ignores other picks', () => {
    expect(heldTag(held, { ...same, point: 32.5, price: 120 })).toEqual({ point: 31.5, odds: null, tone: 'line' });
    expect(heldTag(held, { ...same, side: 'Under' })).toBeNull();
    expect(heldTag(null, same)).toBeNull();
  });
});

describe('openSiblingSlot', () => {
  const slot = (slotId: string, position: RosterSlotState['position'], filled: boolean): RosterSlotState => ({
    slotId,
    position,
    wager: filled ? { ...held, slotId } : null,
  });
  it('finds another empty slot of the same position only', () => {
    const slots = [slot('QB-1', 'QB', true), slot('RB-1', 'RB', true), slot('RB-2', 'RB', false), slot('WR-1', 'WR', false)];
    expect(openSiblingSlot(slots, 'RB-1')?.slotId).toBe('RB-2');
    expect(openSiblingSlot(slots, 'QB-1')).toBeNull();
    expect(openSiblingSlot([slot('RB-1', 'RB', true), slot('RB-2', 'RB', true)], 'RB-1')).toBeNull();
    expect(openSiblingSlot(slots, 'nope')).toBeNull();
  });
});

describe('carried-over stake', () => {
  it('the first key starts a new amount, backspace clears it', () => {
    expect(applyStakeKeyToPrefill('7')).toBe('7');
    expect(applyStakeKeyToPrefill('.')).toBe('0.');
    expect(applyStakeKeyToPrefill('back')).toBe('');
    expect(applyStakeKeyToPrefill('0')).toBe('0');
  });
});

describe('swapChoices', () => {
  const rb = (slotId: string, wager: Partial<Wager> | null): RosterSlotState => ({
    slotId,
    position: 'RB',
    wager: wager ? { ...held, slotId, marketKey: 'player_rush_yds', ...wager } : null,
  });
  const cand = { gameId: 'g9', marketKey: 'player_rush_yds', playerId: 'p-new', side: 'Over' };
  const unlocked = () => false;

  it('lists the open slot and every swappable held pick of that position', () => {
    const slots = [rb('RB-1', { playerId: 'a' }), rb('RB-2', null), { slotId: 'QB-1', position: 'QB' as const, wager: held }];
    expect(swapChoices(slots, 'RB', cand, unlocked)).toEqual({ openSlotId: 'RB-2', filledSlotIds: ['RB-1'], samePickSlotId: null });
  });
  it('skips locked and settled picks', () => {
    const slots = [rb('RB-1', { playerId: 'a', gameId: 'live' }), rb('RB-2', { playerId: 'b', status: 'won' })];
    expect(swapChoices(slots, 'RB', cand, (w) => w.gameId === 'live')).toEqual({ openSlotId: null, filledSlotIds: [], samePickSlotId: null });
  });
  it('points at the slot already holding the same pick', () => {
    const slots = [rb('RB-1', { playerId: 'a' }), rb('RB-2', { gameId: 'g9', playerId: 'p-new', point: 60.5 })];
    expect(swapChoices(slots, 'RB', cand, unlocked).samePickSlotId).toBe('RB-2');
  });
  it('tags a held pick anywhere in the lineup', () => {
    const slots = [rb('RB-1', null), { slotId: 'QB-1', position: 'QB' as const, wager: held }];
    expect(heldTagInSlots(slots, { ...same, price: 120 })?.tone).toBe('better');
    expect(heldTagInSlots(slots, { ...same, side: 'Under' })).toBeNull();
  });
});
