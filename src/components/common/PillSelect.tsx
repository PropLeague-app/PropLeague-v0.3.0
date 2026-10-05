import { ChevronDown } from 'lucide-react';

export interface PillOption<T extends string> {
  value: T;
  label: string;
}

/**
 * A compact filter/sort chip that opens the native picker. The visible text is small and ours; the
 * real <select> sits invisibly on top so a tap opens the OS picker. That matters because the app
 * forces every input and select to 16px (index.css, to stop iOS zooming on focus), which made a
 * bare <select> render far larger than the rest of the screen.
 *
 * `active` highlights the chip when it is holding a non-default choice (a filter in effect).
 */
export function PillSelect<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  label,
  active = false,
}: {
  value: T;
  onChange: (value: T) => void;
  options: PillOption<T>[];
  ariaLabel: string;
  /** Overrides the text shown on the chip (for "Sort: ..." style prefixes). Defaults to the selected option. */
  label?: string;
  active?: boolean;
}) {
  const selected = options.find((o) => o.value === value);
  return (
    <label
      className={`relative inline-flex items-center gap-1 shrink-0 rounded-full border pl-3 pr-2 py-1 text-[11px] font-semibold ${
        active ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-bg-card text-text-muted'
      }`}
    >
      <span className="whitespace-nowrap">{label ?? selected?.label ?? ''}</span>
      <ChevronDown size={12} className="shrink-0" />
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
