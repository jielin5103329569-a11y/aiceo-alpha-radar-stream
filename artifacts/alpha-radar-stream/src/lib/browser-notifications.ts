/**
 * Browser-notification capability detection and dispatch helpers.
 *
 * These are VERIFICATION-ONLY helpers – they never claim a trading signal
 * is enabled or send trading instructions. Callers are responsible for
 * passing correct push-enabled state; this module never fabricates it.
 */

/** All feature-detection outcomes for the Notifications API. */
export type NotificationSupportStatus =
  | 'unsupported'          // Notifications API absent
  | 'ios-pwa-required'     // iOS Safari needs Add to Home Screen first
  | 'blocked'              // User explicitly denied
  | 'granted'              // User has granted permission
  | 'default';             // Not yet asked

/**
 * Detect iPhone Safari without PWA wrapper.
 * On iOS < 16.4 (and sometimes later) Notification is only available
 * inside a standalone PWA installed via "Add to Home Screen".
 */
function isIosSafariNonPwa(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua);
  if (!isIos) return false;
  // navigator.standalone is true when running in a home-screen PWA
  const standalone = (window.navigator as { standalone?: boolean }).standalone;
  return standalone !== true;
}

/**
 * Synchronously determine the current notification support status.
 * Never makes a permission request; safe to call at render time.
 */
export function getNotificationSupportStatus(): NotificationSupportStatus {
  if (typeof window === 'undefined') return 'unsupported';

  // iOS Safari outside PWA: Notification may be undefined or non-functional
  if (isIosSafariNonPwa()) return 'ios-pwa-required';

  if (!('Notification' in window)) return 'unsupported';

  const perm = Notification.permission;
  if (perm === 'granted') return 'granted';
  if (perm === 'denied') return 'blocked';
  return 'default';
}

/**
 * Request notification permission. Returns the resolved status.
 * Only call this in response to a direct user gesture.
 */
export async function requestNotificationPermission(): Promise<NotificationSupportStatus> {
  if (!('Notification' in window)) return 'unsupported';
  if (isIosSafariNonPwa()) return 'ios-pwa-required';

  const result = await Notification.requestPermission();
  if (result === 'granted') return 'granted';
  if (result === 'denied') return 'blocked';
  return 'default';
}

/**
 * Fire a test browser notification.
 * Only works when permission is 'granted'. Safe to call otherwise (no-op).
 */
export function fireTestNotification(): void {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  // eslint-disable-next-line no-new
  new Notification('Alpha Radar – Test Alert', {
    body: 'Verification-only: browser notifications are active. This is not a trading instruction.',
    icon: '/favicon.ico',
    tag: 'alpha-radar-test',
  });
}
