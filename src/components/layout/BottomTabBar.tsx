import { NavLink } from 'react-router-dom';
import { House, ClipboardList, CalendarDays, Settings } from 'lucide-react';
import { useUIStore } from '../../store/useUIStore';
import { useAppStore } from '../../store/useAppStore';
import { validateLineup } from '../../engine/validation';
import { buildEmptyRoster, rosterKey } from '../../engine/rosterSlots';

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
export const BOTTOM_TAB_BAR_HEIGHT = 64;

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

  // Discard-on-leave confirm for the identity/logo editors (manual v0.1.1 §2 #4) — the
  // app has no data-router set up (plain <Routes>), so react-router's navigation
  // blockers aren't available; intercepting the tab bar itself covers the actual way
  // someone leaves the Settings tab mid-edit.
  function handleClick(e: React.MouseEvent) {
    if (!hasUnsavedChanges) return;
    if (!confirm('You have unsaved changes. Discard them?')) {
      e.preventDefault();
      return;
    }
    setHasUnsavedChanges(false);
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
          onClick={handleClick}
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center justify-center gap-0.5 text-xs ${
              isActive ? 'text-primary' : 'text-text-muted'
            }`
          }
        >
          <span className="relative">
            <tab.Icon size={22} strokeWidth={2} />
            {tab.to === '/lineup' && lineupIncomplete && (
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