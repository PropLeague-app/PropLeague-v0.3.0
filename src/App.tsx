import { useEffect } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useAppStore } from './store/useAppStore';
import { MobileShell } from './components/layout/MobileShell';

import { Welcome } from './screens/onboarding/Welcome';
import { HowItWorks } from './screens/onboarding/HowItWorks';
import { ProfileSetup } from './screens/onboarding/ProfileSetup';
import { CreateLeague } from './screens/onboarding/CreateLeague';
import { InviteScreen } from './screens/onboarding/InviteScreen';
import { JoinLeague } from './screens/onboarding/JoinLeague';

import { LeagueHome } from './screens/LeagueHome';
import { MatchupDetail } from './screens/MatchupDetail';
import { Lineup } from './screens/Lineup';
import { MarketBrowser } from './screens/MarketBrowser';
import { NFLSlate } from './screens/NFLSlate';
import { GameDetail } from './screens/GameDetail';
import { SettingsHome } from './screens/SettingsHome';
import { FullStandings } from './screens/FullStandings';
import { ScheduleView } from './screens/ScheduleView';
import { LeagueMembers } from './screens/LeagueMembers';
import { PlayoffBracket } from './screens/PlayoffBracket';
import { BetHistory } from './screens/BetHistory';
import { PrizePool } from './screens/PrizePool';
import { MyStats } from './screens/MyStats';
import { Leaderboards } from './screens/Leaderboards';

/** manual v0.2.0 §6 #15: the Welcome splash only ever appears when no profile exists
 * (the Factory Reset case) — a profile'd user who's between leagues (e.g. just left
 * their only one, or created a second one they haven't filled yet) skips straight to
 * Create League instead. If `currentLeagueId` isn't pointing at a ready league but the
 * user has another ready one (also reachable after Leave This League drops them off a
 * league that wasn't their only one), fall back to that instead of assuming they have
 * none. */
function RootRedirect() {
  const profile = useAppStore((s) => s.profile);
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const leagues = useAppStore((s) => s.leagues);
  const setCurrentLeague = useAppStore((s) => s.setCurrentLeague);

  // A league only counts as "the user's" if their team is still in it — otherwise
  // Leave This League (manual §6 #12) could hand the user right back into a league
  // they just left, since it still has plenty of (now all-simulated) teams.
  const isUserReady = (l: (typeof leagues)[string]) => l.teams.length > 1 && l.teams.some((t) => t.isUser);
  const currentLeague = currentLeagueId ? leagues[currentLeagueId] : undefined;
  const readyLeagues = Object.values(leagues).filter(isUserReady);
  const targetLeague = currentLeague && isUserReady(currentLeague) ? currentLeague : readyLeagues[0];

  useEffect(() => {
    if (targetLeague && targetLeague.id !== currentLeagueId) setCurrentLeague(targetLeague.id);
  }, [targetLeague?.id, currentLeagueId, setCurrentLeague]);

  if (!profile) return <Navigate to="/welcome" replace />;
  if (!targetLeague) return <Navigate to="/create-league" replace />;
  return <Navigate to="/home" replace />;
}

function AppShellLayout() {
  return (
    <MobileShell>
      <Outlet />
    </MobileShell>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />

      <Route path="/welcome" element={<Welcome />} />
      <Route path="/how-it-works" element={<HowItWorks />} />
      <Route path="/profile-setup" element={<ProfileSetup />} />
      <Route path="/create-league" element={<CreateLeague />} />
      <Route path="/create-league/invite/:leagueId" element={<InviteScreen />} />
      <Route path="/join-league" element={<JoinLeague />} />

      <Route element={<AppShellLayout />}>
        <Route path="/home" element={<LeagueHome />} />
        <Route path="/matchup/:matchupId" element={<MatchupDetail />} />
        <Route path="/lineup" element={<Lineup />} />
        <Route path="/lineup/market/:slotId" element={<MarketBrowser />} />
        <Route path="/slate" element={<NFLSlate />} />
        <Route path="/slate/game/:gameId" element={<GameDetail />} />
        <Route path="/settings" element={<SettingsHome />} />
        <Route path="/standings" element={<FullStandings />} />
        <Route path="/schedule" element={<ScheduleView />} />
        <Route path="/members" element={<LeagueMembers />} />
        <Route path="/bracket" element={<PlayoffBracket />} />
        <Route path="/bet-history" element={<BetHistory />} />
        <Route path="/prize-pool" element={<PrizePool />} />
        <Route path="/my-stats" element={<MyStats />} />
        <Route path="/leaderboards" element={<Leaderboards />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
