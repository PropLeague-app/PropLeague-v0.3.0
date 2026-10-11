import { useState } from 'react';
import type { LeagueSettings } from '../../types';
import { settingsInfeasibility } from '../../engine/settingsRules';
import { KeypadField } from './KeypadField';

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
  const reasons = settingsInfeasibility({ ...settings, ...patchFrom(draft) });
  const canSave = dirty && reasons.length === 0 && !saving;

  // A value for one field is refused only for a problem it would add (not one the draft already has),
  // so a chip or a typed amount is judged on its own. The keypad leaves out chips that would fail.
  const checkFor = <K extends keyof LimitsDraft>(key: K) => (v: number | null): string | null => {
    const fresh = settingsInfeasibility({ ...settings, ...patchFrom({ ...draft, [key]: v }) });
    return fresh.find((r) => !reasons.includes(r)) ?? null;
  };
  const totalSlots = Object.values(settings.lineupSlots).reduce((a, b) => a + b, 0);
  // The highest minimum bet a full lineup can afford with these weekly credits.
  const maxMinBet = totalSlots > 0 ? Math.floor((draft.weeklyCredits / totalSlots) * 100) / 100 : draft.weeklyCredits;

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

  return (
    <div className="space-y-2">
      <KeypadField
        label="Weekly credit allocation"
        unit="$"
        value={draft.weeklyCredits}
        presets={[50, 100, 200].map((n) => ({ label: `$${n}`, value: n }))}
        check={checkFor('weeklyCredits')}
        onChange={(v) => set('weeklyCredits', v ?? 0)}
      />
      <KeypadField
        label="Minimum bet per slot"
        unit="$"
        decimals={2}
        value={draft.minBetPerSlot}
        presets={[
          ...[1, 5, 10].filter((n) => n < maxMinBet).map((n) => ({ label: `$${n}`, value: n })),
          { label: 'Max', value: maxMinBet, inBox: true },
        ]}
        sheetHint={`Up to $${maxMinBet.toFixed(2)} with ${totalSlots} slots and $${draft.weeklyCredits} a week`}
        check={checkFor('minBetPerSlot')}
        onChange={(v) => set('minBetPerSlot', v ?? 0)}
      />
      <KeypadField
        label="Max moneyline/spread bet"
        unit="$"
        value={draft.maxMLBet}
        presets={[10, 25, 50].map((n) => ({ label: `$${n}`, value: n }))}
        check={checkFor('maxMLBet')}
        onChange={(v) => set('maxMLBet', v ?? 0)}
      />
      <KeypadField
        label="Max prop bet"
        unit="$"
        allowNull
        value={draft.maxPropBet}
        presets={[...[10, 25, 50].map((n) => ({ label: `$${n}`, value: n })), { label: 'No max', value: null, inBox: true }]}
        check={checkFor('maxPropBet')}
        onChange={(v) => set('maxPropBet', v)}
      />
      <KeypadField
        label="Max % of weekly credits on one pick"
        unit="%"
        value={draft.capPercent}
        presets={[50, 75, 100].map((n) => ({ label: `${n}%`, value: n }))}
        check={(v) => (v != null && (v <= 0 || v > 100) ? 'Pick a percent from 1 to 100.' : checkFor('capPercent')(v))}
        onChange={(v) => set('capPercent', v ?? 0)}
      />

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
          className="flex-1 py-1.5 rounded-lg text-sm border border-border text-text-muted disabled:opacity-40"
        >
          Discard
        </button>
        <button
          type="button"
          disabled={!canSave}
          onClick={() => void save()}
          className="flex-1 py-1.5 rounded-lg text-sm font-semibold btn-soft-primary disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save limits'}
        </button>
      </div>
    </div>
  );
}
