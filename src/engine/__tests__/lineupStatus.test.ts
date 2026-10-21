import { describe, it, expect } from 'vitest';
import { lineupStatus, validateLineup } from '../validation';
import { buildEmptyRoster } from '../rosterSlots';
import { lineupUpside } from '../scoring';
import { profitForStake } from '../oddsMath';
import { DEFAULT_LEAGUE_SETTINGS } from '../../types';
import type { LeagueSettings, Wager, WeeklyRoster } from '../../types';

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

/** 8 slots at $12.50 = the full $100, spread over two games. */
function fullRoster(): WeeklyRoster {
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

function statusOf(roster: WeeklyRoster, settings: LeagueSettings = DEFAULT_LEAGUE_SETTINGS) {
  return lineupStatus(roster, settings, validateLineup(roster, settings));
}

describe('lineupStatus', () => {
  it('reads as unfinished, not broken, on an untouched lineup', () => {
    const roster = buildEmptyRoster('team1', 1, DEFAULT_LEAGUE_SETTINGS.lineupSlots);
    const status = statusOf(roster);
    expect(status.state).toBe('incomplete');
    expect(status.mark).toBe('!');
    // Nothing is wrong, so there is nothing to say. The bar's own 0/8 carries the rest.
    expect(status.note).toBe('');
  });

  it('stays unfinished while both slots and credits are still open', () => {
    const roster = fullRoster();
    roster.slots = roster.slots.map((s, i) => (i < 4 ? { ...s, wager: null } : s));
    const status = statusOf(roster);
    expect(status.state).toBe('incomplete');
    expect(status.note).toBe('');
  });

  it('is ready when full, in budget and legal', () => {
    const status = statusOf(fullRoster());
    expect(status.state).toBe('ready');
    expect(status.mark).toBe('✓');
    expect(status.note).toBe('');
  });

  // The two shapes that separate blocked from incomplete: one axis finished, the other not. In
  // both, carrying on cannot reach a legal lineup, so something already placed has to change.
  it('blocks when every slot is filled but credits are left over', () => {
    const roster = fullRoster();
    roster.slots = roster.slots.map((s) => ({ ...s, wager: { ...s.wager!, stake: 10 } }));
    const status = statusOf(roster);
    expect(status.state).toBe('blocked');
    expect(status.mark).toBe('✕');
    expect(status.note).toBe('Every slot filled, $20.00 unspent');
  });

  it('blocks when every credit is spent but slots are still empty', () => {
    const roster = fullRoster();
    // Six picks carrying the whole $100 (the moneyline slot capped at its own $15 max), two slots
    // left with nothing to spend on them.
    roster.slots = roster.slots.map((s, i) => {
      if (i < 2) return { ...s, wager: null };
      return { ...s, wager: { ...s.wager!, stake: s.position === 'ML' ? 15 : 17 } };
    });
    const status = statusOf(roster);
    expect(status.state).toBe('blocked');
    expect(status.note).toBe('All $100.00 allocated, 2 slots still empty');
  });

  it('blocks when over budget', () => {
    const roster = fullRoster();
    roster.slots = roster.slots.map((s) => ({ ...s, wager: { ...s.wager!, stake: 15 } }));
    const status = statusOf(roster);
    expect(status.state).toBe('blocked');
    expect(status.note).toBe('$20.00 over budget');
  });

  it('blocks on a broken slot rule and quotes the rule, not the budget', () => {
    // One stake under the per-slot minimum, with the difference moved onto another slot so the
    // budget itself still balances. The only thing wrong is the rule.
    const roster = fullRoster();
    const min = DEFAULT_LEAGUE_SETTINGS.minBetPerSlot;
    roster.slots = roster.slots.map((s, i) => {
      if (i === 0) return { ...s, wager: { ...s.wager!, stake: min / 2 } };
      if (i === 1) return { ...s, wager: { ...s.wager!, stake: 12.5 + min / 2 } };
      return s;
    });
    const status = statusOf(roster);
    expect(status.state).toBe('blocked');
    expect(status.note).toContain('minimum');
  });

  it('blocks on too few games only when the commissioner raised the floor', () => {
    const roster = fullRoster();
    roster.slots = roster.slots.map((s) => ({ ...s, wager: { ...s.wager!, gameId: 'one-game' } }));
    expect(statusOf(roster).state).toBe('ready');
    const strict = { ...DEFAULT_LEAGUE_SETTINGS, minGamesPerRoster: 3 };
    const status = statusOf(roster, strict);
    expect(status.state).toBe('blocked');
    expect(status.note).toBe('Needs picks from 3+ different games');
  });

  // The waiver this status drives: `computeIncompleteLineupPenalty` forgives unspent credits on a
  // submitted roster with no empty slots. Ready requires the credits to be exactly spent, so there
  // is never anything left to forgive, which is why auto-marking changes no scoring outcome.
  it('never reaches ready with credits unspent', () => {
    const roster = fullRoster();
    for (const stake of [10, 11, 12, 13, 15]) {
      roster.slots = roster.slots.map((s) => ({ ...s, wager: { ...s.wager!, stake } }));
      const status = statusOf(roster);
      if (status.state === 'ready') expect(stake * 8).toBeCloseTo(DEFAULT_LEAGUE_SETTINGS.weeklyCredits, 5);
    }
  });

  it('singularises one empty slot', () => {
    const roster = fullRoster();
    roster.slots = roster.slots.map((s, i) => (i === 0 ? { ...s, wager: null } : { ...s, wager: { ...s.wager!, stake: 100 / 7 } }));
    expect(statusOf(roster).note).toBe('All $100.00 allocated, 1 slot still empty');
  });
});

describe('lineupUpside', () => {
  it('is the profit of every live pick at the odds it was taken', () => {
    const roster = fullRoster();
    // Eight $12.50 picks at -110 pay $11.36 each if they land.
    expect(lineupUpside(roster)).toBeCloseTo(8 * profitForStake(12.5, -110), 5);
  });

  it('counts a settled pick at what it actually returned, not at what it could have', () => {
    const roster = fullRoster();
    roster.slots = roster.slots.map((s, i) =>
      i === 0
        ? { ...s, wager: { ...s.wager!, status: 'lost' as const, settledProfit: -12.5 } }
        : i === 1
          ? { ...s, wager: { ...s.wager!, status: 'won' as const, settledProfit: 11.36 } }
          : s,
    );
    // The loss drags the ceiling down; the win is locked in at its real figure.
    expect(lineupUpside(roster)).toBeCloseTo(-12.5 + 11.36 + 6 * profitForStake(12.5, -110), 5);
  });

  it('is zero on an empty lineup', () => {
    expect(lineupUpside(buildEmptyRoster('team1', 1, DEFAULT_LEAGUE_SETTINGS.lineupSlots))).toBe(0);
  });
});
