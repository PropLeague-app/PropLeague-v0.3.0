import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import * as leagueService from '../../services/leagueService';
import { joinRealLeague, fetchLeagueMeta, fetchLeagueTeams } from '../../services/supabaseLeague';
import { TEAM_LOGO_COLORS, abbrevFromName } from '../../data/simulatedTeamNames';
import { goBack } from '../../components/layout/BackHeader';

export function JoinLeague() {
  const navigate = useNavigate();
  const profile = useAppStore((s) => s.profile);
  const addLeague = useAppStore((s) => s.addLeague);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!code.trim()) return;
    setError(null);
    setSubmitting(true);

    const teamName = `${profile?.username ?? 'My'}'s Team`;
    const teamAbbrev = abbrevFromName(teamName);
    const userLogoColor = TEAM_LOGO_COLORS[0];

    const joinResult = await joinRealLeague({
      inviteCode: code.trim(),
      teamName,
      teamAbbrev,
      logoColor: userLogoColor,
    });
    if (!joinResult.ok) {
      setSubmitting(false);
      setError(joinResult.error);
      return;
    }

    const [metaResult, teamsResult] = await Promise.all([
      fetchLeagueMeta(joinResult.leagueId),
      fetchLeagueTeams(joinResult.leagueId),
    ]);
    setSubmitting(false);
    if (!metaResult.ok) {
      setError(metaResult.error);
      return;
    }
    if (!teamsResult.ok) {
      setError(teamsResult.error);
      return;
    }
    if (!metaResult.commissionerTeamId) {
      setError('Joined, but this league has no commissioner team set.');
      return;
    }

    const builtLeague = leagueService.buildLeagueFromRealTeams({
      id: metaResult.id,
      name: metaResult.name,
      inviteCode: metaResult.inviteCode,
      commissionerTeamId: metaResult.commissionerTeamId,
      targetTeamCount: metaResult.targetTeamCount,
      isPublic: metaResult.isPublic,
      teams: teamsResult.teams,
    });
    // Mark which of the real teams is actually this user's.
    const league = {
      ...builtLeague,
      teams: builtLeague.teams.map((t) => (t.id === joinResult.teamId ? { ...t, isUser: true } : t)),
    };

    addLeague(league);
    navigate('/home');
  }

  return (
    <div className="min-h-screen bg-bg flex justify-center">
      <div className="w-full max-w-md min-h-screen flex flex-col px-6 py-10 gap-5 border-x border-border">
        {profile && (
          <button
            onClick={() => goBack(navigate, '/settings')}
            className="text-text-muted flex items-center gap-0.5 -ml-1 -mb-2 self-start"
          >
            <span className="text-xl leading-none">‹</span>
            <span className="text-sm">Back</span>
          </button>
        )}
        <h1 className="text-2xl font-bold">Join a League</h1>
        <p className="text-text-muted text-sm">Enter the invite code a commissioner shared with you.</p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Enter invite code"
          className="w-full bg-bg-card border border-border rounded-lg px-3 py-3 font-mono tracking-widest text-center text-lg"
        />
        {error && <p className="text-loss text-sm text-center">{error}</p>}
        <button
          onClick={submit}
          disabled={!code.trim() || submitting}
          className="w-full bg-primary text-white font-semibold py-3.5 rounded-xl disabled:opacity-40"
        >
          {submitting ? 'Joining…' : 'Join League'}
        </button>
      </div>
    </div>
  );
}
