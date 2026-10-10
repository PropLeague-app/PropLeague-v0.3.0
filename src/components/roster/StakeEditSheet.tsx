import { useState } from 'react';
import { X } from 'lucide-react';
import type { LeagueSettings, Wager } from '../../types';
import { profitForStake, formatCents } from '../../engine/oddsMath';
import { stakeError, type StakeContext } from '../../engine/stakeRules';
import { applyStakeKey, type KeypadKey } from '../../engine/stakeInput';
import { MARKET_LABELS } from '../../data/propsGenerator';
import { BudgetBar } from '../common/BudgetBar';
import { NumericKeypad } from '../common/NumericKeypad';
import { OddsDisplay } from '../common/OddsDisplay';
import { SOFT_PRIMARY_BTN, SOFT_PROFIT_BTN } from '../common/buttonStyles';

/**
 * Edits the stake on a pick already in the lineup, with the same keypad and look as the bet slip.
 * It works on a draft: Done saves it, closing (X, tapping outside, Escape) throws it away. The
 * first key pressed replaces the current amount rather than appending to it.
 */
export function StakeEditSheet({
  wager,
  title,
  settings,
  stakeCtx,
  onClose,
  onDone,
}: {
  wager: Wager;
  title: string;
  settings: LeagueSettings;
  stakeCtx: StakeContext;
  onClose: () => void;
  onDone: (stake: number) => void | Promise<unknown>;
}) {
  const [text, setText] = useState(() => String(wager.stake));
  const [fresh, setFresh] = useState(true);
  const [saving, setSaving] = useState(false);

  const stake = Number.isFinite(Number(text)) ? Number(text) : 0;
  const hasStake = stake > 0;
  const problem = stakeError(stakeCtx, stake);
  // Don't scold before the first key press: the starting amount is the saved one.
  const showProblem = fresh ? null : problem;
  const valid = !problem;

  function onKey(key: KeypadKey) {
    setText((t) => applyStakeKey(fresh ? '' : t, key));
    setFresh(false);
  }
  function quickAdd(amount: number) {
    const next = Math.round((stake + amount) * 100) / 100;
    setText(Number.isInteger(next) ? String(next) : next.toFixed(2));
    setFresh(false);
  }
  async function done() {
    if (!valid || saving) return;
    if (Math.abs(stake - wager.stake) < 0.005) {
      onClose();
      return;
    }
    setSaving(true);
    await onDone(stake);
    setSaving(false);
    onClose();
  }

  const pointText = wager.point == null ? '' : ` ${wager.point > 0 && wager.marketKey === 'spreads' ? '+' : ''}${wager.point}`;
  const pickLine = `${wager.side}${pointText} · ${MARKET_LABELS[wager.marketKey] ?? ''}`.replace(/ · $/, '');

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md bg-bg-raised border-t border-border rounded-t-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <BudgetBar attached allocated={stakeCtx.otherStakes} pending={hasStake ? stake : 0} total={settings.weeklyCredits} />
        <div className="p-4 space-y-3" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
          <div className="flex justify-between items-start gap-3">
            <div className="min-w-0">
              <p className="font-bold leading-tight">{title}</p>
              <p className="text-xs text-text-muted mt-0.5">{pickLine}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-sm font-bold">
                <OddsDisplay odds={wager.oddsAtPlacement} />
              </span>
              <button onClick={onClose} aria-label="Close" className="text-text-muted -mr-1 p-1">
                <X size={20} />
              </button>
            </div>
          </div>

          <div className="flex items-stretch gap-2">
            {[1, 5, 10].map((n) => (
              <button key={n} type="button" onClick={() => quickAdd(n)} className={`px-3 rounded-lg text-sm ${SOFT_PROFIT_BTN}`}>
                +${n}
              </button>
            ))}
            <div aria-label="Stake" className="flex-1 min-w-0 flex items-center gap-1.5 bg-bg-card border border-border rounded-lg px-3 py-2">
              <span className="text-text-muted">$</span>
              <span className={`w-full min-w-0 truncate text-lg font-semibold text-right tabular-nums ${text ? '' : 'text-text-muted/50'}`}>
                {text || '0'}
              </span>
            </div>
          </div>

          {/* Above the keypad so the keys never move when the message comes and goes. */}
          {showProblem && <p className="text-loss text-xs">{showProblem}</p>}

          <NumericKeypad onKey={onKey} onEnter={() => void done()} onEscape={onClose} />

          <button
            disabled={!valid || saving}
            onClick={() => void done()}
            className={`w-full h-[54px] flex flex-col items-center justify-center rounded-xl leading-tight ${SOFT_PRIMARY_BTN}`}
          >
            <span className="block text-base">{saving ? 'Saving…' : 'Done'}</span>
            <span className="block text-xs font-medium opacity-80 mt-0.5 tabular-nums">
              Potential Profit: {hasStake ? formatCents(profitForStake(stake, wager.oddsAtPlacement)) : '$–'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
