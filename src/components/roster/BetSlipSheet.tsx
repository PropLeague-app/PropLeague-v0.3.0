import { useState } from 'react';
import { X } from 'lucide-react';
import type { LeagueSettings, MarketKey, OddsOutcome, PrizePool, SlotPosition, WeekId } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { profitForStake, formatCents } from '../../engine/oddsMath';
import { realDollarAmount } from '../../engine/prizePool';
import { findClaimingTeam, claimBlockReason } from '../../engine/duplicatePicks';
import { rosterKey } from '../../engine/rosterSlots';
import { lastSlotPrefill, maxStakeNow, stakeError, type StakeContext } from '../../engine/stakeRules';
import { activeMarketRules, marketBlockReason, marketMaxStake } from '../../engine/marketRules';
import { OddsDisplay } from '../common/OddsDisplay';
import { NumberInput } from '../common/NumberInput';
import { BudgetBar } from '../common/BudgetBar';

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
  const minOdds = isML ? settings.mlBetOverride?.minOdds ?? null : settings.propBetOverride?.minOdds ?? settings.minOdds;

  // Where this roster stands, not counting the slot being filled. A new pick must leave the minimum
  // bet for every other empty slot (so a full legal roster stays reachable); swapping or editing a
  // pick that is already in the slot skips that reserve. The server enforces the same rules.
  const slotsNow = league?.rostersByTeamWeek[rosterKey(target.teamId, target.week)]?.slots;
  const otherSlots = slotsNow?.filter((sl) => sl.slotId !== target.slotId);
  const marketRules = activeMarketRules(settings);
  const marketBlocked = marketBlockReason(marketRules, target.marketKey, target.outcome.name);
  const stakeCtx: StakeContext = {
    settings,
    isMLSlot: isML,
    marketMax: marketMaxStake(marketRules, target.marketKey, target.outcome.name),
    otherStakes: otherSlots ? otherSlots.reduce((sum, sl) => sum + (sl.wager?.stake ?? 0), 0) : settings.weeklyCredits - remainingBudget,
    emptyOtherSlots: otherSlots ? otherSlots.filter((sl) => !sl.wager).length : 0,
    replacing: !!slotsNow?.find((sl) => sl.slotId === target.slotId)?.wager,
  };
  const effectiveMax = maxStakeNow(stakeCtx);

  // Last open slot: the only sensible stake is exactly what is left, so start there.
  const [stake, setStake] = useState(() => lastSlotPrefill(stakeCtx) ?? Math.max(settings.minBetPerSlot, Math.min(effectiveMax, 10)));
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
  const preClaimReason = preClaimTeamId && league ? claimBlockReason(league, preClaimTeamId, league.settings.hidePicks) : null;

  const reasons: string[] = [];
  if (marketBlocked) reasons.push(marketBlocked);
  const stakeProblem = stakeError(stakeCtx, stake);
  if (stakeProblem) reasons.push(stakeProblem);
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
          ? claimBlockReason(league, result.claimedByTeamId, league.settings.hidePicks)
          : (result.error ?? 'This pick is no longer available.'),
      );
      return;
    }
    onConfirmed();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md bg-bg-raised border-t border-border rounded-t-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Bankroll as it would stand with this stake, so the sheet shows what the pick leaves open. */}
        <BudgetBar attached allocated={stakeCtx.otherStakes} pending={Math.max(0, stake || 0)} total={settings.weeklyCredits} />
        <div className="p-4 space-y-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
        <div className="flex justify-between items-start">
          <div>
            <p className="font-bold">{target.label}</p>
            <p className="text-xs text-text-muted">
              {target.outcome.name}
              {target.outcome.point != null ? ` ${target.outcome.point}` : ''} · <OddsDisplay odds={target.outcome.price} />
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-text-muted -mr-1 -mt-1 p-1"><X size={20} /></button>
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
    </div>
  );
}