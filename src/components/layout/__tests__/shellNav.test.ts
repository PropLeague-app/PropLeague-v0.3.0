import { describe, expect, it } from 'vitest';
import { inTabSection, noteShellLocation, resetTabMemory, tabReopenPath } from '../shellNav';

describe('shellNav tab memory', () => {
  it('groups a game under NFL Slate and a matchup under League Home', () => {
    expect(inTabSection('/slate', '/slate/game/abc')).toBe(true);
    expect(inTabSection('/home', '/matchup/m1')).toBe(true);
    expect(inTabSection('/home', '/standings')).toBe(false);
    expect(inTabSection('/lineup', '/lineup/market/s1')).toBe(true);
  });

  it('reopens the last game until the tab is reset', () => {
    noteShellLocation('/slate/game/abc', 'L1');
    noteShellLocation('/lineup', 'L1');
    expect(tabReopenPath('/slate', 'L1')).toBe('/slate/game/abc');
    noteShellLocation('/slate', 'L1');
    expect(tabReopenPath('/slate', 'L1')).toBe('/slate');
    noteShellLocation('/slate/game/xyz', 'L1');
    resetTabMemory('/slate');
    expect(tabReopenPath('/slate', 'L1')).toBe('/slate');
  });

  it('reopens a matchup only in the league it belongs to', () => {
    // Walked there from League Home, which is what makes it that tab's memory.
    noteShellLocation('/home', 'L1');
    noteShellLocation('/matchup/m1', 'L1');
    noteShellLocation('/standings', 'L1');
    expect(tabReopenPath('/home', 'L1')).toBe('/matchup/m1');
    expect(tabReopenPath('/home', 'L2')).toBe('/home');
    resetTabMemory('/home');
    expect(tabReopenPath('/home', 'L1')).toBe('/home');
  });

  // A matchup opened from a profile is a detour, not a place League Home has been. Recording it
  // sent that tab somewhere its own screen never went (see chat, Oct 2026).
  it('a matchup opened from a profile does not become League Home memory', () => {
    noteShellLocation('/home', 'L1');
    resetTabMemory('/home');
    noteShellLocation('/profile', 'L1');
    noteShellLocation('/matchup/m9', 'L1');
    expect(tabReopenPath('/home', 'L1')).toBe('/home');
  });
});
