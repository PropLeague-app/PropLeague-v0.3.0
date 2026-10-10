import { describe, it, expect } from 'vitest';
import { parsePushRoute, setPendingPushRoute, takePendingPushRoute, peekPendingPushRoute } from '../pushRoute';

describe('parsePushRoute', () => {
  it('reads each screen the server sends', () => {
    expect(parsePushRoute({ screen: 'lineup', leagueId: 'L', week: '5' })).toEqual({ screen: 'lineup', leagueId: 'L' });
    expect(parsePushRoute({ screen: 'matchup', leagueId: 'L', week: 5, teamId: 'T' })).toEqual({ screen: 'matchup', leagueId: 'L', week: '5', teamId: 'T' });
    expect(parsePushRoute({ screen: 'matchup', leagueId: 'L', week: 'WC' })).toEqual({ screen: 'matchup', leagueId: 'L', week: 'WC', teamId: null });
    expect(parsePushRoute({ screen: 'void-requests', leagueId: 'L' })).toEqual({ screen: 'void-requests', leagueId: 'L' });
  });
  it('ignores anything it does not know', () => {
    for (const d of [null, undefined, 'x', {}, { screen: 'lineup' }, { screen: 'matchup', leagueId: 'L' }, { screen: 'nope', leagueId: 'L' }, { screen: 'lineup', leagueId: '' }]) {
      expect(parsePushRoute(d)).toBeNull();
    }
  });
  it('a parked route is followed once', () => {
    setPendingPushRoute({ screen: 'lineup', leagueId: 'L' });
    expect(peekPendingPushRoute()).toEqual({ screen: 'lineup', leagueId: 'L' });
    expect(takePendingPushRoute()).toEqual({ screen: 'lineup', leagueId: 'L' });
    expect(takePendingPushRoute()).toBeNull();
  });
});
