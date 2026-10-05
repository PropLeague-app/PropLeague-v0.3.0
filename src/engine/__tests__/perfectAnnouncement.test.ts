import { describe, it, expect } from 'vitest';
import { encodePerfectWeek, parsePerfectWeek } from '../perfectAnnouncement';

const post = { weekLabel: 'Week 5', teamName: "Blunter's Boys", record: '6-0-1', pl: '+$42.30', teamId: 'abc-123' };

describe('perfect week post', () => {
  it('round-trips', () => {
    expect(parsePerfectWeek(encodePerfectWeek(post))).toEqual(post);
  });
  it('keeps a readable sentence in front for older builds', () => {
    expect(encodePerfectWeek(post).startsWith("🔥 **Blunter's Boys** had a perfect week in **Week 5**. 6-0-1, +$42.30")).toBe(true);
  });
  it('strips markup characters from the team name', () => {
    const p = parsePerfectWeek(encodePerfectWeek({ ...post, teamName: 'A*B|C' }));
    expect(p?.teamName).toBe('ABC');
  });
  it('returns null for an ordinary announcement', () => {
    expect(parsePerfectWeek('Welcome to the league')).toBeNull();
  });
});
