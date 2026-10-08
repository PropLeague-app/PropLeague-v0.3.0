import { useState } from 'react';
import { X } from 'lucide-react';
import type { LeagueSettings, MarketKey, OddsOutcome, PrizePool, SlotPosition, WeekId } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { profitForStake, formatCents } from '../../engine/oddsMath';
import { realDollarAmount } from '../../engine/prizePool';
import { findClaimingTeam, claimBlockReason } from '../../engine/duplicatePicks';
import { rosterKey } from '../../engine/rosterSlots';
import { stakeError, type StakeContext } from '../../engine/stakeRules';
import { activeMarketRules, marketBlockReason, marketMaxStake, marketSlotCapReason } from '../../engine/marketRules';
import { OddsDisplay } from '../common/OddsDisplay';
import { MARKET_LABELS } from '../../data/propsGenerator';
import { BudgetBar } from '../common/BudgetBar';
import { SOFT_PRIMARY_BTN, SOFT_PROFIT_BTN } from '../common/buttonStyles';
import { NumericKeypad } from '../common/NumericKeypad';
import { applyStakeKey, type KeypadKey } from '../../engine/stakeInput';

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
  const marketBlocked =
    marketBlockReason(marketRules, target.marketKey, target.outcome.name) ??
    marketSlotCapReason(
      marketRules,
      target.marketKey,
      target.outcome.name,
      (otherSlots ?? []).flatMap((sl) => (sl.wager ? [{ marketKey: sl.wager.marketKey, side: sl.wager.side }] : [])),
    );
  const stakeCtx: StakeContext = {
    settings,
    isMLSlot: isML,
    marketMax: marketMaxStake(marketRules, target.marketKey, target.outcome.name),
    otherStakes: otherSlots ? otherSlots.reduce((sum, sl) => sum + (sl.wager?.stake ?? 0), 0) : settings.weeklyCredits - remainingBudget,
    emptyOtherSlots: otherSlots ? otherSlots.filter((sl) => !sl.wager).length : 0,
    replacing: !!slotsNow?.find((sl) => sl.slotId === target.slotId)?.wager,
  };

  // The field starts empty (placeholder only) so typing begins from the first digit; the number
  // everything else reads is derived from the text, so clearing the field really means $0.
  const [stakeText, setStakeText] = useState('');
  const stake = Number.isFinite(Number(stakeText)) ? Number(stakeText) : 0;
  const hasStake = stake > 0;
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
  // No stake typed yet is not an error, the button just waits.
  const stakeProblem = hasStake ? stakeError(stakeCtx, stake) : null;
  if (stakeProblem) reasons.push(stakeProblem);
  if (minOdds != null && target.outcome.price < minOdds) reasons.push(`Below minimum odds of ${minOdds}`);
  if (preClaimReason) reasons.push(preClaimReason);
  if (claimError) reasons.push(claimError);

  const valid = reasons.length === 0 && stake > 0;
  const potentialProfit = profitForStake(stake, target.outcome.price);

  function onKey(key: KeypadKey) {
    setStakeText((t) => applyStakeKey(t, key));
  }
  function quickAdd(amount: number) {
    const next = Math.round((stake + amount) * 100) / 100;
    setStakeText(Number.isInteger(next) ? String(next) : next.toFixed(2));
  }

  // The full pick, not just the name: "Over 31.5 Passing Attempts", "Tampa Bay Buccaneers -3.5 Spread".
  const isSpread = target.marketKey === 'spreads';
  const pointText =
    target.outcome.point == null ? '' : ` ${isSpread && target.outcome.point > 0 ? '+' : ''}${target.outcome.point}`;
  const pickLine = `${target.outcome.name}${pointText} · ${MARKET_LABELS[target.marketKey] ?? ''}`.replace(/ · $/, '');

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
        <BudgetBar attached allocated={stakeCtx.otherStakes} pending={hasStake ? stake : 0} total={settings.weeklyCredits} />
        <div className="p-4 space-y-3" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
          <div className="flex justify-between items-start gap-3">
            <div className="min-w-0">
              <p className="font-bold leading-tight">{target.label}</p>
              <p className="text-xs text-text-muted mt-0.5">{pickLine}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-sm font-bold">
                <OddsDisplay odds={target.outcome.price} />
              </span>
              <button onClick={onClose} aria-label="Close" className="text-text-muted -mr-1 p-1">
                <X size={20} />
              </button>
            </div>
          </div>

          <div className="flex items-stretch gap-2">
            {[1, 5, 10].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => quickAdd(n)}
                className={`px-3 rounded-lg text-sm ${SOFT_PROFIT_BTN}`}
              >
                +${n}
              </button>
            ))}
            <div
              aria-label="Stake"
              className="flex-1 min-w-0 flex items-center gap-1.5 bg-bg-card border border-border rounded-lg px-3 py-2"
            >
              <span className="text-text-muted">$</span>
              <span className={`w-full min-w-0 truncate text-lg font-semibold text-right tabular-nums ${hasStake || stakeText ? '' : 'text-text-muted/50'}`}>
                {stakeText || '0'}
              </span>
            </div>
          </div>

          <NumericKeypad onKey={onKey} onEnter={() => void confirm()} onEscape={onClose} />

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
            className={`w-full h-[54px] flex flex-col items-center justify-center rounded-xl leading-tight ${SOFT_PRIMARY_BTN}`}
          >
            <span className="block text-base">{submitting ? 'Adding…' : hasStake ? 'Add to Roster' : 'Enter Stake'}</span>
            <span className="block text-xs font-medium opacity-80 mt-0.5 tabular-nums">
              Potential Profit: {hasStake ? formatCents(potentialProfit) : '$–'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
