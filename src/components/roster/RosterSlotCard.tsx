import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftRight, Lock } from 'lucide-react';
import type { LeagueSettings, NFLGame, PrizePool, RosterSlotState, SlotValidation, WeekId, Wager } from '../../types';
import { nflTeamById } from '../../data/nflTeams';
import { PositionBadge, positionFillClasses } from '../common/PositionBadge';
import { OddsDisplay } from '../common/OddsDisplay';
import { StatusPill } from '../common/StatusPill';
import { MARKET_LABELS, MARKET_SHORT_LABELS } from '../../data/propsGenerator';
import { profitForStake, formatCents } from '../../engine/oddsMath';
import { realDollarAmount } from '../../engine/prizePool';
import { currentOddsForWager } from '../../services/oddsService';

/** "CLE@NYJ Sun 1:02p".
 *
 * Deliberately tighter than it reads: the roomier "CLE @ NYJ · Sun 1:02 PM" shares row 2 with the
 * market label and the money, and at that width the kickoff was the part that got truncated away on
 * almost every card (see chat, Oct 2026) -- which is the one thing on the line a person setting a
 * lineup actually needs. Dropping the spaces around @, the middle dot and the M off AM/PM buys back
 * roughly the 35px that was costing. */
function gameInfo(game: NFLGame): string {
  const home = nflTeamById(game.homeTeamId).abbrev;
  const away = nflTeamById(game.awayTeamId).abbrev;
  const at = new Date(game.kickoff);
  const day = at.toLocaleString(undefined, { weekday: 'short' });
  const time = at
    .toLocaleString(undefined, { hour: 'numeric', minute: '2-digit' })
    .replace(/\s*AM$/i, 'a')
    .replace(/\s*PM$/i, 'p');
  return `${away}@${home} ${day} ${time}`;
}

/** What the money column reads once a pick is decided.
 *
 * It used to always show profitForStake(stake, odds) in profit green, with no branch on status at
 * all -- so a LOST pick sat there reading "$10.00 -> $10.10" in green, and a VOIDED one "-> $9.09",
 * as if those were earnings (see chat, Oct 2026: Geno Smith and TreVeyon Henderson on the Week 5
 * lineup). The matchup screen has always shown the real settled_profit here via WagerProfitPill;
 * this screen simply never got the same treatment.
 *
 * Settled picks now read their actual outcome in their own status color -- "-$15.00" red for a
 * loss, "$0.00" for a push or a void -- and only a pick that could still go either way keeps the
 * forward-looking "what this pays" number. */
