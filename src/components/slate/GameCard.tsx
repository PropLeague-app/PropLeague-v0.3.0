import { useNavigate } from 'react-router-dom';
import type { NFLGame } from '../../types';
import { nflTeamById } from '../../data/nflTeams';
import { getGameMarkets, findTeamOutcome } from '../../services/oddsService';
import { Card } from '../common/Card';
import { OddsDisplay } from '../common/OddsDisplay';
import { StatusPill } from '../common/StatusPill';
import { TeamMark } from '../common/TeamMark';

function formatSpread(point: number | undefined): string {
  if (point == null) return '—';
  return point > 0 ? `+${point}` : `${point}`;
}

export function GameCard({ game }: { game: NFLGame }) {
  const navigate = useNavigate();
  const home = nflTeamById(game.homeTeamId);
  const away = nflTeamById(game.awayTeamId);
  const { h2h, spreads, totals } = getGameMarkets(game);
  // findTeamOutcome (not a raw .find on the abbreviation) is what actually fixes
  // the "Spread always shows --" bug: real data names outcomes with the full team
  // name ("Seattle Seahawks"), not the abbreviation, so a plain name === abbrev
  // check never matched a single real game. Same fix applies to the ML price,
  // which previously just grabbed outcomes[0] regardless of which team that
  // happened to be -- mislabeled as home.abbrev even when it was the away team's
  // price.
  const homeSpread = findTeamOutcome(spreads?.outcomes, home);
  const homeMl = findTeamOutcome(h2h?.outcomes, home);
  const kickoffTime = new Date(game.kickoff).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  return (
    <Card onClick={() => navigate(`/slate/game/${game.id}`)} className="space-y-2">
      <div className="flex justify-between items-center">
        <span className="text-[11px] text-text-muted">{kickoffTime}</span>
        <StatusPill status={game.status} />
      </div>
      <div className="flex justify-between items-center text-sm">
        <span className="flex items-center gap-1.5">
          <TeamMark team={away} size="sm" />
          {away.city} {away.name}
        </span>
        {game.status === 'final' ? <span className="font-bold">{game.awayScore}</span> : null}
      </div>
      <div className="flex justify-between items-center text-sm">
        <span className="flex items-center gap-1.5">
          <TeamMark team={home} size="sm" />
          {home.city} {home.name}
        </span>
        {game.status === 'final' ? <span className="font-bold">{game.homeScore}</span> : null}
      </div>
      <div className="flex justify-between text-[11px] text-text-muted pt-1.5 border-t border-border">
        <span>
          <span className="text-text-muted/70">Spread</span> {home.abbrev} {formatSpread(homeSpread?.point)}
        </span>
        <span>
          <span className="text-text-muted/70">O/U</span> {totals?.outcomes[0]?.point ?? '—'}
        </span>
        <span className="flex gap-1">
          <span className="text-text-muted/70">ML</span> {home.abbrev} {homeMl && <OddsDisplay odds={homeMl.price} />}
        </span>
      </div>
    </Card>
  );
}