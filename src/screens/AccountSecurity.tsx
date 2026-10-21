import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AtSign, KeyRound, LogOut, MailCheck, ShieldAlert, Smartphone } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { BackHeader } from '../components/layout/BackHeader';
import { SectionHeader, SettingsRow } from '../components/settings/SettingsPrimitives';
import { PasswordInput } from '../components/common/PasswordInput';
import { ConfirmSheet } from '../components/common/ConfirmSheet';

/** The shortest password this screen will set. Supabase's own floor is lower, so asking for more
 *  here is always compatible with the server and never produces a rejection the user cannot read. */
const MIN_PASSWORD = 8;

const FIELD = 'w-full bg-bg-raised border border-border rounded-lg px-2.5 py-2 text-sm';

const PROVIDER_LABELS: Record<string, string> = {
  email: 'Email and password',
  google: 'Google',
  apple: 'Apple',
};

/** Everything about the account itself, as opposed to the team wearing it: which address signs in,
 * what the password is, where it is signed in, and how to leave for good.
 *
 * Deliberately its own screen rather than two rows under Settings. These are the actions where a
 * mistake is expensive and where people expect to find a familiar shape, so they get room to explain
 * themselves: what a change will do, what it will not touch, and what cannot be undone. The team's
 * own name, colour and logo are not here, they belong to the team and live on the profile.
 */
