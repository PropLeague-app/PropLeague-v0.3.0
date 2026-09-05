import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import type { LeagueSettings, NFLGame, PrizePool, RosterSlotState, SlotValidation, WeekId, Wager } from '../../types';
import { nflTeamById } from '../../data/nflTeams';
import { PositionBadge, positionFillClasses } from '../common/PositionBadge';
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

function formatSignedPoint(point: number): string {
  return point > 0 ? `+${point}` : `${point}`;
}

/** "Matthew Stafford" -> "M. Stafford" -- applied to every player-prop title,
 * not just when a name would otherwise overflow, for a consistent look across
 * every card rather than some names abbreviated and others not. */
function abbreviatePlayerName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

/** For an ML/Spread wager, `wager.side` is the team's name as it was stored at
 * placement -- full name for real data ("Green Bay Packers"), abbreviation for
 * simulated data ("GB") -- so this checks both conventions against the actual
 * game's two teams, the same way findTeamOutcome does for market outcomes, to
 * resolve back to just the nickname ("Packers") for a concise title line. */
function mlTeamNickname(wager: Wager, game: NFLGame | undefined): string | null {
  if (!game) return null;
  const home = nflTeamById(game.homeTeamId);
  const away = nflTeamById(game.awayTeamId);
  if (wager.side === `${home.city} ${home.name}` || wager.side === home.abbrev) return home.name;
  if (wager.side === `${away.city} ${away.name}` || wager.side === away.abbrev) return away.name;
  return null;
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
  const fill = positionFillClasses(slot.position);

  if (!slot.wager) {
    return (
      <div
        onClick={() => navigate(`/lineup/market/${slot.slotId}`)}
        className={`rounded-xl p-2.5 border ${fill.borderSubtle} ${fill.bgSubtle} flex items-center justify-between cursor-pointer active:opacity-80`}
      >
        <div className="flex items-center gap-2">
          <PositionBadge position={slot.position} />
          <span className="text-text-muted text-sm">Add your {slot.position} prop</span>
        </div>
        <span className="text-primary text-xl">+</span>
      </div>
    );
  }

  const wager = slot.wager;
  const potentialProfit = profitForStake(wager.stake, wager.oddsAtPlacement);
  const marketLabel = MARKET_LABELS[wager.marketKey];
  const nickname = wager.marketKey === 'h2h' || wager.marketKey === 'spreads' ? mlTeamNickname(wager, game) : null;
  const displayName = wager.playerName ? abbreviatePlayerName(wager.playerName) : null;

  // "Packers +1.5" for a Spread pick, just "Packers" for a Moneyline pick (no
  // point value to show); "M. Stafford Over 1.5" for a player prop.
  const titleLine = nickname
    ? `${nickname}${wager.point != null ? ` ${formatSignedPoint(wager.point)}` : ''}`
    : `${displayName ?? marketLabel} ${wager.point != null ? `${wager.side} ${wager.point}` : wager.side}`;

  const showMovement = !locked && settings?.lineMovementEnabled && currentWeek != null && wager.status === 'pending';
  const liveOdds = showMovement
    ? currentOddsForWager(wager.gameId, currentWeek, wager.marketKey, wager.playerId, wager.side, wager.point)
    : null;
  const movement = liveOdds != null && liveOdds !== wager.oddsAtPlacement ? (liveOdds > wager.oddsAtPlacement ? 'up' : 'down') : null;

  return (
    <div
      className={`rounded-xl p-2.5 border-2 ${
        invalid ? 'border-loss bg-loss/5' : `${fill.borderLit} ${fill.bgLit}`
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <PositionBadge position={slot.position} />
          {invalid && validation!.reasons.length > 0 && (
            <button
              onClick={() => setReasonsOpen((v) => !v)}
              title="Tap for details"
              className="w-4 h-4 shrink-0 rounded-full bg-loss text-white text-[10px] font-bold flex items-center justify-center leading-none"
            >
              !
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {wager.status !== 'pending' ? (
            <StatusPill status={wager.status === 'won' || wager.status === 'lost' || wager.status === 'push' || wager.status === 'voided' ? wager.status : 'pending'} />
          ) : (
            <StatusPill status={locked ? 'live' : 'pending'} />
          )}
          {locked ? (
            <span title="Locked" className="text-text-muted"><Lock size={14} /></span>
          ) : (
            <button onClick={onRemove} className="text-text-muted text-xs">✕</button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-sm font-semibold leading-tight">{titleLine}</p>
        <div className="flex items-center gap-1 shrink-0">
          <OddsDisplay odds={wager.oddsAtPlacement} className="text-xs text-text-muted" />
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

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-text-muted leading-tight min-w-0">{marketLabel}</p>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-text-muted text-xs">$</span>
          <NumberInput
            min={0}
            decimals={2}
            disabled={locked}
            value={wager.stake}
            onChange={onStakeChange}
            className="w-[68px] bg-bg-raised rounded px-1.5 py-1 text-xs disabled:opacity-60"
          />
          <span className="text-text-muted text-xs">→</span>
          <span className="w-14 shrink-0 text-right text-sm font-semibold text-profit">{formatCents(potentialProfit)}</span>
        </div>
      </div>

      {game && <p className="text-xs text-text-muted leading-tight">{gameInfo(game)}</p>}

      {settings?.buyInEnabled && settings.showRealDollarStakes && pool && teamCount && (
        <p className="text-[10px] text-text-muted text-right leading-tight mt-0.5">
          {formatCents(realDollarAmount(wager.stake, settings.weeklyCredits, pool.current, teamCount) * multiplier)} real
          {multiplier !== 1 ? ` (${multiplier.toFixed(2)}x)` : ''}
        </p>
      )}

      {invalid && reasonsOpen && validation!.reasons.length > 0 && (
        <p className="text-loss text-xs mt-1.5">{validation!.reasons.join(' · ')}</p>
      )}
    </div>
  );
}