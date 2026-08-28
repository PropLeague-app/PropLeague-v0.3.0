import { describe, it, expect } from 'vitest';
import { americanToDecimal, americanToImpliedProbability, profitForStake, formatCents } from '../oddsMath';

describe('oddsMath', () => {
  it('matches the spec examples exactly (stake excluded from profit)', () => {
    expect(profitForStake(10, -150)).toBeCloseTo(6.67, 2);
    expect(profitForStake(10, 230)).toBeCloseTo(23.0, 2);
  });

  it('converts American odds to decimal odds', () => {
    expect(americanToDecimal(100)).toBeCloseTo(2.0, 5);
    expect(americanToDecimal(-100)).toBeCloseTo(2.0, 5);
    expect(americanToDecimal(-200)).toBeCloseTo(1.5, 5);
  });

  it('converts American odds to implied probability', () => {
    expect(americanToImpliedProbability(100)).toBeCloseTo(0.5, 5);
    expect(americanToImpliedProbability(-200)).toBeCloseTo(2 / 3, 5);
  });

  it('formats cents with a leading sign', () => {
    expect(formatCents(12.5)).toBe('$12.50');
    expect(formatCents(-12.5)).toBe('-$12.50');
    expect(formatCents(0)).toBe('$0.00');
  });
});
