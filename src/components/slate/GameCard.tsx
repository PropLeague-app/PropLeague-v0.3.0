import { useNavigate } from 'react-router-dom';
import { Triangle } from 'lucide-react';
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

  // Winner indicator (see chat, Sept 2026: "it can be tough to tell who is
  // winning at a glance" -- two plain white numbers stacked on top of each
  // other read as no comparison at all). Final-only, like the scores
  // themselves already were; a tie gets neither team marked rather than
  // guessing. White triangle + dimming the loser (not coloring the winner --
  // and specifically not gold, which reads too close to "you won the week"
  // from WeeklyResultPopup) per Hunter's follow-up, kept deliberately subtle
  // per his original "nothing too severe": no red/green here either, since
  // those already mean $ profit/loss elsewhere in this app.
  const scoresIn = game.status === 'final' && game.homeScore != null && game.awayScore != null;
  const isTie = scoresIn && game.homeScore === game.awayScore;
  const awayWon = scoresIn && !isTie && game.awayScore! > game.homeScore!;
  const homeWon = scoresIn && !isTie && game.homeScore! > game.awayScore!;

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
        {game.status === 'final' && (
          <span className="flex items-center gap-1">
            {awayWon && <Triangle size={7} className="fill-white text-white" />}
            <span className={`font-bold ${homeWon ? 'text-text-muted' : ''}`}>{game.awayScore}</span>
          </span>
        )}
      </div>
      <div className="flex justify-between items-center text-sm">
        <span className="flex items-center gap-1.5">
          <TeamMark team={home} size="sm" />
          {home.city} {home.name}
        </span>
        {game.status === 'final' && (
          <span className="flex items-center gap-1">
            {homeWon && <Triangle size={7} className="fill-white text-white" />}
            <span className={`font-bold ${awayWon ? 'text-text-muted' : ''}`}>{game.homeScore}</span>
          </span>
        )}
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