import { describe, it, expect } from 'vitest';
import { isMatchupFinal, isSlotLive, matchupStatus } from '../matchupStatus';
import type { RosterSlotState, Wager, WeeklyRoster } from '../../types';

const wager = (gameId: string, status: Wager['status'] = 'pending') => ({ gameId, status }) as unknown as Wager;
const slot = (w: Wager | null): RosterSlotState => ({ slotId: 's', position: 'QB', wager: w }) as RosterSlotState;
const roster = (...slots: RosterSlotState[]): WeeklyRoster => ({ week: 7, teamId: 't', slots, submitted: true });

const started = new Set(['thu']);
const hasStarted = (id: string) => started.has(id);
const open = { winnerId: null, isTie: false };

describe('isMatchupFinal', () => {
  it('is final on a winner or a tie only', () => {
    expect(isMatchupFinal({ winnerId: 'a', isTie: false })).toBe(true);
    expect(isMatchupFinal({ winnerId: null, isTie: true })).toBe(true);
    expect(isMatchupFinal(open)).toBe(false);
  });
});

describe('isSlotLive', () => {
  it('an empty slot is never live', () => {
    expect(isSlotLive(slot(null), () => true)).toBe(false);
  });
  it('a pending pick is live once its game starts', () => {
    expect(isSlotLive(slot(wager('sun')), hasStarted)).toBe(false);
    expect(isSlotLive(slot(wager('thu')), hasStarted)).toBe(true);
  });
  it('a settled pick is live whatever the game lookup says', () => {
    expect(isSlotLive(slot(wager('sun', 'won')), () => false)).toBe(true);
    expect(isSlotLive(slot(wager('sun', 'voided')), () => false)).toBe(true);
  });
});

describe('matchupStatus', () => {
  it('is upcoming with every pick still pending before kickoff', () => {
    expect(matchupStatus(open, [roster(slot(wager('sun'))), roster(slot(null))], hasStarted)).toBe('upcoming');
  });
  it('is upcoming with empty or missing rosters', () => {
    expect(matchupStatus(open, [undefined, roster(slot(null))], hasStarted)).toBe('upcoming');
  });
  it('is live once any pick on either side is live', () => {
    expect(matchupStatus(open, [roster(slot(wager('sun'))), roster(slot(wager('thu')))], hasStarted)).toBe('live');
  });
  it('is final once the result is set, even with picks live', () => {
    expect(matchupStatus({ winnerId: 'a', isTie: false }, [roster(slot(wager('thu')))], hasStarted)).toBe('final');
  });
});
