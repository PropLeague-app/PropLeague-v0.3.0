import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';

const AVATARS = ['🦅', '🐻', '🐺', '🦁', '🐯', '🦈', '🐉', '🦂', '🐢', '🦍', '🦊', '🐗'];

export function ProfileSetup() {
  const navigate = useNavigate();
  const location = useLocation();
  const setProfile = useAppStore((s) => s.setProfile);
  const [username, setUsername] = useState('');
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [error, setError] = useState<string | null>(null);

  const next = (location.state as { next?: string } | null)?.next ?? '/create-league';

  function createProfile() {
    if (username.trim() === '') {
      setError('Username is required.');
      return;
    }
    setProfile({ username: username.trim(), avatarEmoji: avatar, oddsFormat: 'american' });
    navigate(next);
  }

  return (
    <div className="min-h-screen bg-bg flex justify-center">
      <div className="w-full max-w-md min-h-screen flex flex-col px-6 py-10 gap-6 border-x border-border">
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
          onClick={createProfile}
          className="w-full bg-primary text-white font-semibold py-3.5 rounded-xl mt-2"
        >
          Continue
        </button>

        <div className="flex flex-col gap-2">
          <p className="text-center text-xs text-text-muted">or continue with</p>
          {['Google', 'Apple', 'Email'].map((provider) => (
            <button
              key={provider}
              onClick={createProfile}
              className="w-full bg-bg-card border border-border font-medium py-2.5 rounded-xl text-sm flex items-center justify-center gap-2"
            >
              {provider}
              <span className="text-text-muted text-xs">(coming soon)</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
