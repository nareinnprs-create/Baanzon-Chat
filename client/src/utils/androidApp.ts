/** Detects the Play Store TWA (android-twa/, com.opraiz.baanzonchat).
 *
 *  The `android-app://` referrer appears only on the launch load, so the
 *  verdict is persisted in localStorage — the Play purchase gate must survive
 *  reloads and returns from the browser, when the referrer is gone. */
const ANDROID_APP_KEY = 'baanzon_android_app';
const ANDROID_PACKAGE = 'com.opraiz.baanzonchat';

export function detectAndroidApp() {
  if (typeof document === 'undefined') {
    return;
  }
  if (!document.referrer.startsWith(`android-app://${ANDROID_PACKAGE}`)) {
    return;
  }
  try {
    localStorage.setItem(ANDROID_APP_KEY, '1');
  } catch {
    // Private-mode storage: the per-load referrer check in callers still applies.
  }
}

export function isAndroidApp() {
  try {
    return localStorage.getItem(ANDROID_APP_KEY) === '1';
  } catch {
    return false;
  }
}
