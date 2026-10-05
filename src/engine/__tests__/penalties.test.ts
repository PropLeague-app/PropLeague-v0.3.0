import { describe, it, expect } from 'vitest';
import { DEFAULT_LEAGUE_SETTINGS } from '../../types';
import type { LeagueSettings, MarketKey, WagerStatus, WeeklyRoster } from '../../types';
import { checkRosterRules, effectiveEmptyFloor, playerTeamFromId, rosterPenalties } from '../penalties';
import { computeIncompleteLineupPenalty, computeWeeklyScore } from '../scoring';
import { isPerfectWeek } from '../perfectWeek';

const base: LeagueSettings = {
  ...DEFAULT_LEAGUE_SETTINGS,
  weeklyCredits: 100,
  lineupSlots: { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, ML: 1 } as LeagueSettings['lineupSlots'],
  minGamesPerRoster: null,
};
const withPen = (o: Partial<LeagueSettings>): LeagueSettings => ({ ...base, ...o });

interface E {
  stake: number;
  game?: string;
  player?: string;
  market?: MarketKey;
  side?: string;
  status?: WagerStatus;
  profit?: number;
}
function roster(entries: (E | null)[], submitted = true): WeeklyRoster {
  return {
    week: 4,
    teamId: 't',
    submitted,
    slots: entries.map((e, i) => ({
      slotId: `S-${i}`,
      position: 'WR' as const,
      wager: e
        ? {
            id: `w${i}`,
            slotId: `S-${i}`,
            gameId: e.game ?? `g${i}`,
            marketKey: e.market ?? ('player_reception_yds' as MarketKey),
            playerId: e.player ?? `KC-p${i}`,
            playerName: e.player ?? `P${i}`,
            side: e.side ?? 'Over',
            oddsAtPlacement: -110,
            stake: e.stake,
            placedAt: `2026-10-0${i + 1}`,
            status: e.status ?? 'won',
            settledProfit: e.profit ?? (e.status === 'lost' ? -e.stake : e.stake * 0.9),
          }
        : null,
    })),
  };
}
const six = (o: Partial<E>[] = []) => Array.from({ length: 6 }, (_, i) => ({ stake: 100 / 6, ...o[i] }));

describe('empty slot floor', () => {
  it('is Off by default: only unspent credits are lost', () => {
    const r = roster([{ stake: 40 }, null, null, null, null, null]);
    expect(computeIncompleteLineupPenalty(r, base)).toBeCloseTo(-60);
  });
  it('raises a small loss to the floor per empty slot', () => {
    // 5 empty slots, $2 unspent, floor $10 each -> -50
    const r = roster([{ stake: 98 }, null, null, null, null, null]);
    expect(computeIncompleteLineupPenalty(r, withPen({ emptySlotFloor: 10 }))).toBeCloseTo(-50);
  });
  it('never takes less than the unspent credits', () => {
    const r = roster([{ stake: 10 }, null, null, null, null, null]);
    expect(computeIncompleteLineupPenalty(r, withPen({ emptySlotFloor: 5 }))).toBeCloseTo(-90);
  });
  it('is capped at credits split across slots', () => {
    expect(effectiveEmptyFloor(withPen({ emptySlotFloor: 500 }))).toBeCloseTo(100 / 6);
    expect(effectiveEmptyFloor(base)).toBeNull();
  });
});

describe('invalid roster rules', () => {
  const pen = withPen({ invalidRosterPenaltyEnabled: true, invalidRosterFee: 5 });
  it('does nothing when off', () => {
    const r = roster(six([{ player: 'KC-a' }, { player: 'KC-a' }]));
    expect(rosterPenalties(r, base).invalidSlotIds.size).toBe(0);
  });
  it('voids the later duplicate of a player and charges the fee once', () => {
    const r = roster(six([{ player: 'KC-a' }, { player: 'KC-a' }]));
    const p = rosterPenalties(r, pen);
    expect([...p.invalidSlotIds]).toEqual(['S-1']);
    expect(p.fee).toBe(5);
    expect(p.invalidStakeLost).toBeCloseTo(100 / 6);
  });
  it('scores a voided pick as a lost stake even if it won', () => {
    const clean = computeWeeklyScore(roster(six()), pen);
    const dup = computeWeeklyScore(roster(six([{ player: 'KC-a' }, { player: 'KC-a' }])), pen);
    const stake = 100 / 6;
    // one pick flips from +0.9*stake to -stake, and the fee comes off
    expect(dup).toBeCloseTo(clean - 0.9 * stake - stake - 5);
  });
  it('too few games pays the fee but voids nothing', () => {
    const r = roster(six([{ game: 'g' }, { game: 'g' }, { game: 'g' }, { game: 'g' }, { game: 'g' }, { game: 'g' }]));
    const c = checkRosterRules(
      r.slots.map((s) => ({ slotId: s.slotId, gameId: s.wager!.gameId, marketKey: s.wager!.marketKey, side: s.wager!.side, playerId: s.wager!.playerId, stake: s.wager!.stake, placedAt: s.wager!.placedAt })),
      pen,
    );
    expect(c.tooFewGames).toBe(true);
    expect(c.invalidSlotIds).toEqual([]);
    expect(rosterPenalties(r, pen).fee).toBe(5);
  });
  it('voids the later pick of a correlated pair when that rule is on', () => {
    const rules = [{ id: 'r', label: 'QB over + WR over', marketA: 'player_pass_yds', sideA: 'Over', marketB: 'player_reception_yds', sideB: 'Over', scope: 'same-team' }] as LeagueSettings['correlationRules'];
    const r = roster(six([{ market: 'player_pass_yds', player: 'KC-qb' }, { player: 'KC-wr' }]));
    const on = withPen({ invalidRosterPenaltyEnabled: true, correlationBlockEnabled: true, correlationRules: rules });
    expect(rosterPenalties(r, on).invalidSlotIds.size).toBeGreaterThan(0);
    expect(rosterPenalties(r, withPen({ invalidRosterPenaltyEnabled: true, correlationBlockEnabled: false, correlationRules: rules })).invalidSlotIds.size).toBe(0);
  });
  it('a penalized roster is not a perfect week', () => {
    const r = roster(six([{ player: 'KC-a' }, { player: 'KC-a' }]));
    expect(isPerfectWeek(r, base, true)).toBe(true);
    expect(isPerfectWeek(r, pen, true)).toBe(false);
  });
});

describe('playerTeamFromId', () => {
  it('reads the team from the id prefix', () => {
    expect(playerTeamFromId('KC-rashee-rice')).toBe('KC');
    expect(playerTeamFromId('weird')).toBeUndefined();
  });
});
