import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { useAuthStore } from '../store/useAuthStore';
import { useUIStore } from '../store/useUIStore';
import type { League, LeagueTeam, PlayoffFieldSize, Position } from '../types';
import { MOMENT_CATEGORIES, MOMENT_CATEGORY_LABELS, DEFAULT_MOMENT_DISPLAY_NAMES } from '../types';
import { NumberInput, NullableNumberInput } from '../components/common/NumberInput';
import { NameInput } from '../components/common/NameInput';
import { Toggle, ToggleRow } from '../components/common/Toggle';
import { IdentityPicker } from '../components/common/IdentityPicker';
import { TeamLogo } from '../components/common/TeamLogo';
import { conferencesEligible, defaultConferences } from '../engine/conferences';
import { doubleEliminationAvailable, fieldSizeOptionsForTeamCount, structureAvailable } from '../engine/playoffs';
import { activeMultipliers, multiplierRangeForSpread } from '../engine/prizePool';
import { abbrevFromName } from '../data/simulatedTeamNames';
import { HowItWorksSheet } from '../components/common/HowItWorksSheet';
import { initialsFromLeagueName } from '../components/common/LeagueLogo';
import { CorrelationRulesEditor } from '../components/settings/CorrelationRulesEditor';
import { PayoutSplitEditor } from '../components/settings/PayoutSplitEditor';
import { LeaveLeagueSheet } from '../components/settings/LeaveLeagueSheet';

const MORE_LINKS = [
  { to: '/standings', label: 'Full Standings', icon: '📊' },
  { to: '/schedule', label: 'Season Schedule', icon: '🗓️' },
  { to: '/members', label: 'League Members', icon: '👥' },
  { to: '/bracket', label: 'Playoff Bracket', icon: '🏆' },
  { to: '/bet-history', label: 'My Bets', icon: '🎟️' },
  { to: '/prize-pool', label: 'Prize Pool', icon: '💰' },
  { to: '/my-stats', label: 'My Stats', icon: '📈' },
  { to: '/leaderboards', label: 'Leaderboards', icon: '🥇' },
];

const AVATARS = ['🦅', '🐻', '🐺', '🦁', '🐯', '🦈', '🐉', '🦂', '🐢', '🦍', '🦊', '🐗'];
const POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE', 'K'];
const POSITION_RANGE: Record<Position | 'ML', [number, number]> = {
  QB: [1, 2],
  RB: [2, 4],
  WR: [2, 4],
  TE: [1, 2],
  K: [1, 2],
  ML: [1, 2],
};

