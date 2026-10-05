import { useState } from 'react';
import { CalendarClock, ClipboardList, Gauge, Lock, Settings, Sparkles, TrendingUp, Trophy } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { League, LeagueSettings, LeagueTeam, PlayoffFieldSize, Position } from '../../types';
import { MOMENT_CATEGORIES, MOMENT_CATEGORY_LABELS, DEFAULT_MOMENT_DISPLAY_NAMES } from '../../types';
import { Toggle, ToggleRow } from '../common/Toggle';
import { NameInput } from '../common/NameInput';
import { IdentityPicker } from '../common/IdentityPicker';
import { TeamLogo } from '../common/TeamLogo';
import { initialsFromLeagueName } from '../common/LeagueLogo';
import { uploadLeagueLogo } from '../../services/supabaseLogo';
import { conferencesEligible, defaultConferences } from '../../engine/conferences';
import {
  describePendingKeys,
  effectiveSettings,
  meaningfulPending,
  nextWeekLabel,
  pendingKeys,
  settingsInfeasibility,
  touchesFeasibility,
  type DeferredSettingKey,
} from '../../engine/settingsRules';
import { doubleEliminationAvailable, fieldSizeOptionsForTeamCount, structureAvailable } from '../../engine/playoffs';
import { activeMultipliers, multiplierRangeForSpread } from '../../engine/prizePool';
import { CorrelationRulesEditor } from './CorrelationRulesEditor';
import { PayoutSplitEditor } from './PayoutSplitEditor';
import { BettingLimitsGroup } from './BettingLimitsGroup';
import { CollapsibleSection, SectionHeader, SubSection, NumberField, TextField, chipClass } from './SettingsPrimitives';

const POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE', 'K'];
const POSITION_RANGE: Record<Position | 'ML', [number, number]> = {
  QB: [1, 2],
  RB: [2, 4],
  WR: [2, 4],
  TE: [1, 2],
  K: [1, 2],
  ML: [1, 2],
};

/** manual v0.3.0 §8: each team's current real-dollar impact multiplier, for the
 * settings preview list, sorted by team so the row order doesn't jump around as
 * standings shift week to week. */
function leagueMultiplierRows(league: League): { team: LeagueTeam; multiplier: number }[] {
  const multipliers = activeMultipliers(league);
  return league.teams.map((team) => ({ team, multiplier: multipliers[team.id] ?? 1 }));
}

const onOff = (v: boolean) => (v ? 'on' : 'off');

/** Which settings group each gameplay key belongs to, for the "Applies Week N" pills. */
const ROSTER_KEYS: DeferredSettingKey[] = ['lineupSlots', 'minGamesPerRoster', 'maxDuplicatePicks', 'waiverMode', 'correlationBlockEnabled', 'correlationRules', 'hidePicks'];
const LIMIT_KEYS: DeferredSettingKey[] = ['weeklyCredits', 'minBetPerSlot', 'maxMLBet', 'maxPropBet', 'minOdds', 'singleBetCapPct', 'wagerPrecision', 'propBetOverride', 'mlBetOverride'];
const BUYIN_KEYS: DeferredSettingKey[] = ['buyInEnabled', 'buyInAmount', 'poolMultipliers'];

/** Every league-wide setting, grouped by topic into collapsible sections.
 *
 * Visible to every member, editable only by the commissioner. For everyone else each
 * group still expands (so a member can see what is configured and give the commissioner
 * input), but its controls are disabled via CollapsibleSection's `readOnly`. Writes are
 * ALSO guarded here in JS (`isCommissioner` check in the update wrappers) as defense in
 * depth: the disabled fieldset is a UI affordance, not a security boundary.
 *
 * Replaces the old Basic/Advanced split, which mixed unrelated things together and, for
 * non-commissioners, sat inside a `pointer-events-none` wrapper that also swallowed the
 * Advanced expander tap, so members could never open it. */
