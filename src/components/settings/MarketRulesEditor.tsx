import { useState } from 'react';
import type { MarketKey, MarketRule } from '../../types';
import { MARKET_ALLOWED_SIDES } from '../../types';
import { MARKET_LABELS } from '../../data/propsGenerator';
import { MAX_MARKET_RULES, eligibleSlotCount, isBlockRule, isRuleMarketAllowed, marketHasSides, marketRuleLabel, maxSlotCapFor, slotCapLabel } from '../../engine/marketRules';
import { PillSelect } from '../common/PillSelect';
import { Toggle } from '../common/Toggle';
import { Stepper } from './SettingsPrimitives';

const MARKETS = (Object.keys(MARKET_LABELS) as MarketKey[])
  .filter(isRuleMarketAllowed)
  .map((m) => ({ value: m, label: MARKET_LABELS[m] }));

type SidePick = 'both' | 'Over' | 'Under';
type Action = 'block' | 'limit';

/** "Blocked", "Max $5.00", "2/5 slots", or the last two joined. A slot cap that is no tighter than the
 * market's eligible slots (the lineup changed since it was set) is flagged, since it limits nothing. */
function ruleSummary(rule: MarketRule, lineupSlots: Record<string, number>): string {
  if (isBlockRule(rule)) return 'Blocked';
  const parts: string[] = [];
  if (rule.maxStake != null) parts.push(`Max $${rule.maxStake.toFixed(2)}`);
  if (rule.maxSlots != null) {
    const eligible = eligibleSlotCount(rule.market, lineupSlots);
    parts.push(rule.maxSlots >= eligible ? `${slotCapLabel(rule.maxSlots, eligible)} (no effect)` : slotCapLabel(rule.maxSlots, eligible));
  }
  return parts.join(' · ');
}

/** Per-market rules: block a market (or one side of it) outright, or cap what one pick on it can
 * stake. Compact on purpose: each rule is one line, and the builder is two small rows. */
