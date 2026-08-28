import { useNavigate } from 'react-router-dom';
import type { NFLGame } from '../../types';
import { nflTeamById } from '../../data/nflTeams';
import { getGameMarkets } from '../../services/oddsService';
import { Card } from '../common/Card';
import { OddsDisplay } from '../common/OddsDisplay';
import { StatusPill } from '../common/StatusPill';

export function GameCard({ game }: { game: NFLGame }) {
  const navigate = useNavigate();
  const home = nflTeamById(game.homeTeamId);
  const away = nflTeamById(game.awayTeamId);
  const { h2h, spreads, totals } = getGameMarkets(game);
  const homeSpread = spreads?.outcomes.find((o) => o.name === home.abbrev);
  const kickoffTime = new Date(game.kickoff).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  return (
    <Card onClick={() => navigate(`/slate/game/${game.id}`)} className="space-y-2">
      <div className="flex justify-between items-center">
        <span className="text-[11px] text-text-muted">{kickoffTime}</span>
        <StatusPill status={game.status} />
      </div>
      <div className="flex justify-between text-sm">
        <span>{away.city} {away.name}</span>
        {game.status === 'final' ? <span className="font-bold">{game.awayScore}</span> : null}
      </div>
      <div className="flex justify-between text-sm">
        <span>{home.city} {home.name}</span>
        {game.status === 'final' ? <span className="font-bold">{game.homeScore}</span> : null}
      </div>
      <div className="flex justify-between text-[11px] text-text-muted pt-1.5 border-t border-border">
        <span>
          <span className="text-text-muted/70">Spread</span> {home.abbrev}{' '}
          {homeSpread?.point != null ? (homeSpread.point > 0 ? `+${homeSpread.point}` : homeSpread.point) : '—'}
        </span>
        <span>
          <span className="text-text-muted/70">O/U</span> {totals?.outcomes[0]?.point ?? '—'}
        </span>
        <span className="flex gap-1">
          <span className="text-text-muted/70">ML</span> {home.abbrev} {h2h && <OddsDisplay odds={h2h.outcomes[0].price} />}
        </span>
      </div>
    </Card>
  );
}
