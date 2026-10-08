// Small taps on the iPhone for the few moments that deserve one. Native only: in a browser, or on a
// build that does not include the plugin, every call does nothing and never throws.
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

function run(fn: () => Promise<void>): void {
  if (!Capacitor.isNativePlatform()) return;
  fn().catch(() => {});
}

export const haptic = {
  /** A light tap: choosing a chip, picking a reaction. */
  tap: () => run(() => Haptics.impact({ style: ImpactStyle.Light })),
  /** Something worked: a pick was added to the roster. */
  success: () => run(() => Haptics.notification({ type: NotificationType.Success })),
  /** Something was refused. */
  error: () => run(() => Haptics.notification({ type: NotificationType.Error })),
};
