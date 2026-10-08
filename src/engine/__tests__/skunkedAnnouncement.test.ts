import { describe, it, expect } from 'vitest';
import { encodeSkunkedWeek, parseSkunkedWeek } from '../skunkedAnnouncement';
import { parsePerfectWeek } from '../perfectAnnouncement';

const post = { weekLabel: 'Week 5', teamName: "Blunter's Boys", record: '0-6', pl: '-$100.00', teamId: 'abc-123' };

describe('skunked week post', () => {
  it('round-trips', () => {
    expect(parseSkunkedWeek(encodeSkunkedWeek(post))).toEqual(post);
  });
  it('keeps a readable sentence in front for older builds', () => {
    expect(encodeSkunkedWeek(post).startsWith("🦨 **Blunter's Boys** got skunked in **Week 5**. 0-6, -$100.00")).toBe(true);
  });
  it('strips markup characters and tags from the team name', () => {
    const p = parseSkunkedWeek(encodeSkunkedWeek({ ...post, teamName: 'A*B|C::sk::D::pw::E' }));
    expect(p?.teamName).toBe('ABCDE');
  });
  it('returns null for an ordinary announcement, and is never mistaken for a perfect week', () => {
    expect(parseSkunkedWeek('Welcome to the league')).toBeNull();
    expect(parsePerfectWeek(encodeSkunkedWeek(post))).toBeNull();
  });
});
