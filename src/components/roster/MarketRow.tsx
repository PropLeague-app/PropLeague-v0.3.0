import { useState } from 'react';
import type { LeagueTeam, OddsMarket, OddsOutcome } from '../../types';
import { OddsDisplay } from '../common/OddsDisplay';
import { TeamLogo } from '../common/TeamLogo';

/** Who holds an outcome, for the claim banner under it. `hidden` (Hide Picks on, game not started)
 * means the holders must not be identifiable: the count still shows, the logos do not. */
export interface ClaimStatus {
  holderCount: number;
  holderTeams: LeagueTeam[];
  cap: number;
  hidden: boolean;
}

/** Dot color by spots left: none red, one orange, two yellow, three or more green. For bigger caps the
 * green shades toward lime as it fills, so every filled dot still moves along the scale. */
export function claimColor(filled: number, cap: number): string {
  const left = cap - filled;
  if (left <= 0) return 'hsl(0 72% 58%)';
  if (left === 1) return 'hsl(28 92% 56%)';
  if (left === 2) return 'hsl(48 94% 52%)';
  const t = cap <= 4 ? 0 : Math.min(1, (filled - 1) / Math.max(1, cap - 4));
  return `hsl(${Math.round(140 - t * 50)} 62% 46%)`;
}

/** A thin banner tacked onto the bottom of an outcome box (manual v0.2.0 §3 #4, reworked): dots for the
 * claimed spots out of the cap, colored by how few are left, plus overlapping claimant logos when picks
 * are visible. Same width as the box above, so the row's layout does not change. */