export function LeagueSettingsPanel({
  league,
  isCommissioner,
  defaultLeagueName,
  onIdentityDirtyChange,
}: {
  league: League;
  isCommissioner: boolean;
  /** Fallback shown/restored for an emptied league-name field. */
  defaultLeagueName: string;
  onIdentityDirtyChange: (dirty: boolean) => void;
}) {
  const updateSettingsStore = useAppStore((s) => s.updateSettings);
  const discardPendingStore = useAppStore((s) => s.discardPendingSettings);
  const updateTargetTeamCountStore = useAppStore((s) => s.updateTargetTeamCount);
  const updateLeagueLogoStore = useAppStore((s) => s.updateLeagueLogo);
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);
  const [identityDirty, setIdentityDirty] = useState(false);

  // Once a pick exists this week, gameplay edits are scheduled for next week instead of applied
  // (see engine/settingsRules). The commissioner works against live settings with their scheduled
  // changes laid over them, so what they typed stays on screen; everyone else sees what is live.
  const pending = meaningfulPending(league.settings, league.pendingSettings);
  const scheduledKeys = pendingKeys(pending);
  const settingsLocked = !!league.settingsLocked;
  const settings = isCommissioner ? effectiveSettings(league.settings, pending) : league.settings;
  const nextWeek = nextWeekLabel(league.currentWeek);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const pillFor = (keys: DeferredSettingKey[]) => (scheduledKeys.some((k) => keys.includes(k)) ? `Applies ${nextWeek}` : undefined);
  const readOnly = !isCommissioner;
  const seasonNotStarted = Object.keys(league.matchupsByWeek).length === 0;
  // manual v0.2.0 §2 #1: once the bracket exists the playoff format is fully locked;
  // before that, availability is decided per-option by structureAvailable below.
  const bracketLocked = !!league.bracket;
  const totalSlots = Object.values(settings.lineupSlots).reduce((a, b) => a + b, 0);
  const commissionerTeam = league.teams.find((t) => t.id === league.commissionerTeamId);

  async function update(partial: Partial<LeagueSettings>): Promise<{ ok: boolean; error?: string }> {
    if (!isCommissioner) return { ok: false };
    // Catch an unreachable combination before it leaves the device; the server checks again.
    if (touchesFeasibility(partial)) {
      const reasons = settingsInfeasibility({ ...settings, ...partial });
      if (reasons.length > 0) {
        setSaveError(reasons[0]);
        return { ok: false, error: reasons[0] };
      }
    }
    setSaveError(null);
    const res = await updateSettingsStore(league.id, partial);
    if (!res.ok) setSaveError(res.error ?? 'Could not save that change.');
    return res;
  }

  async function discardScheduled() {
    setDiscarding(true);
    const res = await discardPendingStore(league.id);
    setDiscarding(false);
    setSaveError(res.ok ? null : (res.error ?? 'Could not discard the scheduled changes.'));
  }

  const errorNote = saveError ? (
    <p className="text-xs text-loss" role="alert">
      {saveError}
    </p>
  ) : null;

  const slotSummary = [...POSITIONS, 'ML' as const]
    .filter((p) => settings.lineupSlots[p] > 0)
    .map((p) => `${settings.lineupSlots[p]} ${p}`)
    .join(' · ');
  const enabledMoments = MOMENT_CATEGORIES.filter((cat) => settings.moments[cat].enabled).length;
  return (
    <section className="space-y-2">
      <SectionHeader>League Settings</SectionHeader>
      <div className="flex items-start gap-2 bg-bg-card border border-border rounded-xl px-3 py-2.5">
        <Lock size={14} className={`shrink-0 mt-0.5 ${readOnly ? 'text-accent' : 'text-text-muted'}`} />
        <p className="text-xs text-text-muted">
          {readOnly ? (
            <>
              <span className="font-semibold text-text">Commissioner only.</span> Only{' '}
              {commissionerTeam ? commissionerTeam.teamName : 'the commissioner'} can change these.
            </>
          ) : (
            <>
              <span className="font-semibold text-text">You are the commissioner.</span> Only you can edit these.
            </>
          )}
        </p>
      </div>

      {settingsLocked && isCommissioner && (
        <div className="flex items-start gap-2 bg-bg-card border border-border rounded-xl px-3 py-2.5">
          <CalendarClock size={14} className="shrink-0 mt-0.5 text-accent" />
          <p className="text-xs text-text-muted">
            <span className="font-semibold text-text">Picks are in.</span> Gameplay changes start {nextWeek}.
          </p>
        </div>
      )}

      {scheduledKeys.length > 0 && (
        <div className="bg-accent/10 border border-accent/30 rounded-xl px-3 py-2.5 space-y-2">
          <p className="text-xs text-text">
            {isCommissioner ? (
              <>
                <span className="font-semibold">Scheduled for {nextWeek}:</span> {describePendingKeys(scheduledKeys)}.
              </>
            ) : (
              <>
                <span className="font-semibold">Coming in {nextWeek}:</span> {describePendingKeys(scheduledKeys)}.
              </>
            )}
          </p>
          {isCommissioner && (
            <button
              type="button"
              disabled={discarding}
              onClick={() => void discardScheduled()}
              className="text-xs font-semibold text-accent disabled:opacity-40"
            >
              {discarding ? 'Discarding…' : 'Discard scheduled changes'}
            </button>
          )}
        </div>
      )}

      <div className="space-y-2">
        <CollapsibleSection
          title="League Basics"
          icon={<Settings size={16} />}
          readOnly={readOnly}
          badge={identityDirty ? 'Unsaved changes' : undefined}
          summary={`${settings.leagueName || league.name} · ${league.targetTeamCount} teams · ${settings.isPublic ? 'Public' : 'Private'}`}
        >
          <div>
            <IdentityPicker
              key={`league-${league.id}`}
              bare
              title="League Logo"
              value={league}
              initials={initialsFromLeagueName(league.name)}
              onSave={async (next, file) => {
                if (!isCommissioner) return;
                updateLeagueLogoStore(league.id, next);
                if (!file) return;
                setLogoUploadError(null);
                const result = await uploadLeagueLogo(league.id, file);
                if (!result.ok) {
                  setLogoUploadError(result.error);
                  return;
                }
                updateLeagueLogoStore(league.id, { logoDataUrl: result.publicUrl });
              }}
              onDirtyChange={(dirty) => {
                setIdentityDirty(dirty);
                onIdentityDirtyChange(dirty);
              }}
            />
            <p className="text-[11px] text-text-muted mt-1.5">
              Shown on League Home, the invite screen, standings, and feed announcements.
            </p>
            {logoUploadError && <p className="text-loss text-xs mt-1">{logoUploadError}</p>}
          </div>
          <SubSection title="League details">
            <TextField
              label="League name"
              value={settings.leagueName}
              fallback={defaultLeagueName}
              onChange={(v) => update({ leagueName: v })}
            />
            <ToggleRow
              label="Private league"
              value={!settings.isPublic}
              onChange={(v) => update({ isPublic: !v })}
              note="Joining always requires the invite code."
            />
            <div>
              <label className="text-xs text-text-muted mb-1.5 block">Team count: {league.targetTeamCount}</label>
              <div className="flex items-center gap-2">
                <button
                  disabled={!seasonNotStarted}
                  onClick={() => {
                    if (isCommissioner) updateTargetTeamCountStore(league.id, league.targetTeamCount - 1);
                  }}
                  className="w-8 h-8 rounded-lg border border-border text-text-muted disabled:opacity-30"
                >
                  −
                </button>
                <span className="flex-1 text-center text-sm">{league.targetTeamCount}</span>
                <button
                  disabled={!seasonNotStarted}
                  onClick={() => {
                    if (isCommissioner) updateTargetTeamCountStore(league.id, league.targetTeamCount + 1);
                  }}
                  className="w-8 h-8 rounded-lg border border-border text-text-muted disabled:opacity-30"
                >
                  +
                </button>
              </div>
              <p className="text-[11px] text-text-muted mt-1">
                {!seasonNotStarted
                  ? 'Locked once the season starts. Resizing after that would leave the schedule and rosters inconsistent.'
                  : 'Resizing before the season starts may change which playoff fields are available.'}
              </p>
            </div>
            <p className="text-[11px] text-text-muted">
              Members: {league.teams.length} joined (min 4 to begin) · Invite code {league.inviteCode}
            </p>
          </SubSection>
        </CollapsibleSection>

        <CollapsibleSection
          title="Roster & Picks"
          icon={<ClipboardList size={16} />}
          readOnly={readOnly}
          badge={pillFor(ROSTER_KEYS)}
          summary={`${totalSlots} slots: ${slotSummary} · min ${settings.minGamesPerRoster ?? 2} games · duplicates ${settings.maxDuplicatePicks != null ? `capped at ${settings.maxDuplicatePicks}` : 'allowed'}`}
        >
          {errorNote}
          <SubSection title="Lineup slots" description={`${totalSlots} total. Every slot must be filled with a bet each week.`}>
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
                        update({
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
                        update({
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
          </SubSection>
          <SubSection
            title="Minimum games per roster"
            description="How many different NFL games a roster has to be spread across, so one game cannot decide a whole week."
          >
            <ToggleRow
              label="Require more than 2 games"
              value={settings.minGamesPerRoster != null}
              onChange={(v) => update({ minGamesPerRoster: v ? 3 : null })}
              note={settings.minGamesPerRoster == null ? 'Off. The 2-game baseline always applies and cannot be turned off, only raised.' : 'The 2-game baseline always applies. This raises it for this league.'}
            />
            {settings.minGamesPerRoster != null && (
              <div className="pl-1">
                <label className="text-xs text-text-muted mb-1 block">Minimum distinct games: {settings.minGamesPerRoster}</label>
                <div className="flex gap-1.5 flex-wrap">
                  {Array.from({ length: Math.max(0, totalSlots - 1) }, (_, i) => i + 2).map((n) => (
                    <button
                      key={n}
                      onClick={() => update({ minGamesPerRoster: n })}
                      className={`w-8 h-8 rounded-lg text-xs border ${chipClass(settings.minGamesPerRoster === n)}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </SubSection>
          <SubSection
            title="Duplicate pick rules"
            description="Control how many teams in the league can hold the exact same prop in a given week."
          >
            <ToggleRow
              label="Cap teams per pick"
              value={settings.maxDuplicatePicks != null}
              onChange={(v) => update({ maxDuplicatePicks: v ? 1 : null })}
              note={
                settings.maxDuplicatePicks == null
                  ? 'Off. Any number of teams can hold the same pick.'
                  : 'Once a pick has this many holders, it is off-limits to other teams that week.'
              }
            />
            {settings.maxDuplicatePicks != null && (
              <div className="pl-1 space-y-3">
                <div>
                  <label className="text-xs text-text-muted mb-1 block">Max teams per pick: {settings.maxDuplicatePicks}</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {Array.from({ length: Math.max(1, Math.floor(league.targetTeamCount / 2)) }, (_, i) => i + 1).map((n) => (
                      <button
                        key={n}
                        onClick={() => update({ maxDuplicatePicks: n })}
                        className={`w-8 h-8 rounded-lg text-xs border ${chipClass(settings.maxDuplicatePicks === n)}`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-text-muted mb-1 block">Who gets a contested pick</label>
                  <div className="flex gap-2">
                    {(['waiver_order', 'fcfs'] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => update({ waiverMode: mode })}
                        className={`flex-1 py-1.5 rounded-lg text-xs border ${chipClass(settings.waiverMode === mode)}`}
                      >
                        {mode === 'waiver_order' ? 'Inverse-standings waiver' : 'Pure FCFS'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </SubSection>
          <SubSection title="Correlated picks" description="Stop a roster from stacking props that tend to hit or miss together.">
            <ToggleRow
              label="Block correlated picks"
              value={settings.correlationBlockEnabled}
              onChange={(v) => update({ correlationBlockEnabled: v })}
              note="Blocks a roster from stacking highly dependent same-team props (e.g. a QB's pass yds + his own WR's rec yds)."
            />
            {settings.correlationBlockEnabled && (
              <div className="pl-1">
                <CorrelationRulesEditor rules={settings.correlationRules} onChange={(rules) => update({ correlationRules: rules })} />
              </div>
            )}
          </SubSection>
          <SubSection title="Pick visibility">
            <ToggleRow
              label="Hide picks before game start"
              value={settings.hidePicks}
              onChange={(v) => update({ hidePicks: v })}
              note="Other teams' picks stay hidden until that game kicks off."
            />
          </SubSection>
        </CollapsibleSection>

        <CollapsibleSection
          title="Betting & Buy-In"
          icon={<Gauge size={16} />}
          readOnly={readOnly}
          badge={pillFor([...LIMIT_KEYS, ...BUYIN_KEYS])}
          summary={`$${settings.weeklyCredits} weekly · ML max $${settings.maxMLBet} · prop ${settings.maxPropBet != null ? `max $${settings.maxPropBet}` : 'no max'} · buy-in ${settings.buyInEnabled ? `$${settings.buyInAmount.toFixed(2)}` : 'off'}`}
        >
          {errorNote}
          <SubSection title="Betting limits">
            <BettingLimitsGroup
              // Re-seed the draft whenever the saved values change (a save, a discard, a refresh).
              key={JSON.stringify([settings.weeklyCredits, settings.minBetPerSlot, settings.maxMLBet, settings.maxPropBet, settings.singleBetCapPct, settings.lineupSlots])}
              settings={settings}
              onSave={update}
            />
          </SubSection>
          <SubSection title="Buy-in & prize pool">
            <ToggleRow
              label="Buy-in & prize pool"
              value={settings.buyInEnabled}
              onChange={(v) => update({ buyInEnabled: v })}
              note="All virtual, no real money. Locks at end of regular season or if it hits $0."
            />
          </SubSection>
          {settings.buyInEnabled && (
            <>
              <SubSection title="Buy-in">
                <NumberField label="Buy-in per team" value={settings.buyInAmount} onChange={(v) => update({ buyInAmount: v })} />
                <p className="text-[11px] text-text-muted">
                  Starting pool: {league.teams.length} teams × ${settings.buyInAmount.toFixed(2)} = $
                  {(league.teams.length * settings.buyInAmount).toFixed(2)}
                </p>
                <ToggleRow
                  label="Show real $ at stake on picks"
                  value={settings.showRealDollarStakes}
                  onChange={(v) => update({ showRealDollarStakes: v })}
                />
              </SubSection>
              <SubSection title="Payouts" description="How the pool is split among the top finishers. Percentages must add up to 100.">
                <PayoutSplitEditor
                  key={`payout-${league.id}`}
                  splits={settings.payoutSplits}
                  playoffTeams={settings.playoffTeams}
                  onSave={(payoutSplits) => update({ payoutSplits })}
                />
              </SubSection>
              <SubSection title="Standing multipliers">
                <ToggleRow
                  label="Prize pool impact multipliers"
                  value={settings.poolMultipliers.enabled}
                  onChange={(v) => update({ poolMultipliers: { ...settings.poolMultipliers, enabled: v } })}
                  note="Scales how much each team's wagers move the pool, based on standing. Off = every team wagers at a flat 1.0x. Always off during the playoffs."
                />
                {settings.poolMultipliers.enabled && (
                  <div className="space-y-3 pl-1">
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
                            onClick={() => update({ poolMultipliers: { ...settings.poolMultipliers, basis } })}
                            className={`flex-1 py-1.5 rounded-lg text-xs border ${chipClass(settings.poolMultipliers.basis === basis)}`}
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
                            Spread: {top.toFixed(2)}x top / {bottom.toFixed(2)}x bottom
                          </label>
                        );
                      })()}
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(settings.poolMultipliers.spread * 100)}
                        onChange={(e) => update({ poolMultipliers: { ...settings.poolMultipliers, spread: Number(e.target.value) / 100 } })}
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
              </SubSection>
            </>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          title="Lines & Markets"
          icon={<TrendingUp size={16} />}
          readOnly={readOnly}
          summary={`Alt lines ${onOff(settings.altLinesEnabled)} · line movement ${onOff(settings.lineMovementEnabled)}`}
        >
          <ToggleRow
            label="Alt lines in Market Browser"
            value={settings.altLinesEnabled}
            onChange={(v) => update({ altLinesEnabled: v })}
          />
          <ToggleRow label="Line movement" value={settings.lineMovementEnabled} onChange={(v) => update({ lineMovementEnabled: v })} />
        </CollapsibleSection>

        <CollapsibleSection
          title="Playoffs & Conferences"
          icon={<Trophy size={16} />}
          readOnly={readOnly}
          summary={`${settings.playoffTeams}-team ${settings.eliminationType} elimination · conferences ${onOff(settings.conferencesEnabled)}`}
        >
          <SubSection title="Playoff format">
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
                      onClick={() => update({ playoffTeams: n, eliminationType: effectiveType })}
                      className={`flex-1 py-1.5 rounded-lg text-sm border disabled:opacity-40 ${chipClass(settings.playoffTeams === n)}`}
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
                    onClick={() => update({ eliminationType: type })}
                    className={`flex-1 py-1.5 rounded-lg text-sm border capitalize disabled:opacity-40 ${chipClass(settings.eliminationType === type)}`}
                  >
                    {type}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-text-muted mt-1">
                {bracketLocked
                  ? 'Playoff format is locked. The bracket has already been generated.'
                  : 'Editable through the regular season. Each field size/format disappears once there would no longer be enough weeks left to run it.'}
              </p>
            </div>
          </SubSection>
          <SubSection title="Conferences">
            {(() => {
              const eligible = conferencesEligible(league.targetTeamCount);
              const locked = !seasonNotStarted;
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
                          ? 'Assignment locks once the season starts. Adjust members from League Members.'
                          : undefined
                    }
                    onChange={(v) =>
                      update({
                        conferencesEnabled: v,
                        conferences: v ? defaultConferences(settings.conferences.length === 4 ? 4 : 2) : settings.conferences,
                      })
                    }
                  />
                  {settings.conferencesEnabled && (
                    <div className="space-y-3 pl-1">
                      {league.targetTeamCount >= 24 && !locked && (
                        <div>
                          <label className="text-xs text-text-muted mb-1 block">Number of conferences</label>
                          <div className="flex gap-2">
                            {([2, 4] as const).map((n) => (
                              <button
                                key={n}
                                onClick={() => update({ conferences: defaultConferences(n) })}
                                className={`flex-1 py-1.5 rounded-lg text-sm border ${chipClass(settings.conferences.length === n)}`}
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
                            update({
                              conferences: settings.conferences.map((c, j) => (j === i ? { ...c, name: v } : c)),
                            })
                          }
                        />
                      ))}
                      {locked && <p className="text-[11px] text-text-muted">Manage which team is in which conference from League Members.</p>}
                    </div>
                  )}
                </>
              );
            })()}
          </SubSection>
        </CollapsibleSection>

        <CollapsibleSection
          title="Weekly Moments"
          icon={<Sparkles size={16} />}
          readOnly={readOnly}
          summary={`${enabledMoments} of ${MOMENT_CATEGORIES.length} awards on`}
        >
          <p className="text-[11px] text-text-muted">Weekly awards posted to the league feed. Turn any off, or give each a custom name.</p>
          <div className="space-y-2">
            {MOMENT_CATEGORIES.map((cat) => {
              const config = settings.moments[cat];
              return (
                <div key={cat} className="bg-bg-raised rounded-lg p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] text-text-muted flex-1">{MOMENT_CATEGORY_LABELS[cat]}</p>
                    <Toggle
                      value={config.enabled}
                      onChange={(v) => update({ moments: { ...settings.moments, [cat]: { ...config, enabled: v } } })}
                    />
                  </div>
                  {config.enabled && (
                    <div className="flex items-center gap-2">
                      <NameInput
                        value={config.displayName}
                        fallback={DEFAULT_MOMENT_DISPLAY_NAMES[cat]}
                        onChange={(v) => update({ moments: { ...settings.moments, [cat]: { ...config, displayName: v } } })}
                        className="flex-1 bg-bg-card border border-border rounded-lg px-3 py-2 text-sm"
                      />
                      <button
                        onClick={() =>
                          update({
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
        </CollapsibleSection>
      </div>
    </section>
  );
}
