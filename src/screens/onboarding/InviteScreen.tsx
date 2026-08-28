import { useNavigate, useParams } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import { LeagueLogo } from '../../components/common/LeagueLogo';

export function InviteScreen() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const navigate = useNavigate();
  const league = useAppStore((s) => (leagueId ? s.leagues[leagueId] : undefined));
  const fillWithSimulatedTeams = useAppStore((s) => s.fillWithSimulatedTeams);

  if (!league) return null;

  const alreadyFilled = league.teams.length > 1;
  const targetTeamCount = league.targetTeamCount;

  function handleFill() {
    if (!leagueId) return;
    fillWithSimulatedTeams(leagueId, targetTeamCount);
    navigate('/home');
  }

  return (
    <div className="min-h-screen bg-bg flex justify-center">
      <div className="w-full max-w-md min-h-screen flex flex-col items-center justify-center px-6 gap-6 border-x border-border text-center">
        <span className="text-5xl">✅</span>
        <div className="flex items-center gap-2.5">
          <LeagueLogo league={league} size="md" />
          <h1 className="text-2xl font-bold">{league.name} is ready</h1>
        </div>
        <p className="text-text-muted text-sm">Share this invite code with friends (cosmetic — this demo has no real backend to join through):</p>
        <div className="bg-bg-card border border-dashed border-primary rounded-xl px-8 py-4">
          <span className="text-3xl font-mono font-bold tracking-[0.3em] text-primary">{league.inviteCode}</span>
        </div>

        <button
          onClick={handleFill}
          className="w-full bg-primary text-white font-semibold py-3.5 rounded-xl"
        >
          {alreadyFilled ? 'Continue to League' : 'Fill with simulated teams'}
        </button>
        {!alreadyFilled && (
          <p className="text-xs text-text-muted">
            Populates the league with AI-controlled teams so you can start Week 1 right away.
          </p>
        )}
      </div>
    </div>
  );
}
