import { useState } from 'react';
import { ArrowDown, ArrowLeftRight, Plus, X } from 'lucide-react';
import type { LeagueSettings, MarketKey, OddsOutcome, PrizePool, SlotPosition, Wager, WeekId } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { profitForStake, formatCents } from '../../engine/oddsMath';
import { realDollarAmount } from '../../engine/prizePool';
import { findClaimingTeam, claimBlockReason } from '../../engine/duplicatePicks';
import { rosterKey } from '../../engine/rosterSlots';
import { maxStakeRounded, stakeError, type StakeContext } from '../../engine/stakeRules';
import { activeMarketRules, marketBlockReason, marketMaxStake, marketSlotCapReason } from '../../engine/marketRules';
import { OddsDisplay } from '../common/OddsDisplay';
import { PositionBadge } from '../common/PositionBadge';
import { MARKET_LABELS } from '../../data/propsGenerator';
import { BudgetBar } from '../common/BudgetBar';
import { SOFT_PRIMARY_BTN, SOFT_PROFIT_BTN } from '../common/buttonStyles';
import { NumericKeypad } from '../common/NumericKeypad';
import { applyStakeKey, applyStakeKeyToPrefill, type KeypadKey } from '../../engine/stakeInput';
import { compareOdds, swapChoices, swapKind } from '../../engine/pickSwap';
import { pickMarket, pickTitle } from './pickText';
import { haptic } from '../../services/haptics';

