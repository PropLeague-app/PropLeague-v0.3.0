import { create } from 'zustand';
import type { WeekId } from '../types';

/** Ephemeral, non-persisted UI state — deliberately separate from useAppStore (which
 * persists everything to localStorage) so this never gets written to disk or survives
 * a reload, which wouldn't make sense for "is there an unsaved edit on screen right
 * now". Currently just the identity-editor dirty flag (manual v0.1.1 §2 #4), read by
 * BottomTabBar to confirm before navigating away from an unsaved edit. */
interface UIState {
  hasUnsavedChanges: boolean;
  setHasUnsavedChanges: (value: boolean) => void;
  /** Void requests waiting on this commissioner in the current league. Drives the "!" on the
   * Profile tab, so a request does not sit unseen. Zero for everyone who is not the commissioner. */
  pendingVoidRequests: number;
  setPendingVoidRequests: (count: number) => void;
  /** The week picked on NFL Slate (null = the league's current week). Kept here so leaving the tab and
   * coming back keeps it; a tap on the NFL Slate tab while on it, or a relaunch, goes back to null. */
  slateWeek: WeekId | null;
  setSlateWeek: (week: WeekId | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  hasUnsavedChanges: false,
  setHasUnsavedChanges: (value) => set({ hasUnsavedChanges: value }),
  pendingVoidRequests: 0,
  setPendingVoidRequests: (count) => set({ pendingVoidRequests: count }),
  slateWeek: null,
  setSlateWeek: (week) => set({ slateWeek: week }),
}));
