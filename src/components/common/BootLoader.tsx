import { useState } from 'react';
import logo from '../../assets/logo-color.png';

/** Length of one fill cycle: keep in step with `boot-fill` in index.css. */
const FILL_CYCLE_MS = 2200;

/** index.html paints the same loader before the app bundle runs and notes when it started
 * (`window.__plBoot`). Starting this one that far into the cycle keeps the fill going instead of
 * snapping back to empty when React takes over. */
function fillOffset(): string {
  const started = (window as unknown as { __plBoot?: number }).__plBoot;
  if (typeof started !== 'number') return '0ms';
  return `${-((performance.now() - started) % FILL_CYCLE_MS)}ms`;
}

/** The brief screen shown while auth and leagues load. The logo starts grayed out and fills in
 * left to right, holds at full color for about a second, then restarts from empty if loading is
 * still going. The fill is timed rather than tied to real progress (loading has no measurable
 * percentage). Both loading states in RootRedirect render this same component in the same spot, so
 * React keeps one instance and the animation does not restart between them. The first paint of the
 * app is the identical markup in index.html. */
export function BootLoader() {
  const [offset] = useState(fillOffset);
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center" role="status" aria-label="Loading">
      <div className="relative w-12 h-12">
        <img src={logo} alt="" className="absolute inset-0 w-full h-full object-contain opacity-20 grayscale" draggable={false} />
        <img src={logo} alt="" className="absolute inset-0 w-full h-full object-contain boot-fill" style={{ animationDelay: offset }} draggable={false} />
      </div>
    </div>
  );
}
