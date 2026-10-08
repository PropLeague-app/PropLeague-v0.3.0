import { describe, expect, it } from 'vitest';
import type { MarketRule } from '../../types';
import { DEFAULT_CORRELATION_RULES } from '../../types';
import {
  MAX_MARKET_RULES,
  activeMarketRules,
  eligibleSlotCount,
  isBlockRule,
  isRuleMarketAllowed,
  marketBlockReason,
  marketMaxStake,
  marketSlotCapReason,
  maxSlotCapFor,
} from '../marketRules';
import { maxStakeNow, stakeError, type StakeContext } from '../stakeRules';
import { describePendingKeys } from '../settingsRules';

const rule = (r: Partial<MarketRule> & Pick<MarketRule, 'market'>): MarketRule => ({ id: r.market, side: null, maxStake: null, ...r });

describe('market rules', () => {
  it('ignores the list while the toggle is off', () => {
    expect(activeMarketRules({ marketRulesEnabled: false, marketRules: [rule({ market: 'player_anytime_td' })] })).toEqual([]);
    expect(activeMarketRules({})).toEqual([]);
  });

  it('blocks a whole market, or only the chosen side', () => {
    const both = [rule({ market: 'player_anytime_td' })];
    expect(marketBlockReason(both, 'player_anytime_td', 'Yes')).toMatch(/Anytime TD picks are blocked/);
    expect(marketBlockReason(both, 'player_rush_yds', 'Over')).toBeNull();

    const overOnly = [rule({ market: 'player_pass_yds', side: 'Over' })];
    expect(marketBlockReason(overOnly, 'player_pass_yds', 'Over')).toMatch(/Passing Yards Over/);
    expect(marketBlockReason(overOnly, 'player_pass_yds', 'Under')).toBeNull();
    expect(marketBlockReason(overOnly, 'player_pass_yds', 'over')).not.toBeNull();
  });

  it('a stake cap is not a block, and the tightest cap wins', () => {
    const rules = [rule({ market: 'player_receptions', maxStake: 10 }), rule({ id: 'b', market: 'player_receptions', side: 'Over', maxStake: 4 })];
    expect(marketBlockReason(rules, 'player_receptions', 'Over')).toBeNull();
    expect(marketMaxStake(rules, 'player_receptions', 'Over')?.max).toBe(4);
    expect(marketMaxStake(rules, 'player_receptions', 'Under')?.max).toBe(10);
    expect(marketMaxStake(rules, 'player_pass_yds', 'Over')).toBeNull();
  });

  it('the cap feeds the stake rules', () => {
    const ctx: StakeContext = {
      settings: { weeklyCredits: 100, minBetPerSlot: 1, maxMLBet: 15, maxPropBet: null, singleBetCapPct: 0.8, mlBetOverride: null, propBetOverride: null },
      isMLSlot: false,
      otherStakes: 0,
      emptyOtherSlots: 0,
      replacing: false,
      marketMax: { max: 5, label: 'Anytime TD' },
    };
    expect(maxStakeNow(ctx)).toBe(5);
    expect(stakeError(ctx, 5)).toBeNull();
    expect(stakeError(ctx, 6)).toBe('Max stake on Anytime TD is $5.00.');
  });

  it('ignores rules on moneyline, spread and total', () => {
    const rules = [rule({ market: 'h2h' }), rule({ market: 'spreads' }), rule({ market: 'totals' }), rule({ market: 'player_anytime_td' })];
    expect(activeMarketRules({ marketRulesEnabled: true, marketRules: rules }).map((r) => r.market)).toEqual(['player_anytime_td']);
    expect(isRuleMarketAllowed('h2h')).toBe(false);
    expect(isRuleMarketAllowed('player_pass_yds')).toBe(true);
    expect(MAX_MARKET_RULES).toBe(5);
  });

  it('names the pending change once', () => {
    expect(describePendingKeys(['marketRulesEnabled', 'marketRules'])).toBe('market rules');
  });
});