export function MarketRulesEditor({
  rules,
  onChange,
  minStake,
  maxStakeAllowed,
  lineupSlots,
}: {
  rules: MarketRule[];
  onChange: (rules: MarketRule[]) => void;
  /** The league's slot counts, which decide how many slots a market could ever fill. */
  lineupSlots: Record<string, number>;
  /** Smallest cap that still allows a legal pick (the league's minimum bet, rounded up to a dollar). */
  minStake: number;
  /** Largest cap that means anything (the single-pick limit). */
  maxStakeAllowed: number;
}) {
  const [market, setMarket] = useState<MarketKey>('player_anytime_td');
  const [side, setSide] = useState<SidePick>('both');
  const [action, setAction] = useState<Action>('block');
  const lo = Math.max(1, Math.ceil(minStake));
  const hi = Math.max(lo, Math.floor(maxStakeAllowed));
  const [cap, setCap] = useState(Math.min(hi, Math.max(lo, 5)));
  // A limit can cap the stake, the number of slots, or both (at least one).
  const [limitStake, setLimitStake] = useState(true);
  const [limitSlots, setLimitSlots] = useState(false);
  const [slotCapPick, setSlotCapPick] = useState<number | null>(null);

  const sided = marketHasSides(market);
  const atMax = rules.length >= MAX_MARKET_RULES;
  const pickedSide = sided && side !== 'both' ? side : null;
  const eligible = eligibleSlotCount(market, lineupSlots);
  const slotCapMax = maxSlotCapFor(eligible);
  // Only offered when there is more than one slot to share. Starts one below the total (a cap equal to it limits nothing).
  const slotsOffered = slotCapMax >= 1;
  const slotCap = Math.min(slotCapMax, Math.max(1, slotCapPick ?? slotCapMax));
  const useStake = action === 'limit' && limitStake;
  const useSlots = action === 'limit' && slotsOffered && limitSlots;
  const canAdd = action === 'block' || useStake || useSlots;
  const replacesExisting = rules.some((r) => r.market === market && r.side === pickedSide);

  function add() {
    const rule: MarketRule = {
      id: `mr-${Date.now()}`,
      market,
      side: sided && side !== 'both' ? side : null,
      maxStake: useStake ? cap : null,
      ...(useSlots ? { maxSlots: slotCap } : {}),
    };
    // One rule per market and side: adding again replaces the old one.
    if (!canAdd || (!replacesExisting && atMax)) return;
    onChange([...rules.filter((r) => !(r.market === rule.market && r.side === rule.side)), rule]);
  }

  return (
    <div className="space-y-1">
      {rules.map((rule) => (
        <div key={rule.id} className="flex items-center gap-2 bg-bg-raised rounded-lg px-2.5 py-1">
          <span className="text-[11px] flex-1 leading-snug">{marketRuleLabel(rule)}</span>
          {isRuleMarketAllowed(rule.market) ? (
            <span className={`text-[11px] font-semibold shrink-0 text-right ${isBlockRule(rule) ? 'text-loss' : 'text-text-muted'}`}>
              {ruleSummary(rule, lineupSlots)}
            </span>
          ) : (
            <span className="text-[11px] font-semibold shrink-0 text-warning">Not supported, remove</span>
          )}
          <button onClick={() => onChange(rules.filter((r) => r.id !== rule.id))} className="text-text-muted text-xs shrink-0" aria-label="Remove rule">
            ✕
          </button>
        </div>
      ))}
      {rules.length === 0 && <p className="text-[11px] text-text-muted">No markets blocked or limited yet.</p>}
      <p className="text-[10px] text-text-muted">
        {rules.length}/{MAX_MARKET_RULES} rules. Moneyline, spread and total can't be ruled on.
      </p>

      <div className="bg-bg-raised rounded-lg p-1.5 space-y-1 mt-1">
        <div className="flex gap-1">
          <PillSelect
            fill
            ariaLabel="Market"
            value={market}
            options={MARKETS}
            onChange={(m) => {
              setMarket(m);
              if (!(MARKET_ALLOWED_SIDES[m].includes('Over') && MARKET_ALLOWED_SIDES[m].includes('Under'))) setSide('both');
            }}
          />
          {sided && (
            <PillSelect
              fill
              ariaLabel="Side"
              value={side}
              options={[
                { value: 'both', label: 'Over and Under' },
                { value: 'Over', label: 'Over only' },
                { value: 'Under', label: 'Under only' },
              ]}
              onChange={setSide}
            />
          )}
        </div>
        <div className="flex gap-1">
          <PillSelect
            fill
            ariaLabel="Rule type"
            value={action}
            options={[
              { value: 'block', label: 'Block' },
              { value: 'limit', label: 'Limit' },
            ]}
            onChange={setAction}
          />
          <button
            onClick={add}
            disabled={!canAdd || (!replacesExisting && atMax)}
            className="flex-1 btn-soft-primary text-[11px] font-semibold py-1 rounded-lg disabled:opacity-40"
          >
            Add rule
          </button>
        </div>
        {action === 'limit' && (
          <div className="space-y-1">
            <div className="flex items-center justify-between px-1">
              <span className="text-[11px] font-medium">Limit stake per pick</span>
              <Toggle value={limitStake} onChange={setLimitStake} />
            </div>
            {limitStake && <Stepper label="Max per pick" value={cap} min={lo} max={hi} format={(v) => `$${v}`} onChange={setCap} />}
            {slotsOffered && (
              <>
                <div className="flex items-center justify-between px-1">
                  <span className="text-[11px] font-medium">Limit number of slots</span>
                  <Toggle value={limitSlots} onChange={setLimitSlots} />
                </div>
                {limitSlots && (
                  <Stepper label="Max slots" value={slotCap} min={1} max={slotCapMax} format={(v) => slotCapLabel(v, eligible)} onChange={setSlotCapPick} />
                )}
              </>
            )}
            {!canAdd && <p className="text-[10px] text-warning px-1">Turn on at least one limit.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
