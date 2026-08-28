import { useState } from 'react';
import type { LeagueTeam, OddsMarket, OddsOutcome } from '../../types';
import { OddsDisplay } from '../common/OddsDisplay';
import { TeamLogo } from '../common/TeamLogo';
import { MARKET_LABELS } from '../../data/propsGenerator';

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

export function MarketRow({
  label,
  market,
  onSelect,
  disabled,
  altLinesEnabled = true,
  checkBlocked,
  checkClaimStatus,
}: {
  label: string;
  market: OddsMarket;
  onSelect: (outcome: OddsOutcome) => void;
  disabled?: boolean;
  altLinesEnabled?: boolean;
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
  const outcomes = active?.outcomes ?? market.outcomes;

  function changeStep(next: number) {
    setStep(next);
    setTappedReason(null);
  }

  return (
    <div className="py-2.5 border-b border-border last:border-b-0">
      <div className="flex items-center justify-between">
        <div className="min-w-0 pr-2">
          <p className="text-sm font-medium truncate">{label}</p>
          <p className="text-xs text-text-muted">{MARKET_LABELS[market.key]}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
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
                className={`flex flex-col items-center border rounded-lg px-2.5 py-1.5 min-w-[64px] disabled:opacity-40 ${
                  reason ? 'bg-loss/10 border-loss/40' : 'bg-bg-raised border-border'
                }`}
              >
                <span className={`text-xs font-semibold ${reason ? 'line-through text-loss' : ''}`}>
                  {outcome.name}
                  {outcome.point != null ? ` ${outcome.point}` : ''}
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
