import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { SOFT_PRIMARY_BTN } from '../components/common/buttonStyles';
import { useAuthStore } from '../store/useAuthStore';
import { useUIStore } from '../store/useUIStore';
import { NameInput } from '../components/common/NameInput';
import { ToggleRow } from '../components/common/Toggle';
import { lazyNamed } from '../lazyLoad';

// The logo picker carries the full emoji set, so it loads on first use (lazyLoad.ts).
const IdentityPicker = lazyNamed(() => import('../components/common/IdentityPicker'), 'IdentityPicker');
import { uploadTeamLogo } from '../services/supabaseLogo';
import { abbrevFromName } from '../data/simulatedTeamNames';
import { HowItWorksSheet } from '../components/common/HowItWorksSheet';
import { ConfirmSheet } from '../components/common/ConfirmSheet';
import { fetchNotificationPrefs, getCachedNotificationPrefs, updateNotificationPrefs, DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs, type SlateUpdates } from '../services/notificationPrefs';
import logoMark from '../assets/logo-mono-muted.png';
import { LeaveLeagueSheet } from '../components/settings/LeaveLeagueSheet';
import { VoidRequestsCard } from '../components/settings/VoidRequestsCard';
import { lossColor, lossIntensity } from '../engine/plColor';
import { formatCents } from '../engine/oddsMath';
import { ChipRow, CollapsibleSection, HelpContext, SectionHeader, SettingsRow, SubSection } from '../components/settings/SettingsPrimitives';
import { meaningfulPending, pendingKeys } from '../engine/settingsRules';
import {
  ChartColumn,
  Calendar,
  Users,
  Trophy,
  Ticket,
  DollarSign,
  TrendingUp,
  Medal,
  KeyRound,
  Plus,
  DoorOpen,
  Lock,
  UserRound,
  Bell,
  BellRing,
  CalendarCheck,
  CircleCheck,
  Moon,
  MoonStar,
  Radio,
  Repeat,
  Smartphone,
  Sun,
  Check,
  ChevronDown,
  ChevronRight,
  SunMoon,
  SlidersHorizontal,
  TrendingDown,
  Wrench,
} from 'lucide-react';
import { PasswordInput } from '../components/common/PasswordInput';
import type { ThemeMode } from '../types';

const MORE_LINKS = [
  { to: '/standings', label: 'Full Standings', icon: <ChartColumn size={18} /> },
  { to: '/schedule', label: 'Season Schedule', icon: <Calendar size={18} /> },
  { to: '/members', label: 'League Members', icon: <Users size={18} /> },
  { to: '/bracket', label: 'Playoff Bracket', icon: <Trophy size={18} /> },
  { to: '/bet-history', label: 'My Bets', icon: <Ticket size={18} /> },
  { to: '/prize-pool', label: 'Prize Pool', icon: <DollarSign size={18} /> },
  { to: '/my-stats', label: 'My Stats', icon: <TrendingUp size={18} /> },
  { to: '/leaderboards', label: 'Leaderboards', icon: <Medal size={18} /> },
];

const AVATARS = ['🦅', '🐻', '🐺', '🦁', '🐯', '🦈', '🐉', '🦂', '🐢', '🦍', '🦊', '🐗'];

/** Compact two-or-three option switch used by the display preferences. */
function Seg<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label?: string; icon?: ReactNode; ariaLabel: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex bg-bg-raised rounded-lg overflow-hidden shrink-0">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-label={o.ariaLabel}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1.5 text-xs font-semibold flex items-center gap-1 ${value === o.value ? 'seg-active' : 'text-text-muted'}`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

const THEME_OPTIONS: { value: ThemeMode; label: string; hint?: string; icon: ReactNode }[] = [
  { value: 'auto', label: 'Auto', hint: 'Matches your phone', icon: <SunMoon size={14} /> },
  { value: 'light', label: 'Light', icon: <Sun size={14} /> },
  { value: 'graphite', label: 'Dark', icon: <Moon size={14} /> },
  { value: 'dark', label: 'Midnight', icon: <MoonStar size={14} /> },
];

/** Theme picker as an app-styled dropdown (four options will not fit in a segmented control beside the
 * label). A small button shows the current choice; tapping it opens a themed menu instead of the native
 * iOS picker. */
