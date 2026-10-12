import { describe, it, expect } from 'vitest';
import { parseRichText, pinnedAnnouncementCount } from '../richText';

describe('parseRichText', () => {
  it('returns plain text untouched', () => {
    expect(parseRichText('Hello league')).toEqual([{ text: 'Hello league', style: 'plain' }]);
  });
  it('parses the void notice shape, with the commissioner note in italics', () => {
    // The tail is the note the commissioner typed (migration 0039), not a fixed line.
    const segs = parseRichText('All **Rashee Rice** picks for Week 4 have been **voided** due to an early exit (injury). *Left in the first quarter, did not return.*');
    expect(segs.filter((s) => s.style === 'highlight').map((s) => s.text)).toEqual(['Rashee Rice', 'voided']);
    expect(segs.filter((s) => s.style === 'italic').map((s) => s.text)).toEqual(['Left in the first quarter, did not return.']);
    expect(segs.map((s) => s.text).join('')).toBe('All Rashee Rice picks for Week 4 have been voided due to an early exit (injury). Left in the first quarter, did not return.');
  });
  it('parses the same notice with no note at all', () => {
    const segs = parseRichText('All **Rashee Rice** picks for Week 4 have been **voided** due to an early exit (injury).');
    expect(segs.filter((s) => s.style === 'highlight').map((s) => s.text)).toEqual(['Rashee Rice', 'voided']);
    expect(segs.filter((s) => s.style === 'italic')).toEqual([]);
  });
  it('reads a team tag off a highlight', () => {
    const segs = parseRichText('All **Rashee Rice|KC** picks have been **voided**.');
    expect(segs[1]).toEqual({ text: 'Rashee Rice', style: 'highlight', team: 'KC' });
    expect(segs[3]).toEqual({ text: 'voided', style: 'highlight' });
  });
  it('leaves unmatched asterisks as literal text', () => {
    expect(parseRichText('5 * 3 = 15')).toEqual([{ text: '5 * 3 = 15', style: 'plain' }]);
    expect(parseRichText('**open')).toEqual([{ text: '**open', style: 'plain' }]);
  });
});

describe('pinnedAnnouncementCount', () => {
  it('counts only pinned announcements', () => {
    expect(
      pinnedAnnouncementCount([
        { type: 'announcement', pinned: true },
        { type: 'announcement' },
        { type: 'moment', pinned: true },
        { type: 'announcement', pinned: true },
      ]),
    ).toBe(2);
  });
});
