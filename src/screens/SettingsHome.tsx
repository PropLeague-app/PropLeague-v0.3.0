import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { useAuthStore } from '../store/useAuthStore';
import { useUIStore } from '../store/useUIStore';
import { NameInput } from '../components/common/NameInput';
import { ToggleRow } from '../components/common/Toggle';
import { IdentityPicker } from '../components/common/IdentityPicker';
import { uploadTeamLogo } from '../services/supabaseLogo';
import { abbrevFromName } from '../data/simulatedTeamNames';
import { HowItWorksSheet } from '../components/common/HowItWorksSheet';
import { ConfirmSheet } from '../components/common/ConfirmSheet';
import { fetchNotificationPrefs, getCachedNotificationPrefs, updateNotificationPrefs, DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs, type SlateUpdates } from '../services/notificationPrefs';
import logoMark from '../assets/logo-mono-muted.png';
import { LeaveLeagueSheet } from '../components/settings/LeaveLeagueSheet';
import { LeagueSettingsPanel } from '../components/settings/LeagueSettingsPanel';
import { VoidRequestsCard } from '../components/settings/VoidRequestsCard';
import { lossColor, lossIntensity } from '../engine/plColor';
import { formatCents } from '../engine/oddsMath';
import { ChipRow, CollapsibleSection, HelpContext, SectionHeader, SubSection } from '../components/settings/SettingsPrimitives';
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
  Radio,
  Repeat,
  Smartphone,
  Sun,
  TrendingDown,
  Wrench,
} from 'lucide-react';

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
          className={`px-2.5 py-1.5 text-xs font-semibold flex items-center gap-1 ${value === o.value ? 'bg-primary text-white' : 'text-text-muted'}`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A group title with a small icon and a scope tag on the right, in place of a description line. */
function GroupTitle({ icon, title, tag }: { icon: ReactNode; title: string; tag?: string }) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-[13px] font-semibold flex items-center gap-1.5">
        <span className="text-text-muted">{icon}</span>
        {title}
      </p>
      {tag && <span className="text-[10px] text-text-muted">{tag}</span>}
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
        className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left"
      >
        <KeyRound size={16} /> Change Password
      </button>
    );
  }

  return (
    <div className="p-3 space-y-2">
      <input
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        placeholder="New password"
        type="password"
        autoComplete="new-password"
        className="w-full bg-bg-raised border border-border rounded-lg px-2.5 py-1.5 text-sm"
      />
      <input
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        placeholder="Confirm new password"
        type="password"
        autoComplete="new-password"
        className="w-full bg-bg-raised border border-border rounded-lg px-2.5 py-1.5 text-sm"
      />
      {error && <p className="text-loss text-xs">{error}</p>}
      {success && <p className="text-profit text-xs">Password updated.</p>}
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={submitting}
          className="flex-1 bg-primary text-white font-semibold py-1.5 rounded-lg text-sm disabled:opacity-40"
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
  const [leagueIdentityDirty, setLeagueIdentityDirty] = useState(false);
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
  const anyDirty = teamIdentityDirty || leagueIdentityDirty || profileDirty || teamNameDirty;
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
              className="bg-bg-card border border-border rounded-xl px-3 py-2.5 flex items-center gap-2 text-sm"
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
              className="w-full bg-primary text-white font-semibold py-2.5 rounded-lg text-sm disabled:opacity-40"
            >
              {startSeasonBusy ? 'Starting…' : 'Start Season'}
            </button>
            {league.teams.length < 2 && <p className="text-[11px] text-text-muted">Need at least 2 teams first.</p>}
          </div>
        )}

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
                  className="flex-1 bg-primary text-white font-semibold py-1.5 rounded-lg text-sm disabled:opacity-40"
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
                    className="flex-1 bg-primary text-white font-semibold py-1.5 rounded-lg text-sm disabled:opacity-40"
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
                {logoUploadError && <p className="text-loss text-xs mt-1">{logoUploadError}</p>}
              </div>
            )}
          </CollapsibleSection>
        )}

        <section className="space-y-2">
          <SectionHeader>App Preferences</SectionHeader>
          <div className="bg-bg-card border border-border rounded-xl p-2.5 space-y-3">
            <div className="space-y-2.5">
              <GroupTitle icon={<Smartphone size={14} />} title="Display" tag="This device" />
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
                <Seg
                  value={profile?.themeMode ?? 'dark'}
                  onChange={setThemeMode}
                  options={[
                    { value: 'dark', label: 'Dark', icon: <Moon size={13} />, ariaLabel: 'Dark theme' },
                    { value: 'light', label: 'Light', icon: <Sun size={13} />, ariaLabel: 'Light theme' },
                  ]}
                />
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
            <div className={`pt-3 border-t border-border space-y-2.5 transition-opacity duration-150 ${prefsLoaded ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
              <GroupTitle icon={<Bell size={14} />} title="Notifications" />
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
                label="Week results ready"
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
            </div>
          </div>
        </section>

        {league && settings && (
          <LeagueSettingsPanel
            league={league}
            isCommissioner={isCommissioner}
            defaultLeagueName={`${profile?.username ?? 'Commissioner'}'s League`}
            onIdentityDirtyChange={setLeagueIdentityDirty}
          />
        )}

        {league && userTeam && !seasonNotStarted && <VoidRequestsCard leagueId={league.id} week={league.currentWeek} isCommissioner={isCommissioner} />}

        {/* The "Advance Past Week" commissioner button that used to live here is gone --
            season progression (week advance, live-game status, playoff bracket seeding,
            prize pool) is now fully automatic server-side (settle-week's cron schedule),
            per Hunter's explicit "everything should work on its own" call. See chat. */}
        <section className="space-y-2">
          <SectionHeader>League</SectionHeader>
          <div className="bg-bg-card border border-border rounded-xl overflow-hidden divide-y divide-border">
            <button onClick={() => goTo('/create-league')} className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left">
              <Plus size={16} /> Create a League
            </button>
            <button onClick={() => goTo('/join-league')} className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left">
              <KeyRound size={16} /> Join a League
            </button>
            {league && userTeam && (
              <button
                onClick={() => setLeaveSheetOpen(true)}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left text-loss"
              >
                <DoorOpen size={16} /> Leave This League
              </button>
            )}
          </div>
        </section>

        <section className="space-y-2">
          <SectionHeader>Account</SectionHeader>
          <div className="bg-bg-card border border-border rounded-xl overflow-hidden divide-y divide-border">
            <ChangePasswordRow />
            <button
              onClick={() => setLogoutConfirmOpen(true)}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left text-loss"
            >
              <Lock size={16} /> Log Out
            </button>
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
