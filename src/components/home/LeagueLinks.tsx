import { useNavigate } from 'react-router-dom';
import { Medal, Trophy, Users } from 'lucide-react';
import type { League } from '../../types';

/** Every league-wide screen, reachable from the league's own tab.
 *
 * These used to live in a list on the Profile tab, which meant three of them -- Members,
 * Leaderboards and the Schedule -- could only be reached by tapping a gear, and the rest were a
 * second route to somewhere Home already linked (see chat, Oct 2026). They belong to the league, so
 * they sit on the league's screen.
 *
 * Some of these are reachable from the cards above as well: Full Standings from the standings
 * preview, Matchups from the matchup card, Prize Pool from its ticker. That repetition is the
 * point. The cards are for the person already reading them; this is for the person who came looking
 * for a particular screen and should not have to know which card hides it. */
export function LeagueLinks({ league }: { league: League }) {
  const navigate = useNavigate();
  const playoffs = league.seasonPhase === 'playoffs';

  // Only the screens no card above already leads to. Full Standings is reached from the standings
  // preview's own link, Matchups from the matchup card's, and Prize Pool from its ticker, which is
  // only ever on screen when that entry would have been. A second way to the same place, sitting
  // right under the first, is noise (see chat, Oct 2026).
  const links = [
    { to: '/members', label: 'League Members', icon: <Users size={18} /> },
    { to: '/leaderboards', label: 'Leaderboards', icon: <Medal size={18} /> },
    // The bracket is the exception: during the playoffs the matchup card's link reads "See all
    // matchups", which does not say that the bracket is what it opens.
    ...(playoffs ? [{ to: '/matchups', label: 'Bracket', icon: <Trophy size={18} /> }] : []),
  ];

  return (
    <div className="grid grid-cols-2 gap-2">
      {links.map((link) => (
        <button
          key={link.label}
          onClick={() => navigate(link.to)}
          className="bg-bg-card border border-border rounded-xl px-3 py-2.5 flex items-center gap-2 text-sm text-left transition-colors active:bg-bg-raised"
        >
          <span className="shrink-0 text-text-muted">{link.icon}</span>
          <span className="min-w-0 truncate">{link.label}</span>
        </button>
      ))}
    </div>
  );
}
