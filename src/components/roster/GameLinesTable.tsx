import { useState } from 'react';
import type { NFLGame, OddsOutcome } from '../../types';
import { nflTeamById } from '../../data/nflTeams';
import { getGameMarkets, findTeamOutcome } from '../../services/oddsService';
import { OddsDisplay } from '../common/OddsDisplay';
import { TeamMark } from '../common/TeamMark';
import { ClaimBanner, type ClaimStatus } from './MarketRow';
import { HeldTag, heldBoxBorder, type HeldTagInfo } from './HeldTag';

function formatSpreadPoint(point: number | undefined): string {
  if (point == null) return '—';
  return point > 0 ? `+${point}` : `${point}`;
}

function LineCell({
  point,
  price,
  blocked,
  claim,
  held,
  onSelect,
}: {
  point: string;
  price: number | undefined;
  blocked?: string | null;
  /** Claim banner under the box (duplicate limit progress). */
  claim?: ClaimStatus | null;
  /** While swapping: marks the pick already held. */
  held?: HeldTagInfo | null;
  onSelect?: () => void;
}) {
  if (price == null) {
    return <div className="w-16 shrink-0 py-1.5 text-center text-text-muted text-xs">—</div>;
  }
  // Moneyline has no point value (no "number line" the way Spread/Total do), so
  // rather than reserve an empty line for it like before -- which left the odds
  // looking small and pushed toward the bottom -- it centers within the same
  // overall box height (min-h-11) and renders larger, since it's the only thing
  // in the box.
  const hasPoint = point !== '';
  return (
    <div className="w-16 shrink-0 flex flex-col">
      <button
        onClick={onSelect}
        disabled={!onSelect}
        className={`w-full min-h-11 flex flex-col items-center justify-center py-1.5 border ${claim || held ? 'rounded-t-lg' : 'rounded-lg'} ${
          blocked ? 'bg-loss/10 border-loss/40' : held ? `bg-bg-raised ${heldBoxBorder(held)}` : 'bg-bg-raised border-border'
        } disabled:opacity-60`}
      >
        {hasPoint && <span className={`text-xs font-semibold ${blocked ? 'line-through text-loss' : ''}`}>{point}</span>}
        <OddsDisplay
          odds={price}
          className={`${hasPoint ? 'text-[11px]' : 'text-xs font-medium'} ${blocked ? 'text-loss' : 'text-primary'}`}
        />
      </button>
      {claim && <ClaimBanner status={claim} wide={false} attachedBelow={!!held} />}
      {held && <HeldTag info={held} />}
    </div>
  );
}

/** Shared Spread/Total/Moneyline table for a single game -- used by both the ML
 * Pick screen and Game Detail's Game Markets section, matching DraftKings' own
 * table layout (team column on the left, one aligned column per market on the
 * right) rather than the two separately-labeled, stacked market rows this
 * replaced. showTotal is off by default since Totals aren't a real pickable
 * position in this app (see MarketBrowser.tsx) -- Game Detail turns it on to
 * keep showing it as the informational total it's always been there.
 *
 * The team column is flex-1 (takes whatever width the three fixed, narrow
 * odds columns don't need) specifically so the full team name has room --
 * Moneyline cells don't repeat "ML" inside the box since the header above
 * already says "Moneyline". */
