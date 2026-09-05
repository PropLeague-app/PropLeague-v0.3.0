import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CircleCheck } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { LeagueLogo } from '../../components/common/LeagueLogo';

export function InviteScreen() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const navigate = useNavigate();
  const league = useAppStore((s) => (leagueId ? s.leagues[leagueId] : undefined));
  const fillWithSimulatedTeams = useAppStore((s) => s.fillWithSimulatedTeams);
  const [error, setError] = useState<string | null>(null);
  const [filling, setFilling] = useState(false);

  if (!league) return null;

  const alreadyFilled = league.teams.length > 1;
  const targetTeamCount = league.targetTeamCount;

  async function handleFill() {
    if (!leagueId) return;
    setError(null);
    setFilling(true);
    const result = await fillWithSimulatedTeams(leagueId, targetTeamCount);
    setFilling(false);
    if (!result.ok) {
      setError(result.error ?? 'Something went wrong.');
      return;
    }
    navigate('/home');
  }

  return (
    <div className="min-h-screen bg-bg flex justify-center">
      <div
        className="w-full max-w-md min-h-screen flex flex-col items-center justify-center px-6 gap-6 border-x border-border text-center"
        style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <CircleCheck size={48} className="text-profit" />
        <div className="flex items-center gap-2.5">
          <LeagueLogo league={league} size="md" />
          <h1 className="text-2xl font-bold">{league.name} is ready</h1>
        </div>
        <p className="text-text-muted text-sm">Share this invite code with friends so they can join your league:</p>
        <div className="bg-bg-card border border-dashed border-primary rounded-xl px-8 py-4">
          <span className="text-3xl font-mono font-bold tracking-[0.3em] text-primary">{league.inviteCode}</span>
        </div>

        {error && <p className="text-loss text-sm">{error}</p>}
        <button
          onClick={alreadyFilled ? () => navigate('/home') : handleFill}
          disabled={filling}
          className="w-full bg-primary text-white font-semibold py-3.5 rounded-xl disabled:opacity-40"
        >
          {filling ? 'Filling…' : alreadyFilled ? 'Continue to League' : 'Fill with simulated teams'}
        </button>
        {!alreadyFilled && (
          <>
            <p className="text-xs text-text-muted">
              Populates the league with AI-controlled teams so you can start Week 1 right away.
            </p>
            <button onClick={() => navigate('/home')} disabled={filling} className="text-primary text-sm font-medium">
              Skip — wait for real friends to join
            </button>
          </>
        )}
      </div>
    </div>
  );
}