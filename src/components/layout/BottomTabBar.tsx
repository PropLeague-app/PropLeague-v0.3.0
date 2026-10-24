import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { House, ClipboardList, CalendarDays, UserRound } from 'lucide-react';
import { ConfirmSheet } from '../common/ConfirmSheet';
import { useUIStore } from '../../store/useUIStore';
import { useAppStore } from '../../store/useAppStore';
import { validateLineup } from '../../engine/validation';
import { unreadActivityCount } from '../../engine/activityDigest';
import { buildEmptyRoster, rosterKey } from '../../engine/rosterSlots';
import { usePendingVoidRequests } from '../../hooks/usePendingVoidRequests';
import { inTabSection, isMemoryTab, resetTabMemory, scrollShellToTop, tabReopenPath, type ShellNavState } from './shellNav';

// Simple, uniform line icons rather than emoji -- lucide-react has no
// dedicated American football icon, so NFL Slate uses a calendar instead,
// matching what that screen actually is (a weekly game schedule to browse),
// rather than forcing a sports-ball shape that doesn't exist in this set.
const TABS = [
  { to: '/home', label: 'League Home', Icon: House },
  { to: '/lineup', label: 'Lineup', Icon: ClipboardList },
  { to: '/slate', label: 'NFL Slate', Icon: CalendarDays },
  // Profile replaces Settings on the bar. Settings is the lowest-traffic surface in the app and was
  // holding a quarter of the tab bar, while the things people actually came to it for (their stats,
  // their bets, other members) were buried in a list inside it. Settings now sits behind the gear on
  // your own profile, which also puts "what my team looks like" and "change what my team looks like"
  // in one place instead of two tabs apart (see chat, Oct 2026).
  { to: '/profile', label: 'Profile', Icon: UserRound },
];

// Explicit height (rather than intrinsic content height from py-2.5) so any other
// fixed-position element that needs to sit flush against the tab bar (e.g. Lineup's
// sticky Save Lineup footer) can use a matching bottom offset instead of guessing.
// 49pt matches Apple's own native UITabBar content height (the tab bar every stock
// iOS app uses, unchanged since iOS 7) -- not an arbitrary number, but the actual
// platform convention, so this now sits at the same footprint a native tab bar
// would rather than looking taller/more spacious than what iOS users are used to.
export const BOTTOM_TAB_BAR_HEIGHT = 49;

