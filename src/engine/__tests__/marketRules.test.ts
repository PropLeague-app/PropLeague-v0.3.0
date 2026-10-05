import { describe, expect, it } from 'vitest';
import type { MarketRule } from '../../types';
import { DEFAULT_CORRELATION_RULES } from '../../types';
import { MAX_MARKET_RULES, activeMarketRules, isRuleMarketAllowed, marketBlockReason, marketMaxStake } from '../marketRules';
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
