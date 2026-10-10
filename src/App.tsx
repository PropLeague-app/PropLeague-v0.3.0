import { Suspense, useEffect } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useAppStore } from './store/useAppStore';
import { useAuthStore } from './store/useAuthStore';
import { registerForPushNotifications } from './services/pushNotifications';
import { setLiveActivityColorScale, startLiveActivities, stopLiveActivities } from './services/liveActivities';
import { applyAccent, applyThemeMode } from './services/theme';
import { watchSystemAppearance } from './hooks/useResolvedTheme';
import { MobileShell } from './components/layout/MobileShell';
import { WeeklyResultReveal } from './components/home/WeeklyResultReveal';
import { PushRouter } from './components/layout/PushRouter';

import { lazyNamed, prefetchLazyChunks } from './lazyLoad';

// Onboarding is only seen once (or after signing out), so it loads on demand (see lazyLoad.ts).
const Welcome = lazyNamed(() => import('./screens/onboarding/Welcome'), 'Welcome');
const HowItWorks = lazyNamed(() => import('./screens/onboarding/HowItWorks'), 'HowItWorks');
const Auth = lazyNamed(() => import('./screens/onboarding/Auth'), 'Auth');
const ResetPassword = lazyNamed(() => import('./screens/onboarding/ResetPassword'), 'ResetPassword');
const ProfileSetup = lazyNamed(() => import('./screens/onboarding/ProfileSetup'), 'ProfileSetup');
const CreateLeague = lazyNamed(() => import('./screens/onboarding/CreateLeague'), 'CreateLeague');
const InviteScreen = lazyNamed(() => import('./screens/onboarding/InviteScreen'), 'InviteScreen');
const JoinLeague = lazyNamed(() => import('./screens/onboarding/JoinLeague'), 'JoinLeague');

import { LeagueHome } from './screens/LeagueHome';
import { MatchupDetail } from './screens/MatchupDetail';
import { Lineup } from './screens/Lineup';
import { MarketBrowser } from './screens/MarketBrowser';
import { NFLSlate } from './screens/NFLSlate';
import { GameDetail } from './screens/GameDetail';
import { SettingsHome } from './screens/SettingsHome';
// The four tabs, Matchup, the market list and Game Details stay in the main bundle. These deeper
// screens load on first visit (and are prefetched right after launch, so the tap is still instant).
const LeagueSettingsScreen = lazyNamed(() => import('./screens/LeagueSettingsScreen'), 'LeagueSettingsScreen');
const FullStandings = lazyNamed(() => import('./screens/FullStandings'), 'FullStandings');
const ScheduleView = lazyNamed(() => import('./screens/ScheduleView'), 'ScheduleView');
const WeekMatchups = lazyNamed(() => import('./screens/WeekMatchups'), 'WeekMatchups');
const LeagueMembers = lazyNamed(() => import('./screens/LeagueMembers'), 'LeagueMembers');
const PlayoffBracket = lazyNamed(() => import('./screens/PlayoffBracket'), 'PlayoffBracket');
const BetHistory = lazyNamed(() => import('./screens/BetHistory'), 'BetHistory');
const PrizePool = lazyNamed(() => import('./screens/PrizePool'), 'PrizePool');
const MyStats = lazyNamed(() => import('./screens/MyStats'), 'MyStats');
const Leaderboards = lazyNamed(() => import('./screens/Leaderboards'), 'Leaderboards');
import { BootLoader } from './components/common/BootLoader';

/** manual v0.2.0 §6 #15: the Welcome splash only ever appears when no profile exists
 * (the Factory Reset case) — a profile'd user who's between leagues (e.g. just left
 * their only one, or created a second one they haven't filled yet) skips straight to
 * Create League instead. If `currentLeagueId` isn't pointing at a ready league but the
 * user has another ready one (also reachable after Leave This League drops them off a
 * league that wasn't their only one), fall back to that instead of assuming they have
 * none. */
function RootRedirect() {
  const authLoading = useAuthStore((s) => s.loading);
  const session = useAuthStore((s) => s.session);
  const authProfile = useAuthStore((s) => s.profile);

  const profile = useAppStore((s) => s.profile);
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const leagues = useAppStore((s) => s.leagues);
  const setCurrentLeague = useAppStore((s) => s.setCurrentLeague);
  const leaguesHydrated = useAppStore((s) => s.leaguesHydrated);
  const hydrateMyLeagues = useAppStore((s) => s.hydrateMyLeagues);

  // A league only counts as "the user's" if their team is still in it — otherwise
  // Leave This League (manual §6 #12) could hand the user right back into a league
  // they just left, since it still has plenty of (now all-simulated) teams.
  const isUserReady = (l: (typeof leagues)[string]) => l.teams.some((t) => t.isUser);
  const currentLeague = currentLeagueId ? leagues[currentLeagueId] : undefined;
  const readyLeagues = Object.values(leagues).filter(isUserReady);
  const targetLeague = currentLeague && isUserReady(currentLeague) ? currentLeague : readyLeagues[0];

  useEffect(() => {
    if (targetLeague && targetLeague.id !== currentLeagueId) setCurrentLeague(targetLeague.id);
  }, [targetLeague?.id, currentLeagueId, setCurrentLeague]);

  // Discovers any leagues Supabase says this user actually belongs to, once we
  // know they're a real, fully-onboarded session. Without this, a returning
  // user on a fresh install (every TestFlight tester's actual situation) or
  // after signing back in would never learn about their real memberships —
  // the app only ever knew about leagues created/joined THIS session on THIS
  // device. Gated on leaguesHydrated (reset on sign-out) so it runs once per
  // session, not on every render.
  useEffect(() => {
    if (session && authProfile?.onboarded && !leaguesHydrated) hydrateMyLeagues();
  }, [session, authProfile?.onboarded, leaguesHydrated, hydrateMyLeagues]);

  // <Navigate> renders nothing for one commit before it moves the router, which showed up as a blank
  // screen between the loader and the first real screen. Keeping the loader up beside it means the
  // screen is only ever replaced by the next screen, never by an empty one.
  const redirect = (to: string) => (
    <>
      <BootLoader />
      <Navigate to={to} replace />
    </>
  );

  // Auth gates come first: don't decide anything league-related until we know
  // whether there's a real session, and whether it's finished onboarding.
  if (authLoading) {
    return <BootLoader />;
  }
  if (!session) return redirect('/welcome');
  if (authProfile && !authProfile.onboarded) return redirect('/profile-setup');

  if (!profile) return redirect('/welcome');

  // Don't decide "no leagues, go create one" until hydration has actually had
  // a chance to check Supabase — otherwise a returning user with a real
  // membership would get bounced to Create League before we'd even looked.
  if (!leaguesHydrated) {
    return <BootLoader />;
  }

  if (!targetLeague) return redirect('/create-league');
  return redirect('/home');
}

