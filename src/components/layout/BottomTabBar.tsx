import { NavLink } from 'react-router-dom';
import { useUIStore } from '../../store/useUIStore';

const TABS = [
  { to: '/home', label: 'League Home', icon: '🏠' },
  { to: '/lineup', label: 'Lineup', icon: '📋' },
  { to: '/slate', label: 'NFL Slate', icon: '🏈' },
  { to: '/settings', label: 'Profile', icon: '⚙️' },
];

// Explicit height (rather than intrinsic content height from py-2.5) so any other
// fixed-position element that needs to sit flush against the tab bar (e.g. Lineup's
// sticky Save Lineup footer) can use a matching bottom offset instead of guessing.
export const BOTTOM_TAB_BAR_HEIGHT = 64;

export function BottomTabBar() {
  const hasUnsavedChanges = useUIStore((s) => s.hasUnsavedChanges);
  const setHasUnsavedChanges = useUIStore((s) => s.setHasUnsavedChanges);

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
    <nav className="fixed bottom-0 w-full max-w-md bg-bg-raised border-t border-border flex z-40" style={{ height: BOTTOM_TAB_BAR_HEIGHT }}>
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
          <span className="text-lg leading-none">{tab.icon}</span>
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
