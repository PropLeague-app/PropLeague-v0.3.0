import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import { goBack } from '../../components/layout/BackHeader';

export function JoinLeague() {
  const navigate = useNavigate();
  const profile = useAppStore((s) => s.profile);
  const [code, setCode] = useState('');
  const joinDemoLeague = useAppStore((s) => s.joinDemoLeague);

  function submit() {
    if (!code.trim()) return;
    joinDemoLeague();
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
        <p className="text-text-muted text-sm">
          In this beta, any invite code joins a pre-seeded demo league so you can start playing right away.
        </p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Enter invite code"
          className="w-full bg-bg-card border border-border rounded-lg px-3 py-3 font-mono tracking-widest text-center text-lg"
        />
        <button
          onClick={submit}
          disabled={!code.trim()}
          className="w-full bg-primary text-white font-semibold py-3.5 rounded-xl disabled:opacity-40"
        >
          Join League
        </button>
      </div>
    </div>
  );
}