function AppShellLayout() {
  return (
    <MobileShell>
      {/* A deeper screen that has not loaded yet shows nothing for a moment (normally it is already
          prefetched); the tab bar and shell stay put. */}
      <Suspense fallback={null}>
        <Outlet />
      </Suspense>
      {/* Mounted once for the whole app shell, not per-screen, so a decided matchup
          gets its Tuesday reveal popup no matter which screen the user happens to
          open the app to (see chat, Sept 2026 -- same "lives at the shell level"
          reasoning as push-notification registration in App() below). */}
      <WeeklyResultReveal />
      {/* Follows a tapped push to its league and screen (services/pushRoute.ts). */}
      <PushRouter />
    </MobileShell>
  );
}

function App() {
  useEffect(() => {
    useAuthStore.getState().init();
    prefetchLazyChunks(); // quietly loads the on-demand screens once launch work is done
  }, []);

  // Registers this device for push once there's a real, fully-onboarded
  // session (see chat, Sept 2026 -- same gating as RootRedirect's
  // hydrateMyLeagues, for the same reason: nothing to register against
  // before that). Lives here rather than in RootRedirect so it isn't tied to
  // that component's routing re-renders -- App() mounts once for the whole
  // app lifetime.
  const pushSession = useAuthStore((s) => s.session);
  const pushProfile = useAuthStore((s) => s.profile);
  useEffect(() => {
    if (pushSession && pushProfile?.onboarded) void registerForPushNotifications(pushProfile.id);
  }, [pushSession, pushProfile?.onboarded, pushProfile?.id]);

  // Lock screen / Dynamic Island live updates (iOS 16.2+; no-op elsewhere). Same gating and
  // placement as push registration. Signing out ends anything still showing on the device.
  useEffect(() => {
    if (pushSession && pushProfile?.onboarded) void startLiveActivities();
    else if (!pushSession) void stopLiveActivities();
  }, [pushSession, pushProfile?.onboarded, pushProfile?.id]);

  // The lock screen scores follow the same P/L color choice as the app (classic or scaled).
  const plColorScale = useAppStore((s) => s.profile?.plColorScale) ?? 'classic';
  useEffect(() => {
    void setLiveActivityColorScale(plColorScale);
  }, [plColorScale]);

  // Local appearance setting (see chat, Sept 2026 -- light mode) -- lives here
  // rather than per-screen for the same reason push registration does: App()
  // mounts once for the whole app lifetime, so this can't miss applying the
  // theme just because the user's first screen after a cold launch happens not
  // to be one that reads themeMode itself. Fires on every profile load/change,
  // not just once, so switching the Settings toggle repaints immediately.
  const themeMode = useAppStore((s) => s.profile?.themeMode);
  useEffect(() => {
    void applyThemeMode(themeMode ?? 'dark');
    // Auto repaints the moment the phone flips between light and dark.
    if (themeMode !== 'auto') return;
    return watchSystemAppearance(() => void applyThemeMode('auto'));
  }, [themeMode]);

  // Accent color (Settings > Accent), local to the device like the theme.
  const accentColor = useAppStore((s) => s.profile?.accentColor);
  useEffect(() => {
    applyAccent(accentColor);
  }, [accentColor]);

  return (
    // Onboarding screens load on demand; the boot loader covers that first moment.
    <Suspense fallback={<BootLoader />}>
    <Routes>
      <Route path="/" element={<RootRedirect />} />

      <Route path="/welcome" element={<Welcome />} />
      <Route path="/how-it-works" element={<HowItWorks />} />
      <Route path="/auth" element={<Auth />} />
<Route path="/reset-password" element={<ResetPassword />} />
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
        <Route path="/settings/league" element={<LeagueSettingsScreen />} />
        <Route path="/standings" element={<FullStandings />} />
        <Route path="/schedule" element={<ScheduleView />} />
        <Route path="/matchups" element={<WeekMatchups />} />
        <Route path="/members" element={<LeagueMembers />} />
        <Route path="/bracket" element={<PlayoffBracket />} />
        <Route path="/bet-history" element={<BetHistory />} />
        <Route path="/prize-pool" element={<PrizePool />} />
        <Route path="/my-stats" element={<MyStats />} />
        <Route path="/leaderboards" element={<Leaderboards />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}

export default App;