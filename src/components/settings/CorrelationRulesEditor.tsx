import { useEffect, useState } from 'react';
import type { CorrelationRule, CorrelationSide, MarketKey } from '../../types';
import { DEFAULT_CORRELATION_RULES, MARKET_ALLOWED_SIDES } from '../../types';
import { MARKET_LABELS } from '../../data/propsGenerator';

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
];
const SIDE_LABELS: Record<CorrelationSide, string> = {
  Over: 'Over',
  Under: 'Under',
  Yes: 'Yes (anytime TD)',
  FavoredTeam: 'Favored team (ML/spread)',
};

/** Commissioner-customizable correlated-picks blocklist editor (manual v0.1.1 §5 B) —
 * the rules themselves are a plain data table (CorrelationRule[] in types/index.ts),
 * so add/remove/reset here never touches engine code. Side options are filtered per
 * market via MARKET_ALLOWED_SIDES (manual v0.2.0 §3 #5) so e.g. "Yes" can never be
 * picked for a yardage market — every market here only ever settles the sides that
 * actually exist for it. */
export function CorrelationRulesEditor({ rules, onChange }: { rules: CorrelationRule[]; onChange: (rules: CorrelationRule[]) => void }) {
  const [marketA, setMarketA] = useState<MarketKey>('player_pass_yds');
  const [sideA, setSideA] = useState<CorrelationSide>('Over');
  const [marketB, setMarketB] = useState<MarketKey>('player_reception_yds');
  const [sideB, setSideB] = useState<CorrelationSide>('Over');
  const [scope, setScope] = useState<'same-team' | 'same-game'>('same-team');

  const sideOptionsA = MARKET_ALLOWED_SIDES[marketA];
  const sideOptionsB = MARKET_ALLOWED_SIDES[marketB];

  useEffect(() => {
    if (!sideOptionsA.includes(sideA)) setSideA(sideOptionsA[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketA]);
  useEffect(() => {
    if (!sideOptionsB.includes(sideB)) setSideB(sideOptionsB[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketB]);

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
    <div className="space-y-1.5">
      {rules.map((rule) => (
        <div key={rule.id} className="flex items-center justify-between gap-2 bg-bg-raised rounded-lg px-2.5 py-1.5">
          <span className="text-[11px] flex-1">{rule.label}</span>
          <button onClick={() => onChange(rules.filter((r) => r.id !== rule.id))} className="text-text-muted text-xs shrink-0">
            ✕
          </button>
        </div>
      ))}
      {rules.length === 0 && <p className="text-[11px] text-text-muted">No rules configured — add one below.</p>}
      <button onClick={() => onChange(DEFAULT_CORRELATION_RULES)} className="text-[11px] text-primary font-medium">
        Reset to default rules
      </button>

      <div className="bg-bg-raised rounded-lg p-2 space-y-1.5 mt-2">
        <p className="text-[11px] text-text-muted">Add a rule</p>
        <div className="grid grid-cols-2 gap-1.5">
          <select value={marketA} onChange={(e) => setMarketA(e.target.value as MarketKey)} className="bg-bg-card border border-border rounded px-1.5 py-1 text-[11px]">
            {MARKET_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {MARKET_LABELS[m]}
              </option>
            ))}
          </select>
          <select value={sideA} onChange={(e) => setSideA(e.target.value as CorrelationSide)} className="bg-bg-card border border-border rounded px-1.5 py-1 text-[11px]">
            {sideOptionsA.map((s) => (
              <option key={s} value={s}>
                {SIDE_LABELS[s]}
              </option>
            ))}
          </select>
          <select value={marketB} onChange={(e) => setMarketB(e.target.value as MarketKey)} className="bg-bg-card border border-border rounded px-1.5 py-1 text-[11px]">
            {MARKET_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {MARKET_LABELS[m]}
              </option>
            ))}
          </select>
          <select value={sideB} onChange={(e) => setSideB(e.target.value as CorrelationSide)} className="bg-bg-card border border-border rounded px-1.5 py-1 text-[11px]">
            {sideOptionsB.map((s) => (
              <option key={s} value={s}>
                {SIDE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2 items-center">
          <label className="text-[11px] text-text-muted shrink-0">Scope:</label>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as 'same-team' | 'same-game')}
            className="bg-bg-card border border-border rounded px-1.5 py-1 text-[11px] flex-1"
          >
            <option value="same-team">Same team</option>
            <option value="same-game">Same game (either team)</option>
          </select>
        </div>
        <button onClick={addRule} className="w-full bg-primary text-white text-xs font-semibold py-1.5 rounded-lg">
          Add Rule
        </button>
      </div>
    </div>
  );
}
