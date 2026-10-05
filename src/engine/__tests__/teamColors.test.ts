import { describe, it, expect } from 'vitest';
import { contrastRatio, nflTeamFromPlayerId, readableOnCard, teamAccent } from '../teamColors';

describe('team colors', () => {
  it('lightens a near-black team color on the dark theme until it is readable', () => {
    const out = readableOnCard('#000000', 'dark');
    expect(contrastRatio(out.color, '#1e2a3d')).toBeGreaterThanOrEqual(3.5);
    expect(out.amount).toBeGreaterThan(0);
  });
  it('darkens a pale team color on the light theme', () => {
    const out = readableOnCard('#FFB612', 'light');
    expect(contrastRatio(out.color, '#fbfcfe')).toBeGreaterThanOrEqual(3.5);
  });
  it('leaves an already readable color alone', () => {
    expect(readableOnCard('#FB4F14', 'dark').amount).toBe(0);
  });
  it('every team clears the contrast target on both themes', () => {
    for (const abbrev of ['KC', 'LV', 'PIT', 'NO', 'CLE', 'SEA', 'NE', 'DAL']) {
      for (const mode of ['dark', 'light'] as const) {
        const c = teamAccent(abbrev, mode);
        expect(c).not.toBeNull();
        expect(contrastRatio(c!, mode === 'dark' ? '#1e2a3d' : '#fbfcfe')).toBeGreaterThanOrEqual(3.5);
      }
    }
  });
  it('returns null for an unknown team and reads codes from player ids', () => {
    expect(teamAccent('ZZZ', 'dark')).toBeNull();
    expect(teamAccent(null, 'dark')).toBeNull();
    expect(nflTeamFromPlayerId('KC-rashee-rice')).toBe('KC');
    expect(nflTeamFromPlayerId('abcd-x')).toBeNull();
    expect(nflTeamFromPlayerId(null)).toBeNull();
  });
});
