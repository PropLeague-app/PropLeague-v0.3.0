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
      className={`w-11 h-6 rounded-full relative transition-colors shrink-0 disabled:opacity-40 ${value ? 'bg-primary' : 'bg-bg-raised'}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${value ? 'translate-x-5' : 'translate-x-0'}`}
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
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  note?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-sm">{label}</p>
        {note && <p className="text-[11px] text-text-muted">{note}</p>}
      </div>
      <Toggle value={value} onChange={onChange} disabled={disabled} />
    </div>
  );
}
