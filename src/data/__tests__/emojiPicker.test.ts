import { describe, it, expect } from 'vitest';
import { searchEmojis } from '../emojiPicker';

describe('searchEmojis', () => {
  it('returns nothing for an empty or blank query', () => {
    expect(searchEmojis('')).toEqual([]);
    expect(searchEmojis('   ')).toEqual([]);
  });

  it('finds an emoji by a word in its name, ignoring case', () => {
    expect(searchEmojis('TROPHY').map((e) => e.char)).toContain('🏆');
  });

  it('requires every typed word, in any order', () => {
    const chars = searchEmojis('ball soccer').map((e) => e.char);
    expect(chars).toContain('⚽');
    expect(chars).not.toContain('🏀');
  });

  it('lists each emoji once', () => {
    const chars = searchEmojis('ball').map((e) => e.char);
    expect(new Set(chars).size).toBe(chars.length);
  });

  it('returns an empty list when nothing matches', () => {
    expect(searchEmojis('zzzzqqq')).toEqual([]);
  });
});
