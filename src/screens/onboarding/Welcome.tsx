import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';

export function Welcome() {
  const navigate = useNavigate();
  const hasProfile = useAppStore((s) => !!s.profile);

  function go(next: string) {
    navigate(hasProfile ? next : '/profile-setup', { state: { next } });
  }

  return (
    <div className="min-h-screen bg-bg flex justify-center">
      <div className="w-full max-w-md min-h-screen flex flex-col items-center justify-center px-6 gap-8 border-x border-border">
        <div className="flex flex-col items-center gap-3">
          <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-primary to-accent flex items-center justify-center text-5xl shadow-lg">
            🏆
          </div>
          <h1 className="text-3xl font-bold tracking-tight">PropLeague</h1>
          <p className="text-text-muted text-center text-sm">Fantasy football meets the sportsbook.</p>
        </div>

        <div className="w-full flex flex-col gap-3">
          <button
            onClick={() => go('/create-league')}
            className="w-full bg-primary text-white font-semibold py-3.5 rounded-xl"
          >
            Create League
          </button>
          <button
            onClick={() => go('/join-league')}
            className="w-full bg-bg-card border border-border font-semibold py-3.5 rounded-xl"
          >
            Join League
          </button>
          <button
            onClick={() => navigate('/how-it-works')}
            className="w-full text-primary text-sm font-medium py-2"
          >
            How does PropLeague work?
          </button>
        </div>
      </div>
    </div>
  );
}
