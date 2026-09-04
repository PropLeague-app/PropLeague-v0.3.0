import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/useAuthStore';

const AVATARS = ['🦅', '🐻', '🐺', '🦁', '🐯', '🦈', '🐉', '🦂', '🐢', '🦍', '🦊', '🐗'];

/** Matches the key Auth.tsx writes before an OAuth redirect (which loses
 * router state on the round trip to Google/Apple and back). */
const NEXT_KEY = 'pl_auth_next';

export function ProfileSetup() {
  const navigate = useNavigate();
  const location = useLocation();
  const completeProfileSetup = useAuthStore((s) => s.completeProfileSetup);
  const [username, setUsername] = useState('');
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const next = (location.state as { next?: string } | null)?.next ?? sessionStorage.getItem(NEXT_KEY) ?? '/create-league';

  async function submit() {
    if (username.trim() === '') {
      setError('Username is required.');
      return;
    }
    setSubmitting(true);
    const result = await completeProfileSetup(username.trim(), avatar);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? 'Something went wrong.');
      return;
    }
    sessionStorage.removeItem(NEXT_KEY);
    navigate(next);
  }

  return (
    <div className="min-h-screen bg-bg flex justify-center">
      <div
        className="w-full max-w-md min-h-screen flex flex-col px-6 py-10 gap-6 border-x border-border"
        style={{ paddingTop: 'calc(2.5rem + env(safe-area-inset-top))', paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom))' }}
      >
        <h1 className="text-2xl font-bold">Set up your profile</h1>

        <div>
          <label className="text-sm text-text-muted mb-1 block">Username</label>
          <input
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Your username"
            className={`w-full bg-bg-card border rounded-lg px-3 py-2.5 ${error ? 'border-loss' : 'border-border'}`}
          />
          {error && <p className="text-loss text-xs mt-1">{error}</p>}
        </div>

        <div>
          <label className="text-sm text-text-muted mb-2 block">Pick an avatar</label>
          <div className="grid grid-cols-6 gap-2">
            {AVATARS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => setAvatar(emoji)}
                className={`text-2xl aspect-square rounded-xl border flex items-center justify-center ${
                  avatar === emoji ? 'border-primary bg-primary/10' : 'border-border bg-bg-card'
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={submit}
          disabled={submitting}
          className="w-full bg-primary text-white font-semibold py-3.5 rounded-xl mt-2 disabled:opacity-40"
        >
          Continue
        </button>
      </div>
    </div>
  );
}