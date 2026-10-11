import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { House, ClipboardList, CalendarDays, Settings } from 'lucide-react';
import { useUIStore } from '../../store/useUIStore';
import { useAppStore } from '../../store/useAppStore';
import { validateLineup } from '../../engine/validation';
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
  { to: '/settings', label: 'Profile', Icon: Settings },
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

  // Discard-on-leave confirm for the identity/logo editors (manual v0.1.1 §2 #4) — the
  // app has no data-router set up (plain <Routes>), so react-router's navigation
  // blockers aren't available; intercepting the tab bar itself covers the actual way
  // someone leaves the Settings tab mid-edit.
  function confirmLeave(e: React.MouseEvent): boolean {
    if (!hasUnsavedChanges) return true;
    if (!confirm('You have unsaved changes. Discard them?')) {
      e.preventDefault();
      return false;
    }
    setHasUnsavedChanges(false);
    return true;
  }

  // Tab taps (shellNav.ts):
  // - The tab you are already in goes back to its default view (NFL Slate: the list for the current
  //   week; League Home: the home page), and on that view scrolls to the top.
  // - NFL Slate and League Home reopen where you left them (an open game or matchup), with the scroll
  //   position, until the app is quit.
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const setSlateWeek = useUIStore((s) => s.setSlateWeek);
  function handleClick(e: React.MouseEvent, to: string) {
    if (!confirmLeave(e)) return;
    if (inTabSection(to, pathname)) {
      if (isMemoryTab(to)) resetTabMemory(to);
      if (to === '/slate') setSlateWeek(null);
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
            {((tab.to === '/lineup' && lineupIncomplete) || (tab.to === '/settings' && voidWaiting)) && (
              <span className="absolute -top-1 -right-1.5 w-3.5 h-3.5 rounded-full bg-loss text-white text-[9px] leading-[14px] font-bold text-center">
                !
              </span>
            )}
          </span>
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}