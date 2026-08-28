import { describe, it, expect } from 'vitest';
import { validateLineup } from '../validation';
import { buildEmptyRoster } from '../rosterSlots';
import { DEFAULT_LEAGUE_SETTINGS } from '../../types';
import type { Wager, WeeklyRoster } from '../../types';

function wager(overrides: Partial<Wager> = {}): Wager {
  return {
    id: 'w',
    slotId: 'QB-1',
    gameId: 'g1',
    marketKey: 'player_pass_yds',
    side: 'Over',
    point: 250,
    oddsAtPlacement: -110,
    stake: 12.5,
    placedAt: new Date().toISOString(),
    status: 'pending',
    settledProfit: null,
    ...overrides,
  };
}

function fullyAllocatedRoster(): WeeklyRoster {
  // 8 slots (default DEFAULT_LINEUP_SLOTS) at $100/8 = $12.50 each, across 2 games.
  const roster = buildEmptyRoster('team1', 1, DEFAULT_LEAGUE_SETTINGS.lineupSlots);
  return {
    ...roster,
    slots: roster.slots.map((slot, i) => ({
      ...slot,
      wager: wager({
        id: `w${i}`,
        slotId: slot.slotId,
        gameId: i % 2 === 0 ? 'game-a' : 'game-b',
        marketKey: slot.position === 'ML' ? 'h2h' : 'player_pass_yds',
        side: slot.position === 'ML' ? 'NE' : 'Over',
        point: slot.position === 'ML' ? undefined : 250,
        stake: 12.5,
      }),
    })),
  };
}

