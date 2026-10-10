import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { themeTone } from '../../engine/themes';

/**
 * Bankroll strip for the Lineup screen: a slim, full-width band under the title. The headline is what
 * is still unspent (unspent credits are what cost you at lock), with what is already in play on the
 * right, and a full-bleed meter along the bottom edge. The meter warms from amber to money green as
 * the lineup fills up, and turns red if the picks add up to more than the weekly credits. It is meant
 * to sit inside a container with 16px side padding (it bleeds out of it). `attached` drops that bleed
 * for a banner that is already flush with its container (the top of the bet slip sheet).
 *
 * `pending` is a stake still being decided (the bet slip). It is drawn after a small break in the
 * meter as a slowly moving hazard stripe, and echoed by a plain "+$X" in the same color. The "left"
 * figure is what would remain once it is placed (its label reads "left after").
 */
/** Orange when little is allocated, yellow at the halfway mark, then green as it fills. */
function toneHue(share: number): number {
  return share <= 0.5 ? 26 + 52 * share : 52 + 186 * (share - 0.5);
}

export function BudgetBar({
  allocated,
  total,
  attached = false,
  pending = 0,
}: {
  allocated: number;
  total: number;
  attached?: boolean;
  pending?: number;
}) {
  const hasPending = pending > 0;
  const projected = allocated + pending;
  const over = projected > total + 1e-9;
  const remaining = Math.max(0, total - projected);
  const share = total > 0 ? Math.min(1, projected / total) : 0;
  const solidPct = total > 0 ? Math.min(100, (allocated / total) * 100) : 0;
  const pendingPct = total > 0 ? Math.min(100 - solidPct, (pending / total) * 100) : 0;
  // Orange with little allocated, yellow at 50%, green once most of it is in play (see toneHue).
  // Light mode: the same hue scale, but darker so it holds up on a pale background. `tone` colors the
  // bar and `ink` the text and icon (text needs more contrast than a bar does), over a darker gray track.
  const light = themeTone(useResolvedTheme()) === 'light';
  const hue = Math.round(toneHue(share));
  const tone = over
    ? light ? 'hsl(0 72% 48%)' : 'hsl(0 78% 62%)'
    : light ? `hsl(${hue} 80% ${Math.round(46 - 8 * share)}%)` : `hsl(${hue} 74% ${Math.round(54 - 6 * share)}%)`;
  const ink = over
    ? light ? 'hsl(0 72% 40%)' : tone
    : light ? `hsl(${hue} 90% ${Math.round(31 - 5 * share)}%)` : tone;
  const track = light
    ? 'color-mix(in oklab, var(--color-text) 22%, var(--color-bg))'
    : 'color-mix(in oklab, var(--color-border) 70%, transparent)';
  const hatch = `repeating-linear-gradient(135deg, ${tone} 0 3px, transparent 3px 6px)`;
  // Fixed so the strip never changes height when a pending stake appears.
  const barH = 4;
  return (
    <div className={`relative bg-bg border-border ${attached ? 'border-b' : '-mx-4 border-y'}`}>
      <div className={`flex items-center gap-2 px-4 pt-1.5 pb-2.5`}>
        <span
          className="w-[18px] h-[18px] rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold leading-none"
          style={{ color: ink, boxShadow: `inset 0 0 0 1.25px ${ink}` }}
        >
          $
        </span>
        <span className="text-base font-bold tabular-nums leading-none tracking-tight" style={{ color: ink }}>
          {over ? `-$${(projected - total).toFixed(2)}` : `$${remaining.toFixed(2)}`}
        </span>
        <span className="text-[9px] font-semibold uppercase tracking-wider text-text-muted">
          {over ? 'over' : hasPending ? 'left after' : 'left'}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <span className="text-xs font-semibold tabular-nums text-text">${allocated.toFixed(2)}</span>
          {hasPending ? (
            <span className="text-xs font-semibold tabular-nums" style={{ color: ink }}>
              +${pending.toFixed(2)}
            </span>
          ) : null}
          <span className="text-[9px] font-semibold uppercase tracking-wider text-text-muted">in play</span>
        </span>
      </div>
      <div
        className="absolute left-0 right-0 bottom-0 flex"
        style={{ height: barH, background: track }}
      >
        <div
          className="h-full transition-all duration-300"
          style={{
            width: `${solidPct}%`,
            background: tone,
            boxShadow: solidPct > 0 && !light ? `0 0 6px ${tone}` : undefined,
          }}
        />
        {hasPending && pendingPct > 0 ? (
          <div
            className="h-full transition-all duration-300 stripe-live"
            style={{ width: `${pendingPct}%`, marginLeft: solidPct > 0 ? 3 : 0, backgroundImage: hatch }}
          />
        ) : null}
      </div>
    </div>
  );
}
