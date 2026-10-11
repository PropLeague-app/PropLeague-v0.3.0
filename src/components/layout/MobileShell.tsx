import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { BOTTOM_TAB_BAR_HEIGHT, BottomTabBar } from './BottomTabBar';
import { useAppStore } from '../../store/useAppStore';
import {
  noteShellLocation,
  registerShellScroller,
  saveShellScroll,
  savedShellScroll,
  scrollShellToTop,
  shellNavState,
} from './shellNav';

export function MobileShell({ children }: { children: ReactNode }) {
  // MobileShell wraps <Outlet/> at the layout-route level, so this component
  // (and the scrollable div below) never unmounts as you navigate between
  // in-app screens -- only the routed children swap out. That means this
  // div's scrollTop was never reset by navigation on its own, which is why
  // scrolling partway down one screen and then navigating carried that same
  // scroll offset into the next screen instead of starting at the top.
  const scrollRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const { pathname } = location;
  const navigationType = useNavigationType();
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  // Which screen a scroll event belongs to (updated on render, before the new screen's scroll events).
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  useEffect(() => {
    registerShellScroller(scrollRef.current);
    return () => registerShellScroller(null);
  }, []);

  useEffect(() => {
    noteShellLocation(pathname, currentLeagueId);
    const el = scrollRef.current;
    if (!el) return;
    // Back, or a tab reopening a remembered screen (shellNav.ts), returns to where you were on that
    // screen. Everything else starts at the top. Default (omitted) behavior is 'auto', i.e. an
    // immediate jump -- not 'smooth' -- so this doesn't visibly animate on every navigation.
    const restore = navigationType === 'POP' || !!shellNavState(location.state).restoreScroll;
    const target = restore ? savedShellScroll(pathname) : 0;
    el.scrollTo({ top: target, left: 0 });
    if (target === 0) return;
    // The screen may still be filling in, so keep trying for a few frames until it is tall enough.
    let frames = 0;
    let raf = 0;
    const retry = () => {
      if (el.scrollTop >= target - 1 || ++frames > 20) return;
      el.scrollTo({ top: target, left: 0 });
      raf = requestAnimationFrame(retry);
    };
    raf = requestAnimationFrame(retry);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <div className="h-dvh bg-bg flex justify-center">
      <div className="w-full max-w-md h-dvh bg-bg relative flex flex-col border-x border-border">
        {/* Every screen's own header (LeagueHome, Lineup, MarketBrowser, NFLSlate,
         * SettingsHome, and the shared BackHeader used everywhere else) is
         * bg-bg-raised. This strip is sized to exactly the safe-area height and
         * uses that same color so it reads as one continuous bar with whatever
         * header sits right below it in the scroll content, instead of a gap of
         * the page's darker base color sitting between the header and the notch. */}
        {/* Tapping it scrolls to the top, like tapping the status bar in a native iOS app. */}
        <div className="shrink-0 bg-bg-raised" style={{ height: 'env(safe-area-inset-top)' }} onClick={scrollShellToTop} />
        {/* min-h-0 overrides flexbox's default min-height:auto on flex items,
         * which otherwise refuses to let this shrink below its own content's
         * height -- without it, this div (and everything above it, all the way
         * up to <html>) just grows to fit all the page's content instead of
         * clipping to the space actually left after the strip/tab bar, which
         * is what made <html> itself the thing scrolling instead of this div. */}
        {/* Bottom padding is derived from BOTTOM_TAB_BAR_HEIGHT (+16px clearance)
         * instead of a separately hardcoded value, so it can't drift out of sync
         * with the tab bar's actual height the way a fixed '5rem' silently did
         * the last time that height changed -- leaving 24px of now-pointless
         * extra space below the last scrolled item on every screen. */}
        <div
          ref={scrollRef}
          onScroll={(e) => saveShellScroll(pathRef.current, e.currentTarget.scrollTop)}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
          style={{ paddingBottom: `calc(${BOTTOM_TAB_BAR_HEIGHT + 16}px + env(safe-area-inset-bottom))` }}
        >
          {children}
        </div>
        <BottomTabBar />
      </div>
    </div>
  );
}