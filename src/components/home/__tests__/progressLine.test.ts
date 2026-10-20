import { describe, expect, it } from 'vitest';
import { formatProgressLine } from '../MatchupCard';

const p = (active: number, won: number, lost: number, pushed: number, open: number) => ({
  active, won, lost, pushed, open,
});

describe('formatProgressLine', () => {
  it('puts the record on the outer edge of each side', () => {
    // The left side reads outward-in and the right side inward-out, so both records sit against
    // the edges of the matchup row rather than both running the same direction.
    expect(formatProgressLine(p(1, 4, 3, 0, 0), false, 'left')).toBe('4-3-0 · 1 active');
    expect(formatProgressLine(p(1, 4, 3, 0, 0), false, 'right')).toBe('1 active · 4-3-0');
  });

  it('defaults to the left ordering', () => {
    expect(formatProgressLine(p(5, 1, 2, 0, 0))).toBe('1-2-0 · 5 active');
  });

  it('drops the word "settled" from the record', () => {
    expect(formatProgressLine(p(0, 4, 4, 0, 0), false, 'left')).not.toContain('settled');
    expect(formatProgressLine(p(0, 4, 4, 0, 0), false, 'left')).toBe('4-4-0');
  });

  it('keeps the record when nothing has settled yet', () => {
    // The case that prompted this: 8 live picks and an empty record still shows the 0-0-0.
    expect(formatProgressLine(p(8, 0, 0, 0, 0), false, 'right')).toBe('8 active · 0-0-0');
  });

  it('shows at most one live count, preferring active over open', () => {
    // Three parts is wider than the half-row each side gets, which is the truncation this exists
    // to stop, so a side with both live picks and empty slots reports the live ones.
    expect(formatProgressLine(p(2, 1, 1, 0, 3), false, 'left')).toBe('1-1-0 · 2 active');
    expect(formatProgressLine(p(2, 1, 1, 0, 3), false, 'right')).toBe('2 active · 1-1-0');
  });

  it('falls back to open slots before kickoff, when nothing is live yet', () => {
    expect(formatProgressLine(p(0, 0, 0, 0, 3), false, 'left')).toBe('0-0-0 · 3 left');
    expect(formatProgressLine(p(0, 0, 0, 0, 3), false, 'right')).toBe('3 left · 0-0-0');
  });

  it('hides the live counts for an opponent whose picks are hidden, on both sides', () => {
    // Revealing how many picks they have placed would leak what Hide Picks is meant to cover.
    expect(formatProgressLine(p(4, 2, 1, 0, 2), true, 'left')).toBe('2-1-0');
    expect(formatProgressLine(p(4, 2, 1, 0, 2), true, 'right')).toBe('2-1-0');
  });
});
