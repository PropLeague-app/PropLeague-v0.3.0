import { useState } from 'react';
import type { CorrelationRule, CorrelationSide, MarketKey } from '../../types';
import { DEFAULT_CORRELATION_RULES, MARKET_ALLOWED_SIDES } from '../../types';
import { MARKET_LABELS } from '../../data/propsGenerator';
import { PillSelect } from '../common/PillSelect';

const MARKET_OPTIONS: MarketKey[] = [
  'h2h',
  'spreads',
  'player_pass_yds',
  'player_pass_tds',
  'player_pass_interceptions',
  'player_rush_yds',
  'player_rush_attempts',
  'player_anytime_td',
  'player_reception_yds',
  'player_receptions',
  'player_kicking_points',
  'player_field_goals',
  'player_pass_attempts',
  'player_pass_completions',
  'player_rush_longest',
  'player_reception_longest',
  'player_pats',
];
const SIDE_LABELS: Record<CorrelationSide, string> = {
  Over: 'Over',
  Under: 'Under',
  Yes: 'Yes',
  FavoredTeam: 'Favored team',
};
const marketOptions = MARKET_OPTIONS.map((m) => ({ value: m, label: MARKET_LABELS[m] }));
const sideOptionsFor = (m: MarketKey) => MARKET_ALLOWED_SIDES[m].map((s) => ({ value: s, label: SIDE_LABELS[s] }));

/** Commissioner-customizable correlated-picks blocklist editor. The rules are a plain data table
 * (CorrelationRule[] in types/index.ts), so add/remove/reset never touches engine code. Side options are
 * filtered per market via MARKET_ALLOWED_SIDES so "Yes" can never be picked for a yardage market. The
 * builder uses compact pill selects (the app forces native selects to 16px, which made a plain one huge). */
export function CorrelationRulesEditor({ rules, onChange }: { rules: CorrelationRule[]; onChange: (rules: CorrelationRule[]) => void }) {
  const [marketA, setMarketA] = useState<MarketKey>('player_pass_yds');
  const [sideA, setSideA] = useState<CorrelationSide>('Over');
  const [marketB, setMarketB] = useState<MarketKey>('player_reception_yds');
  const [sideB, setSideB] = useState<CorrelationSide>('Over');
  const [scope, setScope] = useState<'same-team' | 'same-game'>('same-team');

  function pickMarket(market: MarketKey, setMarket: (m: MarketKey) => void, side: CorrelationSide, setSide: (s: CorrelationSide) => void) {
    setMarket(market);
    if (!MARKET_ALLOWED_SIDES[market].includes(side)) setSide(MARKET_ALLOWED_SIDES[market][0]);
  }

  function addRule() {
    const rule: CorrelationRule = {
      id: `custom-${Date.now()}`,
      label: `${MARKET_LABELS[marketA]} ${sideA} + ${MARKET_LABELS[marketB]} ${sideB} (${scope === 'same-team' ? 'same team' : 'same game'})`,
      marketA,
      sideA,
      marketB,
      sideB,
      scope,
    };
    onChange([...rules, rule]);
  }

  return (
    <div className="space-y-1">
      {rules.map((rule) => (
        <div key={rule.id} className="flex items-center justify-between gap-2 bg-bg-raised rounded-lg px-2.5 py-1">
          <span className="text-[11px] flex-1 leading-snug">{rule.label}</span>
          <button onClick={() => onChange(rules.filter((r) => r.id !== rule.id))} className="text-text-muted text-xs shrink-0" aria-label="Remove rule">
            ✕
          </button>
        </div>
      ))}
      {rules.length === 0 && <p className="text-[11px] text-text-muted">No rules yet. Add one below.</p>}
      <button onClick={() => onChange(DEFAULT_CORRELATION_RULES)} className="text-[11px] text-primary font-medium">
        Reset to default rules
      </button>

      <div className="bg-bg-raised rounded-lg p-1.5 space-y-1 mt-1">
        <div className="flex gap-1">
          <PillSelect fill ariaLabel="First market" value={marketA} options={marketOptions} onChange={(m) => pickMarket(m, setMarketA, sideA, setSideA)} />
          <PillSelect fill ariaLabel="First side" value={sideA} options={sideOptionsFor(marketA)} onChange={setSideA} />
        </div>
        <div className="flex gap-1">
          <PillSelect fill ariaLabel="Second market" value={marketB} options={marketOptions} onChange={(m) => pickMarket(m, setMarketB, sideB, setSideB)} />
          <PillSelect fill ariaLabel="Second side" value={sideB} options={sideOptionsFor(marketB)} onChange={setSideB} />
        </div>
        <div className="flex gap-1">
          <PillSelect
            fill
            ariaLabel="Scope"
            value={scope}
            options={[
              { value: 'same-team', label: 'Same team' },
              { value: 'same-game', label: 'Same game' },
            ]}
            onChange={setScope}
          />
          <button onClick={addRule} className="flex-1 btn-soft-primary text-[11px] font-semibold py-1 rounded-lg">
            Add rule
          </button>
        </div>
      </div>
    </div>
  );
}
