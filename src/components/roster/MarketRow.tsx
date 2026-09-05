import { useState } from 'react';
import type { LeagueTeam, OddsMarket, OddsOutcome } from '../../types';
import { OddsDisplay } from '../common/OddsDisplay';
import { TeamLogo } from '../common/TeamLogo';

/** manual v0.2.0 §3 #4: mini claimant logos + progress dots toward the cap, shown on a
 * still-pickable outcome once at least one other team already holds it. Distinct from
 * (and rendered instead of, once the cap is hit) the red/strikethrough full state —
 * that one already tells the whole story once nothing is left to claim. */
function ClaimProgress({ holderTeams, cap }: { holderTeams: LeagueTeam[]; cap: number }) {
  return (
    <div className="flex items-center gap-1 mt-1">
      <div className="flex -space-x-1">
        {holderTeams.slice(0, 3).map((t) => (
          <TeamLogo key={t.id} team={t} size="xs" />
        ))}
      </div>
      <div className="flex items-center gap-0.5">
        {Array.from({ length: cap }, (_, i) => (
          <span key={i} className={`w-1.5 h-1.5 rounded-full ${i < holderTeams.length ? 'bg-accent' : 'bg-bg-raised border border-border'}`} />
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
  checkClaimStatus?: (outcome: OddsOutcome) => { holderTeams: LeagueTeam[]; cap: number } | null;
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
        <p className="w-28 shrink-0 text-xs font-medium leading-tight pr-2">{label}</p>
        <div className="flex-1 flex items-center justify-end gap-1.5">
          {showStepper && (
            <button
              disabled={disabled}
              onClick={() => changeStep(Math.max(-1, step - 1))}
              className="text-text-muted text-sm px-1 disabled:opacity-30"
              aria-label="Lower alt line"
            >
              ‹
            </button>
          )}
          {outcomes.map((outcome) => {
            const reason = checkBlocked?.(outcome) ?? null;
            const claimStatus = !reason ? (checkClaimStatus?.(outcome) ?? null) : null;
            return (
              <button
                key={outcome.name}
                disabled={disabled}
                onClick={() => {
                  if (reason) {
                    setTappedReason(reason);
                    return;
                  }
                  setTappedReason(null);
                  onSelect(outcome);
                }}
                className={`flex flex-col items-center border rounded-lg px-1.5 py-1 w-16 shrink-0 disabled:opacity-40 ${
                  reason ? 'bg-loss/10 border-loss/40' : 'bg-bg-raised border-border'
                }`}
              >
                <span className={`text-xs font-semibold ${reason ? 'line-through text-loss' : ''}`}>
                  {hideOutcomeNames ? '' : outcome.name}
                  {outcome.point != null ? `${hideOutcomeNames ? '' : ' '}${outcome.point}` : ''}
                </span>
                <OddsDisplay odds={outcome.price} className={`text-xs ${reason ? 'text-loss' : 'text-primary'}`} />
                {claimStatus && <ClaimProgress holderTeams={claimStatus.holderTeams} cap={claimStatus.cap} />}
              </button>
            );
          })}
          {showStepper && (
            <button
              disabled={disabled}
              onClick={() => changeStep(Math.min(1, step + 1))}
              className="text-text-muted text-sm px-1 disabled:opacity-30"
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