export function BottomTabBar() {
  const hasUnsavedChanges = useUIStore((s) => s.hasUnsavedChanges);
  const setHasUnsavedChanges = useUIStore((s) => s.setHasUnsavedChanges);

  // Global "is this week's lineup incomplete or under-allocated" check, so the
  // indicator is visible from anywhere in the app, not just while already on
  // the Lineup screen -- exactly the case Hunter described (navigated away
  // to research a prop, wants a reminder that something's still unfinished).
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));
  const userTeam = league?.teams.find((t) => t.isUser);
  const roster =
    league && userTeam
      ? (league.rostersByTeamWeek[rosterKey(userTeam.id, league.currentWeek)] ??
        buildEmptyRoster(userTeam.id, league.currentWeek, league.settings.lineupSlots))
      : undefined;
  const lineupIncomplete = !!(roster && league && !validateLineup(roster, league.settings).valid);

  // A commissioner with void requests waiting gets the same "!" on the Profile tab, since that is
  // where the Void Requests card lives and nothing else would bring them there.
  usePendingVoidRequests();
  const voidWaiting = useUIStore((s) => s.pendingVoidRequests) > 0;
  // Something happened in the league since this device last opened the feed. The only unread signal
  // used to be a badge on the Chat pill inside the feed itself, at the bottom of League Home, so you
  // had to scroll to the thing it was advertising before you could see the advert (see chat, Oct
  // 2026). Counts league news and other people talking, never your own settled picks.
  const activityLeague = useAppStore((s) => (s.currentLeagueId ? s.leagues[s.currentLeagueId] : undefined));
  const lastSeenActivity = useAppStore((s) => s.lastSeenActivityByLeague);
  const activityUnread = (() => {
    if (!activityLeague) return 0;
    const seen = lastSeenActivity[activityLeague.id];
    const userTeamId = activityLeague.teams.find((t) => t.isUser)?.id;
    return unreadActivityCount(activityLeague.activity, activityLeague.chat, userTeamId, seen ? new Date(seen).getTime() : 0);
  })();

  // Discard-on-leave confirm for the identity/logo editors (manual v0.1.1 §2 #4) — the
  // app has no data-router set up (plain <Routes>), so react-router's navigation
  // blockers aren't available; intercepting the tab bar itself covers the actual way
  // someone leaves the Settings tab mid-edit.
  //
  // ConfirmSheet is async, so the tap cannot be answered inline the way window.confirm
  // answered it: the tap is cancelled outright, the destination is parked here, and the
  // navigation is replayed by goToTab() if the sheet is confirmed.
  const [pendingLeave, setPendingLeave] = useState<string | null>(null);

  // Tab taps (shellNav.ts):
  // - The tab you are already in goes back to its default view (NFL Slate: the list for the current
  //   week; League Home: the home page), and on that view scrolls to the top.
  // - NFL Slate and League Home reopen where you left them (an open game or matchup), with the scroll
  //   position, until the app is quit.
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const resetSlateView = useUIStore((s) => s.resetSlateView);
  // The same tab-tap rules as handleClick, but driven by navigate() rather than by letting
  // the NavLink's own default through, for the replay-after-confirm path where there is no
  // click event left to allow.
  function goToTab(to: string) {
    if (inTabSection(to, pathname)) {
      if (isMemoryTab(to)) resetTabMemory(to);
      if (to === '/slate') resetSlateView();
      if (pathname === to) {
        scrollShellToTop();
        return;
      }
      navigate(to);
      return;
    }
    if (isMemoryTab(to)) {
      const target = tabReopenPath(to, currentLeagueId);
      const state: ShellNavState = { restoreScroll: true, fromTab: target !== to };
      navigate(target, { state });
      return;
    }
    navigate(to);
  }

  function handleClick(e: React.MouseEvent, to: string) {
    if (hasUnsavedChanges) {
      e.preventDefault();
      setPendingLeave(to);
      return;
    }
    if (inTabSection(to, pathname)) {
      if (isMemoryTab(to)) resetTabMemory(to);
      if (to === '/slate') resetSlateView();
      if (pathname === to) {
        e.preventDefault();
        scrollShellToTop();
      }
      return;
    }
    if (isMemoryTab(to)) {
      e.preventDefault();
      const target = tabReopenPath(to, currentLeagueId);
      const state: ShellNavState = { restoreScroll: true, fromTab: target !== to };
      navigate(target, { state });
    }
  }

  return (
    <>
    <nav
      className="fixed bottom-0 w-full max-w-md bg-bg-raised border-t border-border flex z-40"
      style={{
        height: `calc(${BOTTOM_TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom))`,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          onClick={(e) => handleClick(e, tab.to)}
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center justify-center gap-0.5 text-xs ${
              isActive || inTabSection(tab.to, pathname) ? 'text-primary' : 'text-text-muted'
            }`
          }
        >
          <span className="relative">
            <tab.Icon size={22} strokeWidth={2} />
            {((tab.to === '/lineup' && lineupIncomplete) || (tab.to === '/profile' && voidWaiting)) && (
              <span className="absolute -top-1 -right-1.5 w-3.5 h-3.5 rounded-full bg-loss text-white text-[9px] leading-[14px] font-bold text-center">
                !
              </span>
            )}
            {/* A count rather than a "!": league news is interesting, not urgent, and "3" tells you
                whether it is worth a look in a way a bare mark cannot. Capped so a chatty week
                cannot widen the tab. */}
            {tab.to === '/home' && activityUnread > 0 && (
              <span className="absolute -top-1 -right-2 min-w-3.5 h-3.5 px-1 rounded-full bg-loss text-white text-[9px] leading-[14px] font-bold text-center">
                {activityUnread > 9 ? '9+' : activityUnread}
              </span>
            )}
          </span>
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
    {pendingLeave && (
      <ConfirmSheet
        title="Discard unsaved changes?"
        description="You have changes that have not been saved. Leaving this screen will discard them."
        confirmLabel="Discard"
        onConfirm={async () => {
          setHasUnsavedChanges(false);
          goToTab(pendingLeave);
        }}
        onClose={() => setPendingLeave(null)}
      />
    )}
    </>
  );
}