describe('default correlation rules', () => {
  it('ships the two same-team QB rules only', () => {
    expect(DEFAULT_CORRELATION_RULES.map((r) => r.id)).toEqual(['qb-pass-yds-teammate-rec-yds', 'qb-pass-tds-teammate-anytime-td']);
  });
});

describe('market slot caps', () => {
  const slots = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, ML: 1 };

  it('counts the slots a market can fill from the league slot counts', () => {
    expect(eligibleSlotCount('player_reception_yds', slots)).toBe(5); // 2 RB + 2 WR + 1 TE
    expect(eligibleSlotCount('player_anytime_td', slots)).toBe(6); // everything but K and ML
    expect(eligibleSlotCount('player_pass_interceptions', slots)).toBe(1);
    expect(eligibleSlotCount('player_pass_interceptions', { ...slots, QB: 2 })).toBe(2);
    expect(eligibleSlotCount('player_field_goals', slots)).toBe(1);
  });

  it('offers a slot cap only when there is more than one slot to share, topping out one below the total', () => {
    expect(maxSlotCapFor(5)).toBe(4);
    expect(maxSlotCapFor(2)).toBe(1);
    expect(maxSlotCapFor(1)).toBe(0);
    expect(maxSlotCapFor(0)).toBe(0);
  });

  it('a slot cap or a stake cap makes a limit, only an empty rule is a block', () => {
    expect(isBlockRule({ maxStake: null })).toBe(true);
    expect(isBlockRule({ maxStake: null, maxSlots: null })).toBe(true);
    expect(isBlockRule({ maxStake: null, maxSlots: 2 })).toBe(false);
    expect(isBlockRule({ maxStake: 5, maxSlots: null })).toBe(false);
    expect(marketBlockReason([rule({ market: 'player_receptions', maxSlots: 2 })], 'player_receptions', 'Over')).toBeNull();
  });

  it('blocks a pick once the allowed slots are used by other slots', () => {
    const rules = [rule({ market: 'player_reception_yds', maxSlots: 2 })];
    const pick = (marketKey: string, side = 'Over') => ({ marketKey, side });
    expect(marketSlotCapReason(rules, 'player_reception_yds', 'Over', [pick('player_reception_yds')])).toBeNull();
    expect(marketSlotCapReason(rules, 'player_reception_yds', 'Over', [pick('player_reception_yds'), pick('player_reception_yds', 'Under')])).toMatch(
      /Only 2 of your slots can use Receiving Yards/,
    );
    expect(marketSlotCapReason(rules, 'player_receptions', 'Over', [pick('player_reception_yds'), pick('player_reception_yds')])).toBeNull();
  });

  it('a side-specific cap only counts that side', () => {
    const rules = [rule({ market: 'player_pass_yds', side: 'Over', maxSlots: 1 })];
    const picks = [{ marketKey: 'player_pass_yds', side: 'Under' }];
    expect(marketSlotCapReason(rules, 'player_pass_yds', 'Over', picks)).toBeNull();
    expect(marketSlotCapReason(rules, 'player_pass_yds', 'Over', [{ marketKey: 'player_pass_yds', side: 'Over' }])).toMatch(/Passing Yards Over/);
    expect(marketSlotCapReason(rules, 'player_pass_yds', 'Under', [{ marketKey: 'player_pass_yds', side: 'Over' }])).toBeNull();
  });

  it('works with a stake cap on the same rule', () => {
    const rules = [rule({ market: 'player_receptions', maxStake: 4, maxSlots: 1 })];
    expect(marketMaxStake(rules, 'player_receptions', 'Over')?.max).toBe(4);
    expect(marketSlotCapReason(rules, 'player_receptions', 'Over', [{ marketKey: 'player_receptions', side: 'Over' }])).not.toBeNull();
  });
});
