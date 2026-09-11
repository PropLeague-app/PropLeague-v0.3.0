import { useCallback, useEffect, useRef, useState } from 'react';

/** Standard hex <-> HSV round trip (manual v0.2.1 §5, replacing the flat swatch-dot
 * grid -- see chat: "can we do some sort of color wheel or sliders that look better
 * than these dots?"). HSV rather than HSL because the saturation/value square below
 * is the classic two-axis picker (x = saturation, y = value), which maps directly
 * onto HSV, not HSL. */
function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255 || 0;
  const g = parseInt(clean.slice(2, 4), 16) / 255 || 0;
  const b = parseInt(clean.slice(4, 6), 16) / 255 || 0;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = (((g - b) / d) % 6) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

/** Saturation/value square + hue slider color picker. Kept dependency-free (no
 * react-colorful/etc) since it's two small drag surfaces -- pointer capture on the
 * element itself means a drag tracks correctly even once the finger/cursor leaves
 * the strip, with no window-level listeners to leak.
 *
 * HSV is tracked in local state seeded from `value` and only re-derived from it when
 * `value` changes from OUTSIDE (a preset swatch tap, or switching which team's color
 * this is editing) -- re-deriving on every emitted change would round-trip through
 * hex each frame and lose the hue entirely the moment saturation or value hits 0
 * (pure white/black have no defined hue), making the hue slider jump under your
 * thumb mid-drag. */
export function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const lastEmitted = useRef(value);

  useEffect(() => {
    if (value !== lastEmitted.current) setHsv(hexToHsv(value));
  }, [value]);

  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);

  const emit = useCallback(
    (next: { h: number; s: number; v: number }) => {
      setHsv(next);
      const hex = hsvToHex(next.h, next.s, next.v);
      lastEmitted.current = hex;
      onChange(hex);
    },
    [onChange],
  );

  function dragSurface(el: HTMLDivElement, e: React.PointerEvent, onMoveTo: (x: number, y: number) => void) {
    el.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    const apply = (clientX: number, clientY: number) => {
      const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
      onMoveTo(x, y);
    };
    apply(e.clientX, e.clientY);
    const onMove = (ev: PointerEvent) => apply(ev.clientX, ev.clientY);
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  }

  const hueColor = `hsl(${hsv.h}, 100%, 50%)`;

  return (
    <div className="space-y-3">
      <div
        ref={svRef}
        onPointerDown={(e) => {
          if (svRef.current) dragSurface(svRef.current, e, (x, y) => emit({ h: hsv.h, s: x, v: 1 - y }));
        }}
        className="relative w-full h-32 rounded-lg touch-none"
        style={{
          backgroundColor: hueColor,
          backgroundImage: 'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)',
        }}
      >
        <div
          className="absolute w-4 h-4 rounded-full border-2 border-white shadow-md -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, backgroundColor: value }}
        />
      </div>
      <div
        ref={hueRef}
        onPointerDown={(e) => {
          if (hueRef.current) dragSurface(hueRef.current, e, (x) => emit({ h: x * 360, s: hsv.s, v: hsv.v }));
        }}
        className="relative w-full h-4 rounded-full touch-none"
        style={{ background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
      >
        <div
          className="absolute top-1/2 w-4 h-4 rounded-full border-2 border-white shadow-md -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          style={{ left: `${(hsv.h / 360) * 100}%`, backgroundColor: hueColor }}
        />
      </div>
    </div>
  );
}
