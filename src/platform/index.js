// Platform services: storage now, achievements and window control later.
// The web adapter uses localStorage. The desktop build (design doc 9.10)
// will install its own adapter on window.rnvpPlatform before the game boots,
// writing saves to the user-data folder that Steam Cloud syncs.

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
};

export const platform = (typeof window !== 'undefined' && window.rnvpPlatform) || webPlatform;

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
