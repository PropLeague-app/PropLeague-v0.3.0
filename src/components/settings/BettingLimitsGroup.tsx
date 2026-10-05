import { useState } from 'react';
import type { LeagueSettings } from '../../types';
import { maxMinBetFor, settingsInfeasibility, totalSlotsOf } from '../../engine/settingsRules';
import { NumberField, NullableNumberField } from './SettingsPrimitives';

type LimitsDraft = {
  weeklyCredits: number;
  minBetPerSlot: number;
  maxMLBet: number;
  maxPropBet: number | null;
  /** Shown as a whole percent (80), stored as a fraction (0.8). */
  capPercent: number;
};

function draftFrom(s: LeagueSettings): LimitsDraft {
  return {
    weeklyCredits: s.weeklyCredits,
    minBetPerSlot: s.minBetPerSlot,
    maxMLBet: s.maxMLBet,
    maxPropBet: s.maxPropBet,
    capPercent: Math.round(s.singleBetCapPct * 10000) / 100,
  };
}

function patchFrom(d: LimitsDraft): Partial<LeagueSettings> {
  return {
    weeklyCredits: d.weeklyCredits,
    minBetPerSlot: d.minBetPerSlot,
    maxMLBet: d.maxMLBet,
    maxPropBet: d.maxPropBet,
    singleBetCapPct: d.capPercent / 100,
  };
}

/** The five betting limits depend on each other (a minimum bet that no roster can afford, or
 * maxes too low to ever spend the weekly credits, would make a legal roster impossible), so they
 * are edited together as a draft and saved as one group. Save stays disabled until the draft is
 * different AND every combination check passes; the reasons are listed in plain language. */
export function BettingLimitsGroup({
  settings,
  onSave,
}: {
  /** What the commissioner is working with (live settings with any scheduled changes laid over them). */
  settings: LeagueSettings;
  onSave: (patch: Partial<LeagueSettings>) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [draft, setDraft] = useState<LimitsDraft>(() => draftFrom(settings));
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const original = draftFrom(settings);
  const dirty = JSON.stringify(draft) !== JSON.stringify(original);
  const slots = totalSlotsOf(settings.lineupSlots);
  const reasons = settingsInfeasibility({ ...settings, ...patchFrom(draft) });
  const canSave = dirty && reasons.length === 0 && !saving;

  function set<K extends keyof LimitsDraft>(key: K, value: LimitsDraft[K]) {
    setServerError(null);
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setServerError(null);
    const res = await onSave(patchFrom(draft));
    setSaving(false);
    if (!res.ok) setServerError(res.error ?? 'Could not save these limits.');
  }

  const highestMin = slots > 0 ? maxMinBetFor(draft.weeklyCredits, slots) : 0;

  return (
    <div className="space-y-4">
      <NumberField label="Weekly credit allocation" value={draft.weeklyCredits} onChange={(v) => set('weeklyCredits', v)} />
      <NumberField
        label="Minimum bet per slot"
        value={draft.minBetPerSlot}
        min={0}
        decimals={2}
        onChange={(v) => set('minBetPerSlot', v)}
        hint={slots > 0 ? `With ${slots} slots and $${draft.weeklyCredits} weekly, the highest minimum is $${highestMin.toFixed(2)}.` : undefined}
      />
      <NumberField label="Max moneyline/spread bet" value={draft.maxMLBet} onChange={(v) => set('maxMLBet', v)} />
      <NullableNumberField
        label="Max prop bet (blank = none)"
        value={draft.maxPropBet}
        placeholder="No max"
        onChange={(v) => set('maxPropBet', v)}
      />
      <NumberField label="Max % of weekly credits on one pick" value={draft.capPercent} onChange={(v) => set('capPercent', v)} />

      {dirty && reasons.length > 0 && (
        <ul className="space-y-1" role="alert">
          {reasons.map((r) => (
            <li key={r} className="text-xs text-loss">
              {r}
            </li>
          ))}
        </ul>
      )}
      {serverError && (
        <p className="text-xs text-loss" role="alert">
          {serverError}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => {
            setServerError(null);
            setDraft(original);
          }}
          className="flex-1 py-2 rounded-lg text-sm border border-border text-text-muted disabled:opacity-40"
        >
          Discard
        </button>
        <button
          type="button"
          disabled={!canSave}
          onClick={() => void save()}
          className="flex-1 py-2 rounded-lg text-sm font-semibold bg-primary text-white disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save limits'}
        </button>
      </div>
    </div>
  );
}