function ThemeMenu({ value, onChange }: { value: ThemeMode; onChange: (v: ThemeMode) => void }) {
  const [open, setOpen] = useState(false);
  const current = THEME_OPTIONS.find((o) => o.value === value) ?? THEME_OPTIONS[3];
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="sel-pill border rounded-lg px-2.5 py-1.5 text-xs font-semibold flex items-center gap-1.5"
      >
        {current.icon}
        {current.label}
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div role="listbox" className="absolute right-0 top-full mt-1.5 z-40 w-48 bg-bg-raised border border-border rounded-xl shadow-2xl p-1">
            {THEME_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={value === o.value}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-xs font-semibold ${value === o.value ? 'seg-active' : 'text-text'}`}
              >
                {o.icon}
                <span className="flex-1">
                  {o.label}
                  {o.hint && <span className="block text-[10px] font-normal text-text-muted">{o.hint}</span>}
                </span>
                {value === o.value && <Check size={14} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PrefRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm">{label}</p>
      {children}
    </div>
  );
}
/** Collapsed to a single row by default; expands into a small inline form.
 * Manages its own state so it doesn't add more hooks to the already-large
 * SettingsHome component. */
function ChangePasswordRow() {
  const updatePassword = useAuthStore((s) => s.updatePassword);
  const [open, setOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setError(null);
    if (!newPassword) {
      setError('Enter a new password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    const result = await updatePassword(newPassword);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? 'Something went wrong.');
      return;
    }
    setSuccess(true);
    setNewPassword('');
    setConfirmPassword('');
  }

  if (!open) {
    return (
      <button
        onClick={() => {
          setOpen(true);
          setSuccess(false);
          setError(null);
        }}
        className="w-full flex items-center gap-2.5 pl-3 pr-3 py-2 text-left transition-colors active:bg-bg-raised"
      >
        <span className="w-6 h-6 shrink-0 rounded-md bg-primary/10 text-primary flex items-center justify-center">
          <KeyRound size={14} />
        </span>
        <span className="flex-1 text-xs font-medium text-text">Change Password</span>
        <ChevronRight size={16} className="text-text-muted shrink-0" />
      </button>
    );
  }

  return (
    <div className="p-3 space-y-2">
      <PasswordInput
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        placeholder="New password"
        autoComplete="new-password"
        className="w-full bg-bg-raised border border-border rounded-lg px-2.5 py-1.5 text-sm"
      />
      <PasswordInput
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        placeholder="Confirm new password"
        autoComplete="new-password"
        className="w-full bg-bg-raised border border-border rounded-lg px-2.5 py-1.5 text-sm"
      />
      {error && <p className="text-loss text-xs">{error}</p>}
      {success && <p className="text-profit text-xs">Password updated.</p>}
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={submitting}
          className="flex-1 btn-soft-primary font-semibold py-1.5 rounded-lg text-sm disabled:opacity-40"
        >
          Save
        </button>
        <button onClick={() => setOpen(false)} className="flex-1 bg-bg-raised border border-border font-medium py-2 rounded-lg text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}

export function SettingsHome() {
  const navigate = useNavigate();
  const profile = useAppStore((s) => s.profile);
  const setOddsFormat = useAppStore((s) => s.setOddsFormat);
  const setThemeMode = useAppStore((s) => s.setThemeMode);
  const updateProfile = useAppStore((s) => s.updateProfile);
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));
  const updateUserTeam = useAppStore((s) => s.updateUserTeam);
  const refreshLeagueSettings = useAppStore((s) => s.refreshLeagueSettings);
  const transferCommissioner = useAppStore((s) => s.transferCommissioner);
  const leaveLeague = useAppStore((s) => s.leaveLeague);
  const startSeason = useAppStore((s) => s.startSeason);
  const authUpdateProfile = useAuthStore((s) => s.updateProfile);
  const authProfileId = useAuthStore((s) => s.profile?.id);

  // Persisted to profiles.notification_prefs (see migration 0008, chat Sept
  // 2026) rather than local-only state -- these used to be pure useState
  // stubs with no backend behind them at all. Starts from the same
  // every-on default the server-side senders use, then syncs to whatever's
  // actually saved once authProfileId is known.
  // Starts from the last prefs this device saw, so a toggle that is off never flashes on. With nothing
  // cached yet (first visit) the block stays invisible until the real values arrive.
  const cachedPrefs = getCachedNotificationPrefs(authProfileId);
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPrefs>(cachedPrefs ?? DEFAULT_NOTIFICATION_PREFS);
  const [prefsLoaded, setPrefsLoaded] = useState(cachedPrefs != null);
  useEffect(() => {
    if (!authProfileId) return;
    let cancelled = false;
    void fetchNotificationPrefs(authProfileId).then((prefs) => {
      if (cancelled) return;
      setNotificationPrefs(prefs);
      setPrefsLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [authProfileId]);

  function toggleNotificationPref(key: 'lineupReminders' | 'wagerSettled' | 'weekResults' | 'liveActivities', value: boolean) {
    setNotificationPrefs((prev) => ({ ...prev, [key]: value })); // optimistic -- reverted below if the save fails
    if (!authProfileId) return;
    void updateNotificationPrefs(authProfileId, { [key]: value }).then((result) => {
      if (!result.ok) {
        console.error('[settings] failed to save notification preference:', result.error);
        setNotificationPrefs((prev) => ({ ...prev, [key]: !value }));
      }
    });
  }
  function chooseSlateUpdates(value: SlateUpdates) {
    const previous = notificationPrefs.slateUpdates;
    setNotificationPrefs((prev) => ({ ...prev, slateUpdates: value }));
    if (!authProfileId) return;
    void updateNotificationPrefs(authProfileId, { slateUpdates: value }).then((result) => {
      if (!result.ok) {
        console.error('[settings] failed to save slate update preference:', result.error);
        setNotificationPrefs((prev) => ({ ...prev, slateUpdates: previous }));
      }
    });
  }
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  const [helpFocus, setHelpFocus] = useState<{ category: string; topic: string } | null>(null);
  const [pendingNav, setPendingNav] = useState<string | null>(null);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [teamIdentityDirty, setTeamIdentityDirty] = useState(false);
  const [leaveSheetOpen, setLeaveSheetOpen] = useState(false);
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);

  const userTeam = league?.teams.find((t) => t.isUser);
  const settings = league?.settings;

  // Explicit-save drafts for username/avatar and team name/abbrev (see chat: these
  // used to commit on every keystroke straight to local-only state, which is why
  // they always reverted after a sign-out -- factoryReset wipes local state, and
  // nothing was ever pushed to Supabase to re-hydrate from). Re-seeded whenever the
  // underlying saved value actually changes (a real save completing, or a fresh
  // fetch from another device); left alone otherwise so an in-progress edit is
  // never silently overwritten mid-type.
  const [usernameDraft, setUsernameDraft] = useState(profile?.username ?? '');
  const [avatarDraft, setAvatarDraft] = useState(profile?.avatarEmoji ?? '');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  useEffect(() => {
    setUsernameDraft(profile?.username ?? '');
    setAvatarDraft(profile?.avatarEmoji ?? '');
  }, [profile?.username, profile?.avatarEmoji]);
  const profileDirty = usernameDraft.trim() !== (profile?.username ?? '') || avatarDraft !== (profile?.avatarEmoji ?? '');

  const [teamNameDraft, setTeamNameDraft] = useState(userTeam?.teamName ?? '');
  const [abbrevDraft, setAbbrevDraft] = useState(userTeam?.abbrev ?? '');
  useEffect(() => {
    setTeamNameDraft(userTeam?.teamName ?? '');
    setAbbrevDraft(userTeam?.abbrev ?? '');
  }, [userTeam?.teamName, userTeam?.abbrev]);
  const teamNameDirty = !!userTeam && (teamNameDraft.trim() !== userTeam.teamName || abbrevDraft.trim().toUpperCase() !== userTeam.abbrev);

  const [startSeasonBusy, setStartSeasonBusy] = useState(false);
  const [startSeasonError, setStartSeasonError] = useState<string | null>(null);
  const isCommissioner = !!league && !!userTeam && userTeam.id === league.commissionerTeamId;
  const [searchParams] = useSearchParams();
  const openVoidRequests = searchParams.get('open') === 'void-requests';
  const seasonNotStarted = !!league && Object.keys(league.matchupsByWeek).length === 0;

  // Members only see the commissioner's settings read-only, and the commissioner needs
  // the current lock / scheduled-changes state, so refetch both when the screen opens
  // (see refreshLeagueSettings). Runs once on open, before any edit can be in flight.
  const leagueId = league?.id;
  useEffect(() => {
    if (!leagueId) return;
    void refreshLeagueSettings(leagueId);
  }, [leagueId, refreshLeagueSettings]);

  async function handleSaveProfile() {
    const trimmed = usernameDraft.trim();
    if (!trimmed) {
      setProfileError('Username cannot be empty.');
      return;
    }
    setProfileSaving(true);
    setProfileError(null);
    const result = await authUpdateProfile({ username: trimmed, avatarEmoji: avatarDraft });
    setProfileSaving(false);
    if (!result.ok) {
      setProfileError(result.error ?? 'Something went wrong.');
      return;
    }
    setUsernameDraft(trimmed);
  }

  function handleSaveTeam() {
    if (!league || !userTeam) return;
    const trimmedName = teamNameDraft.trim() || profile?.username || 'My Team';
    const trimmedAbbrev = (abbrevDraft.trim() || abbrevFromName(trimmedName)).toUpperCase().slice(0, 4);
    updateUserTeam(league.id, { teamName: trimmedName, abbrev: trimmedAbbrev });
    setTeamNameDraft(trimmedName);
    setAbbrevDraft(trimmedAbbrev);
  }

  async function handleStartSeason() {
    if (!league) return;
    setStartSeasonBusy(true);
    setStartSeasonError(null);
    const result = await startSeason(league.id);
    setStartSeasonBusy(false);
    if (!result.ok) setStartSeasonError(result.error ?? 'Something went wrong.');
  }

  // Drives the bottom tab bar's discard-on-leave confirm (manual v0.1.1 §2 #4) — reset
  // on unmount too, as a safety net against a stale "dirty" flag surviving a route change.
  const setHasUnsavedChanges = useUIStore((s) => s.setHasUnsavedChanges);
  const anyDirty = teamIdentityDirty || profileDirty || teamNameDirty;
  useEffect(() => {
    setHasUnsavedChanges(anyDirty);
  }, [anyDirty, setHasUnsavedChanges]);
  useEffect(() => () => setHasUnsavedChanges(false), [setHasUnsavedChanges]);

  function goTo(link: string) {
    if (anyDirty) {
      setPendingNav(link); // confirmed via the ConfirmSheet rendered below
      return;
    }
    navigate(link);
  }

  const notificationsOn = [notificationPrefs.lineupReminders, notificationPrefs.wagerSettled, notificationPrefs.weekResults, notificationPrefs.liveActivities].filter(Boolean).length;
  const notificationSummary = prefsLoaded ? `${notificationsOn} of 4 on${notificationPrefs.lineupReminders ? ' · lineup reminders on' : ''}` : undefined;
  const leagueScheduledChanges = !!league && pendingKeys(meaningfulPending(league.settings, league.pendingSettings)).length > 0;
  const profileTeamSummary = [profile?.username, userTeam?.teamName].filter(Boolean).join(' · ');
  const profileTeamDirty = profileDirty || teamNameDirty || teamIdentityDirty;

  return (
    <HelpContext.Provider value={(category, topic) => setHelpFocus({ category, topic })}>
      <div className="flex items-center justify-between px-4 pt-2 pb-3 sticky top-0 bg-bg-raised z-10">
        <h1 className="text-xl font-bold">Profile & Settings</h1>
        <button
          onClick={() => setHowItWorksOpen(true)}
          aria-label="Help: how PropLeague works"
          className="w-8 h-8 rounded-full bg-bg-card border border-primary/50 text-primary text-base font-bold flex items-center justify-center shrink-0 active:scale-95"
        >
          ?
        </button>
      </div>

      <div className="px-4 pt-2 pb-5 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {MORE_LINKS.map((link) => (
            <button
              key={link.to}
              onClick={() => goTo(link.to)}
              className="bg-bg-card border border-border rounded-xl px-3 py-2.5 flex items-center gap-2 text-sm transition-colors active:bg-bg-raised"
            >
              <span>{link.icon}</span>
              {link.label}
            </button>
          ))}
        </div>

        {league && isCommissioner && seasonNotStarted && (
          <div className="bg-bg-card border border-dashed border-primary rounded-xl p-3 space-y-2">
            <p className="text-sm font-semibold">Start the season</p>
            <p className="text-xs text-text-muted">
              Generates Week 1 for the {league.teams.length} team{league.teams.length === 1 ? '' : 's'} in the league and locks conferences.
            </p>
            {startSeasonError && <p className="text-loss text-xs">{startSeasonError}</p>}
            <button
              disabled={startSeasonBusy || league.teams.length < 2}
              onClick={handleStartSeason}
              className={`w-full py-2.5 rounded-lg text-sm ${SOFT_PRIMARY_BTN}`}
            >
              {startSeasonBusy ? 'Starting…' : 'Start Season'}
            </button>
            {league.teams.length < 2 && <p className="text-[11px] text-text-muted">Need at least 2 teams first.</p>}
          </div>
        )}

        <section className="space-y-2">
          <SectionHeader>You</SectionHeader>
          {profile && (
            <CollapsibleSection
              title="Profile & Team"
              icon={<UserRound size={16} />}
              summary={profileTeamSummary}
              badge={profileTeamDirty ? 'Unsaved changes' : undefined}
            >
              <SubSection title="Profile (all leagues)">
                <div>
                  <label className="text-xs text-text-muted mb-0.5 block">Username</label>
                  <NameInput
                    value={usernameDraft}
                    fallback="Commissioner"
                    onChange={setUsernameDraft}
                    className="w-full bg-bg-raised border border-border rounded-lg px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-text-muted mb-0.5 block">Avatar</label>
                  <div className="grid grid-cols-6 gap-1">
                    {AVATARS.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => setAvatarDraft(emoji)}
                        className={`text-lg h-9 rounded-lg border flex items-center justify-center ${
                          avatarDraft === emoji ? 'border-primary bg-primary/10' : 'border-border bg-bg-raised'
                        }`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
                {profileError && <p className="text-loss text-xs">{profileError}</p>}
                <div className="flex items-center gap-2">
                  <button
                    disabled={!profileDirty || profileSaving}
                    onClick={handleSaveProfile}
                    className="flex-1 btn-soft-primary font-semibold py-1.5 rounded-lg text-sm disabled:opacity-40"
                  >
                    {profileSaving ? 'Saving…' : 'Save Changes'}
                  </button>
                  {profileDirty && (
                    <button
                      onClick={() => {
                        setUsernameDraft(profile.username);
                        setAvatarDraft(profile.avatarEmoji);
                        setProfileError(null);
                      }}
                      className="text-xs text-text-muted px-2"
                    >
                      Discard
                    </button>
                  )}
                </div>
              </SubSection>

              {league && userTeam && (
                <SubSection title="Team (this league)">
                  <div className="grid grid-cols-[1fr_4.5rem] gap-2">
                    <div>
                      <label className="text-xs text-text-muted mb-0.5 block">Team name</label>
                      <NameInput
                        value={teamNameDraft}
                        fallback={profile?.username ?? 'My Team'}
                        onChange={setTeamNameDraft}
                        className="w-full bg-bg-raised border border-border rounded-lg px-2.5 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-text-muted mb-0.5 block">Abbr.</label>
                      <NameInput
                        maxLength={4}
                        value={abbrevDraft}
                        fallback={abbrevFromName(teamNameDraft)}
                        onChange={(v) => setAbbrevDraft(v.toUpperCase())}
                        className="w-full bg-bg-raised border border-border rounded-lg px-2.5 py-1.5 text-sm uppercase"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      disabled={!teamNameDirty}
                      onClick={handleSaveTeam}
                      className="flex-1 btn-soft-primary font-semibold py-1.5 rounded-lg text-sm disabled:opacity-40"
                    >
                      Save Changes
                    </button>
                    {teamNameDirty && (
                      <button
                        onClick={() => {
                          setTeamNameDraft(userTeam.teamName);
                          setAbbrevDraft(userTeam.abbrev);
                        }}
                        className="text-xs text-text-muted px-2"
                      >
                        Discard
                      </button>
                    )}
                  </div>
                </SubSection>
              )}

              {league && userTeam && (
                <div className="pt-3 border-t border-border">
                  <Suspense fallback={null}>
                    <IdentityPicker
                      key={`team-${userTeam.id}`}
                      bare
                      title="Team Logo"
                      value={userTeam}
                      initials={userTeam.abbrev.slice(0, 2)}
                      colorLabel="Team color"
                      onSave={async (next, file) => {
                        updateUserTeam(league.id, next);
                        if (!file) return;
                        setLogoUploadError(null);
                        const result = await uploadTeamLogo(userTeam.id, file);
                        if (!result.ok) {
                          setLogoUploadError(result.error);
                          return;
                        }
                        // Swap the local base64 preview for the real, now-shared public URL.
                        updateUserTeam(league.id, { logoDataUrl: result.publicUrl });
                      }}
                      onDirtyChange={setTeamIdentityDirty}
                    />
                  </Suspense>
                  {logoUploadError && <p className="text-loss text-xs mt-1">{logoUploadError}</p>}
                </div>
              )}
            </CollapsibleSection>
          )}
          <div className="bg-bg-card border border-border rounded-xl">
            <div className="flex items-center gap-2.5 pl-3 pr-3 py-2.5">
              <span className="w-7 h-7 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <Smartphone size={16} />
              </span>
              <span className="text-sm font-bold text-text flex-1">Display</span>
              <span className="text-[10px] text-text-muted">This device</span>
            </div>
            <div className="border-t border-border p-2.5">
              <div className="space-y-2.5">
                <PrefRow label="Odds">
                  <Seg
                    value={profile?.oddsFormat ?? 'american'}
                    onChange={setOddsFormat}
                    options={[
                      { value: 'american', label: 'American', ariaLabel: 'American odds' },
                      { value: 'decimal', label: 'Decimal', ariaLabel: 'Decimal odds' },
                    ]}
                  />
                </PrefRow>
                <PrefRow label="Theme">
                  <ThemeMenu value={profile?.themeMode ?? 'dark'} onChange={setThemeMode} />
                </PrefRow>
                {/* Gains are always solid green; this only changes how losses are tinted (engine/plColor.ts). */}
                <PrefRow label="Loss colors">
                  <Seg
                    value={profile?.plColorScale ?? 'classic'}
                    onChange={(mode) => updateProfile({ plColorScale: mode })}
                    options={[
                      { value: 'classic', label: 'Classic', ariaLabel: 'Every loss red' },
                      { value: 'scaled', label: 'Scaled', ariaLabel: 'Losses fade from yellow to red' },
                    ]}
                  />
                </PrefRow>
                <div className="flex items-center justify-between bg-bg-raised rounded-lg px-3 py-1.5 text-xs font-semibold tabular-nums">
                  <span className="text-profit">{formatCents(20)}</span>
                  {[-5, -30, -75].map((amount) => (
                    <span
                      key={amount}
                      className="text-loss"
                      style={(profile?.plColorScale ?? 'classic') === 'scaled' ? { color: lossColor(lossIntensity(amount, 75)) } : undefined}
                    >
                      {formatCents(amount)}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <CollapsibleSection title="Notifications" icon={<Bell size={16} />} summary={notificationSummary}>
            <div className={`space-y-2.5 transition-opacity duration-150 ${prefsLoaded ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
              <ToggleRow
                icon={<BellRing size={15} />}
                label="Lineup reminders"
                value={notificationPrefs.lineupReminders}
                onChange={(v) => toggleNotificationPref('lineupReminders', v)}
              />
              {notificationPrefs.lineupReminders && (
                <div className="space-y-1">
                  <ChipRow
                    value={notificationPrefs.slateUpdates}
                    onChange={chooseSlateUpdates}
                    options={[
                      { value: 'needs_work', label: 'Needs work', icon: <Wrench size={14} /> },
                      { value: 'trailing', label: 'Trailing', icon: <TrendingDown size={14} /> },
                      { value: 'every_slate', label: 'Every slate', icon: <Repeat size={14} /> },
                    ]}
                  />
                  <p className="text-[11px] text-text-muted">
                    {notificationPrefs.slateUpdates === 'needs_work'
                      ? 'Only when slots are empty, credits unspent or games too few.'
                      : notificationPrefs.slateUpdates === 'trailing'
                        ? 'Also when you are behind in your matchup.'
                        : 'Before every slate, even when you are set.'}
                  </p>
                </div>
              )}
              <ToggleRow
                icon={<CircleCheck size={15} />}
                label="Settled-bet alerts"
                value={notificationPrefs.wagerSettled}
                onChange={(v) => toggleNotificationPref('wagerSettled', v)}
              />
              <ToggleRow
                icon={<CalendarCheck size={15} />}
                label="Week results"
                value={notificationPrefs.weekResults}
                onChange={(v) => toggleNotificationPref('weekResults', v)}
              />
              <ToggleRow
                icon={<Radio size={15} />}
                label="Live scores on lock screen"
                value={notificationPrefs.liveActivities}
                onChange={(v) => toggleNotificationPref('liveActivities', v)}
              />
              <p className="text-[11px] text-text-muted">
                Your matchup score and lineup countdown on the lock screen and Dynamic Island. iPhone with iOS 16.2 or later.
              </p>
              <p className="text-[11px] text-text-muted">
                These are your defaults for every league. To favorite, mute or change alerts for one league, tap the league name at the top of Home.
              </p>
            </div>
          </CollapsibleSection>
        </section>

        <section className="space-y-2">
          <SectionHeader>League</SectionHeader>
          {league && settings && (
            <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
              <SettingsRow
                icon={<SlidersHorizontal size={16} />}
                label="League Settings"
                badge={leagueScheduledChanges ? 'Changes scheduled' : undefined}
                summary={isCommissioner ? 'You are the commissioner' : 'View only, the commissioner edits these'}
                onClick={() => goTo('/settings/league')}
              />
            </div>
          )}
          {league && userTeam && !seasonNotStarted && (
            <VoidRequestsCard
              // A void request push opens Settings with ?open=void-requests: remounting with the card
              // open (and scrolled to) even if Settings was already on screen.
              key={openVoidRequests ? 'void-open' : 'void'}
              openOnMount={openVoidRequests}
              leagueId={league.id}
              week={league.currentWeek}
              isCommissioner={isCommissioner}
            />
          )}
          <div className="bg-bg-card border border-border rounded-xl overflow-hidden divide-y divide-border">
            <SettingsRow icon={<Plus size={14} />} compact label="Create a League" onClick={() => goTo('/create-league')} />
            <SettingsRow icon={<KeyRound size={14} />} compact label="Join a League" onClick={() => goTo('/join-league')} />
            {league && userTeam && (
              <SettingsRow icon={<DoorOpen size={14} />} compact label="Leave This League" tone="danger" onClick={() => setLeaveSheetOpen(true)} />
            )}
          </div>
        </section>

        <section className="space-y-2">
          <SectionHeader>Account</SectionHeader>
          <div className="bg-bg-card border border-border rounded-xl overflow-hidden divide-y divide-border">
            <ChangePasswordRow />
            <SettingsRow icon={<Lock size={14} />} compact label="Log Out" tone="danger" chevron={false} onClick={() => setLogoutConfirmOpen(true)} />
          </div>
        </section>

        <div className="flex flex-col items-center gap-1 pt-2 pb-1 text-text-muted">
          <img src={logoMark} alt="" className="w-6 h-6 object-contain opacity-80" />
          <p className="text-[11px]">PropLeague</p>
        </div>
        {(howItWorksOpen || helpFocus) && (
          <HowItWorksSheet
            settings={settings ?? null}
            focus={helpFocus ?? undefined}
            onClose={() => {
              setHowItWorksOpen(false);
              setHelpFocus(null);
            }}
          />
        )}
        {leaveSheetOpen && league && userTeam && (
          <LeaveLeagueSheet
            league={league}
            userTeamId={userTeam.id}
            onTransferCommissioner={(newCommissionerTeamId) => transferCommissioner(league.id, newCommissionerTeamId)}
            onLeave={async () => {
              const result = await leaveLeague(league.id);
              if (result.ok) {
                setLeaveSheetOpen(false);
                navigate('/');
              }
              return result;
            }}
            onClose={() => setLeaveSheetOpen(false)}
          />
        )}
        {pendingNav && (
          <ConfirmSheet
            title="Discard unsaved changes?"
            description="You have changes that have not been saved. Leaving this screen will discard them."
            confirmLabel="Discard"
            onConfirm={async () => {
              setHasUnsavedChanges(false);
              navigate(pendingNav);
            }}
            onClose={() => setPendingNav(null)}
          />
        )}
        {logoutConfirmOpen && (
          <ConfirmSheet
            title="Log out of PropLeague?"
            confirmLabel="Log Out"
            confirmingLabel="Logging out…"
            onConfirm={async () => {
              await useAuthStore.getState().signOut();
              navigate('/welcome');
            }}
            onClose={() => setLogoutConfirmOpen(false)}
          />
        )}
      </div>
    </HelpContext.Provider>
  );
}
