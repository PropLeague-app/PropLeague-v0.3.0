import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Reverse-domain bundle identifier. "com" reflects the real domain
  // (PropLeague.com), following the standard convention -- confirmed with
  // Hunter directly. This ties to the App ID registered in Phase 5 and is
  // meaningfully harder to change later than most settings here.
  appId: 'com.propleague.app',
  appName: 'PropLeague',
  webDir: 'dist',
};

export default config;