function SectionHeader({ children }: { children: string }) {
  return <p className="font-semibold text-sm text-text-muted uppercase tracking-wide mt-2">{children}</p>;
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
        className="w-full flex items-center gap-2 px-3 py-3 text-sm text-left"
      >
        <span>🔑</span> Change Password
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
        className="w-full bg-bg-raised border border-border rounded-lg px-3 py-2 text-sm"
      />
      <input
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        placeholder="Confirm new password"
        type="password"
        autoComplete="new-password"
        className="w-full bg-bg-raised border border-border rounded-lg px-3 py-2 text-sm"
      />
      {error && <p className="text-loss text-xs">{error}</p>}
      {success && <p className="text-profit text-xs">Password updated.</p>}
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={submitting}
          className="flex-1 bg-primary text-white font-semibold py-2 rounded-lg text-sm disabled:opacity-40"
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
  const updateProfile = useAppStore((s) => s.updateProfile);
  const setOddsFormat = useAppStore((s) => s.setOddsFormat);
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));
  const updateUserTeam = useAppStore((s) => s.updateUserTeam);
  const updateLeagueLogo = useAppStore((s) => s.updateLeagueLogo);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const updateTargetTeamCount = useAppStore((s) => s.updateTargetTeamCount);
  const transferCommissioner = useAppStore((s) => s.transferCommissioner);
  const leaveLeague = useAppStore((s) => s.leaveLeague);

  const [notifLineup, setNotifLineup] = useState(true);
  const [notifSettled, setNotifSettled] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  const [teamIdentityDirty, setTeamIdentityDirty] = useState(false);
  const [leagueIdentityDirty, setLeagueIdentityDirty] = useState(false);
  const [leaveSheetOpen, setLeaveSheetOpen] = useState(false);

  const userTeam = league?.teams.find((t) => t.isUser);
  const settings = league?.settings;
  // manual v0.2.0 §2 #1: once the bracket exists the playoff format is fully locked;
  // before that, availability is decided per-option by structureAvailable below.
  const bracketLocked = !!league?.bracket;

  // Drives the bottom tab bar's discard-on-leave confirm (manual v0.1.1 §2 #4) — reset
  // on unmount too, as a safety net against a stale "dirty" flag surviving a route change.
  const setHasUnsavedChanges = useUIStore((s) => s.setHasUnsavedChanges);
  useEffect(() => {
    setHasUnsavedChanges(teamIdentityDirty || leagueIdentityDirty);
  }, [teamIdentityDirty, leagueIdentityDirty, setHasUnsavedChanges]);
  useEffect(() => () => setHasUnsavedChanges(false), [setHasUnsavedChanges]);

  function goTo(link: string) {
    if ((teamIdentityDirty || leagueIdentityDirty) && !confirm('You have unsaved changes. Discard them?')) return;
    setHasUnsavedChanges(false);
    navigate(link);
  }

  return (
    <div className="p-4 space-y-5">
      <h1 className="text-xl font-bold">Profile & Settings</h1>

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

      <SectionHeader>My Profile</SectionHeader>
      {profile && (
        <div className="bg-bg-card border border-border rounded-xl p-3 space-y-3">
          <div>
            <label className="text-xs text-text-muted mb-1 block">Username</label>
            <NameInput
              value={profile.username}
              fallback="Commissioner"
              onChange={(v) => updateProfile({ username: v })}
              className="w-full bg-bg-raised border border-border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-text-muted mb-1 block">Avatar</label>
            <div className="grid grid-cols-6 gap-1.5">
              {AVATARS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => updateProfile({ avatarEmoji: emoji })}
                  className={`text-xl aspect-square rounded-lg border flex items-center justify-center ${
                    profile.avatarEmoji === emoji ? 'border-primary bg-primary/10' : 'border-border bg-bg-raised'
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {league && userTeam && (
        <div className="bg-bg-card border border-border rounded-xl p-3 space-y-3">
          <p className="text-xs text-text-muted">Team (this league)</p>
          <div>
            <label className="text-xs text-text-muted mb-1 block">Team name</label>
            <NameInput
              value={userTeam.teamName}
              fallback={profile?.username ?? 'My Team'}
              onChange={(v) => updateUserTeam(league.id, { teamName: v })}
              className="w-full bg-bg-raised border border-border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-text-muted mb-1 block">Abbreviation</label>
            <NameInput
              maxLength={4}
              value={userTeam.abbrev}
              fallback={abbrevFromName(userTeam.teamName)}
              onChange={(v) => updateUserTeam(league.id, { abbrev: v.toUpperCase() })}
              className="w-24 bg-bg-raised border border-border rounded-lg px-3 py-2 text-sm uppercase"
            />
          </div>

        </div>
      )}

      {league && userTeam && (
        <IdentityPicker
          key={`team-${userTeam.id}`}
          title="Team Logo"
          value={userTeam}
          initials={userTeam.abbrev.slice(0, 2)}
          onSave={(next) => updateUserTeam(league.id, next)}
          onDirtyChange={setTeamIdentityDirty}
        />
      )}

      <SectionHeader>App Preferences</SectionHeader>
      <div className="bg-bg-card border border-border rounded-xl p-3 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm">Odds format</p>
          <div className="flex bg-bg-raised rounded-lg overflow-hidden">
            {(['american', 'decimal'] as const).map((format) => (
              <button
                key={format}
                onClick={() => setOddsFormat(format)}
                className={`px-3 py-1.5 text-xs font-semibold capitalize ${
                  profile?.oddsFormat === format ? 'bg-primary text-white' : 'text-text-muted'
                }`}
              >
                {format}
              </button>
            ))}
          </div>
        </div>
        <ToggleRow label="Lineup reminders" value={notifLineup} onChange={setNotifLineup} />
        <ToggleRow label="Settled-bet alerts" value={notifSettled} onChange={setNotifSettled} />
      </div>

      {league && settings && (
        <>
          <SectionHeader>League Settings — Basic</SectionHeader>
          {/* manual v0.2.0 §4 #9: moved here from a standalone spot above App
              Preferences — the league logo is a basic league-identity setting, so it
              belongs alongside league name/credits/slots. Keeps its own Save Changes
              behavior from v0.1.1 §2 #4 unchanged. */}
          <div>
            <IdentityPicker
              key={`league-${league.id}`}
              title="League Logo"
              value={league}
              initials={initialsFromLeagueName(league.name)}
              onSave={(next) => updateLeagueLogo(league.id, next)}
              onDirtyChange={setLeagueIdentityDirty}
            />
            <p className="text-[11px] text-text-muted mt-1.5 px-1">
              Shown on League Home, the invite screen, standings, and feed announcements.
            </p>
          </div>
          <div className="bg-bg-card border border-border rounded-xl p-3 space-y-3">
            <TextField
              label="League name"
              value={settings.leagueName}
              fallback={`${profile?.username ?? 'Commissioner'}'s League`}
              onChange={(v) => updateSettings(league.id, { leagueName: v })}
            />
            <ToggleRow label="Private league" value={!settings.isPublic} onChange={(v) => updateSettings(league.id, { isPublic: !v })} />
            <NumberField
              label="Weekly credit allocation"
              value={settings.weeklyCredits}
              onChange={(v) => updateSettings(league.id, { weeklyCredits: v })}
            />
            <div>
              <p className="text-xs text-text-muted mb-1.5">Lineup slots ({Object.values(settings.lineupSlots).reduce((a, b) => a + b, 0)} total)</p>
              {/* manual v0.3.0 §7: column-major fill puts QB/RB/WR down the left column
                  and TE/K/ML down the right, instead of the old row-major pairing
                  (QB+RB / WR+TE / K+ML) that split the offensive skill positions across
                  both columns for no reason. */}
              <div className="grid grid-cols-2 grid-rows-3 grid-flow-col gap-2">
                {[...POSITIONS, 'ML' as const].map((pos) => (
                  <div key={pos} className="flex items-center justify-between bg-bg-raised rounded-lg px-2.5 py-1.5">
                    <span className="text-xs font-medium">{pos}</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          updateSettings(league.id, {
                            lineupSlots: {
                              ...settings.lineupSlots,
                              [pos]: Math.max(POSITION_RANGE[pos][0], settings.lineupSlots[pos] - 1),
                            },
                          })
                        }
                        className="text-text-muted w-5"
                      >
                        −
                      </button>
                      <span className="text-sm w-4 text-center">{settings.lineupSlots[pos]}</span>
                      <button
                        onClick={() =>
                          updateSettings(league.id, {
                            lineupSlots: {
                              ...settings.lineupSlots,
                              [pos]: Math.min(POSITION_RANGE[pos][1], settings.lineupSlots[pos] + 1),
                            },
                          })
                        }
                        className="text-text-muted w-5"
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-text-muted mb-1.5 block">
                Team count: {league.targetTeamCount}
              </label>
              <div className="flex items-center gap-2">
                <button
                  disabled={league.teams.length > 1}
                  onClick={() => updateTargetTeamCount(league.id, league.targetTeamCount - 1)}
                  className="w-8 h-8 rounded-lg border border-border text-text-muted disabled:opacity-30"
                >
                  −
                </button>
                <span className="flex-1 text-center text-sm">{league.targetTeamCount}</span>
                <button
                  disabled={league.teams.length > 1}
                  onClick={() => updateTargetTeamCount(league.id, league.targetTeamCount + 1)}
                  className="w-8 h-8 rounded-lg border border-border text-text-muted disabled:opacity-30"
                >
                  +
                </button>
              </div>
              <p className="text-[11px] text-text-muted mt-1">
                {league.teams.length > 1
                  ? 'Locked once simulated teams join — resizing after that would leave the schedule and rosters inconsistent.'
                  : 'Resizing before the league fills may change which playoff fields are available.'}
              </p>
            </div>
            <div>
              <label className="text-xs text-text-muted mb-1.5 block">Playoff teams</label>
              <div className="flex gap-1.5">
                {(bracketLocked
                  ? [settings.playoffTeams as PlayoffFieldSize]
                  : fieldSizeOptionsForTeamCount(league.targetTeamCount).filter((n) =>
                      structureAvailable(n, doubleEliminationAvailable(n) ? settings.eliminationType : 'single', league.currentWeek),
                    )
                ).map((n) => {
                  const effectiveType = doubleEliminationAvailable(n) ? settings.eliminationType : 'single';
                  return (
                    <button
                      key={n}
                      disabled={bracketLocked}
                      onClick={() =>
                        updateSettings(league.id, {
                          playoffTeams: n,
                          eliminationType: effectiveType,
                        })
                      }
                      className={`flex-1 py-1.5 rounded-lg text-sm border disabled:opacity-40 ${
                        settings.playoffTeams === n ? 'border-primary text-primary bg-primary/10' : 'border-border'
                      }`}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="text-xs text-text-muted mb-1.5 block">Elimination structure</label>
              <div className="flex gap-2">
                {(bracketLocked
                  ? [settings.eliminationType]
                  : (['single', 'double'] as const).filter(
                      (type) =>
                        (type === 'single' || doubleEliminationAvailable(settings.playoffTeams as PlayoffFieldSize)) &&
                        structureAvailable(settings.playoffTeams as PlayoffFieldSize, type, league.currentWeek),
                    )
                ).map((type) => (
                  <button
                    key={type}
                    disabled={bracketLocked}
                    onClick={() => updateSettings(league.id, { eliminationType: type })}
                    className={`flex-1 py-1.5 rounded-lg text-sm border capitalize disabled:opacity-40 ${
                      settings.eliminationType === type ? 'border-primary text-primary bg-primary/10' : 'border-border'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-text-muted mt-1">
                {bracketLocked
                  ? 'Playoff format is locked — the bracket has already been generated.'
                  : 'Editable through the regular season — each field size/format disappears once there would no longer be enough weeks left to run it.'}
              </p>
            </div>
            <p className="text-[11px] text-text-muted">
              Members: {league.teams.length} joined (min 4 to begin) · Invite code {league.inviteCode}
            </p>
          </div>

          <button
            onClick={() => setAdvancedOpen((v) => !v)}
            className="w-full flex items-center justify-between bg-bg-card border border-border rounded-xl px-3 py-3"
          >
            <span className="font-semibold text-sm">Advanced Settings</span>
            <span className="text-text-muted">{advancedOpen ? '▲' : '▼'}</span>
          </button>

          {advancedOpen && (
            <div className="bg-bg-card border border-border rounded-xl p-3 space-y-4">
              <NumberField
                label="Max moneyline/spread bet"
                value={settings.maxMLBet}
                onChange={(v) => updateSettings(league.id, { maxMLBet: v })}
              />
              <NullableNumberField
                label="Max prop bet (blank = none)"
                value={settings.maxPropBet}
                placeholder="No max"
                onChange={(v) => updateSettings(league.id, { maxPropBet: v })}
              />
              <NumberField
                label="Single-bet allocation cap %"
                value={settings.singleBetCapPct * 100}
                onChange={(v) => updateSettings(league.id, { singleBetCapPct: v / 100 })}
              />
              <ToggleRow
                label="Hide picks before game start"
                value={settings.hidePicks}
                onChange={(v) => updateSettings(league.id, { hidePicks: v })}
              />
              <ToggleRow label="Allow live bets" value={settings.allowLiveBets} onChange={() => {}} disabled note="Stub — non-functional in v0.01" />

              <div className="pt-1 border-t border-border">
                <p className="text-sm mb-2">Duplicate picks</p>
                <div className="space-y-3">
                  <div>
                    <ToggleRow
                      label="Limit duplicate picks"
                      value={settings.maxDuplicatePicks != null}
                      onChange={(v) => updateSettings(league.id, { maxDuplicatePicks: v ? 1 : null })}
                      note={settings.maxDuplicatePicks == null ? 'Duplicates fully allowed (default).' : 'A pick held by the cap already is off-limits to others this week.'}
                    />
                    {settings.maxDuplicatePicks != null && (
                      <div className="mt-2 pl-1 space-y-2">
                        <div>
                          <label className="text-xs text-text-muted mb-1 block">Max teams per pick: {settings.maxDuplicatePicks}</label>
                          <div className="flex gap-1.5 flex-wrap">
                            {Array.from({ length: Math.max(1, Math.floor(league.targetTeamCount / 2)) }, (_, i) => i + 1).map((n) => (
                              <button
                                key={n}
                                onClick={() => updateSettings(league.id, { maxDuplicatePicks: n })}
                                className={`w-8 h-8 rounded-lg text-xs border ${
                                  settings.maxDuplicatePicks === n ? 'border-primary text-primary bg-primary/10' : 'border-border'
                                }`}
                              >
                                {n}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="text-xs text-text-muted mb-1 block">Contested-pick priority</label>
                          <div className="flex gap-2">
                            {(['waiver_order', 'fcfs'] as const).map((mode) => (
                              <button
                                key={mode}
                                onClick={() => updateSettings(league.id, { waiverMode: mode })}
                                className={`flex-1 py-1.5 rounded-lg text-xs border ${
                                  settings.waiverMode === mode ? 'border-primary text-primary bg-primary/10' : 'border-border'
                                }`}
                              >
                                {mode === 'waiver_order' ? 'Inverse-standings waiver' : 'Pure FCFS'}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="pt-2 border-t border-border">
                    <ToggleRow
                      label="Block correlated picks"
                      value={settings.correlationBlockEnabled}
                      onChange={(v) => updateSettings(league.id, { correlationBlockEnabled: v })}
                      note="Blocks a roster from stacking highly dependent same-team props (e.g. a QB's pass yds + his own WR's rec yds)."
                    />
                    {settings.correlationBlockEnabled && (
                      <div className="mt-2 pl-1">
                        <CorrelationRulesEditor
                          rules={settings.correlationRules}
                          onChange={(rules) => updateSettings(league.id, { correlationRules: rules })}
                        />
                      </div>
                    )}
                  </div>

                  <div className="pt-2 border-t border-border">
                    <ToggleRow
                      label="Raise minimum games per roster"
                      value={settings.minGamesPerRoster != null}
                      onChange={(v) => updateSettings(league.id, { minGamesPerRoster: v ? 3 : null })}
                      note={settings.minGamesPerRoster == null ? 'Baseline of 2 different games still applies.' : undefined}
                    />
                    {settings.minGamesPerRoster != null && (
                      <div className="mt-2 pl-1">
                        <label className="text-xs text-text-muted mb-1 block">Minimum distinct games: {settings.minGamesPerRoster}</label>
                        <div className="flex gap-1.5 flex-wrap">
                          {Array.from(
                            { length: Math.max(0, Object.values(settings.lineupSlots).reduce((a, b) => a + b, 0) - 1) },
                            (_, i) => i + 2,
                          ).map((n) => (
                            <button
                              key={n}
                              onClick={() => updateSettings(league.id, { minGamesPerRoster: n })}
                              className={`w-8 h-8 rounded-lg text-xs border ${
                                settings.minGamesPerRoster === n ? 'border-primary text-primary bg-primary/10' : 'border-border'
                              }`}
                            >
                              {n}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <ToggleRow
                label="Alt lines in Market Browser"
                value={settings.altLinesEnabled}
                onChange={(v) => updateSettings(league.id, { altLinesEnabled: v })}
              />
              <ToggleRow
                label="Line movement"
                value={settings.lineMovementEnabled}
                onChange={(v) => updateSettings(league.id, { lineMovementEnabled: v })}
              />
              <div className="pt-1 border-t border-border">
                {(() => {
                  const eligible = conferencesEligible(league.targetTeamCount);
                  const locked = league.teams.length > 1;
                  return (
                    <>
                      <ToggleRow
                        label="Conferences"
                        value={settings.conferencesEnabled}
                        disabled={!eligible || locked}
                        note={
                          !eligible
                            ? 'Requires an even team count (4+)'
                            : locked
                              ? 'Assignment locks once the league is filled — adjust members below.'
                              : undefined
                        }
                        onChange={(v) =>
                          updateSettings(league.id, {
                            conferencesEnabled: v,
                            conferences: v ? defaultConferences(settings.conferences.length === 4 ? 4 : 2) : settings.conferences,
                          })
                        }
                      />
                      {settings.conferencesEnabled && (
                        <div className="mt-3 space-y-3 pl-1">
                          {league.targetTeamCount >= 24 && !locked && (
                            <div>
                              <label className="text-xs text-text-muted mb-1 block">Number of conferences</label>
                              <div className="flex gap-2">
                                {([2, 4] as const).map((n) => (
                                  <button
                                    key={n}
                                    onClick={() => updateSettings(league.id, { conferences: defaultConferences(n) })}
                                    className={`flex-1 py-1.5 rounded-lg text-sm border ${
                                      settings.conferences.length === n ? 'border-primary text-primary bg-primary/10' : 'border-border'
                                    }`}
                                  >
                                    {n}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          {settings.conferences.map((conf, i) => (
                            <TextField
                              key={conf.id}
                              label={`Conference ${i + 1} name`}
                              value={conf.name}
                              fallback={`Conference ${i + 1}`}
                              onChange={(v) =>
                                updateSettings(league.id, {
                                  conferences: settings.conferences.map((c, j) => (j === i ? { ...c, name: v } : c)),
                                })
                              }
                            />
                          ))}
                          {locked && (
                            <p className="text-[11px] text-text-muted">
                              Manage which team is in which conference from League Members.
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>

              <div className="pt-1 border-t border-border">
                <ToggleRow
                  label="Buy-in & prize pool"
                  value={settings.buyInEnabled}
                  onChange={(v) => updateSettings(league.id, { buyInEnabled: v })}
                  note="All virtual — no real money. Locks at end of regular season or if it hits $0."
                />
                {settings.buyInEnabled && (
                  <div className="mt-3 space-y-3 pl-1">
                    <NumberField
                      label="Buy-in per team"
                      value={settings.buyInAmount}
                      onChange={(v) => updateSettings(league.id, { buyInAmount: v })}
                    />
                    <p className="text-[11px] text-text-muted">
                      Starting pool: {league.teams.length} teams × ${settings.buyInAmount.toFixed(2)} = $
                      {(league.teams.length * settings.buyInAmount).toFixed(2)}
                    </p>
                    <div>
                      <label className="text-xs text-text-muted mb-1.5 block">Payout split</label>
                      <PayoutSplitEditor
                        key={`payout-${league.id}`}
                        splits={settings.payoutSplits}
                        playoffTeams={settings.playoffTeams}
                        onSave={(payoutSplits) => updateSettings(league.id, { payoutSplits })}
                      />
                    </div>
                    <ToggleRow
                      label="Show real $ at stake on picks"
                      value={settings.showRealDollarStakes}
                      onChange={(v) => updateSettings(league.id, { showRealDollarStakes: v })}
                    />

                    <div className="pt-2 border-t border-border">
                      <ToggleRow
                        label="Prize pool impact multipliers"
                        value={settings.poolMultipliers.enabled}
                        onChange={(v) => updateSettings(league.id, { poolMultipliers: { ...settings.poolMultipliers, enabled: v } })}
                        note="Scales how much each team's wagers move the pool, based on standing. Off = every team wagers at a flat 1.0x. Always off during the playoffs."
                      />
                      {settings.poolMultipliers.enabled && (
                        <div className="mt-3 space-y-3 pl-1">
                          <div>
                            <label className="text-xs text-text-muted mb-1.5 block">Rank teams by</label>
                            <div className="flex gap-1.5">
                              {(
                                [
                                  ['rank', 'Standings'],
                                  ['record', 'Win-loss'],
                                  ['seasonPL', 'Season P/L'],
                                ] as const
                              ).map(([basis, label]) => (
                                <button
                                  key={basis}
                                  onClick={() => updateSettings(league.id, { poolMultipliers: { ...settings.poolMultipliers, basis } })}
                                  className={`flex-1 py-1.5 rounded-lg text-xs border ${
                                    settings.poolMultipliers.basis === basis ? 'border-primary text-primary bg-primary/10' : 'border-border'
                                  }`}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div>
                            {(() => {
                              const { top, bottom } = multiplierRangeForSpread(settings.poolMultipliers.spread);
                              return (
                                <label className="text-xs text-text-muted mb-1.5 block">
                                  Spread — {top.toFixed(2)}x top / {bottom.toFixed(2)}x bottom
                                </label>
                              );
                            })()}
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={Math.round(settings.poolMultipliers.spread * 100)}
                              onChange={(e) =>
                                updateSettings(league.id, {
                                  poolMultipliers: { ...settings.poolMultipliers, spread: Number(e.target.value) / 100 },
                                })
                              }
                              className="w-full accent-primary"
                            />
                            <p className="text-[11px] text-text-muted mt-1">0 = flat (everyone 1.0x). Hard-capped at 0.5x-1.5x regardless.</p>
                          </div>
                          <div>
                            <p className="text-xs text-text-muted mb-1.5">Current multipliers</p>
                            <div className="space-y-1">
                              {leagueMultiplierRows(league).map(({ team, multiplier }) => (
                                <div key={team.id} className="flex items-center justify-between bg-bg-raised rounded-lg px-2.5 py-1.5">
                                  <span className="text-xs flex items-center gap-1.5 min-w-0 truncate">
                                    <TeamLogo team={team} size="sm" /> <span className="truncate">{team.teamName}</span>
                                  </span>
                                  <span className={`text-xs font-semibold shrink-0 ${multiplier >= 1 ? 'text-profit' : 'text-loss'}`}>
                                    {multiplier.toFixed(2)}x
                                  </span>
                                </div>
                              ))}
                            </div>
                            {league.seasonPhase !== 'regular' && (
                              <p className="text-[11px] text-text-muted mt-1">Every team is at a flat 1.0x during the playoffs.</p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-1 border-t border-border">
                <p className="text-sm mb-2">Weekly Moments</p>
                <div className="space-y-2">
                  {MOMENT_CATEGORIES.map((cat) => {
                    const config = settings.moments[cat];
                    return (
                      <div key={cat} className="bg-bg-raised rounded-lg p-2.5 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] text-text-muted flex-1">{MOMENT_CATEGORY_LABELS[cat]}</p>
                          <Toggle
                            value={config.enabled}
                            onChange={(v) =>
                              updateSettings(league.id, { moments: { ...settings.moments, [cat]: { ...config, enabled: v } } })
                            }
                          />
                        </div>
                        {config.enabled && (
                          <div className="flex items-center gap-2">
                            <NameInput
                              value={config.displayName}
                              fallback={DEFAULT_MOMENT_DISPLAY_NAMES[cat]}
                              onChange={(v) =>
                                updateSettings(league.id, { moments: { ...settings.moments, [cat]: { ...config, displayName: v } } })
                              }
                              className="flex-1 bg-bg-card border border-border rounded-lg px-3 py-2 text-sm"
                            />
                            <button
                              onClick={() =>
                                updateSettings(league.id, {
                                  moments: { ...settings.moments, [cat]: { ...config, displayName: DEFAULT_MOMENT_DISPLAY_NAMES[cat] } },
                                })
                              }
                              className="text-[10px] text-text-muted shrink-0 px-1"
                            >
                              Reset
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <p className="text-[11px] text-text-muted pt-1 border-t border-border">
                Setting changes apply to future weeks only — previously settled weeks are never altered.
              </p>
            </div>
          )}
        </>
      )}

      {/* manual v0.2.1 §5 #6: moved to the bottom of the page, below Advanced Settings,
          as its own always-visible block — previously sat at the very top, easy to
          confuse with a quick-navigation shortcut rather than the more consequential
          league-membership actions it actually is. */}
      <SectionHeader>League</SectionHeader>
      <div className="bg-bg-card border border-border rounded-xl overflow-hidden divide-y divide-border">
        <button onClick={() => goTo('/create-league')} className="w-full flex items-center gap-2 px-3 py-3 text-sm text-left">
          <span>➕</span> Create a League
        </button>
        <button onClick={() => goTo('/join-league')} className="w-full flex items-center gap-2 px-3 py-3 text-sm text-left">
          <span>🔑</span> Join a League
        </button>
        {league && userTeam && (
          <button
            onClick={() => setLeaveSheetOpen(true)}
            className="w-full flex items-center gap-2 px-3 py-3 text-sm text-left text-loss"
          >
            <span>🚪</span> Leave This League
          </button>
        )}
      </div>
      <SectionHeader>Account</SectionHeader>
      <div className="bg-bg-card border border-border rounded-xl overflow-hidden divide-y divide-border">
        <ChangePasswordRow />
        <button
          onClick={async () => {
            if (!confirm('Log out of PropLeague?')) return;
            await useAuthStore.getState().signOut();
            navigate('/welcome');
          }}
          className="w-full flex items-center gap-2 px-3 py-3 text-sm text-left text-loss"
        >
          <span>🔒</span> Log Out
        </button>
      </div>
      {/* manual v0.2.0 §4 #10: was anchored bottom-24 left-4, which clipped off the left
          edge of the centered mobile shell on wider viewports. Moved to the bottom-right,
          stacked above the always-present DEV button (also bottom-right, at bottom-24)
          so the two floating buttons never overlap, and above the tab bar (64px) either way. */}
      <button
        onClick={() => setHowItWorksOpen(true)}
        aria-label="How does PropLeague work?"
        className="fixed bottom-40 right-4 z-50 w-10 h-10 rounded-full bg-bg-raised border border-border text-primary font-bold shadow-lg"
        style={{ right: 'max(1rem, calc(50% - 14rem))' }}
      >
        ?
      </button>
      {howItWorksOpen && <HowItWorksSheet settings={settings ?? null} onClose={() => setHowItWorksOpen(false)} />}
      {leaveSheetOpen && league && userTeam && (
        <LeaveLeagueSheet
          league={league}
          userTeamId={userTeam.id}
          onTransferCommissioner={(newCommissionerTeamId) => transferCommissioner(league.id, newCommissionerTeamId)}
          onLeave={() => {
            const result = leaveLeague(league.id);
            if (result.ok) {
              setLeaveSheetOpen(false);
              navigate('/');
            }
          }}
          onClose={() => setLeaveSheetOpen(false)}
        />
      )}
    </div>
  );
}

/** manual v0.3.0 §8: each team's current real-dollar impact multiplier, for the
 * settings preview list — sorted by team so the row order doesn't jump around as
 * standings shift week to week. */
function leagueMultiplierRows(league: League): { team: LeagueTeam; multiplier: number }[] {
  const multipliers = activeMultipliers(league);
  return league.teams.map((team) => ({ team, multiplier: multipliers[team.id] ?? 1 }));
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="text-xs text-text-muted mb-1 block">{label}</label>
      <NumberInput
        value={value}
        onChange={onChange}
        className="w-full bg-bg-raised border border-border rounded-lg px-3 py-2 text-sm"
      />
    </div>
  );
}

function NullableNumberField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-xs text-text-muted mb-1 block">{label}</label>
      <NullableNumberInput
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full bg-bg-raised border border-border rounded-lg px-3 py-2 text-sm placeholder:text-text-muted"
      />
    </div>
  );
}

/** `fallback` makes this a required field (manual v0.03 §3 #8) — an empty/whitespace
 * value reverts to it on blur instead of sticking. Omit `fallback` for optional text. */
function TextField({
  label,
  value,
  onChange,
  fallback,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  fallback?: string;
}) {
  return (
    <div>
      <label className="text-xs text-text-muted mb-1 block">{label}</label>
      {fallback != null ? (
        <NameInput value={value} onChange={onChange} fallback={fallback} className="w-full bg-bg-raised border border-border rounded-lg px-3 py-2 text-sm" />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-bg-raised border border-border rounded-lg px-3 py-2 text-sm"
        />
      )}
    </div>
  );
}
