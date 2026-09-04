import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/useAuthStore';
import { goBack } from '../../components/layout/BackHeader';

type Mode = 'signin' | 'signup' | 'forgot';

/** Where to send the user once auth finishes. Kept in sessionStorage too
 * because the Google/Apple flows do a full-page redirect away and back —
 * router state (location.state) doesn't survive that round trip, but
 * sessionStorage does. ProfileSetup reads this as a fallback. */
const NEXT_KEY = 'pl_auth_next';

export function Auth() {
  const navigate = useNavigate();
  const location = useLocation();
  const next = (location.state as { next?: string } | null)?.next ?? '/create-league';

  const signInWithEmail = useAuthStore((s) => s.signInWithEmail);
  const signUpWithEmail = useAuthStore((s) => s.signUpWithEmail);
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);
  const signInWithApple = useAuthStore((s) => s.signInWithApple);
  const requestPasswordReset = useAuthStore((s) => s.requestPasswordReset);

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function goToMode(m: Mode) {
    setMode(m);
    setError(null);
    setInfo(null);
    setPassword('');
    setConfirmPassword('');
  }

  async function submitEmail() {
    setError(null);
    setInfo(null);
    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }
    if (mode === 'signup' && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    const result = mode === 'signin' ? await signInWithEmail(email.trim(), password) : await signUpWithEmail(email.trim(), password);
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error ?? 'Something went wrong.');
      return;
    }
    if (result.needsEmailConfirmation) {
      setInfo('Check your email to confirm your account, then log in.');
      goToMode('signin');
      return;
    }
    if (mode === 'signin') {
      // A returning user's onboarded status isn't reliably known yet here --
      // it's only set once useAuthStore's auth-state listener finishes
      // fetching their profile, a separate async chain not guaranteed done
      // by the time this resolves. Sending them to root lets RootRedirect's
      // already-correct, wait-for-it logic decide where they actually belong
      // (profile-setup if somehow incomplete, otherwise their real hydrated
      // leagues) instead of this screen guessing and routing them wrong.
      navigate('/');
      return;
    }
    navigate('/profile-setup', { state: { next } });
  }

  async function submitForgotPassword() {
    setError(null);
    setInfo(null);
    if (!email.trim()) {
      setError('Enter your email first.');
      return;
    }
    setSubmitting(true);
    const result = await requestPasswordReset(email.trim());
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? 'Something went wrong.');
      return;
    }
    setInfo('Check your email for a link to reset your password.');
  }

  function oauth(fn: () => Promise<void>) {
    sessionStorage.setItem(NEXT_KEY, next);
    fn();
  }

  return (
    <div className="min-h-screen bg-bg flex justify-center">
      <div
        className="w-full max-w-md min-h-screen flex flex-col px-6 py-10 gap-5 border-x border-border"
        style={{ paddingTop: 'calc(2.5rem + env(safe-area-inset-top))', paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom))' }}
      >
        <button onClick={() => goBack(navigate, '/welcome')} className="text-text-muted flex items-center gap-0.5 -ml-1 -mb-2 self-start">
          <span className="text-xl leading-none">‹</span>
          <span className="text-sm">Back</span>
        </button>

        <h1 className="text-2xl font-bold">
          {mode === 'signin' ? 'Log in' : mode === 'signup' ? 'Create your account' : 'Reset your password'}
        </h1>

        {mode === 'forgot' ? (
          <div className="flex flex-col gap-3">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              type="email"
              autoComplete="email"
              className="w-full bg-bg-card border border-border rounded-lg px-3 py-2.5"
            />
            {error && <p className="text-loss text-xs">{error}</p>}
            {info && <p className="text-text-muted text-xs">{info}</p>}
            <button
              onClick={submitForgotPassword}
              disabled={submitting}
              className="w-full bg-primary text-white font-semibold py-3.5 rounded-xl disabled:opacity-40"
            >
              Send reset email
            </button>
            <button onClick={() => goToMode('signin')} className="text-primary text-sm font-medium">
              Back to log in
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                type="email"
                autoComplete="email"
                className="w-full bg-bg-card border border-border rounded-lg px-3 py-2.5"
              />
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                type="password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                className="w-full bg-bg-card border border-border rounded-lg px-3 py-2.5"
              />
              {mode === 'signup' && (
                <input
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm password"
                  type="password"
                  autoComplete="new-password"
                  className="w-full bg-bg-card border border-border rounded-lg px-3 py-2.5"
                />
              )}
              {mode === 'signin' && (
                <button onClick={() => goToMode('forgot')} className="text-primary text-xs font-medium self-end -mt-1">
                  Forgot password?
                </button>
              )}
              {error && <p className="text-loss text-xs">{error}</p>}
              {info && <p className="text-text-muted text-xs">{info}</p>}
              <button
                onClick={submitEmail}
                disabled={submitting}
                className="w-full bg-primary text-white font-semibold py-3.5 rounded-xl disabled:opacity-40"
              >
                {mode === 'signin' ? 'Log in' : 'Sign up'}
              </button>
            </div>

            <button onClick={() => goToMode(mode === 'signin' ? 'signup' : 'signin')} className="text-primary text-sm font-medium">
              {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
            </button>

            <div className="flex flex-col gap-2 mt-2">
              <p className="text-center text-xs text-text-muted">or continue with</p>
              <button
                onClick={() => oauth(signInWithGoogle)}
                className="w-full bg-bg-card border border-border font-medium py-2.5 rounded-xl text-sm flex items-center justify-center gap-2"
              >
                Google
              </button>
              <button
                onClick={() => oauth(signInWithApple)}
                className="w-full bg-bg-card border border-border font-medium py-2.5 rounded-xl text-sm flex items-center justify-center gap-2"
              >
                Apple
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
