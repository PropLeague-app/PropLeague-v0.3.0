import { describe, it, expect } from 'vitest';
import { pickIdentity } from '../IdentityPicker';

// manual v0.2.1 §2 #1: the settings-save-clobbering bug — saving the League Logo (or
// Team Logo) editor was silently reverting the league name, team name, and other
// unrelated settings. Root cause: IdentityPicker's `value` prop is typed as the small
// LogoIdentity shape, but callers actually pass the entire League or LeagueTeam object;
// TypeScript's structural typing doesn't strip the extra fields at runtime, so without
// this explicit pick, the editor's local draft (and therefore its Save payload) quietly
// carried the *whole* stale object captured at mount, clobbering everything else when
// merged back into the store. pickIdentity is what makes the Save payload a true
// partial patch — these tests pin that behavior directly.
describe('pickIdentity (manual v0.2.1 §2 #1 regression)', () => {
  it('keeps only the 4 real LogoIdentity fields, dropping everything else', () => {
    const fakeLeagueLikeObject = {
      id: 'league-1',
      name: 'My League',
      settings: { leagueName: 'My League', weeklyCredits: 100 },
      teams: [{ id: 'user' }],
      logoMode: 'emoji' as const,
      logoEmoji: '🏈',
      logoColor: '#4C8DF5',
      logoDataUrl: null,
    };
    const picked = pickIdentity(fakeLeagueLikeObject);
    expect(picked).toEqual({ logoMode: 'emoji', logoEmoji: '🏈', logoColor: '#4C8DF5', logoDataUrl: null });
    expect(picked).not.toHaveProperty('name');
    expect(picked).not.toHaveProperty('settings');
    expect(picked).not.toHaveProperty('teams');
  });

  it('keeps only the 4 real LogoIdentity fields when given a team-shaped object', () => {
    const fakeTeamLikeObject = {
      id: 'user',
      ownerName: 'You',
      teamName: 'My Team',
      abbrev: 'MT',
      isUser: true,
      isSimulated: false,
      conferenceId: null,
      logoMode: 'initials' as const,
      logoEmoji: '🦅',
      logoColor: '#9D4EED',
      logoDataUrl: null,
    };
    const picked = pickIdentity(fakeTeamLikeObject);
    expect(picked).toEqual({ logoMode: 'initials', logoEmoji: '🦅', logoColor: '#9D4EED', logoDataUrl: null });
    expect(picked).not.toHaveProperty('teamName');
    expect(picked).not.toHaveProperty('abbrev');
    expect(picked).not.toHaveProperty('conferenceId');
  });
});