export function ClaimBanner({ status, wide }: { status: ClaimStatus; wide: boolean }) {
  const { holderCount, holderTeams, cap, hidden } = status;
  const color = claimColor(holderCount, cap);
  const full = holderCount >= cap;
  const dot = cap <= 5 ? 6 : 4;
  const gap = cap <= 5 ? 3 : 2;
  const dotsPx = cap * dot + (cap - 1) * gap;
  const room = (wide ? 120 : 54) - dotsPx - 4;
  const fit = Math.max(0, Math.floor((room - 16) / 10) + 1);
  const logos = hidden ? [] : holderTeams.slice(0, Math.min(fit, 4));
  return (
    <div
      className={`flex items-center justify-center h-[18px] px-1 gap-1 border border-t-0 rounded-b-lg ${
        full ? 'bg-loss/10 border-loss/40' : 'bg-bg-raised border-border'
      }`}
    >
      {logos.length > 0 && (
        <div className="flex">
          {logos.map((t, i) => (
            <span key={t.id} className="rounded-full ring-1 ring-bg-raised" style={{ marginLeft: i === 0 ? 0 : -6 }}>
              <TeamLogo team={t} size="xs" />
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center" style={{ gap }}>
        {Array.from({ length: cap }, (_, i) => (
          <span
            key={i}
            className="rounded-full"
            style={{
              width: dot,
              height: dot,
              backgroundColor: i < holderCount ? color : 'transparent',
              border: i < holderCount ? 'none' : '1px solid var(--color-border, #3a4256)',
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** Now used exclusively for player-prop markets (game-level h2h/spreads moved to
 * GameLinesTable) -- label is the market type itself ("Passing Yards"), not the
 * player's name, since that's shown once by the caller's PlayerPropsCard header
 * instead of repeating on every one of a player's rows. The label column and each
 * outcome button both use a fixed width (rather than the previous min-width/flex
 * mix) specifically so every row's odds boxes land in the same place regardless of
 * how long that row's label text is. Label wraps instead of truncating -- a fixed
 * width alone doesn't help if the text still gets cut off inside it. */
export function MarketRow({
  label,
  market,
  onSelect,
  disabled,
  altLinesEnabled = true,
  hideOutcomeNames = false,
  checkBlocked,
  checkClaimStatus,
}: {
  label: string;
  market: OddsMarket;
  onSelect: (outcome: OddsOutcome) => void;
  disabled?: boolean;
  altLinesEnabled?: boolean;
  /** Omits the outcome name ("Over"/"Under") from inside each box -- used when a
   * shared column header above (see PlayerPropsCard) already provides that
   * context, so the box only needs to show the line + odds and can be narrower. */
  hideOutcomeNames?: boolean;
  /** Returns a short reason ("Claimed by [team]") when this exact outcome is
   * unavailable (manual v0.1.1 §3 #7), or null when it's free to pick. */
  checkBlocked?: (outcome: OddsOutcome) => string | null;
  /** Returns the current claimants + cap for the "N of cap claimed" progress
   * indicator (manual v0.2.0 §3 #4), or null when nobody holds this outcome yet. */
  checkClaimStatus?: (outcome: OddsOutcome) => ClaimStatus | null;
}) {
  const [step, setStep] = useState(0); // -1 = lower alt, 0 = standard, 1 = higher alt
  const [tappedReason, setTappedReason] = useState<string | null>(null);
  const showStepper = altLinesEnabled && !!market.altLines;
  const active = step === -1 ? market.altLines?.[0] : step === 1 ? market.altLines?.[1] : market;
  // "Over" sorted before "Under" regardless of the source order, so it always
  // lines up under whichever header column PlayerPropsCard rendered as "Over".
  const outcomes = [...(active?.outcomes ?? market.outcomes)].sort((a, b) => (a.name === 'Over' ? -1 : b.name === 'Over' ? 1 : 0));

  function changeStep(next: number) {
    setStep(next);
    setTappedReason(null);
  }

  return (
    <div className="py-1 border-b border-border last:border-b-0">
      <div className="flex items-center">
        <p className="w-36 shrink-0 text-xs font-medium leading-tight pr-2">{label}</p>
        <div className="flex-1 flex items-start justify-end gap-1.5">
          {showStepper && (
            <button
              disabled={disabled}
              onClick={() => changeStep(Math.max(-1, step - 1))}
              className="text-text-muted text-sm px-1 self-center disabled:opacity-30"
              aria-label="Lower alt line"
            >
              ‹
            </button>
          )}
          {outcomes.map((outcome) => {
            const reason = checkBlocked?.(outcome) ?? null;
            const claimStatus = checkClaimStatus?.(outcome) ?? null;
            // A single-outcome market (Anytime TD) doesn't have a second column to
            // sit next to -- right-aligning one w-16 button left it looking like it
            // belonged under "Under" specifically, rather than being its own thing.
            // Spanning the full combined width of both standard columns (64px +
            // 6px gap + 64px) instead reads as one deliberate, full-width row.
            const widthClass = outcomes.length === 1 ? 'w-[134px]' : 'w-16';
            return (
              <div key={outcome.name} className={`${widthClass} shrink-0 flex flex-col`}>
                <button
                  disabled={disabled}
                  onClick={() => {
                    if (reason) {
                      setTappedReason(reason);
                      return;
                    }
                    setTappedReason(null);
                    onSelect(outcome);
                  }}
                  className={`flex flex-col items-center border px-1.5 py-1 w-full disabled:opacity-40 ${claimStatus ? 'rounded-t-lg' : 'rounded-lg'} ${
                    reason ? 'bg-loss/10 border-loss/40' : 'bg-bg-raised border-border'
                  }`}
                >
                  <span className={`text-xs font-semibold ${reason ? 'line-through text-loss' : ''}`}>
                    {hideOutcomeNames ? '' : outcome.name}
                    {outcome.point != null ? `${hideOutcomeNames ? '' : ' '}${outcome.point}` : ''}
                  </span>
                  <OddsDisplay odds={outcome.price} className={`text-xs ${reason ? 'text-loss' : 'text-primary'}`} />
                </button>
                {claimStatus && <ClaimBanner status={claimStatus} wide={outcomes.length === 1} />}
              </div>
            );
          })}
          {showStepper && (
            <button
              disabled={disabled}
              onClick={() => changeStep(Math.min(1, step + 1))}
              className="text-text-muted text-sm px-1 self-center disabled:opacity-30"
              aria-label="Higher alt line"
            >
              ›
            </button>
          )}
        </div>
      </div>
      {tappedReason && <p className="text-[10px] text-loss text-right mt-1">{tappedReason}</p>}
    </div>
  );
}