/** "G. Smith" for a player prop, "Buccaneers" for a team pick: the short name on a slot choice. */
function heldName(w: Wager): string {
  if (w.playerName) {
    const parts = w.playerName.trim().split(/\s+/);
    return parts.length < 2 ? w.playerName : `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
  }
  return w.side.trim().split(/\s+/).pop() ?? w.side;
}

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
  /** Offer the other slots of this position on the slip (replace a held pick, or use an open slot).
   * Set when swapping from a filled slot (⇄) and from Game Details; a plain add from an empty slot
   * keeps the slip simple. */
  offerSwap?: boolean;
  /** Opened from Game Details: say plainly when the pick replaces one you hold, since nothing
   * before the slip hinted at a swap (from ⇄ on the Lineup screen it is already obvious). */
  announceReplace?: boolean;
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

  const slotsNow = league?.rostersByTeamWeek[rosterKey(target.teamId, target.week)]?.slots;

  // Swapping (engine/pickSwap.ts): which slot this pick goes in. The slip can offer every slot of
  // this position whose pick can still be swapped plus the first empty one. If one of them already
  // holds this same pick, it is the only target (the pick is re-locked there at the new line/odds).
  const realGamesById = useAppStore((s) => s.realGamesById);
  const wagerLocked = (w: Wager) => {
    const g = realGamesById[w.gameId];
    return !!g && (g.status !== 'upcoming' || new Date(g.kickoff).getTime() <= Date.now());
  };
  const candidate = {
    gameId: target.gameId,
    marketKey: target.marketKey,
    playerId: target.playerId,
    side: target.outcome.name,
    point: target.outcome.point,
    price: target.outcome.price,
  };
  const choices = slotsNow
    ? swapChoices(slotsNow, target.slotPosition, candidate, wagerLocked)
    : { openSlotId: null, filledSlotIds: [] as string[], samePickSlotId: null };
  const [slotId, setSlotId] = useState(choices.samePickSlotId ?? target.slotId);
  const heldIn = (id: string): Wager | null => slotsNow?.find((sl) => sl.slotId === id)?.wager ?? null;
  const held = heldIn(slotId);
  const kind = swapKind(held, candidate);
  const replacing = !!held;
  // The slip's slot choice: the slot it opened on first, then the rest (filled in lineup order, the
  // open slot last). Hidden when there is only one place it can go.
  const slotOptions =
    target.offerSwap && !choices.samePickSlotId
      ? [target.slotId, ...choices.filledSlotIds, ...(choices.openSlotId ? [choices.openSlotId] : [])].filter((id, i, all) => all.indexOf(id) === i)
      : [];
  const showSlotChoice = slotOptions.length > 1;

  // Where this roster stands, not counting the slot being filled. A new pick must leave the minimum
  // bet for every other empty slot (so a full legal roster stays reachable); swapping or editing a
  // pick that is already in the slot skips that reserve. The server enforces the same rules.
  const otherSlots = slotsNow?.filter((sl) => sl.slotId !== slotId);
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
    replacing: !!slotsNow?.find((sl) => sl.slotId === slotId)?.wager,
  };

  // The field starts empty (placeholder only) so typing begins from the first digit; the number
  // everything else reads is derived from the text, so clearing the field really means $0.
  // When replacing, the old stake is carried over so one tap swaps. It shows as selected: the first
  // key starts a new amount instead of editing it (applyStakeKeyToPrefill).
  const stakeTextOf = (w: Wager | null) => (w ? (Number.isInteger(w.stake) ? String(w.stake) : w.stake.toFixed(2)) : '');
  const [stakeText, setStakeText] = useState(stakeTextOf(held));
  const [prefilled, setPrefilled] = useState(!!held);
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
  if (replacing && kind === 'same') reasons.push('This is your current pick at the same odds. Change its stake on the Lineup screen.');

  const valid = reasons.length === 0 && stake > 0;
  const potentialProfit = profitForStake(stake, target.outcome.price);

  // Largest stake the league's rules allow for this slot right now (slot max, market cap, single-pick
  // cap, credits left, and the minimum held back for other empty slots), rounded down to the cent.
  // The chip is hidden when no legal stake exists or the field already holds it.
  const maxStake = maxStakeRounded(stakeCtx);
  const showMax = !marketBlocked && maxStake >= settings.minBetPerSlot - 0.005 && Math.abs(stake - maxStake) > 0.004;

  function setMax() {
    haptic.tap();
    setPrefilled(false);
    setStakeText(Number.isInteger(maxStake) ? String(maxStake) : maxStake.toFixed(2));
  }
  function onKey(key: KeypadKey) {
    if (prefilled) {
      setPrefilled(false);
      setStakeText(applyStakeKeyToPrefill(key));
      return;
    }
    setStakeText((t) => applyStakeKey(t, key));
  }
  function chooseSlot(next: string) {
    if (next === slotId) return;
    haptic.tap();
    setSlotId(next);
    setClaimError(null);
    // A carried-over stake belongs to the pick being replaced, so it follows the choice until the
    // person types their own amount.
    if (prefilled || stakeText === '') {
      const w = heldIn(next);
      setStakeText(stakeTextOf(w));
      setPrefilled(!!w);
    }
  }
  function quickAdd(amount: number) {
    haptic.tap();
    setPrefilled(false);
    const next = Math.round((stake + amount) * 100) / 100;
    setStakeText(Number.isInteger(next) ? String(next) : next.toFixed(2));
  }

  // The full pick, not just the name: "Over 31.5 Passing Attempts", "Tampa Bay Buccaneers -3.5 Spread".
  const isSpread = target.marketKey === 'spreads';
  const pointText =
    target.outcome.point == null ? '' : ` ${isSpread && target.outcome.point > 0 ? '+' : ''}${target.outcome.point}`;
  const pickLine = `${target.outcome.name}${pointText} · ${MARKET_LABELS[target.marketKey] ?? ''}`.replace(/ · $/, '');

  const heldPoint = held?.point == null ? '' : ` ${held.marketKey === 'spreads' && held.point > 0 ? '+' : ''}${held.point}`;
  const heldMarket = held ? pickMarket(held) : '';
  const heldSide = held ? (held.marketKey === 'h2h' || held.marketKey === 'spreads' ? '' : held.side) : '';
  const oddsVsHeld = held && replacing && kind === 'odds' ? compareOdds(target.outcome.price, held.oddsAtPlacement) : 0;

  async function confirm() {
    if (!valid) return;
    setSubmitting(true);
    const result = await placeWager({
      leagueId: target.leagueId,
      teamId: target.teamId,
      week: target.week,
      slotId,
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
      haptic.error();
      setClaimError(
        result.claimedByTeamId && league
          ? claimBlockReason(league, result.claimedByTeamId, league.settings.hidePicks)
          : (result.error ?? 'This pick is no longer available.'),
      );
      return;
    }
    haptic.success();
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
          {/* Where this pick goes (Game Details, or ⇄ on a filled slot): ⇄ a held pick to replace it, or +
              an open slot to add it alongside. Starts on the slot the slip opened for. */}
          {showSlotChoice && (
            <div
              role="radiogroup"
              aria-label="Where this pick goes"
              className="grid gap-1 rounded-lg bg-bg-card border border-border p-0.5"
              style={{ gridTemplateColumns: `repeat(${slotOptions.length}, minmax(0, 1fr))` }}
            >
              {slotOptions.map((id) => {
                const w = heldIn(id);
                const selected = id === slotId;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={w ? `Replace ${heldName(w)}` : `Use the open ${target.slotPosition} slot`}
                    onClick={() => chooseSlot(id)}
                    className={`min-w-0 flex items-center justify-center gap-1 rounded-md py-1.5 px-1.5 text-xs font-semibold ${selected ? 'bg-primary/15 text-primary' : 'text-text-muted'}`}
                  >
                    {w ? <ArrowLeftRight size={12} className="shrink-0" aria-hidden /> : <Plus size={12} className="shrink-0" aria-hidden />}
                    <span className="truncate">{w ? heldName(w) : `Open ${target.slotPosition} slot`}</span>
                  </button>
                );
              })}
            </div>
          )}

          {target.announceReplace && replacing && held && kind !== 'same' && (
            <p className="flex items-center gap-1.5 text-[11px] text-text-muted -mb-1.5">
              <PositionBadge position={target.slotPosition} />
              {kind === 'different'
                ? `Replacing your ${target.slotPosition} pick`
                : `Re-locking your ${target.slotPosition} pick ${kind === 'odds' ? 'at new odds' : 'at a new line'}`}
            </p>
          )}

          {/* What is being replaced, above the new pick. A different pick is struck through end to end
              (one line across the whole pick, odds and stake); the same pick at a new line strikes only
              the line and odds. The same pick at new odds has no strip: just the old odds struck beside
              the new ones. */}
          {replacing && held && (kind === 'different' || kind === 'line') && (
            <div className="-mb-1.5">
              <div className="flex items-center gap-2 rounded-lg border border-border bg-bg-card px-2.5 py-1.5 text-xs text-text-muted">
                <ArrowLeftRight size={13} className="shrink-0" aria-hidden />
                {kind === 'different' ? (
                  <div className="relative min-w-0 flex-1 flex items-center gap-2" aria-label={`Replacing ${pickTitle(held)}`}>
                    <p className="min-w-0 flex-1 truncate">
                      {pickTitle(held)}
                      {heldMarket ? ` · ${heldMarket}` : ''}
                    </p>
                    <span className="shrink-0 tabular-nums">
                      <OddsDisplay odds={held.oddsAtPlacement} /> · {formatCents(held.stake)}
                    </span>
                    <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-px bg-current" />
                  </div>
                ) : (
                  <>
                    <p className="min-w-0 flex-1 truncate">
                      Your line: {heldSide}
                      <span className="line-through">{heldPoint}</span>
                      {heldMarket ? ` · ${heldMarket}` : ''}
                    </p>
                    <span className="shrink-0 line-through tabular-nums">
                      <OddsDisplay odds={held.oddsAtPlacement} />
                    </span>
                  </>
                )}
              </div>
              <div className="flex justify-center text-text-muted pt-0.5" aria-hidden>
                <ArrowDown size={12} />
              </div>
            </div>
          )}

          <div className="flex justify-between items-start gap-3">
            <div className="min-w-0">
              <p className="font-bold leading-tight">{target.label}</p>
              <p className="text-xs text-text-muted mt-0.5">{pickLine}</p>
              {oddsVsHeld !== 0 && held && (
                <p className={`text-[11px] font-medium mt-0.5 ${oddsVsHeld > 0 ? 'text-profit' : 'text-loss'}`}>
                  {oddsVsHeld > 0 ? 'Better' : 'Worse'} than your <OddsDisplay odds={held.oddsAtPlacement} />
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {replacing && held && kind === 'odds' && (
                <span className="text-xs text-text-muted line-through" aria-label="Your current odds">
                  <OddsDisplay odds={held.oddsAtPlacement} />
                </span>
              )}
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
              {showMax && (
                <button
                  type="button"
                  onClick={setMax}
                  aria-label={`Set stake to the maximum, ${formatCents(maxStake)}`}
                  className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted active:bg-bg-raised"
                >
                  Max
                </button>
              )}
              <span className={`w-full min-w-0 truncate text-lg font-semibold text-right tabular-nums ${hasStake || stakeText ? '' : 'text-text-muted/50'}`}>
                {/* A carried-over stake looks selected: typing starts a new amount. */}
                <span className={prefilled && stakeText ? 'rounded bg-primary/20 px-1' : ''}>{stakeText || '0'}</span>
              </span>
            </div>
          </div>

          {settings.buyInEnabled && settings.showRealDollarStakes && pool && teamCount && (
            <div className="flex justify-between text-xs text-text-muted px-1">
              <span>Real $ at stake{multiplier !== 1 ? ` (${multiplier.toFixed(2)}x)` : ''}</span>
              <span>{formatCents(realDollarAmount(stake, settings.weeklyCredits, pool.current, teamCount) * multiplier)}</span>
            </div>
          )}

          {/* Above the keypad on purpose: a line that comes and goes below it would slide the keys
              under the finger mid-tap (delete, then the 9 lands). */}
          {reasons.length > 0 && <p className="text-loss text-xs">{reasons[0]}</p>}

          <NumericKeypad onKey={onKey} onEnter={() => void confirm()} onEscape={onClose} />

          <button
            disabled={!valid || submitting}
            onClick={confirm}
            className={`w-full h-[54px] flex flex-col items-center justify-center rounded-xl leading-tight ${SOFT_PRIMARY_BTN}`}
          >
            <span className="block text-base">
              {submitting ? (replacing ? 'Replacing…' : 'Adding…') : !hasStake ? 'Enter Stake' : replacing ? 'Replace Pick' : 'Add to Roster'}
            </span>
            <span className="block text-xs font-medium opacity-80 mt-0.5 tabular-nums">
              Potential Profit: {hasStake ? formatCents(potentialProfit) : '$–'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
