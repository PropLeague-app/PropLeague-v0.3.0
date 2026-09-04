import type { ReactNode } from 'react';
import { BottomTabBar } from './BottomTabBar';
import { DevPanel } from '../dev/DevPanel';

export function MobileShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg flex justify-center">
      {/* Padding lives on this OUTER, non-scrolling wrapper -- not on the inner
       * overflow-y-auto div below. Moved here after the safe-area padding
       * didn't visually apply when it was on the nested scrolling container:
       * onboarding's screens (confirmed working) all put this padding on a
       * plain, non-scrolling div, and there's a known class of WebKit quirk
       * where env(safe-area-inset-*) doesn't reliably resolve the same way
       * inside a nested overflow-y-auto context as it does at this level. */}
      <div
        className="w-full max-w-md min-h-screen bg-bg relative flex flex-col border-x border-border"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="flex-1 overflow-y-auto" style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom))' }}>
          {children}
        </div>
        <BottomTabBar />
        <DevPanel />
      </div>
    </div>
  );
}