function payoutDisplay(wager: Wager, potentialProfit: number): { text: string; className: string } {
  switch (wager.status) {
    case 'won':
      return { text: `+${formatCents(wager.settledProfit ?? potentialProfit)}`, className: 'text-profit' };
    case 'lost':
      return { text: formatCents(wager.settledProfit ?? -wager.stake), className: 'text-loss' };
    case 'push':
      return { text: formatCents(wager.settledProfit ?? 0), className: 'text-primary' };
    case 'voided':
      return { text: formatCents(wager.settledProfit ?? 0), className: 'text-accent' };
    default:
      // Still pending or live: nothing has been decided, so this stays the potential payout.
      return { text: formatCents(potentialProfit), className: 'text-profit' };
  }
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
  stakeError = null,
  onEditStake,
  editingStake = false,
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
  /** Why the server refused the last stake edit, if it did. */
  stakeError?: string | null;
  /** Opens the stake keypad for this slot. */
  onEditStake: () => void;
  /** This slot's keypad is open right now. */
  editingStake?: boolean;
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
        className={`rounded-xl p-2 border ${fill.borderSubtle} ${fill.bgSubtle} flex items-center justify-between cursor-pointer active:opacity-80`}
      >
        <div className="flex items-center gap-2">
          <PositionBadge position={slot.position} />
          <span className="text-text-muted text-[13px]">
            {/* The ML slot actually covers both moneyline AND spread bets --
                "Add your ML prop" read as if spread wasn't allowed there
                (see chat, Sept 2026). */}
            {slot.position === 'ML' ? 'Add your ML/Spread' : `Add your ${slot.position} prop`}
          </span>
        </div>
        <span className="text-primary text-lg leading-none">+</span>
      </div>
    );
  }

  const wager = slot.wager;
  const potentialProfit = profitForStake(wager.stake, wager.oddsAtPlacement);
  const marketLabel = MARKET_LABELS[wager.marketKey];
  const nickname = wager.marketKey === 'h2h' || wager.marketKey === 'spreads' ? mlTeamNickname(wager, game) : null;
  const displayName = wager.playerName ? abbreviatePlayerName(wager.playerName) : null;

  // "Packers +1.5" for a Spread pick, just "Packers" for a Moneyline pick (no
  // point value to show); "M. Stafford Over 1.5 pass yds" for a player prop.
  //
  // The units used to live on their own muted row below as the full MARKET_LABELS text ("Passing
  // Yards"). On the two-line card that row also carries the kickoff and the money, and three things
  // did not fit: whichever one was allowed to truncate looked broken (see chat, Oct 2026). Folding
  // the short label into the title removes the redundancy instead of shuffling it -- "Over 31.5" and
  // "Pass Attempts" were always two halves of one phrase -- and matches wagerCompactLabel, which is
  // how the matchup screen, weekly moments, bet history and the activity feed already read a pick.
  const shortLabel = MARKET_SHORT_LABELS[wager.marketKey];
  const titleLine = nickname
    ? `${nickname}${wager.point != null ? ` ${formatSignedPoint(wager.point)}` : ''}${wager.marketKey === 'h2h' ? ' ML' : ''}`
    : wager.marketKey === 'player_anytime_td'
      ? `${displayName ?? marketLabel} anytime TD`
      : `${displayName ?? marketLabel} ${wager.point != null ? `${wager.side} ${wager.point}` : wager.side}${shortLabel ? ` ${shortLabel}` : ''}`;

  const showMovement = !locked && settings?.lineMovementEnabled && currentWeek != null && wager.status === 'pending';
  const liveOdds = showMovement
    ? currentOddsForWager(wager.gameId, currentWeek, wager.marketKey, wager.playerId, wager.side, wager.point)
    : null;
  const movement = liveOdds != null && liveOdds !== wager.oddsAtPlacement ? (liveOdds > wager.oddsAtPlacement ? 'up' : 'down') : null;

  const payout = payoutDisplay(wager, potentialProfit);
  // "Pending" is the resting state of every pick on this screen before kickoff, so a column of nine
  // identical Pending pills said nothing while costing the width that the swap and remove controls
  // now need (see chat, Oct 2026). An unlocked pending pick is shown by its controls instead; the
  // pill comes back the moment it means something -- Live once the game starts, or the verdict.
  const statusPill =
    wager.status !== 'pending' ? (
      <StatusPill status={wager.status} />
    ) : locked ? (
      <StatusPill status="live" />
    ) : null;

  // Two lines, not five. The old card gave a whole row to the position badge and the status pill
  // with nothing but empty space between them, which is where most of its height went: nine slots
  // could not fit on one screen (see chat, Oct 2026, against ESPN's roster screen). The badge is
  // now a fixed left rail -- the same column on every card, so the eye tracks straight down it --
  // and the two text rows sit beside it: what the pick is, then what it costs and what it pays.
  return (
    <div
      className={`rounded-xl p-2 border ${
        invalid ? 'border-loss bg-loss/5' : `${fill.borderLit} ${fill.bgLit}`
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="shrink-0 flex items-center gap-1 pt-px">
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

        <div className="min-w-0 flex-1">
          {/* Row 1: the pick and its price, then its state and its controls. */}
          <div className="flex items-center gap-1.5">
            <p className="min-w-0 truncate text-[13px] font-semibold leading-tight">{titleLine}</p>
            <div className="flex items-center gap-0.5 shrink-0">
              <OddsDisplay odds={wager.oddsAtPlacement} className="text-[11px] text-text-muted" />
              {movement && (
                <span
                  title={`Line moved from ${wager.oddsAtPlacement} to ${liveOdds} since you placed this`}
                  className={`text-[11px] ${movement === 'up' ? 'text-profit' : 'text-loss'}`}
                >
                  {movement === 'up' ? '↑' : '↓'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0 ml-auto">
              {statusPill}
              {locked ? (
                <span title="Locked" className="text-text-muted"><Lock size={13} /></span>
              ) : (
                <>
                  {/* ⇄ swap: browse this slot's markets without losing the pick. It is only replaced once a
                      new pick is confirmed on the bet slip (see engine/pickSwap.ts). */}
                  {wager.status === 'pending' && (
                    <button
                      onClick={() => navigate(`/lineup/market/${slot.slotId}`)}
                      aria-label="Swap pick"
                      title="Swap pick"
                      className="text-text-muted p-0.5"
                    >
                      <ArrowLeftRight size={13} />
                    </button>
                  )}
                  <button onClick={onRemove} aria-label="Remove pick" className="text-text-muted text-[11px] p-0.5 leading-none">✕</button>
                </>
              )}
            </div>
          </div>

          {/* Row 2: which game, then the money. With the units folded into the title above, the
              kickoff gets this row to itself and never has to truncate. */}
          <div className="flex items-center gap-1.5 mt-1">
            {game && <p className="text-[11px] text-text-muted leading-tight truncate min-w-0">{gameInfo(game)}</p>}
            <div className="flex items-center gap-1 shrink-0 ml-auto">
              {/* Same look as the stake box on the bet slip: bordered card-colored box, $ prefix, right-aligned semibold number.
                  Tapping it opens the in-app keypad (StakeEditSheet), never the OS keyboard. */}
              <button
                type="button"
                disabled={locked}
                onClick={onEditStake}
                aria-label="Edit stake"
                className={`flex items-center gap-0.5 bg-bg-card border rounded-md px-1 py-0.5 disabled:opacity-60 ${
                  editingStake ? 'border-primary' : 'border-border'
                }`}
              >
                <span className="text-text-muted text-[11px] leading-4">$</span>
                <span className="block w-[38px] h-4 text-[12px] leading-4 font-semibold text-right tabular-nums">{wager.stake.toFixed(2)}</span>
              </button>
              <span className="text-text-muted text-[11px]">→</span>
              <span className={`w-[52px] shrink-0 text-right text-[12px] leading-4 font-semibold tabular-nums ${payout.className}`}>
                {payout.text}
              </span>
            </div>
          </div>

          {settings?.buyInEnabled && settings.showRealDollarStakes && pool && teamCount && (
            <p className="text-[10px] text-text-muted text-right leading-tight mt-0.5">
              {formatCents(realDollarAmount(wager.stake, settings.weeklyCredits, pool.current, teamCount) * multiplier)} real
              {multiplier !== 1 ? ` (${multiplier.toFixed(2)}x)` : ''}
            </p>
          )}

          {stakeError && <p className="text-loss text-[11px] mt-1">{stakeError}</p>}

          {invalid && reasonsOpen && validation!.reasons.length > 0 && (
            <p className="text-loss text-[11px] mt-1">{validation!.reasons.join(' · ')}</p>
          )}
        </div>
      </div>
    </div>
  );
}