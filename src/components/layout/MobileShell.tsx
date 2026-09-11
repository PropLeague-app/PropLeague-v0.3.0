import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { BottomTabBar } from './BottomTabBar';

export function MobileShell({ children }: { children: ReactNode }) {
  // MobileShell wraps <Outlet/> at the layout-route level, so this component
  // (and the scrollable div below) never unmounts as you navigate between
  // in-app screens -- only the routed children swap out. That means this
  // div's scrollTop was never reset by navigation on its own, which is why
  // scrolling partway down one screen and then navigating carried that same
  // scroll offset into the next screen instead of starting at the top.
  const scrollRef = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();

  useEffect(() => {
    // Default (omitted) behavior is 'auto', i.e. an immediate jump -- not
    // 'smooth' -- so this doesn't visibly animate on every navigation.
    scrollRef.current?.scrollTo({ top: 0, left: 0 });
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
        <div className="shrink-0 bg-bg-raised" style={{ height: 'env(safe-area-inset-top)' }} />
        {/* min-h-0 overrides flexbox's default min-height:auto on flex items,
         * which otherwise refuses to let this shrink below its own content's
         * height -- without it, this div (and everything above it, all the way
         * up to <html>) just grows to fit all the page's content instead of
         * clipping to the space actually left after the strip/tab bar, which
         * is what made <html> itself the thing scrolling instead of this div. */}
        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
          style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
        >
          {children}
        </div>
        <BottomTabBar />
      </div>
    </div>
  );
}