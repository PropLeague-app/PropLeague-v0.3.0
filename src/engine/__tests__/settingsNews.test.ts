import { describe, expect, it } from 'vitest';
import { DEFAULT_LEAGUE_SETTINGS, type LeagueSettings } from '../../types';
import { majorSettingsChanges, settingsNewsMessage } from '../settingsNews';

const base: LeagueSettings = { ...DEFAULT_LEAGUE_SETTINGS, buyInEnabled: true, buyInAmount: 20 };

describe('settings news', () => {
  it('lists major changes briefly and skips minor ones', () => {
    const after: LeagueSettings = {
      ...base,
      maxPropBet: 25,
      waiverMode: base.waiverMode === 'first_come' ? 'waiver' : 'first_come',
      wagerPrecision: base.wagerPrecision,
      marketRulesEnabled: true,
      marketRules: [{ id: 'r1', market: 'player_anytime_td', side: null, maxStake: null }],
      poolMultipliers: { ...base.poolMultipliers, enabled: true, spread: 1 },
    } as LeagueSettings;
    const changes = majorSettingsChanges(base, after);
    expect(changes).toContain('Max prop bet No max → $25');
    expect(changes.some((c) => c.endsWith('blocked'))).toBe(true);
    expect(changes).toContain('Standing multipliers on (1.50x/0.50x)');
    expect(changes.some((c) => /order|waiver/i.test(c))).toBe(false);
  });

  it('builds one short line, split into now and next week', () => {
    expect(settingsNewsMessage(['Buy-in $20 → $50'], ['Max prop bet No max → $25'], 'Week 6')).toBe(
      '⚙️ Commissioner update: Buy-in $20 → $50. From Week 6: Max prop bet No max → $25.',
    );
    expect(settingsNewsMessage([], [], 'Week 6')).toBeNull();
  });
});
