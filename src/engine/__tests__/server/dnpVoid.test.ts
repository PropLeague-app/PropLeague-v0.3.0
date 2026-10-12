import { describe, it, expect } from 'vitest';
import { dnpVoidDecision, teamFromPlayerId, MIN_TEAM_STAT_ROWS } from '../../../../supabase/functions/_shared/dnpVoid';

const HOUR = 60 * 60 * 1000;
const base = {
  playerTeam: 'MIN',
  teamStatRows: 0,
  pastRevealCutoff: false,
  graceMs: 3 * HOUR,
  hardCeilingMs: 24 * HOUR,
};

describe('teamFromPlayerId', () => {
  it('reads the team off a pick id', () => {
    expect(teamFromPlayerId('MIN-jordan-addison')).toBe('MIN');
    expect(teamFromPlayerId('kc-travis-kelce')).toBe('KC');
  });
  it('gives null for anything that is not a team code', () => {
    for (const id of [null, undefined, '', 'jordan-addison', '12345-x']) expect(teamFromPlayerId(id)).toBeNull();
  });
});

describe('when a missing stat row becomes a DNP void', () => {
  it('voids as soon as his own teammates are ingested', () => {
    // The real case (see chat, Oct 2026): Jordan Addison, 8 hours after final, 31 Minnesota players
    // already in. Under the old time-only rule this waited for the 24h ceiling.
    const d = dnpVoidDecision({ ...base, msSinceFinal: 8 * HOUR, teamStatRows: 31 });
    expect(d.shouldVoid).toBe(true);
    expect(d.reason).toContain('teammates ingested');
  });

  it('keeps waiting while his team has no box score at all', () => {
    // The transient ingestion gap the time rules were added for: nothing from his team yet, so a
    // missing row says nothing about whether he played.
    const d = dnpVoidDecision({ ...base, msSinceFinal: 8 * HOUR, teamStatRows: 0 });
    expect(d.shouldVoid).toBe(false);
    expect(d.reason).toContain('still ingesting');
  });

  it('keeps waiting on a trickle of rows rather than a finished box score', () => {
    expect(dnpVoidDecision({ ...base, msSinceFinal: 8 * HOUR, teamStatRows: MIN_TEAM_STAT_ROWS - 1 }).shouldVoid).toBe(false);
    expect(dnpVoidDecision({ ...base, msSinceFinal: 8 * HOUR, teamStatRows: MIN_TEAM_STAT_ROWS }).shouldVoid).toBe(true);
  });

  it('never voids inside the grace window, however complete the box score looks', () => {
    const d = dnpVoidDecision({ ...base, msSinceFinal: 1 * HOUR, teamStatRows: 40 });
    expect(d.shouldVoid).toBe(false);
    expect(d.reason).toContain('grace');
  });

  it('still falls back to the 24h ceiling and the Tuesday reveal', () => {
    expect(dnpVoidDecision({ ...base, msSinceFinal: 25 * HOUR, teamStatRows: 0 }).shouldVoid).toBe(true);
    expect(dnpVoidDecision({ ...base, msSinceFinal: 8 * HOUR, teamStatRows: 0, pastRevealCutoff: true }).shouldVoid).toBe(true);
  });

  it('falls back to the clock for a pick with no team on it', () => {
    const old = dnpVoidDecision({ ...base, msSinceFinal: 8 * HOUR, playerTeam: null, teamStatRows: 99 });
    expect(old.shouldVoid).toBe(false); // teammates signal needs a team to be about
    expect(dnpVoidDecision({ ...base, msSinceFinal: 25 * HOUR, playerTeam: null }).shouldVoid).toBe(true);
  });

  it('waits when the game has no final time yet', () => {
    expect(dnpVoidDecision({ ...base, msSinceFinal: null, teamStatRows: 40 }).shouldVoid).toBe(false);
  });
});
