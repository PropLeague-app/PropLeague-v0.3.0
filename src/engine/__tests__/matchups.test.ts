import { describe, it, expect } from 'vitest';
import { generateMatchupSchedule, generateConferenceWeightedSchedule } from '../matchups';

describe('generateMatchupSchedule', () => {
  it('gives every team exactly one game per week', () => {
    const teamIds = Array.from({ length: 8 }, (_, i) => `t${i}`);
    const schedule = generateMatchupSchedule(teamIds, 6);
    for (let week = 1; week <= 6; week++) {
      const teamsThisWeek = schedule[week].flat();
      expect(new Set(teamsThisWeek).size).toBe(teamIds.length);
    }
  });

  it('handles an odd team count with a bye (one fewer game that week)', () => {
    const teamIds = Array.from({ length: 5 }, (_, i) => `t${i}`);
    const schedule = generateMatchupSchedule(teamIds, 4);
    expect(schedule[1].length).toBe(2); // 5 teams -> 2 games + 1 bye
  });
});

describe('generateConferenceWeightedSchedule', () => {
  it('targets roughly a 2:1 in-conference:cross-conference game ratio', () => {
    const teamIds = Array.from({ length: 8 }, (_, i) => `t${i}`);
    const conferenceOf: Record<string, string> = {};
    teamIds.forEach((id, i) => (conferenceOf[id] = i < 4 ? 'A' : 'B'));
    const schedule = generateConferenceWeightedSchedule(teamIds, conferenceOf, 18, 'test-seed');

    let inConf = 0;
    let cross = 0;
    for (const pairings of Object.values(schedule)) {
      for (const [a, b] of pairings) {
        if (conferenceOf[a] === conferenceOf[b]) inConf++;
        else cross++;
      }
    }
    const ratio = inConf / cross;
    expect(ratio).toBeGreaterThan(1.7);
    expect(ratio).toBeLessThan(2.3);
  });

  it('still gives every team exactly one game per week', () => {
    const teamIds = Array.from({ length: 10 }, (_, i) => `t${i}`);
    const conferenceOf: Record<string, string> = {};
    teamIds.forEach((id, i) => (conferenceOf[id] = i % 2 === 0 ? 'A' : 'B')); // uneven 5/5 split
    const schedule = generateConferenceWeightedSchedule(teamIds, conferenceOf, 10, 'test-seed-2');
    for (const pairings of Object.values(schedule)) {
      const teamsThisWeek = pairings.flat();
      expect(new Set(teamsThisWeek).size).toBe(teamIds.length);
    }
  });

  it('is deterministic for a given seed', () => {
    const teamIds = Array.from({ length: 6 }, (_, i) => `t${i}`);
    const conferenceOf: Record<string, string> = {};
    teamIds.forEach((id, i) => (conferenceOf[id] = i < 3 ? 'A' : 'B'));
    const a = generateConferenceWeightedSchedule(teamIds, conferenceOf, 8, 'same-seed');
    const b = generateConferenceWeightedSchedule(teamIds, conferenceOf, 8, 'same-seed');
    expect(a).toEqual(b);
  });
});
