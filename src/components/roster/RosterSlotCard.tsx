import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LeagueSettings, NFLGame, PrizePool, RosterSlotState, SlotValidation, WeekId } from '../../types';
import { nflTeamById } from '../../data/nflTeams';
import { Card } from '../common/Card';
import { PositionBadge, positionBorderClass } from '../common/PositionBadge';
import { OddsDisplay } from '../common/OddsDisplay';
import { StatusPill } from '../common/StatusPill';
import { MARKET_LABELS } from '../../data/propsGenerator';
import { profitForStake, formatCents } from '../../engine/oddsMath';
import { realDollarAmount } from '../../engine/prizePool';
import { currentOddsForWager } from '../../services/oddsService';
import { NumberInput } from '../common/NumberInput';

function gameInfo(game: NFLGame): string {
  const home = nflTeamById(game.homeTeamId).abbrev;
  const away = nflTeamById(game.awayTeamId).abbrev;
  const day = new Date(game.kickoff).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  return `${away} @ ${home} · ${day}`;
}

export function RosterSlotCard({
  slot,
  game,
  validation,
  locked,
  settings,
  pool,
  teamCount,
  multiplier = 1,
  currentWeek,
  onStakeChange,
  onRemove,
}: {
  slot: RosterSlotState;
  game: NFLGame | undefined;
  validation: SlotValidation | undefined;
  locked: boolean;
  settings?: LeagueSettings;
  pool?: PrizePool | null;
  teamCount?: number;
  /** manual v0.3.0 §8: this team's current prize-pool impact multiplier, applied to
   * the "real $" preview shown under each staked slot. */
  multiplier?: number;
  currentWeek?: WeekId;
  onStakeChange: (stake: number) => void;
  onRemove: () => void;
}) {
  const navigate = useNavigate();
  const invalid = validation && !validation.valid && !locked;
  // manual v0.2.0 §3 #6: reasons stay hidden behind the "!" badge until tapped, rather
  // than always rendered inline — keeps a lineup with several flagged slots scannable.
  const [reasonsOpen, setReasonsOpen] = useState(false);

  if (!slot.wager) {
    return (
      <Card
        onClick={() => navigate(`/lineup/market/${slot.slotId}`)}
        className={`border-l-4 border-dashed ${positionBorderClass(slot.position)} flex items-center justify-between`}
      >
        <div className="flex items-center gap-3">
          <PositionBadge position={slot.position} />
          <span className="text-text-muted text-sm">Add your {slot.position} prop</span>
        </div>
        <span className="text-primary text-xl">+</span>
      </Card>
    );
  }

  const wager = slot.wager;
  const potentialProfit = profitForStake(wager.stake, wager.oddsAtPlacement);
  const marketLabel = MARKET_LABELS[wager.marketKey];

  const showMovement = !locked && settings?.lineMovementEnabled && currentWeek != null && wager.status === 'pending';
  const liveOdds = showMovement
    ? currentOddsForWager(wager.gameId, currentWeek, wager.marketKey, wager.playerId, wager.side, wager.point)
    : null;
  const movement = liveOdds != null && liveOdds !== wager.oddsAtPlacement ? (liveOdds > wager.oddsAtPlacement ? 'up' : 'down') : null;

  return (
    <Card className={`border-l-4 ${invalid ? 'border-l-loss' : positionBorderClass(slot.position)} ${invalid ? 'ring-1 ring-loss' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <PositionBadge position={slot.position} />
          {invalid && validation!.reasons.length > 0 && (
            <button
              onClick={() => setReasonsOpen((v) => !v)}
              title="Tap for details"
              className="w-4 h-4 shrink-0 rounded-full bg-loss text-white text-[10px] font-bold flex items-center justify-center leading-none mt-0.5"
            >
              !
            </button>
          )}
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">
              {wager.playerName ?? marketLabel} {wager.point != null ? `${wager.side} ${wager.point}` : wager.side}
            </p>
            <p className="text-xs text-text-muted truncate">{marketLabel}</p>
            {game && <p className="text-xs text-text-muted truncate">{gameInfo(game)}</p>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {locked ? (
            <span title="Locked" className="text-text-muted">🔒</span>
          ) : (
            <button onClick={onRemove} className="text-text-muted text-xs">✕</button>
          )}
          <div className="flex items-center gap-1">
            <OddsDisplay odds={wager.oddsAtPlacement} className="text-sm font-semibold" />
            {movement && (
              <span
                title={`Line moved from ${wager.oddsAtPlacement} to ${liveOdds} since you placed this`}
                className={`text-xs ${movement === 'up' ? 'text-profit' : 'text-loss'}`}
              >
                {movement === 'up' ? '↑' : '↓'}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
        <div className="flex items-center gap-1">
          <span className="text-text-muted text-xs">$</span>
          <NumberInput
            min={0}
            decimals={2}
            disabled={locked}
            value={wager.stake}
            onChange={onStakeChange}
            className="w-16 bg-bg-raised rounded px-1.5 py-1 text-sm disabled:opacity-60"
          />
        </div>
        <div className="text-right">
          <p className="text-[11px] text-text-muted">To win</p>
          <p className="text-sm font-semibold text-profit">{formatCents(potentialProfit)}</p>
          {settings?.buyInEnabled && settings.showRealDollarStakes && pool && teamCount && (
            <p className="text-[10px] text-text-muted">
              {formatCents(realDollarAmount(wager.stake, settings.weeklyCredits, pool.current, teamCount) * multiplier)} real
              {multiplier !== 1 ? ` (${multiplier.toFixed(2)}x)` : ''}
            </p>
          )}
        </div>
        {wager.status !== 'pending' ? (
          <StatusPill status={wager.status === 'won' || wager.status === 'lost' || wager.status === 'push' || wager.status === 'voided' ? wager.status : 'pending'} />
        ) : (
          <StatusPill status={locked ? 'live' : 'pending'} />
        )}
      </div>

      {invalid && reasonsOpen && validation!.reasons.length > 0 && (
        <p className="text-loss text-xs mt-1.5">{validation!.reasons.join(' · ')}</p>
      )}
    </Card>
  );
}
