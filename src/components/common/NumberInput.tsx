import { useEffect, useRef, useState } from 'react';

/**
 * Strips anything non-numeric, collapses to a single decimal point, and removes a
 * stray leading zero as soon as a further digit follows it (so "0" then typing "2"
 * becomes "2", not "02", and "10" backspaced to "" stays "" instead of snapping to "0").
 */
function sanitizeNumericText(raw: string): string {
  let next = raw.replace(/[^0-9.]/g, '');
  const firstDot = next.indexOf('.');
  if (firstDot !== -1) {
    next = next.slice(0, firstDot + 1) + next.slice(firstDot + 1).replace(/\./g, '');
  }
  next = next.replace(/^0+(?=\d)/, '');
  return next;
}

const sharedInputProps = {
  type: 'text' as const,
  inputMode: 'decimal' as const,
  // Blur on wheel so trackpad/mouse-wheel scrolling over the field scrolls the page
  // instead of incrementing the value (native <input type="number"> behavior).
  onWheel: (e: React.WheelEvent<HTMLInputElement>) => e.currentTarget.blur(),
};

/**
 * Controlled numeric text input that avoids the classic React leading-zero bug:
 * clearing the field keeps it empty while focused (never snaps back to "0" mid-edit).
 * The value is only clamped/finalized on blur.
 *
 * `decimals` (manual v0.1.1 §3 #5) — when set, the display snaps to exactly that many
 * decimal places on blur via `toFixed`, so a stake input showing "12.5" becomes
 * "12.50" and a trailing-dot "9." becomes "9.00". `onChange` always receives the true
 * numeric value regardless (12.5, not 12.05) — this only affects what's displayed.
 * Omit for non-currency numeric fields (week counts, slot counts, etc).
 */
export function NumberInput({
  value,
  onChange,
  disabled,
  min = 0,
  max,
  decimals,
  className = '',
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
  decimals?: number;
  className?: string;
}) {
  const [text, setText] = useState(() => (decimals != null ? value.toFixed(decimals) : String(value)));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(decimals != null ? value.toFixed(decimals) : String(value));
  }, [value, decimals]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = sanitizeNumericText(e.target.value);
    setText(next);
    if (next !== '' && next !== '.') {
      const parsed = Number(next);
      if (!Number.isNaN(parsed)) onChange(parsed);
    }
  }

  function handleBlur() {
    focused.current = false;
    const parsed = Number(text);
    let clamped = text === '' || Number.isNaN(parsed) ? min : parsed;
    clamped = Math.max(min, max != null ? Math.min(max, clamped) : clamped);
    setText(decimals != null ? clamped.toFixed(decimals) : String(clamped));
    onChange(clamped);
  }

  return (
    <input
      {...sharedInputProps}
      disabled={disabled}
      value={text}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={handleChange}
      onBlur={handleBlur}
      className={className}
    />
  );
}

/** Same behavior as NumberInput, but an empty field commits `null` (e.g. "no limit") on
 * blur instead of clamping to `min` — for optional numeric settings like max bet caps. */
export function NullableNumberInput({
  value,
  onChange,
  disabled,
  min = 0,
  max,
  placeholder,
  className = '',
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
  placeholder?: string;
  className?: string;
}) {
  const [text, setText] = useState(() => (value == null ? '' : String(value)));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(value == null ? '' : String(value));
  }, [value]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = sanitizeNumericText(e.target.value);
    setText(next);
    if (next !== '' && next !== '.') {
      const parsed = Number(next);
      if (!Number.isNaN(parsed)) onChange(parsed);
    } else if (next === '') {
      onChange(null);
    }
  }

  function handleBlur() {
    focused.current = false;
    if (text === '') {
      onChange(null);
      return;
    }
    const parsed = Number(text);
    let clamped = Number.isNaN(parsed) ? min : parsed;
    clamped = Math.max(min, max != null ? Math.min(max, clamped) : clamped);
    setText(String(clamped));
    onChange(clamped);
  }

  return (
    <input
      {...sharedInputProps}
      disabled={disabled}
      value={text}
      placeholder={placeholder}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={handleChange}
      onBlur={handleBlur}
      className={className}
    />
  );
}
