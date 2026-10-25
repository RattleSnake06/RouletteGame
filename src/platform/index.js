// Platform services: storage, the back button, the app's pauses and haptics
// now, achievements and window control later. The web adapter uses
// localStorage. The phone build (Capacitor, design doc 9.10) swaps in
// platform/native.js when the game boots (ready()); the desktop build
// (Electron) will install its own adapter on window.rnvpPlatform.

const PREFIX = 'rien-ne-va-plus.';

const webPlatform = {
  name: 'web',
  load(key) {
    try {
      return localStorage.getItem(PREFIX + key);
    } catch {
      return null;
    }
  },
  save(key, value) {
    try {
      localStorage.setItem(PREFIX + key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      // Storage blocked: nothing to remove.
    }
  },
  unlockAchievement() {},
  /**
   * The system back button or gesture (Android). On the web it is the
   * browser's back: a history entry held in hand turns it into a call, so it
   * pauses the game instead of leaving the page. Only on touch screens: a
   * desktop browser's back button should still leave.
   */
  onBack(fn) {
    if (typeof window === 'undefined' || !window.matchMedia?.('(pointer: coarse)').matches) return;
    history.pushState({ rnvp: true }, '');
    window.addEventListener('popstate', () => {
      history.pushState({ rnvp: true }, '');
      fn();
    });
  },
};

export const platform = (typeof window !== 'undefined' && window.rnvpPlatform) || webPlatform;

/** Inside the phone app: Capacitor's native bridge is there before any script runs. */
const isNativeApp = () => typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();

/**
 * Called once before the game reads a save. In the phone app it loads the
 * native adapter, with every save read into memory, in place of the web one.
 */
platform.ready = async function ready() {
  if (!isNativeApp()) return;
  const { createNativePlatform } = await import('./native.js');
  Object.assign(platform, await createNativePlatform());
};

export function loadSettings(defaults) {
  try {
    return { ...defaults, ...JSON.parse(platform.load('settings') || '{}') };
  } catch {
    return { ...defaults };
  }
}

export function saveSettings(settings) {
  platform.save('settings', JSON.stringify(settings));
}
