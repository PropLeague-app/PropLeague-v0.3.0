import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Reverse-domain bundle identifier. "com" reflects the real domain
  // (PropLeague.com), following the standard convention -- confirmed with
  // Hunter directly. This ties to the App ID registered in Phase 5 and is
  // meaningfully harder to change later than most settings here.
  appId: 'com.propleague.app',
  appName: 'PropLeague',
  webDir: 'dist',
  ios: {
    // This is the actual root cause of the top/bottom clipping that two
    // rounds of CSS-only fixes failed to solve. Capacitor's iOS webview maps
    // this directly to UIScrollView.contentInsetAdjustmentBehavior, and its
    // DEFAULT VALUE IS "never" -- meaning the webview was never adjusting for
    // the safe area at the native level at all, which is exactly why
    // env(safe-area-inset-top) was verified (via Web Inspector) to resolve to
    // 0px no matter where the CSS padding was placed. No CSS change was ever
    // going to fix this; it needed to happen here.
    contentInset: 'automatic',
  },
  // Matches --color-bg from index.css exactly. Without this, whatever's
  // natively behind the webview (white, by default) shows through in the
  // safe-area regions -- the "white bar" Hunter saw once content scrolled up
  // into that space.
  backgroundColor: '#141c29',
};

export default config;