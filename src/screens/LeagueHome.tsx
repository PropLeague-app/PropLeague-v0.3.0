import { useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { weekLabel } from '../types';
import { getSlate } from '../services/oddsService';
import { MatchupCard } from '../components/home/MatchupCard';
import { StandingsPreview } from '../components/home/StandingsPreview';
import { ActivityFeed } from '../components/home/ActivityFeed';
import { CountdownTimer } from '../components/common/CountdownTimer';
import { EmptyState } from '../components/common/EmptyState';
import { PrizePoolTicker } from '../components/home/PrizePoolTicker';
import { LeagueLogo } from '../components/common/LeagueLogo';
import { LeagueSwitcherSheet } from '../components/home/LeagueSwitcherSheet';

export function LeagueHome() {
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));
  const allLeagues = useAppStore((s) => s.leagues);
  const setCurrentLeague = useAppStore((s) => s.setCurrentLeague);
  const postAnnouncement = useAppStore((s) => s.postAnnouncement);
  const reactToActivity = useAppStore((s) => s.reactToActivity);
  const loadLeagueResults = useAppStore((s) => s.loadLeagueResults);
  const [showAll, setShowAll] = useState(false);
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [announceText, setAnnounceText] = useState('');
  const [switcherOpen, setSwitcherOpen] = useState(false);

  // Pulls the real, shared matchup/standings results — matters most for anyone who
  // isn't the commissioner, since they never ran Advance Week themselves.
  useEffect(() => {
    if (currentLeagueId) loadLeagueResults(currentLeagueId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLeagueId]);

  if (!league) {
    return (
      <div className="p-4">
        <EmptyState icon="🏈" title="No league yet" subtitle="Create or join a league from the welcome screen to get started." />
      </div>
    );
  }

  const userTeam = league.teams.find((t) => t.isUser);
  const weekMatchups = league.matchupsByWeek[String(league.currentWeek)] ?? [];
  const userMatchup = weekMatchups.find((m) => m.teamAId === userTeam?.id || m.teamBId === userTeam?.id);
  const otherMatchups = weekMatchups.filter((m) => m.id !== userMatchup?.id);
  const slate = getSlate(league.currentWeek, league.currentWeek, league.settings.lineMovementEnabled, league.manualGameOverrides);
  const firstKickoff = slate.length > 0 ? slate.reduce((min, g) => (g.kickoff < min ? g.kickoff : min), slate[0].kickoff) : null;

  return (
    <>
      <button
        onClick={() => setSwitcherOpen(true)}
        className="flex items-center gap-2.5 text-left w-full p-4 pb-2 sticky top-0 bg-bg z-10"
      >
        <LeagueLogo league={league} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-text-muted text-sm truncate flex items-center gap-1">
            {league.name}
            <span className="text-[10px]">▾</span>
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
            icon="🏆"
            title={`${league.teams.find((t) => t.id === league.bracket?.championId)?.teamName ?? 'A team'} won it all!`}
            subtitle="Check the Playoff Bracket in Settings to relive the run, or reset the season from the dev panel."
          />
        ) : userMatchup ? (
          <MatchupCard league={league} matchup={userMatchup} highlightTeamId={userTeam?.id} />
        ) : (
          <EmptyState icon="⏳" title="No matchup this week" subtitle="Your team may have been eliminated from the playoffs." />
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
            <button onClick={() => setAnnounceOpen((v) => !v)} className="text-xs text-primary font-medium">
              {announceOpen ? 'Cancel' : '+ Announcement'}
            </button>
          </div>
          {announceOpen && (
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
          <ActivityFeed league={league} items={league.activity} onReact={(itemId, emoji) => reactToActivity(league.id, itemId, emoji)} />
        </div>
      </div>
    </>
  );
}