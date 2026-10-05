import { createContext, useContext, useState, type ReactNode } from 'react';
import { ChevronDown, CircleHelp } from 'lucide-react';
import { NumberInput, NullableNumberInput } from '../common/NumberInput';
import { NameInput } from '../common/NameInput';

/** Lets any settings group open the help sheet at its own topic: (category id, topic title). The page
 * that owns the sheet provides it; without a provider the help icon simply is not drawn. */
export const HelpContext = createContext<((category: string, topic: string) => void) | null>(null);

/** Page-level section title (Profile & Team, App Preferences, League Settings, ...).
 * Deliberately loud compared to the old small uppercase-muted label: bold, full-contrast
 * text with a short accent bar, so the page reads as clear chapters at a glance. */
export function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-1 h-4 rounded-full bg-primary shrink-0" />
      <h2 className="text-sm font-bold text-text tracking-tight">{children}</h2>
    </div>
  );
}

/** Selected/unselected styling shared by every chip-style option button on this page. */
export function chipClass(selected: boolean): string {
  return selected ? 'border-primary text-primary bg-primary/10' : 'border-border';
}

/** Accordion card: a bold title row (optional icon tile, one-line summary of the
 * current values while closed, optional badge), and a body that is NEVER unmounted when
 * closed -- only hidden -- so draft state inside (IdentityPicker, unsaved text edits)
 * survives a collapse instead of being silently lost while a parent's dirty flag stays
 * set. `readOnly` disables every native control in the body via <fieldset disabled>
 * (the header itself stays tappable, which is the whole point: members can still expand
 * a group to read it, they just can't change anything in it). */
export function CollapsibleSection({
  title,
  summary,
  icon,
  badge,
  readOnly = false,
  defaultOpen = false,
  help,
  children,
}: {
  title: string;
  summary?: string;
  icon?: ReactNode;
  badge?: string;
  readOnly?: boolean;
  defaultOpen?: boolean;
  /** [help category id, topic title]: draws a small help icon that opens the help sheet there. */
  help?: [string, string];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const openHelp = useContext(HelpContext);
  return (
    <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex-1 min-w-0 flex items-center gap-2.5 pl-3 pr-2 py-2.5 text-left"
        >
          {icon && (
            <span className="w-7 h-7 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center">{icon}</span>
          )}
          <span className="flex-1 min-w-0">
            <span className="flex items-center gap-2">
              <span className="text-sm font-bold text-text">{title}</span>
              {badge && <span className="text-[10px] text-accent font-semibold shrink-0">{badge}</span>}
            </span>
            {summary && !open && <span className="block text-[11px] text-text-muted truncate">{summary}</span>}
          </span>
        </button>
        {help && openHelp && (
          <button
            type="button"
            onClick={() => openHelp(help[0], help[1])}
            aria-label={`Help: ${title}`}
            className="p-1.5 text-text-muted hover:text-primary shrink-0"
          >
            <CircleHelp size={16} />
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
          className="pl-1 pr-3 py-2.5 shrink-0"
        >
          <ChevronDown size={16} className={`text-text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      <div hidden={!open} className="border-t border-border">
        <fieldset
          disabled={readOnly}
          className={`min-w-0 border-0 m-0 p-2.5 space-y-3 ${readOnly ? 'settings-readonly' : ''}`}
        >
          {children}
        </fieldset>
      </div>
    </div>
  );
}

/** A titled block inside a CollapsibleSection body: bold title, optional one-line
 * description, divider above every block except the first. */
export function SubSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="pt-3 border-t border-border space-y-2 first:pt-0 first:border-t-0">
      <div>
        <p className="text-[13px] font-semibold text-text">{title}</p>
        {description && <p className="text-[11px] text-text-muted">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  decimals,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  decimals?: number;
  hint?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <label className="text-xs text-text-muted">{label}</label>
        <NumberInput
          value={value}
          onChange={onChange}
          min={min}
          max={max}
          decimals={decimals}
          className="w-24 bg-bg-raised border border-border rounded-lg px-2.5 py-1.5 text-sm text-right"
        />
      </div>
      {hint && <p className="text-[11px] text-text-muted mt-0.5">{hint}</p>}
    </div>
  );
}

export function NullableNumberField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label className="text-xs text-text-muted">{label}</label>
      <NullableNumberInput
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-24 bg-bg-raised border border-border rounded-lg px-2.5 py-1.5 text-sm text-right placeholder:text-text-muted"
      />
    </div>
  );
}

/** `fallback` makes this a required field (manual v0.03 §3 #8): an empty/whitespace
 * value reverts to it on blur instead of sticking. Omit `fallback` for optional text. */
export function TextField({
  label,
  value,
  onChange,
  fallback,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  fallback?: string;
}) {
  return (
    <div>
      <label className="text-xs text-text-muted mb-0.5 block">{label}</label>
      {fallback != null ? (
        <NameInput value={value} onChange={onChange} fallback={fallback} className="w-full bg-bg-raised border border-border rounded-lg px-2.5 py-1.5 text-sm" />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-bg-raised border border-border rounded-lg px-2.5 py-1.5 text-sm"
        />
      )}
    </div>
  );
}

/** A compact - n + stepper row for small integer settings. */
export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  format,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between bg-bg-raised rounded-lg px-2.5 py-1">
      <span className="text-xs font-medium">{label}</span>
      <div className="flex items-center gap-1">
        <button type="button" disabled={disabled || value <= min} onClick={() => onChange(Math.max(min, value - 1))} className="text-text-muted w-6 h-6 disabled:opacity-30">
          −
        </button>
        <span className="text-sm w-10 text-center">{format ? format(value) : value}</span>
        <button type="button" disabled={disabled || value >= max} onClick={() => onChange(Math.min(max, value + 1))} className="text-text-muted w-6 h-6 disabled:opacity-30">
          +
        </button>
      </div>
    </div>
  );
}

/** A row of equal-width option buttons (optionally with an icon above each label). */
export function ChipRow<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { value: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-1.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-lg border py-1.5 text-xs font-medium flex flex-col items-center gap-0.5 disabled:opacity-40 ${chipClass(value === o.value)}`}
        >
          {o.icon}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}
