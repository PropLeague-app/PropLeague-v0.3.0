import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/useAuthStore';

export function ResetPassword() {
  const navigate = useNavigate();
  const updatePassword = useAuthStore((s) => s.updatePassword);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setError(null);
    if (!password) {
      setError('Enter a new password.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    const result = await updatePassword(password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? 'Something went wrong.');
      return;
    }
    navigate('/');
  }

  return (
    <div className="min-h-screen bg-bg flex justify-center">
      <div className="w-full max-w-md min-h-screen flex flex-col px-6 py-10 gap-5 border-x border-border">
        <h1 className="text-2xl font-bold">Set a new password</h1>

        <div className="flex flex-col gap-3">
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="New password"
            type="password"
            autoComplete="new-password"
            className="w-full bg-bg-card border border-border rounded-lg px-3 py-2.5"
          />
          <input
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
            type="password"
            autoComplete="new-password"
            className="w-full bg-bg-card border border-border rounded-lg px-3 py-2.5"
          />
          {error && <p className="text-loss text-xs">{error}</p>}
          <button
            onClick={submit}
            disabled={submitting}
            className="w-full bg-primary text-white font-semibold py-3.5 rounded-xl disabled:opacity-40"
          >
            Set password
          </button>
        </div>
      </div>
    </div>
  );
}
