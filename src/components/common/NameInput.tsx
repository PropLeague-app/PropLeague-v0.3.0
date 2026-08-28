import { useEffect, useRef, useState } from 'react';

/** Controlled text input for required name-like fields (manual v0.03 §3 #8: username,
 * team name, abbreviation, league name, conference names, moment display names). Live-
 * commits on every keystroke like a plain input, but on blur an empty/whitespace-only
 * value reverts to `fallback` instead of being allowed to stick — trailing/leading
 * whitespace is trimmed too. Used for settings-style edits where "revert to a sensible
 * default" is the right UX; onboarding forms that need to block Continue with inline
 * "required" feedback validate separately since that's a different interaction. */
export function NameInput({
  value,
  onChange,
  fallback,
  className = '',
  maxLength,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  fallback: string;
  className?: string;
  maxLength?: number;
  placeholder?: string;
}) {
  const [text, setText] = useState(value);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setText(e.target.value);
    onChange(e.target.value);
  }

  function handleBlur() {
    focused.current = false;
    const trimmed = text.trim();
    const final = trimmed === '' ? fallback : trimmed;
    if (final !== text) setText(final);
    if (final !== value) onChange(final);
  }

  return (
    <input
      value={text}
      maxLength={maxLength}
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
