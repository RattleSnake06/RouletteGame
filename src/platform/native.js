import { App } from '@capacitor/app';
import { Capacitor, SystemBars } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Preferences } from '@capacitor/preferences';

// The phone build's platform (design doc 9.10, M3), on Capacitor: saves in
// the phone's own storage, the system back button, the app going to the
// background and coming back, and haptics. Only the phone build loads this
// file (platform/index.js), so the web build never carries the plugins.
//
// The plugins answer asynchronously while the game reads its saves
// synchronously, so every save is read into memory before the game boots;
// a save then goes to memory at once and to storage behind it.

const STYLE = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy };

/** The phone's platform, its saves already read. */
export async function createNativePlatform() {
  const cache = new Map();
  const { keys } = await Preferences.keys();
  for (const key of keys) {
    const { value } = await Preferences.get({ key });
    if (value !== null) cache.set(key, value);
  }
  return {
    name: Capacitor.getPlatform(),
    native: true,
    haptics: true,
    load: (key) => (cache.has(key) ? cache.get(key) : null),
    save(key, value) {
      cache.set(key, value);
      Preferences.set({ key, value }).catch(() => {});
      return true;
    },
    remove(key) {
      cache.delete(key);
      Preferences.remove({ key }).catch(() => {});
    },
    unlockAchievement() {},
    /** The system back button: `fn` returns false when the game has nothing to go back to, and the app goes to the background. */
    onBack(fn) {
      App.addListener('backButton', () => {
        if (!fn()) App.minimizeApp().catch(() => {});
      });
    },
    onPause(fn) {
      App.addListener('pause', fn);
    },
    /** Back from the background: the system bars come back with a swipe, so they are hidden again. */
    onResume(fn) {
      App.addListener('resume', () => {
        SystemBars.hide().catch(() => {});
        fn();
      });
    },
    haptic(kind = 'light') {
      Haptics.impact({ style: STYLE[kind] ?? ImpactStyle.Light }).catch(() => {});
    },
  };
}
