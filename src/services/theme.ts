// Local appearance (light/dark) setting -- see chat, Sept 2026, a tester request.
// The whole app already repaints from index.css's CSS variables the moment
// document.documentElement's data-theme attribute changes (no per-component work
// needed, see that file's header), so the only real job here is also keeping the
// iOS system status bar's text/icon color in sync -- that one piece genuinely can't
// be pure CSS, since it's the OS drawing over the top of the webview.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import type { ResolvedTheme, ThemeMode } from '../types';

/**
 * Style.Dark = light-colored status bar text/icons, for a DARK app background.
 * Style.Light = dark-colored status bar text/icons, for a LIGHT app background.
 * (Confirmed directly against @capacitor/status-bar's own definitions.d.ts/README,
 * not assumed -- the naming is easy to get backwards since "Style.Dark" describes
 * the RESULTING TEXT color, not which theme it's meant for.)
 *
 * Gated on Capacitor.isNativePlatform() the same way pushNotifications.ts gates
 * every native-only call -- StatusBar has no real status bar to control in a
 * desktop browser (`npm run dev`), and this runs on every theme change/app load,
 * so it needs to no-op cleanly there rather than throw.
 */
export function systemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return true;
  }
}

/** 'auto' becomes light or the gray Dark theme from the phone's appearance; anything else is itself. */
export function resolveTheme(mode: ThemeMode, systemDark: boolean = systemPrefersDark()): ResolvedTheme {
  return mode === 'auto' ? (systemDark ? 'graphite' : 'light') : mode;
}

/** The native side (ios/App/App/PropLeagueBridgeViewController.swift): the view behind the web page and the keyboard. */
interface AppearancePlugin {
  set(options: { background: string; style: 'dark' | 'light' | 'auto' }): Promise<void>;
}
const Appearance = registerPlugin<AppearancePlugin>('Appearance');

/** Fallbacks for --color-bg, only used if the computed value can't be read. */
const NATIVE_BG: Record<ResolvedTheme, string> = { dark: '#141c29', graphite: '#0e0e10', light: '#e3e9f1' };

export async function applyThemeMode(chosen: ThemeMode): Promise<void> {
  // For 'auto' the phone has to be told to follow itself again BEFORE its setting is read, otherwise a
  // previously forced light/dark would keep answering the media query.
  if (Capacitor.isNativePlatform() && chosen === 'auto') {
    try {
      await Appearance.set({ background: NATIVE_BG.graphite, style: 'auto' });
    } catch {
      /* best-effort */
    }
  }
  const mode = resolveTheme(chosen);
  document.documentElement.dataset.theme = mode;
  if (!Capacitor.isNativePlatform()) return;
  try {
    // The view behind the page and the keyboard take the theme too, so nothing native shows the launch navy.
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim() || NATIVE_BG[mode];
    await Appearance.set({ background: bg, style: chosen === 'auto' ? 'auto' : mode === 'light' ? 'light' : 'dark' });
  } catch {
    // Older native build without the plugin, or a failed call: nothing to do.
  }
  try {
    await StatusBar.setStyle({ style: mode === 'light' ? Style.Light : Style.Dark });
  } catch {
    // Best-effort -- a failed status bar style change shouldn't be able to break
    // app load, and there's nothing actionable to do about it here.
  }
}
