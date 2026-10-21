import { describe, expect, it } from 'vitest';
import { placeLabels } from '../labelPlacement';

const GAP = 24;
const MIN = 13;
const MAX = 227;

/** No two labels closer than the gap, and none outside the bounds. */
function check(out: number[], gap = GAP, min = MIN, max = MAX) {
  const sorted = [...out].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i += 1) {
    expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(gap - 1e-6);
  }
  expect(Math.min(...out)).toBeGreaterThanOrEqual(min - 1e-6);
  expect(Math.max(...out)).toBeLessThanOrEqual(max + 1e-6);
}

describe('placeLabels', () => {
  it('leaves labels alone when they already clear each other', () => {
    const desired = [20, 60, 100, 140];
    expect(placeLabels(desired, GAP, MIN, MAX)).toEqual(desired);
  });

  it('spreads a crowd both ways around where it sits, not only downward', () => {
    // Four labels stacked at 120. The old push-down put them at 120..192; they belong centred.
    const out = placeLabels([120, 120, 120, 120], GAP, MIN, MAX);
    check(out);
    const mid = out.reduce((a, b) => a + b, 0) / out.length;
    expect(mid).toBeCloseTo(120, 6);
  });

  it('pushes back up off the floor instead of piling labels on top of each other', () => {
    // Everything wants to be at the very bottom: there is only one way to fit them.
    const out = placeLabels([225, 226, 227, 227, 227], GAP, MIN, MAX);
    check(out);
    expect(Math.max(...out)).toBeCloseTo(MAX, 6);
  });

  it('keeps the lowest value lowest, rather than just producing a valid set of slots', () => {
    // The lowest desired value must still come out lowest.
    const out = placeLabels([200, 40, 120], GAP, MIN, MAX);
    check(out);
    expect(out[1]).toBeLessThan(out[2]);
    expect(out[2]).toBeLessThan(out[0]);
  });

  it('never overlaps with a full league crammed into a narrow band', () => {
    const out = placeLabels([100, 101, 102, 103, 104, 105, 106, 107], GAP, MIN, MAX);
    check(out);
    expect(out).toHaveLength(8);
  });

  it('tightens the spacing rather than overflowing when the band is too small', () => {
    // Eight labels, 24px apart, need 168px of room; this band has 80.
    const out = placeLabels([10, 20, 30, 40, 50, 60, 70, 80], GAP, 0, 80);
    check(out, 80 / 7, 0, 80);
  });

  it('handles an empty list and a single label', () => {
    expect(placeLabels([], GAP, MIN, MAX)).toEqual([]);
    expect(placeLabels([150], GAP, MIN, MAX)).toEqual([150]);
  });

  it('clamps a single label that wants to sit outside the bounds', () => {
    expect(placeLabels([-40], GAP, MIN, MAX)[0]).toBeCloseTo(MIN, 6);
    expect(placeLabels([999], GAP, MIN, MAX)[0]).toBeCloseTo(MAX, 6);
  });
});
