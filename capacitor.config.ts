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
    // Reverted from 'automatic' back to 'never' (the framework default).
    // 'automatic' maps to UIScrollView.contentInsetAdjustmentBehavior, which
    // makes the native webview's own top-level scroll view ALSO push its
    // content down by the safe-area amount -- on top of the
    // env(safe-area-inset-top/bottom) padding every screen already applies
    // in CSS (MobileShell, Welcome, and the rest of onboarding). With both
    // active at once, the safe area got applied twice, which is what
    // produced the oversized gap above the header and the extra empty space
    // below the last item in every scrollable screen. The real fix for
    // env(safe-area-inset-*) resolving to 0px was adding `viewport-fit=cover`
    // to the viewport meta tag in index.html -- that's what actually lets
    // the webview extend its layout viewport under the notch/dynamic island
    // and makes the CSS env() values resolve correctly. With that in place,
    // CSS alone should own 100% of the safe-area handling, so the native
    // scroll view should never also apply its own.
    contentInset: 'never',
  },
  // Matches --color-bg from index.css exactly. Without this, whatever's
  // natively behind the webview (white, by default) shows through in the
  // safe-area regions -- the "white bar" Hunter saw once content scrolled up
  // into that space.
  backgroundColor: '#141c29',
};

export default config;