import { useState } from 'react';
import type { MarketKey, MarketRule } from '../../types';
import { MARKET_ALLOWED_SIDES } from '../../types';
import { MARKET_LABELS } from '../../data/propsGenerator';
import { MAX_MARKET_RULES, isRuleMarketAllowed, marketHasSides, marketRuleLabel } from '../../engine/marketRules';
import { PillSelect } from '../common/PillSelect';
import { Stepper } from './SettingsPrimitives';

const MARKETS = (Object.keys(MARKET_LABELS) as MarketKey[])
  .filter(isRuleMarketAllowed)
  .map((m) => ({ value: m, label: MARKET_LABELS[m] }));

type SidePick = 'both' | 'Over' | 'Under';
type Action = 'block' | 'limit';

/** Per-market rules: block a market (or one side of it) outright, or cap what one pick on it can
 * stake. Compact on purpose: each rule is one line, and the builder is two small rows. */
export function MarketRulesEditor({
  rules,
  onChange,
  minStake,
  maxStakeAllowed,
}: {
  rules: MarketRule[];
  onChange: (rules: MarketRule[]) => void;
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

  const sided = marketHasSides(market);
  const atMax = rules.length >= MAX_MARKET_RULES;
  const pickedSide = sided && side !== 'both' ? side : null;
  const replacesExisting = rules.some((r) => r.market === market && r.side === pickedSide);

  function add() {
    const rule: MarketRule = {
      id: `mr-${Date.now()}`,
      market,
      side: sided && side !== 'both' ? side : null,
      maxStake: action === 'block' ? null : cap,
    };
    // One rule per market and side: adding again replaces the old one.
    if (!replacesExisting && atMax) return;
    onChange([...rules.filter((r) => !(r.market === rule.market && r.side === rule.side)), rule]);
  }

  return (
    <div className="space-y-1">
      {rules.map((rule) => (
        <div key={rule.id} className="flex items-center gap-2 bg-bg-raised rounded-lg px-2.5 py-1">
          <span className="text-[11px] flex-1 leading-snug">{marketRuleLabel(rule)}</span>
          {isRuleMarketAllowed(rule.market) ? (
            <span className={`text-[11px] font-semibold shrink-0 ${rule.maxStake == null ? 'text-loss' : 'text-text-muted'}`}>
              {rule.maxStake == null ? 'Blocked' : `Max $${rule.maxStake.toFixed(2)}`}
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
              { value: 'limit', label: 'Limit stake' },
            ]}
            onChange={setAction}
          />
          <button
            onClick={add}
            disabled={!replacesExisting && atMax}
            className="flex-1 bg-primary text-white text-[11px] font-semibold py-1 rounded-lg disabled:opacity-40"
          >
            Add rule
          </button>
        </div>
        {action === 'limit' && <Stepper label="Max per pick" value={cap} min={lo} max={hi} format={(v) => `$${v}`} onChange={setCap} />}
      </div>
    </div>
  );
}
