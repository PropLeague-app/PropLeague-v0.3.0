import { describe, it, expect } from 'vitest';
import { lossColor, lossIntensity, plStyleFor, scaleReference, seasonAtRisk, seasonScaleRef, weekScaleRef, ORANGE_AT, RED_AT } from '../plColor';
import type { League } from '../../types';

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

  it('runs yellow to orange to red, reaching red well before the worst loss', () => {
    expect(lossColor(0)).toBe('color-mix(in oklab, var(--pl-loss-mid) 0%, var(--pl-loss-lo))');
    expect(lossColor(ORANGE_AT)).toBe('color-mix(in oklab, var(--pl-loss-mid) 100%, var(--pl-loss-lo))');
    expect(lossColor(RED_AT)).toBe('color-mix(in oklab, var(--pl-loss-hi) 100%, var(--pl-loss-mid))');
    expect(lossColor(1)).toBe(lossColor(RED_AT));
    expect(RED_AT).toBeLessThan(0.75);
    expect(lossColor(-1)).toBe(lossColor(0));
    expect(lossColor(9)).toBe(lossColor(1));
  });

  it('the worst loss in the comparison is the reddest, the rest scale toward zero', () => {
    const ref = scaleReference(80, 100);
    expect(ref).toBe(80);
    expect(lossIntensity(-80, ref)).toBe(1);
    expect(lossIntensity(-40, ref)).toBe(0.5);
    expect(lossIntensity(-8, ref)).toBeCloseTo(0.1);
  });

  it('when even the worst loss is small, the reference floors at a quarter of what was at risk', () => {
    const ref = scaleReference(3, 100);
    expect(ref).toBe(25);
    expect(lossIntensity(-3, ref)).toBeCloseTo(0.12);
    // 12% intensity is still in the yellow half of the first blend, not red.
    expect(lossColor(0.12)).toContain('var(--pl-loss-mid) 40%');
  });

  it('weekly reference comes from that week\'s scores, live ones and the caller\'s included', () => {
    const league = {
      settings: { weeklyCredits: 100 },
      matchupsByWeek: { '4': [{ teamAScore: -60, teamBScore: 20 }, { teamAScore: -10, teamBScore: null }] },
    } as unknown as League;
    expect(weekScaleRef(league, 4)).toBe(60);
    expect(weekScaleRef(league, 4, [-90])).toBe(90);
    expect(weekScaleRef(league, 5)).toBe(25);
  });

  it('season reference is the worst team total, floored by weeks played', () => {
    const league = {
      settings: { weeklyCredits: 100 },
      standings: [
        { totalPL: -120, wins: 1, losses: 2, ties: 0 },
        { totalPL: 40, wins: 2, losses: 1, ties: 0 },
      ],
    } as unknown as League;
    expect(seasonScaleRef(league)).toBe(120);
    const flat = { settings: { weeklyCredits: 100 }, standings: [{ totalPL: -5, wins: 1, losses: 2, ties: 0 }] } as unknown as League;
    expect(seasonScaleRef(flat)).toBe(75);
  });

  it('is built from theme variables only, so it follows dark and light mode', () => {
    for (const t of [0, 0.3, 0.7, 1]) {
      expect(lossColor(t)).toContain('var(--pl-loss-');
      expect(lossColor(t)).not.toMatch(/#[0-9a-f]{3,6}/i);
    }
  });

  it('season at-risk is credits for each week played', () => {
    expect(seasonAtRisk(3, { weeklyCredits: 100 })).toBe(300);
    expect(seasonAtRisk(-1, { weeklyCredits: 100 })).toBe(0);
  });
});