describe('validateLineup', () => {
  it('is invalid with empty slots and reports how many are missing', () => {
    const roster = buildEmptyRoster('team1', 1, DEFAULT_LEAGUE_SETTINGS.lineupSlots);
    const result = validateLineup(roster, DEFAULT_LEAGUE_SETTINGS);
    expect(result.valid).toBe(false);
    expect(result.overallReasons.some((r) => r.includes('empty'))).toBe(true);
  });

  it('is valid when every slot is filled, credits exactly allocated, and 2+ games used', () => {
    const result = validateLineup(fullyAllocatedRoster(), DEFAULT_LEAGUE_SETTINGS);
    expect(result.valid).toBe(true);
    expect(result.remaining).toBeCloseTo(0, 5);
    expect(result.distinctGames).toBeGreaterThanOrEqual(2);
  });

  it('rejects a roster using only one game (game diversity rule)', () => {
    const roster = fullyAllocatedRoster();
    roster.slots = roster.slots.map((s) => ({ ...s, wager: s.wager ? { ...s.wager, gameId: 'only-game' } : null }));
    const result = validateLineup(roster, DEFAULT_LEAGUE_SETTINGS);
    expect(result.valid).toBe(false);
    expect(result.overallReasons.some((r) => r.includes('2 different games'))).toBe(true);
  });

  it('flags the same player used in two slots the same week', () => {
    const roster = fullyAllocatedRoster();
    const [first, second] = roster.slots;
    roster.slots[1] = { ...second, wager: { ...first.wager!, id: 'dup', slotId: second.slotId, playerId: 'shared-player' } };
    roster.slots[0] = { ...first, wager: { ...first.wager!, playerId: 'shared-player' } };
    const result = validateLineup(roster, DEFAULT_LEAGUE_SETTINGS);
    expect(result.valid).toBe(false);
    expect(result.overallReasons.some((r) => r.includes('one slot per week'))).toBe(true);
  });

  it('enforces the moneyline max bet override', () => {
    const roster = fullyAllocatedRoster();
    const mlSlot = roster.slots.find((s) => s.position === 'ML')!;
    mlSlot.wager = { ...mlSlot.wager!, stake: DEFAULT_LEAGUE_SETTINGS.maxMLBet + 5 };
    const result = validateLineup(roster, DEFAULT_LEAGUE_SETTINGS);
    const slotResult = result.slotResults.find((s) => s.slotId === mlSlot.slotId);
    expect(slotResult?.valid).toBe(false);
  });

  // manual v0.1.1 §5 C: commissioner-configurable floor above the baseline of 2.
  describe('minGamesPerRoster (manual v0.1.1 §5 C)', () => {
    it('applies the baseline of 2 distinct games when the setting is OFF (null)', () => {
      const roster = fullyAllocatedRoster(); // already spans 2 games
      const result = validateLineup(roster, { ...DEFAULT_LEAGUE_SETTINGS, minGamesPerRoster: null });
      expect(result.overallReasons.some((r) => r.includes('different games'))).toBe(false);
    });

    it('rejects a roster below a raised minimum', () => {
      const roster = fullyAllocatedRoster(); // spans exactly 2 games
      const result = validateLineup(roster, { ...DEFAULT_LEAGUE_SETTINGS, minGamesPerRoster: 3 });
      expect(result.valid).toBe(false);
      expect(result.overallReasons.some((r) => r.includes('at least 3 different games'))).toBe(true);
    });

    it('accepts a roster that meets a raised minimum', () => {
      const roster = fullyAllocatedRoster();
      roster.slots = roster.slots.map((s, i) => ({
        ...s,
        wager: s.wager ? { ...s.wager, gameId: `game-${i % 3}` } : null,
      }));
      const result = validateLineup(roster, { ...DEFAULT_LEAGUE_SETTINGS, minGamesPerRoster: 3 });
      expect(result.overallReasons.some((r) => r.includes('different games'))).toBe(false);
    });
  });

  // manual v0.1.1 §5 B: correlated same-team prop stacking, gated behind the commissioner toggle.
  describe('correlationBlockEnabled (manual v0.1.1 §5 B)', () => {
    it('does not check correlations when the setting is off', () => {
      const roster = fullyAllocatedRoster();
      const [qbSlot, rbSlot] = roster.slots;
      roster.slots[0] = { ...qbSlot, wager: { ...qbSlot.wager!, marketKey: 'player_pass_yds', side: 'Over', playerId: 'NE-drake-maye', gameId: 'game-a' } };
      roster.slots[1] = { ...rbSlot, wager: { ...rbSlot.wager!, marketKey: 'player_reception_yds', side: 'Over', playerId: 'NE-stefon-diggs', gameId: 'game-a' } };
      const result = validateLineup(roster, { ...DEFAULT_LEAGUE_SETTINGS, correlationBlockEnabled: false });
      expect(result.overallReasons.some((r) => r.includes('Correlated picks'))).toBe(false);
    });

    it('flags a roster stacking the default QB pass yds Over + teammate rec yds Over rule', () => {
      const roster = fullyAllocatedRoster();
      const [qbSlot, rbSlot] = roster.slots;
      roster.slots[0] = { ...qbSlot, wager: { ...qbSlot.wager!, marketKey: 'player_pass_yds', side: 'Over', playerId: 'NE-drake-maye', gameId: 'game-a' } };
      roster.slots[1] = { ...rbSlot, wager: { ...rbSlot.wager!, marketKey: 'player_reception_yds', side: 'Over', playerId: 'NE-stefon-diggs', gameId: 'game-a' } };
      const result = validateLineup(roster, { ...DEFAULT_LEAGUE_SETTINGS, correlationBlockEnabled: true });
      expect(result.valid).toBe(false);
      expect(result.overallReasons.some((r) => r.includes('Correlated picks'))).toBe(true);
    });

    it('does not flag a roster with no correlated pairs', () => {
      const result = validateLineup(fullyAllocatedRoster(), { ...DEFAULT_LEAGUE_SETTINGS, correlationBlockEnabled: true });
      expect(result.overallReasons.some((r) => r.includes('Correlated picks'))).toBe(false);
    });

    // manual v0.2.0 §3 #6: correlated-pair violations must mark BOTH involved slots so
    // the Lineup screen can badge each offending card, not just report it in aggregate.
    it('marks both offending slots, not just the aggregate reasons', () => {
      const roster = fullyAllocatedRoster();
      const [qbSlot, rbSlot] = roster.slots;
      roster.slots[0] = { ...qbSlot, wager: { ...qbSlot.wager!, marketKey: 'player_pass_yds', side: 'Over', playerId: 'NE-drake-maye', gameId: 'game-a' } };
      roster.slots[1] = { ...rbSlot, wager: { ...rbSlot.wager!, marketKey: 'player_reception_yds', side: 'Over', playerId: 'NE-stefon-diggs', gameId: 'game-a' } };
      const result = validateLineup(roster, { ...DEFAULT_LEAGUE_SETTINGS, correlationBlockEnabled: true });
      const qbResult = result.slotResults.find((s) => s.slotId === qbSlot.slotId)!;
      const rbResult = result.slotResults.find((s) => s.slotId === rbSlot.slotId)!;
      expect(qbResult.valid).toBe(false);
      expect(rbResult.valid).toBe(false);
      expect(qbResult.reasons.some((r) => r.includes('Correlated'))).toBe(true);
      expect(rbResult.reasons.some((r) => r.includes('Correlated'))).toBe(true);
      // an uninvolved slot stays untouched
      const untouched = result.slotResults.find((s) => s.slotId !== qbSlot.slotId && s.slotId !== rbSlot.slotId)!;
      expect(untouched.reasons.some((r) => r.includes('Correlated'))).toBe(false);
    });
  });

  // manual v0.2.0 §3 #6: the same-player-in-two-slots violation also marks both slots.
  it('marks both slots holding the same duplicated player', () => {
    const roster = fullyAllocatedRoster();
    const [first, second] = roster.slots;
    roster.slots[1] = { ...second, wager: { ...first.wager!, id: 'dup', slotId: second.slotId, playerId: 'shared-player' } };
    roster.slots[0] = { ...first, wager: { ...first.wager!, playerId: 'shared-player' } };
    const result = validateLineup(roster, DEFAULT_LEAGUE_SETTINGS);
    const firstResult = result.slotResults.find((s) => s.slotId === first.slotId)!;
    const secondResult = result.slotResults.find((s) => s.slotId === second.slotId)!;
    expect(firstResult.valid).toBe(false);
    expect(secondResult.valid).toBe(false);
    expect(firstResult.reasons.some((r) => r.includes('used in another slot'))).toBe(true);
    expect(secondResult.reasons.some((r) => r.includes('used in another slot'))).toBe(true);
  });
});
