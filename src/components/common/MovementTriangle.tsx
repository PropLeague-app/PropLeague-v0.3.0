/** Week-over-week movement: a filled triangle and how many places.
 *
 * A triangle rather than an arrow, because this is a direction of travel in a table rather than a
 * thing to tap, and because at 7px an arrowhead with a shaft reads as noise (see chat, Oct 2026).
 *
 * Nothing is drawn when a team has not moved, and nothing when there is no previous week to compare
 * against. Those are different facts but they look the same here on purpose: a column of dashes
 * next to teams that simply held their place is clutter, and a team sitting still for a month
 * should look settled rather than repeatedly annotated.
 */
export function MovementTriangle({ value, className = '' }: { value: number | null; className?: string }) {
  if (value == null || value === 0) return <span className={`inline-block ${className}`} aria-hidden />;
  const up = value > 0;
  const places = Math.abs(value);
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[11px] tabular-nums ${up ? 'text-profit' : 'text-loss'} ${className}`}
      aria-label={up ? `Up ${places} ${places === 1 ? 'place' : 'places'}` : `Down ${places} ${places === 1 ? 'place' : 'places'}`}
      title={up ? `Up ${places} since last week` : `Down ${places} since last week`}
    >
      <svg width="7" height="6" viewBox="0 0 7 6" aria-hidden className="shrink-0">
        <path d={up ? 'M3.5 0 L7 6 L0 6 Z' : 'M3.5 6 L7 0 L0 0 Z'} fill="currentColor" />
      </svg>
      {places}
    </span>
  );
}