export function AccountSecurity() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const signOutEverywhere = useAuthStore((s) => s.signOutEverywhere);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [logoutAllOpen, setLogoutAllOpen] = useState(false);

  const email = user?.email ?? '';
  // Supabase keeps the old address live and carries the new one here until the link in the
  // confirmation mail is followed, so a change that is still waiting has to be visible. Otherwise
  // the screen would keep showing the old address with no sign anything is in flight.
  const pendingEmail = (user as { new_email?: string } | null)?.new_email ?? '';
  const providers = (user?.identities ?? []).map((i) => i.provider);
  const hasPassword = providers.length === 0 || providers.includes('email');

  return (
    <div className="flex flex-col">
      <BackHeader title="Account & Security" fallback="/settings" />
      <div className="p-4 space-y-5 pb-8">
        <section className="space-y-2">
          <SectionHeader>Sign-in</SectionHeader>
          <EmailSection email={email} pendingEmail={pendingEmail} />
          {providers.length > 0 && (
            <div className="bg-bg-card border border-border rounded-xl p-3 space-y-1.5">
              <p className="text-[11px] text-text-muted">You can sign in with</p>
              <div className="flex flex-wrap gap-1.5">
                {providers.map((p) => (
                  <span key={p} className="text-[11px] font-semibold border border-border bg-bg-raised rounded-full px-2.5 py-1">
                    {PROVIDER_LABELS[p] ?? p}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="space-y-2">
          <SectionHeader>Password</SectionHeader>
          <PasswordSection email={email} hasPassword={hasPassword} />
        </section>

        <section className="space-y-2">
          <SectionHeader>Devices</SectionHeader>
          <div className="bg-bg-card border border-border rounded-xl overflow-hidden divide-y divide-border">
            <SettingsRow
              icon={<LogOut size={14} />}
              compact
              label="Log Out"
              summary="This device only"
              tone="danger"
              chevron={false}
              onClick={() => setLogoutOpen(true)}
            />
            <SettingsRow
              icon={<Smartphone size={14} />}
              compact
              label="Log Out Everywhere"
              summary="Ends every signed-in device"
              tone="danger"
              chevron={false}
              onClick={() => setLogoutAllOpen(true)}
            />
          </div>
        </section>

        <section className="space-y-2">
          <SectionHeader>Delete account</SectionHeader>
          <DeleteAccountSection />
        </section>
      </div>

      {logoutOpen && (
        <ConfirmSheet
          title="Log out of PropLeague?"
          confirmLabel="Log Out"
          confirmingLabel="Logging out…"
          onConfirm={async () => {
            await signOut();
            navigate('/welcome');
          }}
          onClose={() => setLogoutOpen(false)}
        />
      )}
      {logoutAllOpen && (
        <ConfirmSheet
          title="Log out everywhere?"
          description="Every device signed in to this account is signed out, including this one. Your leagues, teams and history are not affected."
          confirmLabel="Log Out Everywhere"
          confirmingLabel="Logging out…"
          onConfirm={async () => {
            const result = await signOutEverywhere();
            if (!result.ok) return result;
            navigate('/welcome');
            return { ok: true };
          }}
          onClose={() => setLogoutAllOpen(false)}
        />
      )}
    </div>
  );
}

/** A card that collapses to one row and opens into a short form, the shape the old Change Password
 *  row in Settings already used, so these read as the same kind of thing. */
function Panel({
  icon,
  label,
  summary,
  open,
  onOpen,
  onClose,
  children,
}: {
  icon: ReactNode;
  label: string;
  summary?: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
      {!open ? (
        <SettingsRow icon={icon} compact label={label} summary={summary} onClick={onOpen} />
      ) : (
        <div className="p-3 space-y-2">
          <p className="text-xs font-bold">{label}</p>
          {children}
          <button onClick={onClose} className="w-full bg-bg-raised border border-border font-medium py-2 rounded-lg text-sm">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function EmailSection({ email, pendingEmail }: { email: string; pendingEmail: string }) {
  const updateEmail = useAuthStore((s) => s.updateEmail);
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    const value = next.trim();
    if (!value.includes('@') || !value.includes('.')) {
      setError('Enter a valid email address.');
      return;
    }
    if (value.toLowerCase() === email.toLowerCase()) {
      setError('That is already your address.');
      return;
    }
    setBusy(true);
    const result = await updateEmail(value);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? 'Could not change your email.');
      return;
    }
    setSent(true);
    setNext('');
  }

  return (
    <div className="space-y-2">
      <Panel
        icon={<AtSign size={14} />}
        label="Email"
        summary={email || 'No address on this account'}
        open={open}
        onOpen={() => {
          setOpen(true);
          setSent(false);
          setError(null);
        }}
        onClose={() => setOpen(false)}
      >
        <input
          value={next}
          onChange={(e) => setNext(e.target.value)}
          placeholder="New email address"
          type="email"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="email"
          className={FIELD}
        />
        {error && <p className="text-loss text-xs">{error}</p>}
        {sent && <p className="text-profit text-xs">Check your new address for a confirmation link.</p>}
        <p className="text-[11px] text-text-muted leading-snug">
          You keep signing in with your current address until you follow the link we send to the new
          one.
        </p>
        <button
          onClick={submit}
          disabled={busy}
          className="w-full btn-soft-primary font-semibold py-2 rounded-lg text-sm disabled:opacity-40"
        >
          {busy ? 'Sending…' : 'Send confirmation'}
        </button>
      </Panel>
      {pendingEmail && (
        <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2">
          <MailCheck size={14} className="text-warning shrink-0 mt-0.5" />
          <p className="text-[11px] leading-snug">
            Waiting on <span className="font-semibold">{pendingEmail}</span>. Follow the link in that
            inbox to finish the change.
          </p>
        </div>
      )}
    </div>
  );
}

function PasswordSection({ email, hasPassword }: { email: string; hasPassword: boolean }) {
  const verifyPassword = useAuthStore((s) => s.verifyPassword);
  const updatePassword = useAuthStore((s) => s.updatePassword);
  const requestPasswordReset = useAuthStore((s) => s.requestPasswordReset);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resetNote, setResetNote] = useState<string | null>(null);

  function reset() {
    setCurrent('');
    setNext('');
    setConfirm('');
  }

  async function submit() {
    setError(null);
    if (next.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (next !== confirm) {
      setError('Those do not match.');
      return;
    }
    setBusy(true);
    // The current password is checked first so that someone holding an unlocked phone cannot take
    // the account outright. An account that only ever signed in with Google or Apple has no password
    // to check, which is why that case sets one instead of changing it.
    if (hasPassword) {
      const check = await verifyPassword(current);
      if (!check.ok) {
        setBusy(false);
        setError(check.error ?? 'That password is not right.');
        return;
      }
    }
    const result = await updatePassword(next);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? 'Could not change your password.');
      return;
    }
    setDone(true);
    reset();
  }

  return (
    <div className="space-y-2">
      <Panel
        icon={<KeyRound size={14} />}
        label={hasPassword ? 'Change Password' : 'Set a Password'}
        summary={hasPassword ? undefined : 'So you can sign in without Google or Apple'}
        open={open}
        onOpen={() => {
          setOpen(true);
          setDone(false);
          setError(null);
          reset();
        }}
        onClose={() => setOpen(false)}
      >
        {hasPassword && (
          <PasswordInput
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder="Current password"
            autoComplete="current-password"
            className={FIELD}
          />
        )}
        <PasswordInput
          value={next}
          onChange={(e) => setNext(e.target.value)}
          placeholder={`New password (${MIN_PASSWORD}+ characters)`}
          autoComplete="new-password"
          className={FIELD}
        />
        <PasswordInput
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm new password"
          autoComplete="new-password"
          className={FIELD}
        />
        {error && <p className="text-loss text-xs">{error}</p>}
        {done && <p className="text-profit text-xs">Password updated.</p>}
        <button
          onClick={submit}
          disabled={busy}
          className="w-full btn-soft-primary font-semibold py-2 rounded-lg text-sm disabled:opacity-40"
        >
          {busy ? 'Saving…' : hasPassword ? 'Change password' : 'Set password'}
        </button>
      </Panel>

      {/* The way back in for someone who cannot remember the current password, which is exactly the
          person the verification step above would otherwise lock out. */}
      {email && (
        <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
          <SettingsRow
            icon={<MailCheck size={14} />}
            compact
            label="Email Me A Reset Link"
            summary={resetNote ?? `Goes to ${email}`}
            chevron={false}
            onClick={async () => {
              const result = await requestPasswordReset(email);
              setResetNote(result.ok ? 'Link sent. Check your inbox.' : (result.error ?? 'Could not send that link.'));
            }}
          />
        </div>
      )}
    </div>
  );
}

function DeleteAccountSection() {
  const navigate = useNavigate();
  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const armed = typed.trim().toUpperCase() === 'DELETE';

  return (
    <div className="bg-bg-card border border-loss/40 rounded-xl overflow-hidden">
      {!open ? (
        <SettingsRow
          icon={<ShieldAlert size={14} />}
          compact
          label="Delete My Account"
          summary="Permanent, and cannot be undone"
          tone="danger"
          onClick={() => {
            setOpen(true);
            setError(null);
            setTyped('');
          }}
        />
      ) : (
        <div className="p-3 space-y-2">
          <p className="text-xs font-bold text-loss">Delete my account</p>
          {/* Said plainly and in full, because this is the one action nobody can walk back and the
              part that surprises people is what happens to their leagues, not to their login. */}
          <ul className="text-[11px] text-text-muted leading-relaxed list-disc pl-4 space-y-0.5">
            <li>Your login, profile and notification settings are deleted.</li>
            <li>Each of your teams keeps playing as an AI team, so nobody's schedule breaks.</li>
            <li>Weeks already played, standings, chat and the prize pool stay as they are.</li>
            <li>If you run a league, it is handed to another member.</li>
            <li>None of this can be undone, and the same email can start over from scratch.</li>
          </ul>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Type DELETE to confirm"
            autoCapitalize="characters"
            autoCorrect="off"
            className={FIELD}
          />
          {error && <p className="text-loss text-xs">{error}</p>}
          <button
            onClick={async () => {
              if (!armed || busy) return;
              setBusy(true);
              setError(null);
              const result = await deleteAccount();
              setBusy(false);
              if (!result.ok) {
                setError(result.error ?? 'Could not delete your account.');
                return;
              }
              navigate('/welcome');
            }}
            disabled={!armed || busy}
            className="w-full btn-soft-loss font-semibold py-2 rounded-lg text-sm disabled:opacity-40"
          >
            {busy ? 'Deleting…' : 'Delete my account'}
          </button>
          <button
            onClick={() => setOpen(false)}
            className="w-full bg-bg-raised border border-border font-medium py-2 rounded-lg text-sm"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
