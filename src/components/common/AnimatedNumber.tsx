import { useEffect, useRef, useState } from 'react';
import { formatCents } from '../../engine/oddsMath';
import { usePlStyle } from './usePlStyle';

export function AnimatedNumber({
  value,
  className = '',
  atRisk,
  perfect = false,
}: {
  value: number;
  className?: string;
  /** What this amount is measured against for the optional P/L color scale (weekly credits for a
   * week's score). Omit and a loss keeps the classic red. */
  atRisk?: number;
  /** A perfect week: the number is drawn as fire instead of plain green. */
  perfect?: boolean;
}) {
  const plStyle = usePlStyle();
  const [displayed, setDisplayed] = useState(value);
  const [flash, setFlash] = useState<'profit' | 'loss' | null>(null);
  const prevValue = useRef(value);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const from = prevValue.current;
    const to = value;
    if (from === to) return;

    setFlash(to > from ? 'profit' : 'loss');
    const duration = 600;
    const start = performance.now();

    function tick(now: number) {
      const progress = Math.min(1, (now - start) / duration);
      setDisplayed(from + (to - from) * progress);
      if (progress < 1) {
        frame.current = requestAnimationFrame(tick);
      } else {
        prevValue.current = to;
      }
    }
    frame.current = requestAnimationFrame(tick);

    const flashTimeout = setTimeout(() => setFlash(null), 900);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      clearTimeout(flashTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const colorClass = perfect ? 'pl-fire' : displayed > 0 ? 'text-profit' : displayed < 0 ? 'text-loss' : 'text-text';
  const flashClass = flash === 'profit' ? 'flash-profit' : flash === 'loss' ? 'flash-loss' : '';

  return (
    <span className={`${colorClass} ${flashClass} rounded px-0.5 ${className}`} style={perfect ? undefined : plStyle(displayed, atRisk)}>
      {formatCents(displayed)}
    </span>
  );
}
