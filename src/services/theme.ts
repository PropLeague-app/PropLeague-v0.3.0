// Local appearance (light/dark) setting -- see chat, Sept 2026, a tester request.
// The whole app already repaints from index.css's CSS variables the moment
// document.documentElement's data-theme attribute changes (no per-component work
// needed, see that file's header), so the only real job here is also keeping the
// iOS system status bar's text/icon color in sync -- that one piece genuinely can't
// be pure CSS, since it's the OS drawing over the top of the webview.
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import type { ThemeMode } from '../types';

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
export async function applyThemeMode(mode: ThemeMode): Promise<void> {
  document.documentElement.dataset.theme = mode;
  if (!Capacitor.isNativePlatform()) return;
  try {
    await StatusBar.setStyle({ style: mode === 'light' ? Style.Light : Style.Dark });
  } catch {
    // Best-effort -- a failed status bar style change shouldn't be able to break
    // app load, and there's nothing actionable to do about it here.
  }
}
