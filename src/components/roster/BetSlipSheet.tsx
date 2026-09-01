import { useState } from 'react';
import type { LeagueSettings, MarketKey, OddsOutcome, PrizePool, SlotPosition, WeekId } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { profitForStake, formatCents } from '../../engine/oddsMath';
import { realDollarAmount } from '../../engine/prizePool';
import { findClaimingTeam, claimBlockReason } from '../../engine/duplicatePicks';
import { OddsDisplay } from '../common/OddsDisplay';
import { NumberInput } from '../common/NumberInput';

export interface BetSlipTarget {
  leagueId: string;
  teamId: string;
  week: WeekId;
  slotId: string;
  slotPosition: SlotPosition;
  gameId: string;
  marketKey: MarketKey;
  outcome: OddsOutcome;
  playerId?: string;
  playerName?: string;
  label: string;
}

export function BetSlipSheet({
  target,
  settings,
  remainingBudget,
  pool,
  teamCount,
  multiplier = 1,
  onClose,
  onConfirmed,
}: {
  target: BetSlipTarget;
  settings: LeagueSettings;
  remainingBudget: number;
  pool?: PrizePool | null;
  teamCount?: number;
  /** manual v0.3.0 §8: the placing team's current prize-pool impact multiplier —
   * applied to the "real $ at stake" preview so a commissioner running multipliers
   * sees their actual exposure, not the unscaled 1/N share. */
  multiplier?: number;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const placeWager = useAppStore((s) => s.placeWager);
  const league = useAppStore((s) => s.leagues[target.leagueId]);
  const isML = target.slotPosition === 'ML';
  const maxForSlot = isML ? (settings.mlBetOverride?.max ?? settings.maxMLBet) : (settings.propBetOverride?.max ?? settings.maxPropBet);
  const capAmount = settings.weeklyCredits * settings.singleBetCapPct;
  const effectiveMax = Math.min(maxForSlot ?? Infinity, capAmount, Math.max(0, remainingBudget));
  const minOdds = isML ? settings.mlBetOverride?.minOdds ?? null : settings.propBetOverride?.minOdds ?? settings.minOdds;

  const [stake, setStake] = useState(() => Math.max(settings.minBetPerSlot, Math.min(effectiveMax, 10)));
  const [claimError, setClaimError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Pre-checked up front (manual v0.1.1 §3 #7 — "same treatment inside the bet slip if
  // reached via deep link") rather than only discovered after tapping Add to Roster, so
  // a blocked pick shows its reason and a disabled button immediately.
  const preClaimTeamId = league
    ? findClaimingTeam(
        league,
        target.week,
        { gameId: target.gameId, marketKey: target.marketKey, playerId: target.playerId, side: target.outcome.name, point: target.outcome.point },
        target.teamId,
      )
    : null;
  const preClaimReason = preClaimTeamId && league ? claimBlockReason(league, preClaimTeamId) : null;

  const reasons: string[] = [];
  if (stake < settings.minBetPerSlot) reasons.push(`Minimum bet is $${settings.minBetPerSlot.toFixed(2)}`);
  if (maxForSlot != null && stake > maxForSlot) reasons.push(`Maximum bet is $${maxForSlot.toFixed(2)}`);
  if (stake > capAmount) reasons.push(`Exceeds ${Math.round(settings.singleBetCapPct * 100)}% cap ($${capAmount.toFixed(2)})`);
  if (stake > remainingBudget + 0.001) reasons.push(`Only $${remainingBudget.toFixed(2)} remaining this week`);
  if (minOdds != null && target.outcome.price < minOdds) reasons.push(`Below minimum odds of ${minOdds}`);
  if (preClaimReason) reasons.push(preClaimReason);
  if (claimError) reasons.push(claimError);

  const valid = reasons.length === 0 && stake > 0;
  const potentialProfit = profitForStake(stake, target.outcome.price);

  async function confirm() {
    if (!valid) return;
    setSubmitting(true);
    const result = await placeWager({
      leagueId: target.leagueId,
      teamId: target.teamId,
      week: target.week,
      slotId: target.slotId,
      gameId: target.gameId,
      marketKey: target.marketKey,
      side: target.outcome.name,
      price: target.outcome.price,
      point: target.outcome.point,
      playerId: target.playerId,
      playerName: target.playerName,
      stake,
    });
    setSubmitting(false);
    if (!result.ok) {
      setClaimError(
        result.claimedByTeamId && league
          ? claimBlockReason(league, result.claimedByTeamId)
          : (result.error ?? 'This pick is no longer available.'),
      );
      return;
    }
    onConfirmed();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md bg-bg-raised border-t border-border rounded-t-2xl p-4 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start">
          <div>
            <p className="font-bold">{target.label}</p>
            <p className="text-xs text-text-muted">
              {target.outcome.name}
              {target.outcome.point != null ? ` ${target.outcome.point}` : ''} · <OddsDisplay odds={target.outcome.price} />
            </p>
          </div>
          <button onClick={onClose} className="text-text-muted text-sm">Close</button>
        </div>

        <div>
          <label className="text-xs text-text-muted mb-1 block">Stake</label>
          <div className="flex items-center gap-2 bg-bg-card border border-border rounded-lg px-3 py-2">
            <span className="text-text-muted">$</span>
            <NumberInput
              value={stake}
              onChange={setStake}
              min={0}
              decimals={2}
              className="flex-1 bg-transparent outline-none text-lg font-semibold"
            />
          </div>
        </div>

        <div className="flex justify-between text-sm bg-bg-card border border-border rounded-lg px-3 py-2.5">
          <span className="text-text-muted">Potential profit</span>
          <span className="font-semibold text-profit">{formatCents(potentialProfit)}</span>
        </div>

        {settings.buyInEnabled && settings.showRealDollarStakes && pool && teamCount && (
          <div className="flex justify-between text-xs text-text-muted px-1">
            <span>Real $ at stake{multiplier !== 1 ? ` (${multiplier.toFixed(2)}x)` : ''}</span>
            <span>{formatCents(realDollarAmount(stake, settings.weeklyCredits, pool.current, teamCount) * multiplier)}</span>
          </div>
        )}

        {reasons.length > 0 && <p className="text-loss text-xs">{reasons[0]}</p>}

        <button
          disabled={!valid || submitting}
          onClick={confirm}
          className="w-full bg-primary text-white font-semibold py-3 rounded-xl disabled:opacity-40"
        >
          {submitting ? 'Adding…' : 'Add to Roster'}
        </button>
      </div>
    </div>
  );
}