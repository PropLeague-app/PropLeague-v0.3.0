import type { ReactNode } from 'react';
import { BottomTabBar } from './BottomTabBar';
import { DevPanel } from '../dev/DevPanel';

export function MobileShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg flex justify-center">
      <div className="w-full max-w-md min-h-screen bg-bg relative flex flex-col border-x border-border">
        {/* Top padding pushes every screen's own content (including their sticky
         * headers, since sticky positioning is relative to this scrolling
         * container) below the notch/Dynamic Island -- one shared fix here
         * instead of touching each screen's header individually. Bottom padding
         * keeps the original ~80px tab-bar clearance and adds the extra space
         * BottomTabBar now needs for the home indicator. */}
        <div
          className="flex-1 overflow-y-auto"
          style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
        >
          {children}
        </div>
        <BottomTabBar />
        <DevPanel />
      </div>
    </div>
  );
}