export function GameLinesTable({
  game,
  onSelectSpread,
  onSelectMoneyline,
  showTotal = false,
  checkBlocked,
  checkClaimStatus,
  heldFor,
}: {
  game: NFLGame;
  onSelectSpread?: (outcome: OddsOutcome) => void;
  onSelectMoneyline?: (outcome: OddsOutcome) => void;
  showTotal?: boolean;
  checkBlocked?: (marketKey: 'spreads' | 'h2h', outcome: OddsOutcome) => string | null;
  checkClaimStatus?: (marketKey: 'spreads' | 'h2h', outcome: OddsOutcome) => ClaimStatus | null;
  /** While swapping: the "Yours" tag for the held pick's box. */
  heldFor?: (marketKey: 'spreads' | 'h2h', outcome: OddsOutcome) => HeldTagInfo | null;
}) {
  const [tappedReason, setTappedReason] = useState<string | null>(null);
  const { h2h, spreads, totals } = getGameMarkets(game);
  const home = nflTeamById(game.homeTeamId);
  const away = nflTeamById(game.awayTeamId);

  const awaySpread = findTeamOutcome(spreads?.outcomes, away);
  const homeSpread = findTeamOutcome(spreads?.outcomes, home);
  const awayMl = findTeamOutcome(h2h?.outcomes, away);
  const homeMl = findTeamOutcome(h2h?.outcomes, home);
  const overTotal = totals?.outcomes.find((o) => o.name === 'Over');
  const underTotal = totals?.outcomes.find((o) => o.name === 'Under');

  function select(marketKey: 'spreads' | 'h2h', outcome: OddsOutcome | undefined, handler?: (o: OddsOutcome) => void) {
    if (!outcome || !handler) return;
    const reason = checkBlocked?.(marketKey, outcome) ?? null;
    if (reason) {
      setTappedReason(reason);
      return;
    }
    setTappedReason(null);
    handler(outcome);
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="flex-1" />
        <span className="w-16 shrink-0 text-center text-[10px] text-text-muted">Spread</span>
        {showTotal && <span className="w-16 shrink-0 text-center text-[10px] text-text-muted">Total</span>}
        <span className="w-16 shrink-0 text-center text-[10px] text-text-muted">Moneyline</span>
      </div>

      <div className="space-y-1">
        <div className="flex items-start gap-2">
          <div className="flex-1 flex items-center gap-1.5 min-w-0 self-center">
            <TeamMark team={away} size="sm" />
            <span className="text-xs font-medium leading-tight">
              {away.city} {away.name}
            </span>
          </div>
          <LineCell
            point={formatSpreadPoint(awaySpread?.point)}
            price={awaySpread?.price}
            blocked={awaySpread ? checkBlocked?.('spreads', awaySpread) : null}
            claim={awaySpread ? (checkClaimStatus?.('spreads', awaySpread) ?? null) : null}
            held={awaySpread ? (heldFor?.('spreads', awaySpread) ?? null) : null}
            onSelect={() => select('spreads', awaySpread, onSelectSpread)}
          />
          {showTotal && <LineCell point={overTotal?.point != null ? `O ${overTotal.point}` : ''} price={overTotal?.price} />}
          <LineCell
            point=""
            price={awayMl?.price}
            blocked={awayMl ? checkBlocked?.('h2h', awayMl) : null}
            claim={awayMl ? (checkClaimStatus?.('h2h', awayMl) ?? null) : null}
            held={awayMl ? (heldFor?.('h2h', awayMl) ?? null) : null}
            onSelect={() => select('h2h', awayMl, onSelectMoneyline)}
          />
        </div>

        <div className="flex items-start gap-2">
          <div className="flex-1 flex items-center gap-1.5 min-w-0 self-center">
            <TeamMark team={home} size="sm" />
            <span className="text-xs font-medium leading-tight">
              {home.city} {home.name}
            </span>
          </div>
          <LineCell
            point={formatSpreadPoint(homeSpread?.point)}
            price={homeSpread?.price}
            blocked={homeSpread ? checkBlocked?.('spreads', homeSpread) : null}
            claim={homeSpread ? (checkClaimStatus?.('spreads', homeSpread) ?? null) : null}
            held={homeSpread ? (heldFor?.('spreads', homeSpread) ?? null) : null}
            onSelect={() => select('spreads', homeSpread, onSelectSpread)}
          />
          {showTotal && <LineCell point={underTotal?.point != null ? `U ${underTotal.point}` : ''} price={underTotal?.price} />}
          <LineCell
            point=""
            price={homeMl?.price}
            blocked={homeMl ? checkBlocked?.('h2h', homeMl) : null}
            claim={homeMl ? (checkClaimStatus?.('h2h', homeMl) ?? null) : null}
            held={homeMl ? (heldFor?.('h2h', homeMl) ?? null) : null}
            onSelect={() => select('h2h', homeMl, onSelectMoneyline)}
          />
        </div>
      </div>

      {tappedReason && <p className="text-[10px] text-loss text-right mt-1">{tappedReason}</p>}
    </div>
  );
}