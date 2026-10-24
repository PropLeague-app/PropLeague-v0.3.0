import type { MouseEvent } from 'react';

// Navigation memory for the app shell. Kept in plain module memory on purpose: it lasts while the app
// is running and starts fresh when the app is quit or reloaded.

/** Router state a tab tap attaches when it reopens a remembered screen. */
export interface ShellNavState {
  /** Put the scroll position back where it was instead of starting at the top. */
  restoreScroll?: boolean;
  /** The screen was reopened from the tab bar, so its Back goes to its parent, not to the last tab. */
  fromTab?: boolean;
}

export function shellNavState(state: unknown): ShellNavState {
  return state && typeof state === 'object' ? (state as ShellNavState) : {};
}

// ---- The one scroll container (MobileShell) ----

let scroller: HTMLElement | null = null;
const scrollByPath = new Map<string, number>();

export function registerShellScroller(el: HTMLElement | null) {
  scroller = el;
}

export function scrollShellToTop() {
  scroller?.scrollTo({ top: 0, behavior: 'smooth' });
}

export function saveShellScroll(path: string, top: number) {
  scrollByPath.set(path, top);
}

export function savedShellScroll(path: string): number {
  return scrollByPath.get(path) ?? 0;
}

/** For a screen header: a tap on the header itself (not one of its buttons or controls) scrolls back
 * to the top, the way Instagram and most iOS apps do. */
export function headerTapToTop(e: MouseEvent) {
  if ((e.target as Element).closest('button, a, input, select, textarea, [role="tab"]')) return;
  scrollShellToTop();
}

// ---- Which screen each tab reopens to ----

/** The tabs that remember where you were. NFL Slate remembers an open game; League Home remembers an
 * open matchup (for the league it belongs to). */
type MemoryTab = '/slate' | '/home';

let slateLast = '/slate';
let homeLast: { path: string; leagueId: string | null } = { path: '/home', leagueId: null };

export function inTabSection(tab: string, path: string): boolean {
  if (tab === '/slate') return path === '/slate' || path.startsWith('/slate/');
  if (tab === '/home') return path === '/home' || path.startsWith('/matchup/');
  // Settings belongs to the Profile tab: it is reached from the gear on your own profile and has no
  // tab of its own, so the tab you came in on has to stay lit while you are in there, or the tab bar
  // shows nothing selected and Back has no obvious partner (see chat, Oct 2026).
  if (tab === '/profile') return path === '/profile' || path.startsWith('/profile/') || path === '/settings' || path.startsWith('/settings/');
  return path === tab || path.startsWith(`${tab}/`);
}

// Where the last route change came from. A matchup counts as League Home's memory only when you
// actually walked there from League Home: the same matchup opened from a profile is a detour, and
// recording it sent the League Home tab somewhere its own screen never went (see chat, Oct 2026).
let cameFrom = '/home';

/** Called on every route change inside the shell. */
export function noteShellLocation(path: string, leagueId: string | null) {
  if (inTabSection('/slate', path)) slateLast = path;
  else if (path === '/home') homeLast = { path, leagueId };
  else if (path.startsWith('/matchup/') && inTabSection('/home', cameFrom)) homeLast = { path, leagueId };
  cameFrom = path;
}

/** Where a tab tap should go when you are not already in that tab. */
export function tabReopenPath(tab: MemoryTab, leagueId: string | null): string {
  if (tab === '/slate') return slateLast;
  return homeLast.leagueId === leagueId ? homeLast.path : '/home';
}

/** Back to a tab's default view (a tap on the tab you are already in). */
export function resetTabMemory(tab: MemoryTab) {
  if (tab === '/slate') slateLast = '/slate';
  else homeLast = { path: '/home', leagueId: homeLast.leagueId };
}

export function isMemoryTab(tab: string): tab is MemoryTab {
  return tab === '/slate' || tab === '/home';
}
