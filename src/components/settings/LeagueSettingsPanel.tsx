import { useState } from 'react';
import {
  CalendarClock,
  ClipboardList,
  Gauge,
  Lock,
  ShieldAlert,
  Settings,
  Sparkles,
  TrendingUp,
  Trophy,
} from 'lucide-react';
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
import { ChipRow, CollapsibleSection, SectionHeader, SubSection, NumberField, Stepper, TextField, chipClass } from './SettingsPrimitives';

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
const PENALTY_KEYS: DeferredSettingKey[] = ['emptySlotFloor', 'invalidRosterPenaltyEnabled', 'invalidRosterFee'];

/** A small dollar stepper (whole-dollar steps), for penalty amounts. */
function MoneyStepper({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  const clamp = (n: number) => Math.round(Math.min(max, Math.max(min, n)) * 100) / 100;
  return (
    <div className="flex items-center justify-between bg-bg-raised rounded-lg px-2.5 py-1">
      <span className="text-xs font-medium">{label}</span>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => onChange(clamp(value - step))} className="text-text-muted w-5">
          −
        </button>
        <span className="text-sm w-14 text-center">${value.toFixed(2)}</span>
        <button type="button" onClick={() => onChange(clamp(value + step))} className="text-text-muted w-5">
          +
        </button>
      </div>
    </div>
  );
}

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
  // Most an empty slot can cost: credits split evenly across the slots.
  const floorCap = totalSlots > 0 ? Math.floor((settings.weeklyCredits / totalSlots) * 100 + 1e-9) / 100 : 0;
  const penaltySummary = [
    settings.emptySlotFloor != null ? `empty slot min $${Math.min(settings.emptySlotFloor, floorCap).toFixed(2)}` : 'empty slot floor off',
    settings.invalidRosterPenaltyEnabled ? `invalid roster fee $${settings.invalidRosterFee.toFixed(2)}` : 'invalid roster penalty off',
  ].join(' · ');
  const enabledMoments = MOMENT_CATEGORIES.filter((cat) => settings.moments[cat].enabled).length;
  return (
    <section className="space-y-2">
      <SectionHeader>League Settings</SectionHeader>
      {/* One line, always. Orange for the commissioner, gray for everyone else. */}
      <div
        className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 ${
          readOnly ? 'bg-bg-card border-border' : 'bg-warning/10 border-warning/40'
        }`}
      >
        <Lock size={14} className={`shrink-0 ${readOnly ? 'text-text-muted' : 'text-warning'}`} />
        <p className="text-xs text-text-muted truncate min-w-0">
          {readOnly ? (
            <>
              <span className="font-semibold text-text">Commissioner only.</span>{' '}
              {commissionerTeam ? `${commissionerTeam.teamName} edits these.` : 'View only.'}
            </>
          ) : (
            <span className="font-semibold text-text">You are the commissioner.</span>
          )}
        </p>
      </div>

      {settingsLocked && isCommissioner && (
        <div className="flex items-start gap-2 bg-bg-card border border-border rounded-xl px-3 py-1.5">
          <CalendarClock size={14} className="shrink-0 mt-0.5 text-accent" />
          <p className="text-xs text-text-muted">
            <span className="font-semibold text-text">Picks are in.</span> Gameplay changes start {nextWeek}.
          </p>
        </div>
      )}

      {scheduledKeys.length > 0 && (
        <div className="bg-accent/10 border border-accent/30 rounded-xl px-3 py-2 space-y-1.5">
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
          help={['commissioner', 'Who can change what']}
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
              label="Private (invite code only)"
              value={!settings.isPublic}
              onChange={(v) => update({ isPublic: !v })}
            />
            <Stepper
              label={seasonNotStarted ? 'Team count' : 'Team count (locked)'}
              value={league.targetTeamCount}
              min={4}
              max={32}
              disabled={!seasonNotStarted}
              onChange={(v) => {
                if (isCommissioner) updateTargetTeamCountStore(league.id, v);
              }}
            />
            <p className="text-[11px] text-text-muted">
              Members: {league.teams.length} joined (min 4 to begin) · Invite code {league.inviteCode}
            </p>
          </SubSection>
        </CollapsibleSection>

        <CollapsibleSection
          title="Roster & Picks"
          icon={<ClipboardList size={16} />}
          help={['lineup', 'Duplicate and correlated picks']}
          readOnly={readOnly}
          badge={pillFor(ROSTER_KEYS)}
          summary={`${totalSlots} slots: ${slotSummary} · min ${settings.minGamesPerRoster ?? 2} games · duplicates ${settings.maxDuplicatePicks != null ? `capped at ${settings.maxDuplicatePicks}` : 'allowed'}`}
        >
          {errorNote}
          <SubSection title={`Lineup slots (${totalSlots})`}>
            {/* Column-major fill puts QB/RB/WR down the left column and TE/K/ML down the right. */}
            <div className="grid grid-cols-2 grid-rows-3 grid-flow-col gap-1.5">
              {[...POSITIONS, 'ML' as const].map((pos) => (
                <div key={pos} className="flex items-center justify-between bg-bg-raised rounded-lg px-2.5 py-1">
                  <span className="text-xs font-medium">{pos}</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() =>
                        update({
                          lineupSlots: {
                            ...settings.lineupSlots,
                            [pos]: Math.max(POSITION_RANGE[pos][0], settings.lineupSlots[pos] - 1),
                          },
                        })
                      }
                      className="text-text-muted w-6 h-6"
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
                      className="text-text-muted w-6 h-6"
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </SubSection>
          <SubSection title="Rules">
            <Stepper
              label="Min games per roster"
              value={settings.minGamesPerRoster ?? 2}
              min={2}
              max={Math.max(2, totalSlots - 1)}
              onChange={(v) => update({ minGamesPerRoster: v <= 2 ? null : v })}
            />
            <ToggleRow
              label="Cap teams per pick"
              value={settings.maxDuplicatePicks != null}
              onChange={(v) => update({ maxDuplicatePicks: v ? 1 : null })}
            />
            {settings.maxDuplicatePicks != null && (
              <div className="pl-1 space-y-1.5">
                <Stepper
                  label="Max teams per pick"
                  value={settings.maxDuplicatePicks}
                  min={1}
                  max={Math.max(1, Math.floor(league.targetTeamCount / 2))}
                  onChange={(n) => update({ maxDuplicatePicks: n })}
                />
                <ChipRow
                  value={settings.waiverMode}
                  onChange={(mode) => update({ waiverMode: mode })}
                  options={[
                    { value: 'waiver_order', label: 'Waiver order' },
                    { value: 'fcfs', label: 'First come' },
                  ]}
                />
              </div>
            )}
            <ToggleRow
              label="Block correlated picks"
              value={settings.correlationBlockEnabled}
              onChange={(v) => update({ correlationBlockEnabled: v })}
            />
            {settings.correlationBlockEnabled && (
              <div className="pl-1">
                <CorrelationRulesEditor rules={settings.correlationRules} onChange={(rules) => update({ correlationRules: rules })} />
              </div>
            )}
            <ToggleRow
              label="Hide picks until kickoff"
              value={settings.hidePicks}
              onChange={(v) => update({ hidePicks: v })}
            />
          </SubSection>
        </CollapsibleSection>

        <CollapsibleSection
          title="Penalties"
          icon={<ShieldAlert size={16} />}
          help={['lineup', 'Penalties']}
          readOnly={readOnly}
          badge={pillFor(PENALTY_KEYS)}
          summary={penaltySummary}
        >
          {errorNote}
          <ToggleRow
            label="Minimum loss per empty slot"
            value={settings.emptySlotFloor != null}
            onChange={(v) => update({ emptySlotFloor: v ? Math.min(5, floorCap) : null })}
          />
          {settings.emptySlotFloor != null && (
            <MoneyStepper
              label="Per empty slot"
              value={Math.min(settings.emptySlotFloor, floorCap)}
              min={1}
              max={Math.max(1, floorCap)}
              onChange={(v) => update({ emptySlotFloor: v })}
            />
          )}
          <ToggleRow
            label="Penalize invalid rosters"
            value={settings.invalidRosterPenaltyEnabled}
            onChange={(v) => update({ invalidRosterPenaltyEnabled: v })}
          />
          {settings.invalidRosterPenaltyEnabled && (
            <MoneyStepper
              label="Flat fee"
              value={settings.invalidRosterFee}
              min={0}
              max={settings.weeklyCredits}
              onChange={(v) => update({ invalidRosterFee: v })}
            />
          )}
        </CollapsibleSection>

        <CollapsibleSection
          title="Betting & Buy-In"
          icon={<Gauge size={16} />}
          help={['lineup', 'Stakes and games']}
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
          <ToggleRow
            label="Buy-in & prize pool"
            value={settings.buyInEnabled}
            onChange={(v) => update({ buyInEnabled: v })}
          />
          {settings.buyInEnabled && (
            <>
              <SubSection title="Buy-in">
                <NumberField label="Buy-in per team" value={settings.buyInAmount} onChange={(v) => update({ buyInAmount: v })} />
                <p className="text-[11px] text-text-muted">
                  Starting pool: {league.teams.length} × ${settings.buyInAmount.toFixed(2)} = ${(league.teams.length * settings.buyInAmount).toFixed(2)}
                </p>
                <ToggleRow
                  label="Show real $ on picks"
                  value={settings.showRealDollarStakes}
                  onChange={(v) => update({ showRealDollarStakes: v })}
                />
              </SubSection>
              <SubSection title="Payouts (must total 100%)">
                <PayoutSplitEditor
                  key={`payout-${league.id}`}
                  splits={settings.payoutSplits}
                  playoffTeams={settings.playoffTeams}
                  onSave={(payoutSplits) => update({ payoutSplits })}
                />
              </SubSection>
              <SubSection title="Multipliers">
                <ToggleRow
                  label="Scale pool impact by standing"
                  value={settings.poolMultipliers.enabled}
                  onChange={(v) => update({ poolMultipliers: { ...settings.poolMultipliers, enabled: v } })}
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
                    </div>
                    <div>
                      <p className="text-xs text-text-muted mb-1.5">Current multipliers</p>
                      <div className="space-y-1">
                        {leagueMultiplierRows(league).map(({ team, multiplier }) => (
                          <div key={team.id} className="flex items-center justify-between bg-bg-raised rounded-lg px-2.5 py-1">
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
                        <p className="text-[11px] text-text-muted mt-1">Flat 1.0x in the playoffs.</p>
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
          help={['commissioner', 'Settings groups']}
          readOnly={readOnly}
          summary={`Alt lines ${onOff(settings.altLinesEnabled)} · line movement ${onOff(settings.lineMovementEnabled)}`}
        >
          <ToggleRow
            label="Alt lines in Market Browser"
            value={settings.altLinesEnabled}
            onChange={(v) => update({ altLinesEnabled: v })}
          />
          <ToggleRow label="Live line movement" value={settings.lineMovementEnabled} onChange={(v) => update({ lineMovementEnabled: v })} />
        </CollapsibleSection>

        <CollapsibleSection
          title="Playoffs & Conferences"
          icon={<Trophy size={16} />}
          help={['scoring', 'Playoffs']}
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
              {bracketLocked && <p className="text-[11px] text-text-muted mt-1">Locked: the bracket is already set.</p>}
            </div>
          </SubSection>
          <SubSection title="Conferences">
            {(() => {
              const eligible = conferencesEligible(league.targetTeamCount);
              const locked = !seasonNotStarted;
              return (
                <>
                  <ToggleRow
                    label="Split into conferences"
                    value={settings.conferencesEnabled}
                    disabled={!eligible || locked}
                    note={!eligible ? 'Needs an even team count (4+)' : locked ? 'Locked once the season starts' : undefined}
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
          help={['scoring', 'Perfect weeks']}
          readOnly={readOnly}
          summary={`${enabledMoments} of ${MOMENT_CATEGORIES.length} awards on`}
        >
          <ToggleRow
            label="Announce perfect weeks"
            value={settings.perfectWeekAnnouncements}
            onChange={(v) => update({ perfectWeekAnnouncements: v })}
          />
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
                        className="flex-1 bg-bg-card border border-border rounded-lg px-2.5 py-1.5 text-sm"
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
