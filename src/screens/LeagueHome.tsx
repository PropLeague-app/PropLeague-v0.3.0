import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trophy, ChevronDown, Hourglass, Rocket, RefreshCw } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { weekLabel } from '../types';
import { MatchupCard } from '../components/home/MatchupCard';
import { StandingsPreview } from '../components/home/StandingsPreview';
import { ActivityFeed } from '../components/home/ActivityFeed';
import { CountdownTimer } from '../components/common/CountdownTimer';
import { EmptyState } from '../components/common/EmptyState';
import { PrizePoolTicker } from '../components/home/PrizePoolTicker';
import { LeagueLogo } from '../components/common/LeagueLogo';
import { LeagueSwitcherSheet } from '../components/home/LeagueSwitcherSheet';

export function LeagueHome() {
  const navigate = useNavigate();
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));
  const allLeagues = useAppStore((s) => s.leagues);
  const setCurrentLeague = useAppStore((s) => s.setCurrentLeague);
  const postAnnouncement = useAppStore((s) => s.postAnnouncement);
  const deleteAnnouncement = useAppStore((s) => s.deleteAnnouncement);
  const reactToActivity = useAppStore((s) => s.reactToActivity);
  const postChatMessage = useAppStore((s) => s.postChatMessage);
  const deleteChatMessage = useAppStore((s) => s.deleteChatMessage);
  const lastSeenChatByLeague = useAppStore((s) => s.lastSeenChatByLeague);
  const markChatSeen = useAppStore((s) => s.markChatSeen);
  const loadLeagueResults = useAppStore((s) => s.loadLeagueResults);
  const loadWeekRosters = useAppStore((s) => s.loadWeekRosters);
  const loadRealGamesForWeek = useAppStore((s) => s.loadRealGamesForWeek);
  const realGamesForWeek = useAppStore((s) => (league ? s.realGamesByWeek[String(league.currentWeek)] : undefined));
  const [showAll, setShowAll] = useState(false);
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [announceText, setAnnounceText] = useState('');
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Pulls the real, shared matchup/standings results — matters most for anyone who
  // isn't the commissioner, since they never ran Advance Week themselves.
  useEffect(() => {
    if (currentLeagueId) loadLeagueResults(currentLeagueId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLeagueId]);

  // MatchupCard needs each team's roster to compute a live in-progress score (see
  // chat: MatchupDetail.tsx had the same gap) -- without this, whichever matchups
  // are shown here fall back to a flat $0 live score for any team whose roster this
  // account hasn't already loaded some other way this session.
  useEffect(() => {
    if (currentLeagueId && league) loadWeekRosters(currentLeagueId, league.currentWeek);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLeagueId, league?.currentWeek]);

  // The home slate/kickoff countdown was reading ONLY the simulated dataset --
  // unlike MarketBrowser/NFLSlate (which already prefer real games when loaded),
  // this screen showed a fake slate and a fake countdown even once a league was
  // fully wired to real games elsewhere in the app (see chat). Loads the current
  // week's real games the same way NFLSlate does.
  useEffect(() => {
    if (league) loadRealGamesForWeek(league.currentWeek);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league?.currentWeek]);

  if (!league) {
    return (
      <div className="p-4">
        <EmptyState icon={<Trophy size={36} strokeWidth={1.5} />} title="No league yet" subtitle="Create or join a league from the welcome screen to get started." />
      </div>
    );
  }

  const userTeam = league.teams.find((t) => t.isUser);
  // Unread-chat badge on the Chat tab pill (see ActivityFeed) -- a message
  // counts as unread if it's from someone else and newer than the last time
  // this device looked at the Chat tab for this league (see chat, Sept 2026).
  const lastSeenChatTs = lastSeenChatByLeague[league.id];
  const lastSeenChatMs = lastSeenChatTs ? new Date(lastSeenChatTs).getTime() : 0;
  const chatUnreadCount = league.chat.filter(
    (m) => m.teamId !== userTeam?.id && new Date(m.ts).getTime() > lastSeenChatMs,
  ).length;

  // Client-side-only refresh: re-reads whatever's already in Supabase (scores,
  // wager/roster status, standings) -- does NOT touch the odds/lines
  // themselves, which stay behind the separate Refresh Odds button + cooldown
  // on MarketBrowser (that one spends real Odds API credits; this one doesn't
  // touch any edge function at all, so no cooldown needed here).
  async function handleRefresh() {
    if (refreshing || !league) return;
    setRefreshing(true);
    try {
      await Promise.all([
        loadLeagueResults(league.id),
        loadWeekRosters(league.id, league.currentWeek),
        loadRealGamesForWeek(league.currentWeek),
      ]);
    } finally {
      setRefreshing(false);
    }
  }
  const weekMatchups = league.matchupsByWeek[String(league.currentWeek)] ?? [];
  const userMatchup = weekMatchups.find((m) => m.teamAId === userTeam?.id || m.teamBId === userTeam?.id);
  const otherMatchups = weekMatchups.filter((m) => m.id !== userMatchup?.id);
  // No matchup this week is ambiguous on its own -- could mean "eliminated from
  // the playoffs" or "nobody has ever started the season" (see chat: a league
  // that filled up entirely with real invite-code joins used to have no path to
  // ever get a schedule at all). Distinguish by whether *any* week has matchups.
  const seasonNotStarted = Object.keys(league.matchupsByWeek).length === 0;
  const isCommissioner = !!userTeam && userTeam.id === league.commissionerTeamId;
  // Real games only now -- no more falling back to the simulated slate just to
  // compute a countdown (see chat, Sept 2026: MarketBrowser dropped the same
  // fallback since it let a wager get placed against a fake game that could
  // never settle; this spot was display-only so the risk was different, but a
  // countdown to a game that was never going to happen was still wrong).
  // No countdown at all (rather than a fake one) is the honest state while
  // this week's real odds are still posting.
  const realUpcoming = realGamesForWeek?.filter((g) => g.status === 'upcoming' && g.bookmakers.length > 0) ?? [];
  const firstKickoff = realUpcoming.length > 0 ? realUpcoming.reduce((min, g) => (g.kickoff < min ? g.kickoff : min), realUpcoming[0].kickoff) : null;

  return (
    <>
      <div className="flex items-center gap-2.5 w-full px-4 pt-2 pb-2 sticky top-0 bg-bg-raised z-10">
        <button onClick={() => setSwitcherOpen(true)} className="flex items-center gap-2.5 text-left flex-1 min-w-0">
          <LeagueLogo league={league} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="text-text-muted text-sm truncate flex items-center gap-1">
              {league.name}
              <ChevronDown size={12} />
            </p>
            <div className="flex items-baseline justify-between">
              <h1 className="text-2xl font-bold">{weekLabel(league.currentWeek)}</h1>
              {firstKickoff && (
                <span className="text-xs text-text-muted">
                  <CountdownTimer target={firstKickoff} />
                </span>
              )}
            </div>
          </div>
        </button>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          aria-label="Refresh scores and stats"
          className="p-2 -mr-2 text-text-muted disabled:opacity-50 shrink-0"
        >
          <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {switcherOpen && (
        <LeagueSwitcherSheet
          leagues={Object.values(allLeagues).filter((l) => l.teams.some((t) => t.isUser))}
          currentLeagueId={currentLeagueId}
          onSwitch={(leagueId) => {
            setCurrentLeague(leagueId);
            setSwitcherOpen(false);
          }}
          onClose={() => setSwitcherOpen(false)}
        />
      )}

      <div className="px-4 pb-4 space-y-4">
        {league.seasonPhase === 'complete' ? (
          <EmptyState
            icon={<Trophy size={36} strokeWidth={1.5} />}
            title={`${league.teams.find((t) => t.id === league.bracket?.championId)?.teamName ?? 'A team'} won it all!`}
            subtitle="Check the Playoff Bracket in Settings to relive the run."
          />
        ) : userMatchup ? (
          <MatchupCard league={league} matchup={userMatchup} highlightTeamId={userTeam?.id} />
        ) : seasonNotStarted ? (
          <EmptyState
            icon={<Rocket size={36} strokeWidth={1.5} />}
            title="Season hasn't started yet"
            subtitle={
              isCommissioner
                ? 'Head to Settings to fill the league with simulated teams or start the season with whoever has joined so far.'
                : "The commissioner hasn't started the season yet."
            }
            action={
              isCommissioner ? (
                <button onClick={() => navigate('/settings')} className="bg-primary text-white text-sm font-semibold px-4 py-2 rounded-lg">
                  Go to Settings
                </button>
              ) : undefined
            }
          />
        ) : (
          <EmptyState icon={<Hourglass size={36} strokeWidth={1.5} />} title="No matchup this week" subtitle="Your team may have been eliminated from the playoffs." />
        )}

        {otherMatchups.length > 0 && (
          <div>
            <button
              onClick={() => setShowAll((v) => !v)}
              className="text-xs text-primary font-medium mb-2"
            >
              {showAll ? 'Hide' : 'View'} other matchups ({otherMatchups.length})
            </button>
            {showAll && (
              <div className="space-y-2.5">
                {otherMatchups.map((m) => (
                  <MatchupCard key={m.id} league={league} matchup={m} />
                ))}
              </div>
            )}
          </div>
        )}

        {league.settings.buyInEnabled && league.prizePool && <PrizePoolTicker pool={league.prizePool} />}

        <StandingsPreview league={league} />

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="font-semibold text-sm">Activity</p>
            {/* League News is commissioner-only/auto (see chat) -- any member could
               post an announcement before this gate; postAnnouncement itself is a
               client action, so this is a client-side gate only until the
               post_announcement RPC (hand-created in the SQL editor, not
               migration-tracked -- see chat's established pattern) gets a matching
               server-side check. */}
            {isCommissioner && (
              <button onClick={() => setAnnounceOpen((v) => !v)} className="text-xs text-primary font-medium">
                {announceOpen ? 'Cancel' : '+ Announcement'}
              </button>
            )}
          </div>
          {isCommissioner && announceOpen && (
            <div className="flex gap-2 mb-2">
              <input
                value={announceText}
                onChange={(e) => setAnnounceText(e.target.value)}
                placeholder="Message the league…"
                className="flex-1 bg-bg-card border border-border rounded-lg px-3 py-2 text-sm"
              />
              <button
                disabled={!announceText.trim()}
                onClick={() => {
                  postAnnouncement(league.id, announceText.trim());
                  setAnnounceText('');
                  setAnnounceOpen(false);
                }}
                className="bg-primary text-white text-sm font-semibold px-3 rounded-lg disabled:opacity-40"
              >
                Post
              </button>
            </div>
          )}
          <ActivityFeed
            league={league}
            items={league.activity}
            chat={league.chat}
            chatUnreadCount={chatUnreadCount}
            onReact={(itemId, emoji) => reactToActivity(league.id, itemId, emoji)}
            onSendChat={(message) => postChatMessage(league.id, message)}
            onDeleteAnnouncement={(itemId) => deleteAnnouncement(league.id, itemId)}
            onDeleteChat={(itemId) => deleteChatMessage(league.id, itemId)}
            onSeenChat={() => markChatSeen(league.id)}
          />
        </div>
      </div>
    </>
  );
}