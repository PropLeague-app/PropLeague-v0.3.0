import { describe, it, expect } from 'vitest';
import { lossColor, lossIntensity, plStyleFor, seasonAtRisk, SCALE_FLOOR } from '../plColor';

describe('P/L color scale', () => {
  it('intensity is the loss as a share of what was at risk, capped at 1', () => {
    expect(lossIntensity(-25, 100)).toBe(0.25);
    expect(lossIntensity(-250, 100)).toBe(1);
    expect(lossIntensity(10, 100)).toBe(0);
    expect(lossIntensity(0, 100)).toBe(0);
    expect(lossIntensity(-5, 0)).toBe(0);
  });

  it('classic mode and gains never get an override', () => {
    expect(plStyleFor(-40, 'classic', 100)).toBeUndefined();
    expect(plStyleFor(40, 'scaled', 100)).toBeUndefined();
    expect(plStyleFor(0, 'scaled', 100)).toBeUndefined();
    expect(plStyleFor(-40, 'scaled', 0)).toBeUndefined();
  });

  it('a bigger loss is redder, and even a tiny loss keeps the floor of red', () => {
    const pct = (c: string) => Number(/var\(--color-loss\) (\d+)%/.exec(c)![1]);
    expect(pct(lossColor(0))).toBe(Math.round(SCALE_FLOOR * 100));
    expect(pct(lossColor(1))).toBe(100);
    expect(pct(lossColor(0.2))).toBeLessThan(pct(lossColor(0.8)));
  });

  it('is built from theme variables only, so it follows dark and light mode', () => {
    expect(lossColor(0.5)).toContain('var(--color-loss)');
    expect(lossColor(0.5)).toContain('var(--color-text-muted)');
    expect(lossColor(0.5)).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it('season at-risk is credits for each week played', () => {
    expect(seasonAtRisk(3, { weeklyCredits: 100 })).toBe(300);
    expect(seasonAtRisk(-1, { weeklyCredits: 100 })).toBe(0);
  });
});
