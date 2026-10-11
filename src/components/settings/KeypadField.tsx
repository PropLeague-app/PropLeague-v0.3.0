import { useState } from 'react';
import { X } from 'lucide-react';
import { applyStakeKey, type KeypadKey } from '../../engine/stakeInput';
import { NumericKeypad } from '../common/NumericKeypad';
import { SOFT_PRIMARY_BTN, SOFT_PROFIT_BTN } from '../common/buttonStyles';

export interface KeypadPreset {
  label: string;
  /** null = "no limit" for a field that allows none. */
  value: number | null;
  /** Shown as a small pill inside the amount box (like the bet slip's MAX) instead of a chip. */
  inBox?: boolean;
}

/** Dollar presets are green like the bet slip's; percent presets use the accent; counts stay neutral. */
export type KeypadUnit = '$' | '%' | '';

function format(value: number | null, unit: KeypadUnit, decimals: number, nullLabel: string): string {
  if (value == null) return nullLabel;
  const n = value.toFixed(decimals);
  return unit === '$' ? `$${n}` : unit === '%' ? `${n}%` : n;
}

/**
 * A numeric setting edited with the app's own keypad (1.2.11) instead of the phone keyboard. The row
 * shows the value; tapping it opens a sheet with setting-specific quick chips, the amount, the keypad and
 * Done. `check` returns why a value cannot be used (shown above the keypad, Done disabled), and chips that
 * would fail it are left out, so a chip is always a legal choice.
 */
export function KeypadField({
  label,
  value,
  onChange,
  unit = '',
  decimals = 0,
  presets = [],
  allowNull = false,
  nullLabel = 'No max',
  check,
  hint,
  sheetHint,
  disabled,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  unit?: KeypadUnit;
  decimals?: number;
  presets?: KeypadPreset[];
  allowNull?: boolean;
  nullLabel?: string;
  check?: (v: number | null) => string | null;
  hint?: string;
  /** One line under the title in the keypad sheet (e.g. what the highest legal amount is). */
  sheetHint?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <label className="text-xs text-text-muted">{label}</label>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className="w-24 bg-bg-raised border border-border rounded-lg px-2.5 py-1.5 text-sm text-right tabular-nums disabled:opacity-50"
        >
          {format(value, unit, decimals, nullLabel)}
        </button>
      </div>
      {hint && <p className="text-[11px] text-text-muted mt-0.5">{hint}</p>}
      {open && (
        <KeypadSheet
          label={label}
          initial={value}
          unit={unit}
          decimals={decimals}
          presets={presets}
          allowNull={allowNull}
          nullLabel={nullLabel}
          check={check}
          sheetHint={sheetHint}
          onClose={() => setOpen(false)}
          onDone={(v) => {
            onChange(v);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function KeypadSheet({
  label,
  initial,
  unit,
  decimals,
  presets,
  allowNull,
  nullLabel,
  check,
  sheetHint,
  onClose,
  onDone,
}: {
  label: string;
  sheetHint?: string;
  initial: number | null;
  unit: KeypadUnit;
  decimals: number;
  presets: KeypadPreset[];
  allowNull: boolean;
  nullLabel: string;
  check?: (v: number | null) => string | null;
  onClose: () => void;
  onDone: (v: number | null) => void;
}) {
  // The current value shows as if selected: the first key starts a new number.
  const [text, setText] = useState(initial == null ? '' : String(initial));
  const [fresh, setFresh] = useState(true);
  const value: number | null = text === '' ? (allowNull ? null : 0) : Number(text);
  const problem = check ? check(value) : null;
  const chips = presets.filter((p) => !check || check(p.value) == null);
  const boxPill = chips.find((p) => p.inBox);
  const pick = (p: KeypadPreset) => {
    setText(p.value == null ? '' : String(p.value));
    setFresh(true);
  };
  const chipClass = unit === '$' ? SOFT_PROFIT_BTN : unit === '%' ? SOFT_PRIMARY_BTN : 'border border-border text-text';

  function onKey(key: KeypadKey) {
    let next = fresh ? (key === 'back' ? '' : applyStakeKey('', key)) : applyStakeKey(text, key);
    if (decimals === 0) next = next.replace('.', '');
    setFresh(false);
    setText(next);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-md bg-bg-raised border-t border-border rounded-t-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 space-y-3" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
          <div className="flex justify-between items-start gap-3">
            <div className="min-w-0">
              <p className="font-bold leading-tight">{label}</p>
              {sheetHint && <p className="text-xs text-text-muted mt-0.5">{sheetHint}</p>}
            </div>
            <button onClick={onClose} aria-label="Close" className="text-text-muted -mr-1 p-1 shrink-0">
              <X size={20} />
            </button>
          </div>
          {/* Same layout as the bet slip: compact chips, then the amount box with an optional pill. */}
          <div className="flex items-stretch gap-2">
            {chips.filter((p) => !p.inBox).map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => pick(p)}
                className={`px-3 rounded-lg text-sm whitespace-nowrap ${chipClass}`}
              >
                {p.label}
              </button>
            ))}
            <div aria-label={label} className="flex-1 min-w-0 flex items-center gap-1.5 bg-bg-card border border-border rounded-lg px-3 py-2">
              {unit === '$' && <span className="text-text-muted">$</span>}
              {boxPill && (
                <button
                  type="button"
                  onClick={() => pick(boxPill)}
                  className="shrink-0 rounded-md border border-border bg-bg-raised px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-text-muted"
                >
                  {boxPill.label}
                </button>
              )}
              <span className={`w-full min-w-0 truncate text-lg font-semibold text-right tabular-nums ${fresh ? 'text-text-muted' : ''}`}>
                {text === '' ? (allowNull ? nullLabel : '0') : text}
              </span>
              {unit === '%' && <span className="text-text-muted">%</span>}
            </div>
          </div>
          {/* Above the keypad so the keys never move when the message comes and goes. */}
          {problem && <p className="text-loss text-xs">{problem}</p>}
          <NumericKeypad onKey={onKey} allowDecimal={decimals > 0} onEnter={() => !problem && onDone(value)} onEscape={onClose} />
          <button
            type="button"
            disabled={!!problem}
            onClick={() => onDone(value)}
            className={`w-full h-12 rounded-xl text-base font-semibold ${SOFT_PRIMARY_BTN}`}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
