import type { ReactNode } from 'react';
import { BottomTabBar } from './BottomTabBar';
import { DevPanel } from '../dev/DevPanel';

export function MobileShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg flex justify-center">
      <div className="w-full max-w-md min-h-screen bg-bg relative flex flex-col border-x border-border">
        <div className="flex-1 overflow-y-auto pb-20">{children}</div>
        <BottomTabBar />
        <DevPanel />
      </div>
    </div>
  );
}
