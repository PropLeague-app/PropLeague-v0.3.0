import { useState } from 'react';
import { validatePayoutSplit } from '../../engine/prizePool';
import { NumberInput } from '../common/NumberInput';

const PRESETS: { label: string; splits: number[]; minPlayoffTeams: number }[] = [
  { label: 'Winner-take-all', splits: [100], minPlayoffTeams: 1 },
  { label: '80/20', splits: [80, 20], minPlayoffTeams: 2 },
  { label: '60/30/10', splits: [60, 30, 10], minPlayoffTeams: 3 },
];

function sameSplits(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function placeLabel(place: number): string {
  if (place === 1) return '1st';
  if (place === 2) return '2nd';
  if (place === 3) return '3rd';
  return `${place}th`;
}

/** manual v0.3.0 §4: fully customizable payout structure — the commissioner picks how
 * many places get paid (up to the playoff field size) and each place's percentage,
 * via quick presets or a custom per-place editor. Draft/dirty/Save pattern matches the
 * rest of this app's settings editors (IdentityPicker, LeagueMembers conference
 * assignment) rather than applying on every keystroke, since an in-progress edit is
 * routinely invalid (percentages mid-typing rarely sum to 100) and shouldn't be
 * written to the store until it's actually valid. */
export function PayoutSplitEditor({
  splits,
  playoffTeams,
  onSave,
}: {
  splits: number[];
  playoffTeams: number;
  onSave: (splits: number[]) => void;
}) {
  const [draft, setDraft] = useState<number[]>(splits);
  const dirty = !sameSplits(draft, splits);
  const validation = validatePayoutSplit(draft, playoffTeams);

  function setPlace(index: number, pct: number) {
    setDraft(draft.map((v, i) => (i === index ? pct : v)));
  }

  function addPlace() {
    if (draft.length >= playoffTeams) return;
    // New place starts at 0% — deliberately invalid until the commissioner rebalances
    // the other places, since there's no non-arbitrary way to auto-redistribute.
    setDraft([...draft, 0]);
  }

  function removePlace(index: number) {
    if (draft.length <= 1) return;
    setDraft(draft.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 flex-wrap">
        {PRESETS.filter((p) => p.minPlayoffTeams <= playoffTeams).map((preset) => (
          <button
            key={preset.label}
            onClick={() => setDraft(preset.splits)}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border ${
              sameSplits(draft, preset.splits) ? 'border-primary text-primary bg-primary/10' : 'border-border text-text-muted'
            }`}
          >
            {preset.label}
          </button>
        ))}
        <span
          className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border ${
            PRESETS.some((p) => sameSplits(draft, p.splits)) ? 'border-border text-text-muted' : 'border-primary text-primary bg-primary/10'
          }`}
        >
          Custom
        </span>
      </div>

      <div className="space-y-1.5">
        {draft.map((pct, i) => (
          <div key={i} className="flex items-center gap-2 bg-bg-raised rounded-lg px-2.5 py-1.5">
            <span className="text-xs font-medium w-14 shrink-0">{placeLabel(i + 1)} place</span>
            <div className="flex items-center gap-1 flex-1">
              <NumberInput
                value={pct}
                onChange={(v) => setPlace(i, v)}
                min={0}
                decimals={0}
                className="w-14 bg-bg-card border border-border rounded px-1.5 py-1 text-sm text-right"
              />
              <span className="text-xs text-text-muted">%</span>
            </div>
            <button
              onClick={() => removePlace(i)}
              disabled={draft.length <= 1}
              className="text-text-muted text-xs shrink-0 disabled:opacity-30"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={addPlace}
        disabled={draft.length >= playoffTeams}
        className="text-xs text-primary font-medium disabled:opacity-30 disabled:text-text-muted"
      >
        + Add a paid place
      </button>

      <div className="flex items-center justify-between gap-2 pt-1">
        <p className={`text-[11px] ${validation.valid ? 'text-text-muted' : 'text-loss'}`}>
          {validation.valid ? `Total: ${draft.reduce((a, b) => a + b, 0)}%` : validation.reason}
        </p>
        <button
          onClick={() => onSave(draft)}
          disabled={!dirty || !validation.valid}
          className="bg-primary text-white text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40 shrink-0"
        >
          Save
        </button>
      </div>
    </div>
  );
}
