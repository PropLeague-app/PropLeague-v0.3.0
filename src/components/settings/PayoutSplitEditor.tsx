import { useState } from 'react';
import { validatePayoutSplit } from '../../engine/prizePool';
import { KeypadField } from './KeypadField';

const PRESETS: { label: string; splits: number[]; minPlayoffTeams: number }[] = [
  { label: 'Winner', splits: [100], minPlayoffTeams: 1 },
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
  topPL,
  playoffTeams,
  onSave,
}: {
  splits: number[];
  /** Share (percent) for the highest regular-season P/L; 0 = none. */
  topPL: number;
  playoffTeams: number;
  onSave: (splits: number[], topPL: number) => void;
}) {
  const [draft, setDraft] = useState<number[]>(splits);
  const [plDraft, setPlDraft] = useState<number | null>(topPL > 0 ? topPL : null);
  const pl = plDraft ?? 0;
  const dirty = !sameSplits(draft, splits) || pl !== topPL;
  const validation = validatePayoutSplit(draft, playoffTeams, pl);

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
      <div className="flex gap-1.5">
        {PRESETS.filter((p) => p.minPlayoffTeams <= playoffTeams).map((preset) => (
          <button
            key={preset.label}
            onClick={() => {
              setDraft(preset.splits);
              setPlDraft(null);
            }}
            className={`flex-1 px-1.5 py-1.5 rounded-lg text-xs font-semibold border whitespace-nowrap ${
              sameSplits(draft, preset.splits) && plDraft == null ? 'sel-pill' : 'border-border text-text-muted'
            }`}
          >
            {preset.label}
          </button>
        ))}
        <span
          className={`flex-1 text-center px-1.5 py-1.5 rounded-lg text-xs font-semibold border whitespace-nowrap ${
            PRESETS.some((p) => sameSplits(draft, p.splits)) && plDraft == null ? 'border-border text-text-muted' : 'sel-pill'
          }`}
        >
          Custom
        </span>
      </div>

      <div className="space-y-1.5">
        {draft.map((pct, i) => (
          <div key={i} className="flex items-center gap-2 bg-bg-raised rounded-lg px-2.5 py-1.5">
            <div className="flex-1 min-w-0">
              {(() => {
                // "Rest" fills this place with whatever the other places leave.
                const rest = 100 - pl - draft.reduce((sum, v, j) => (j === i ? sum : sum + v), 0);
                return (
                  <KeypadField
                    label={`${placeLabel(i + 1)} place`}
                    unit="%"
                    value={pct}
                    presets={[
                      ...[50, 75, 100].map((n) => ({ label: `${n}%`, value: n })),
                      ...(rest > 0 && rest < 100 ? [{ label: 'Rest', value: rest, inBox: true }] : []),
                    ]}
                    check={(v) => (v != null && (v < 0 || v > 100) ? 'Pick a percent from 0 to 100.' : null)}
                    sheetHint={rest > 0 && rest < 100 ? `The other places leave ${rest}%` : undefined}
                    onChange={(v) => setPlace(i, v ?? 0)}
                  />
                );
              })()}
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

      {/* Highest season P/L (1.2.11): a share of the pot for the best regular-season P/L, whatever its
          finish (it can also be a place winner). */}
      {plDraft == null ? (
        <button onClick={() => setPlDraft(0)} className="block text-xs text-primary font-medium">
          + Pay the highest season P/L
        </button>
      ) : (
        <div className="flex items-center gap-2 bg-bg-raised rounded-lg px-2.5 py-1.5">
          <div className="flex-1 min-w-0">
            {(() => {
              const rest = 100 - draft.reduce((a, b) => a + b, 0);
              return (
                <KeypadField
                  label="Top season P/L"
                  unit="%"
                  value={pl}
                  presets={[
                    ...[10, 20, 25].map((n) => ({ label: `${n}%`, value: n })),
                    ...(rest > 0 && rest < 100 ? [{ label: 'Rest', value: rest, inBox: true }] : []),
                  ]}
                  check={(v) => (v != null && (v < 0 || v > 100) ? 'Pick a percent from 0 to 100.' : null)}
                  sheetHint="Paid to the team with the best regular-season P/L, even if it also finishes in a paid place"
                  onChange={(v) => setPlDraft(v ?? 0)}
                />
              );
            })()}
          </div>
          <button onClick={() => setPlDraft(null)} className="text-text-muted text-xs shrink-0">
            ✕
          </button>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <p className={`text-[11px] ${validation.valid ? 'text-text-muted' : 'text-loss'}`}>
          {validation.valid ? `Total: ${draft.reduce((a, b) => a + b, 0) + pl}%` : validation.reason}
        </p>
        <button
          onClick={() => onSave(draft, pl)}
          disabled={!dirty || !validation.valid}
          className="btn-soft-primary text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40 shrink-0"
        >
          Save
        </button>
      </div>
    </div>
  );
}
