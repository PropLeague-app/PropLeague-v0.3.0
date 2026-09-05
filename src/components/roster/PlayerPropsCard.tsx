import type { OddsMarket, OddsOutcome, LeagueTeam, PlayerPropGroup } from '../../types';
import { nflTeamById } from '../../data/nflTeams';
import { MARKET_LABELS } from '../../data/propsGenerator';
import { TeamMark } from '../common/TeamMark';
import { MarketRow } from './MarketRow';

function isOverUnderMarket(market: OddsMarket): boolean {
  return market.outcomes.length === 2 && market.outcomes.some((o) => o.name === 'Over');
}

/** One player's props as a visually distinct sub-card -- name/team/injury shown
 * once here rather than repeated on every one of that player's market rows
 * (the redundancy the previous layout had), with a real card boundary (not just
 * spacing) between one player and the next so scanning a game with several
 * players stays easy to follow at a glance.
 *
 * Over/Under markets (the vast majority of props) get a single shared "Over"/
 * "Under" column header instead of repeating those words inside every box --
 * frees up real width for the label column, which is the actual fix for prop
 * names getting cut off. Single-outcome markets (Anytime TD) don't fit that
 * header shape at all, so they're sorted after the Over/Under group and keep
 * their own outcome name ("Yes") inside the box. */
export function PlayerPropsCard({
  group,
  altLinesEnabled,
  onSelect,
  checkBlocked,
  checkClaimStatus,
}: {
  group: PlayerPropGroup;
  altLinesEnabled?: boolean;
  onSelect: (market: OddsMarket, outcome: OddsOutcome) => void;
  checkBlocked?: (market: OddsMarket, outcome: OddsOutcome) => string | null;
  checkClaimStatus?: (market: OddsMarket, outcome: OddsOutcome) => { holderTeams: LeagueTeam[]; cap: number } | null;
}) {
  const team = nflTeamById(group.teamId);
  const overUnderMarkets = group.markets.filter(isOverUnderMarket);
  const otherMarkets = group.markets.filter((m) => !isOverUnderMarket(m));

  function row(market: OddsMarket, idx: number, hideOutcomeNames: boolean) {
    return (
      <MarketRow
        key={`${market.key}-${idx}`}
        label={MARKET_LABELS[market.key]}
        market={market}
        altLinesEnabled={altLinesEnabled}
        hideOutcomeNames={hideOutcomeNames}
        checkBlocked={checkBlocked ? (outcome) => checkBlocked(market, outcome) : undefined}
        checkClaimStatus={checkClaimStatus ? (outcome) => checkClaimStatus(market, outcome) : undefined}
        onSelect={(outcome) => onSelect(market, outcome)}
      />
    );
  }

  return (
    <div className="bg-bg-raised border border-border rounded-lg px-3 py-2">
      <div className="flex items-center gap-1.5 mb-0.5">
        <TeamMark team={team} size="xs" />
        <p className="text-sm font-semibold">{group.playerName}</p>
        {group.injury && (
          <span className="text-[10px] font-bold text-loss border border-loss rounded px-1">{group.injury}</span>
        )}
      </div>
      {overUnderMarkets.length > 0 && (
        <div className="flex items-center">
          <span className="w-28 shrink-0" />
          <div className="flex-1 flex items-center justify-end gap-1.5">
            <span className="w-16 shrink-0 text-center text-[10px] text-text-muted">Over</span>
            <span className="w-16 shrink-0 text-center text-[10px] text-text-muted">Under</span>
          </div>
        </div>
      )}
      {overUnderMarkets.map((market, idx) => row(market, idx, true))}
      {otherMarkets.map((market, idx) => row(market, idx, false))}
    </div>
  );
}