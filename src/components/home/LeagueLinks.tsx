import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Medal, Trophy, UserX, Users } from 'lucide-react';
import type { League } from '../../types';
import { useUIStore } from '../../store/useUIStore';
import { VoidRequestsSheet } from './VoidRequestsSheet';

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
  const userTeam = league.teams.find((t) => t.isUser);
  const isCommissioner = !!userTeam && userTeam.id === league.commissionerTeamId;
  const seasonStarted = Object.keys(league.matchupsByWeek).length > 0;
  const pendingVoids = useUIStore((s) => s.pendingVoidRequests);
  const [voidsOpen, setVoidsOpen] = useState(false);

  // Only the screens no card above already leads to. Full Standings is reached from the standings
  // preview's own link, Matchups from the matchup card's, and Prize Pool from its ticker, which is
  // only ever on screen when that entry would have been. A second way to the same place, sitting
  // right under the first, is noise (see chat, Oct 2026).
  const links: { key: string; label: string; icon: ReactNode; onClick: () => void; badge?: number }[] = [
    { key: 'members', label: 'League Members', icon: <Users size={18} />, onClick: () => navigate('/members') },
    { key: 'leaderboards', label: 'Leaderboards', icon: <Medal size={18} />, onClick: () => navigate('/leaderboards') },
    // The bracket is the exception: during the playoffs the matchup card's link reads "See all
    // matchups", which does not say that the bracket is what it opens.
    ...(playoffs ? [{ key: 'bracket', label: 'Bracket', icon: <Trophy size={18} />, onClick: () => navigate('/matchups') }] : []),
    // Void Requests lived only in Settings and was hard to find (backlog B3, Oct 2026). Opens the same
    // card in a sheet. Same gate as Settings: nothing to void before the season has matchups.
    ...(seasonStarted && userTeam
      ? [{ key: 'voids', label: 'Void Requests', icon: <UserX size={18} />, onClick: () => setVoidsOpen(true), badge: isCommissioner ? pendingVoids : 0 }]
      : []),
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {links.map((link, i) => (
          <button
            key={link.key}
            onClick={link.onClick}
            className={`bg-bg-card border border-border rounded-xl px-3 py-2.5 flex items-center gap-2 text-sm text-left transition-colors active:bg-bg-raised ${
              // A tile left alone on the last row takes the full width rather than half of it.
              i === links.length - 1 && links.length % 2 === 1 ? 'col-span-2' : ''
            }`}
          >
            <span className="shrink-0 text-text-muted">{link.icon}</span>
            <span className="min-w-0 truncate">{link.label}</span>
            {!!link.badge && (
              <span className="ml-auto shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-loss text-white text-[10px] font-bold leading-none flex items-center justify-center">
                {link.badge}
              </span>
            )}
          </button>
        ))}
      </div>
      {voidsOpen && userTeam && (
        <VoidRequestsSheet leagueId={league.id} week={league.currentWeek} isCommissioner={isCommissioner} onClose={() => setVoidsOpen(false)} />
      )}
    </>
  );
}
