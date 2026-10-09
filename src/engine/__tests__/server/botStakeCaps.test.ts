import { describe, it, expect } from 'vitest';
import * as clientRules from '../../marketRules';
import * as srvRules from '../../../../supabase/functions/_shared/marketRules';
import { applyStakeCaps } from '../../../../supabase/functions/_shared/autoLineupReal';

const settings = { marketRulesEnabled: true, marketRules: [
  { id: 'a', market: 'player_reception_yds', side: null, maxStake: 10, maxSlots: 2 },
  { id: 'b', market: 'player_rush_yds', side: 'Over', maxStake: 5 },
  { id: 'c', market: 'player_receptions', side: null, maxStake: null },
] };

describe('bot stake caps', () => {
  it('reads stake caps (alone or with a slot cap) and ignores blocks', () => {
    expect(srvRules.stakeCapRules(settings).map((r) => r.market)).toEqual(['player_reception_yds', 'player_rush_yds']);
    expect(srvRules.stakeCapRules({ ...settings, marketRulesEnabled: false })).toEqual([]);
    expect(srvRules.stakeCapRules(null)).toEqual([]);
  });

  it('agrees with the client on the tightest cap for a pick', () => {
    const srv = srvRules.stakeCapRules(settings);
    const clientList = settings.marketRules as never[];
    for (const [m, side] of [['player_reception_yds', 'Over'], ['player_rush_yds', 'Over'], ['player_rush_yds', 'Under'], ['player_receptions', 'Over']]) {
      const c = clientRules.marketMaxStake(clientList, m, side);
      expect(srvRules.stakeCapFor(srv, m, side)).toBe(c ? c.max : null);
    }
  });

  const league = { weeklyCredits: 100, lineupSlots: { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, ML: 1 }, minBetPerSlot: 1, maxMLBet: 50, singleBetCapPct: 0.5 };
  const w = (marketKey: string, stake: number) => ({ id: 'x', slotId: 's', gameId: 'g', marketKey, side: 'Over', oddsAtPlacement: -110, stake, placedAt: '', status: 'pending', settledProfit: null });

  it('brings a capped pick down and spreads the difference to the others, never overspending', () => {
    const wagers = [w('player_rush_yds', 16), w('player_pass_yds', 16), w('player_receptions', 16), w('player_anytime_td', 16), w('player_kicking_points', 16), w('h2h', 20)];
    const srv = srvRules.stakeCapRules(settings);
    const before = wagers.reduce((s, x) => s + x.stake, 0);
    applyStakeCaps(wagers as never, [], league as never, 5, (m, side) => srvRules.stakeCapFor(srv, m, side));
    expect(wagers[0].stake).toBe(5);
    const after = wagers.reduce((s, x) => s + x.stake, 0);
    expect(after).toBeLessThanOrEqual(before + 1e-9);
    expect(after).toBeGreaterThan(before - 0.1);
  });

  it('never goes below the league minimum bet, even if the cap is lower', () => {
    const wagers = [w('player_rush_yds', 16)];
    applyStakeCaps(wagers as never, [], { ...league, minBetPerSlot: 8 } as never, -1, () => 3);
    expect(wagers[0].stake).toBe(8);
  });

  it('does nothing when no cap applies', () => {
    const wagers = [w('player_pass_yds', 16)];
    applyStakeCaps(wagers as never, [], league as never, -1, () => null);
    expect(wagers[0].stake).toBe(16);
  });
});
