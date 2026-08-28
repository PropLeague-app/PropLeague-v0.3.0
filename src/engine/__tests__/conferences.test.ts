import { describe, it, expect } from 'vitest';
import { conferencesEligible, assignConferencesRandomly, defaultConferences, conferencesBalanced } from '../conferences';
import { createRng } from '../random';

describe('conferencesEligible', () => {
  it('requires an even team count of at least 4 (manual §3.1)', () => {
    expect(conferencesEligible(8)).toBe(true);
    expect(conferencesEligible(10)).toBe(true);
    expect(conferencesEligible(7)).toBe(false);
    expect(conferencesEligible(2)).toBe(false);
  });
});

describe('assignConferencesRandomly', () => {
  it('splits teams across conferences with sizes differing by at most 1', () => {
    const teamIds = Array.from({ length: 10 }, (_, i) => `t${i}`);
    const conferences = defaultConferences(2);
    const assignment = assignConferencesRandomly(teamIds, conferences, createRng('seed'));
    const counts = conferences.map((c) => Object.values(assignment).filter((id) => id === c.id).length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(10);
  });

  it('assigns every team to one of the configured conferences', () => {
    const teamIds = ['a', 'b', 'c', 'd'];
    const conferences = defaultConferences(2);
    const assignment = assignConferencesRandomly(teamIds, conferences, createRng('seed2'));
    for (const id of teamIds) {
      expect(conferences.map((c) => c.id)).toContain(assignment[id]);
    }
  });
});

// manual v0.2.1 §4 #4: nothing should let a commissioner drift the conferences out of
// balance (in the extreme, everyone landing in one conference) — this is the engine-
// level guard a bulk reassignment must pass before it's allowed to commit.
describe('conferencesBalanced', () => {
  it('is true when every conference has the same team count', () => {
    const conferences = defaultConferences(2);
    const teams = [
      { conferenceId: 'A' }, { conferenceId: 'A' }, { conferenceId: 'A' },
      { conferenceId: 'B' }, { conferenceId: 'B' }, { conferenceId: 'B' },
    ];
    expect(conferencesBalanced(teams, conferences)).toBe(true);
  });

  it('is false when one conference has more teams than another', () => {
    const conferences = defaultConferences(2);
    const teams = [
      { conferenceId: 'A' }, { conferenceId: 'A' }, { conferenceId: 'A' }, { conferenceId: 'A' },
      { conferenceId: 'B' }, { conferenceId: 'B' },
    ];
    expect(conferencesBalanced(teams, conferences)).toBe(false);
  });

  it('is false when every team ends up in a single conference', () => {
    const conferences = defaultConferences(2);
    const teams = Array.from({ length: 6 }, () => ({ conferenceId: 'A' }));
    expect(conferencesBalanced(teams, conferences)).toBe(false);
  });

  it('is true when there are no conferences defined (nothing to unbalance)', () => {
    expect(conferencesBalanced([{ conferenceId: null }], [])).toBe(true);
  });

  it('checks all 4 conferences equally for a 4-conference league', () => {
    const conferences = defaultConferences(4);
    const balanced = [
      { conferenceId: 'A' }, { conferenceId: 'A' },
      { conferenceId: 'B' }, { conferenceId: 'B' },
      { conferenceId: 'C' }, { conferenceId: 'C' },
      { conferenceId: 'D' }, { conferenceId: 'D' },
    ];
    expect(conferencesBalanced(balanced, conferences)).toBe(true);
    const unbalanced = [...balanced.slice(0, 7), { conferenceId: 'A' }]; // now A has 3, D has 1
    expect(conferencesBalanced(unbalanced, conferences)).toBe(false);
  });
});
