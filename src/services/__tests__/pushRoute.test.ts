import { describe, it, expect } from 'vitest';
import { parsePushRoute, parsePushUrl, setPendingPushRoute, takePendingPushRoute, peekPendingPushRoute } from '../pushRoute';

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
  it('reads a tapped Live Activity card url', () => {
    expect(parsePushUrl('propleague://open?screen=matchup&leagueId=L&week=DIV&teamId=T')).toEqual({
      screen: 'matchup',
      leagueId: 'L',
      week: 'DIV',
      teamId: 'T',
    });
    expect(parsePushUrl('propleague://open?screen=lineup&leagueId=L')).toEqual({ screen: 'lineup', leagueId: 'L' });
  });
  it('ignores a url that is not ours or is missing its league', () => {
    for (const u of ['', 'not a url', 'https://example.com/?screen=lineup&leagueId=L', 'propleague://open?screen=lineup', 'propleague://open?screen=matchup&leagueId=L']) {
      expect(parsePushUrl(u)).toBeNull();
    }
  });
  it('a parked route is followed once', () => {
    setPendingPushRoute({ screen: 'lineup', leagueId: 'L' });
    expect(peekPendingPushRoute()).toEqual({ screen: 'lineup', leagueId: 'L' });
    expect(takePendingPushRoute()).toEqual({ screen: 'lineup', leagueId: 'L' });
    expect(takePendingPushRoute()).toBeNull();
  });
});
