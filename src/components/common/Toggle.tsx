import type { ReactNode } from 'react';

/** Bare on/off switch. Knob is explicitly anchored (`left-0.5`) rather than relying on
 * the browser's "static position" fallback for an unpositioned absolute element, which
 * is what caused the knob to render off-track in both states. */
export function Toggle({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!value)}
      className={`w-10 h-[22px] rounded-full relative transition-colors shrink-0 disabled:opacity-40 ${value ? 'bg-primary' : 'bg-bg-raised'}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-[18px] h-[18px] bg-white rounded-full transition-transform ${value ? 'translate-x-[18px]' : 'translate-x-0'}`}
      />
    </button>
  );
}

export function ToggleRow({
  label,
  value,
  onChange,
  disabled,
  note,
  icon,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  note?: string;
  /** Small leading icon, so a row can be told apart without a description. */
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        {icon && <span className="text-text-muted shrink-0">{icon}</span>}
        <div className="min-w-0">
          <p className="text-sm">{label}</p>
          {note && <p className="text-[11px] text-text-muted">{note}</p>}
        </div>
      </div>
      <Toggle value={value} onChange={onChange} disabled={disabled} />
    </div>
  );
}
