import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { NumberInput, NullableNumberInput } from '../common/NumberInput';
import { NameInput } from '../common/NameInput';

/** Page-level section title (Profile & Team, App Preferences, League Settings, ...).
 * Deliberately loud compared to the old small uppercase-muted label: bold, full-contrast
 * text with a short accent bar, so the page reads as clear chapters at a glance. */
export function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="w-1 h-4 rounded-full bg-primary shrink-0" />
      <h2 className="text-[15px] font-bold text-text tracking-tight">{children}</h2>
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
  children,
}: {
  title: string;
  summary?: string;
  icon?: ReactNode;
  badge?: string;
  readOnly?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-3 py-3 text-left"
      >
        {icon && (
          <span className="w-8 h-8 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center">{icon}</span>
        )}
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2">
            <span className="text-[15px] font-bold text-text">{title}</span>
            {badge && <span className="text-[10px] text-accent font-semibold shrink-0">{badge}</span>}
          </span>
          {summary && !open && <span className="block text-xs text-text-muted truncate">{summary}</span>}
        </span>
        <ChevronDown size={18} className={`text-text-muted shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <div hidden={!open} className="border-t border-border">
        <fieldset
          disabled={readOnly}
          className={`min-w-0 border-0 m-0 p-3 space-y-4 ${readOnly ? 'settings-readonly' : ''}`}
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
    <div className="pt-4 border-t border-border space-y-3 first:pt-0 first:border-t-0">
      <div>
        <p className="text-sm font-semibold text-text">{title}</p>
        {description && <p className="text-[11px] text-text-muted mt-0.5">{description}</p>}
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
      <label className="text-xs text-text-muted mb-1 block">{label}</label>
      <NumberInput
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        decimals={decimals}
        className="w-full bg-bg-raised border border-border rounded-lg px-3 py-2 text-sm"
      />
      {hint && <p className="text-[11px] text-text-muted mt-1">{hint}</p>}
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
    <div>
      <label className="text-xs text-text-muted mb-1 block">{label}</label>
      <NullableNumberInput
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full bg-bg-raised border border-border rounded-lg px-3 py-2 text-sm placeholder:text-text-muted"
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
      <label className="text-xs text-text-muted mb-1 block">{label}</label>
      {fallback != null ? (
        <NameInput value={value} onChange={onChange} fallback={fallback} className="w-full bg-bg-raised border border-border rounded-lg px-3 py-2 text-sm" />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-bg-raised border border-border rounded-lg px-3 py-2 text-sm"
        />
      )}
    </div>
  );
}
