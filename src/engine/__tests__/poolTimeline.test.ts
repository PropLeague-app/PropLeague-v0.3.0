import { describe, it, expect } from 'vitest';
import { poolTimeline, weekEndIndex, weekStartValue } from '../poolTimeline';
import { DEFAULT_LEAGUE_SETTINGS, type DaySlot, type League, type PrizePool } from '../../types';

// Two teams, $100 credits, $200 pool: a team's $1 of profit moves the pool by 1/100 x 200/2 = $1.
const wager = (profit: number, daySlot?: DaySlot, status = profit > 0 ? 'won' : 'lost') => ({
  slotId: 's',
  position: 'QB',
  wager: { id: Math.random().toString(), slotId: 's', gameId: 'g', status, settledProfit: profit, stake: 10, oddsAtPlacement: -110, daySlot, kickoff: daySlot ? `2026-10-0${DAY_SLOT_DAYS[daySlot]}T17:00:00Z` : undefined },
});
const DAY_SLOT_DAYS: Partial<Record<DaySlot, number>> = { TNF: 1, SUN_EARLY: 4, SUN_LATE: 4, MNF: 5 };
const roster = (...slots: ReturnType<typeof wager>[]) => ({ week: 1, teamId: 'x', submitted: true, slots });

function league(rosters: Record<string, ReturnType<typeof roster>>): League {
  return {
    teams: [{ id: 'a', isSimulated: false }, { id: 'b', isSimulated: false }],
    settings: { ...DEFAULT_LEAGUE_SETTINGS, weeklyCredits: 100 },
    rostersByTeamWeek: rosters,
  } as unknown as League;
}

const pool = (history: PrizePool['history']): PrizePool => ({ initial: 200, current: history.at(-1)?.poolAfter ?? 200, locked: false, history });

describe('poolTimeline', () => {
  it('steps a week by game window against that week’s starting pool, and lands on the stored close', () => {
    const l = league({
      'a:1': roster(wager(10, 'TNF'), wager(-5, 'SUN_EARLY')),
      'b:1': roster(wager(4, 'SUN_EARLY'), wager(-10, 'MNF')),
    });
    // Settled net is -1; the stored close is 2 lower again, which is that week's penalties.
    const pts = poolTimeline(l, pool([{ week: 1, poolBefore: 200, poolAfter: 197, netRealPL: -3, byTeam: { a: { impact: 5, multiplier: 1 }, b: { impact: -8, multiplier: 1 } } }]));
    expect(pts.map((p) => [p.week, p.slot, p.value, p.weekEnd])).toEqual([
      ['start', undefined, 200, true],
      [1, 'TNF', 210, false],
      [1, 'SUN_EARLY', 209, false],
      [1, 'MNF', 197, true],
    ]);
    expect(pts[1].kickoff).toBe('2026-10-01T17:00:00Z');
  });

  it('applies each team’s multiplier for that week', () => {
    const l = league({ 'a:1': roster(wager(10, 'TNF'), wager(0, 'MNF', 'push')), 'b:1': roster(wager(10, 'TNF')) });
    const pts = poolTimeline(l, pool([{ week: 1, poolBefore: 200, poolAfter: 220, netRealPL: 20, byTeam: { a: { impact: 15, multiplier: 1.5 }, b: { impact: 5, multiplier: 0.5 } } }]));
    expect(pts[1]).toMatchObject({ slot: 'TNF', value: 220 });
  });

  it('starts each week from the previous week’s close, without compounding inside a week', () => {
    const l = league({ 'a:1': roster(wager(10, 'SUN_EARLY')), 'a:2': roster(wager(10, 'TNF'), wager(10, 'MNF')) });
    const pts = poolTimeline(
      l,
      pool([
        { week: 1, poolBefore: 200, poolAfter: 210, netRealPL: 10, byTeam: { a: { impact: 10, multiplier: 1 } } },
        // Week 2's $10 of profit is worth 10/100 x 210/2 = $10.50 per step, both against 210.
        { week: 2, poolBefore: 210, poolAfter: 231, netRealPL: 21, byTeam: { a: { impact: 21, multiplier: 1 } } },
      ]),
    );
    expect(pts.filter((p) => p.week === 2).map((p) => p.value)).toEqual([220.5, 231]);
  });

  it('keeps a week whole when a settled pick has no known game window', () => {
    const l = league({ 'a:1': roster(wager(10, 'TNF'), wager(5)) });
    const pts = poolTimeline(l, pool([{ week: 1, poolBefore: 200, poolAfter: 215, netRealPL: 15, byTeam: { a: { impact: 15, multiplier: 1 } } }]));
    expect(pts).toHaveLength(2);
    expect(pts[1]).toMatchObject({ week: 1, value: 215, weekEnd: true });
  });

  it('keeps a week settled before per-team detail whole', () => {
    const pts = poolTimeline(league({}), pool([{ week: 1, poolBefore: 200, poolAfter: 190, netRealPL: -10 }]));
    expect(pts.map((p) => p.value)).toEqual([200, 190]);
  });

  it('marks the live week as provisional', () => {
    const l = league({ 'a:2': roster(wager(10, 'TNF')) });
    const pts = poolTimeline(
      l,
      pool([
        { week: 1, poolBefore: 200, poolAfter: 200, netRealPL: 0 },
        { week: 2, poolBefore: 200, poolAfter: 210, netRealPL: 10, byTeam: { a: { impact: 10, multiplier: 1 } } },
      ]),
      2,
    );
    expect(pts.at(-1)).toMatchObject({ week: 2, live: true, weekEnd: true, value: 210 });
    expect(pts[1].live).toBe(false);
  });

  it('finds a week’s close and the pool it started from', () => {
    const l = league({ 'a:1': roster(wager(10, 'TNF'), wager(10, 'MNF')) });
    const pts = poolTimeline(l, pool([{ week: 1, poolBefore: 200, poolAfter: 220, netRealPL: 20, byTeam: { a: { impact: 20, multiplier: 1 } } }]));
    expect(weekEndIndex(pts, 1)).toBe(2);
    expect(weekEndIndex(pts, 'start')).toBe(0);
    expect(weekStartValue(pts, 1)).toBe(200);
  });
});
