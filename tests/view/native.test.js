import { beforeEach, describe, expect, it, vi } from 'vitest';

// The phone app's platform (doc 9.10): Capacitor's plugins, mocked here, as
// the native adapter uses them.

const store = new Map();
const listeners = {};
const calls = [];
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    keys: async () => ({ keys: [...store.keys()] }),
    get: async ({ key }) => ({ value: store.has(key) ? store.get(key) : null }),
    set: async ({ key, value }) => void store.set(key, value),
    remove: async ({ key }) => void store.delete(key),
  },
}));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (name, fn) => void (listeners[name] = fn),
    minimizeApp: async () => void calls.push('minimize'),
  },
}));
vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact: async ({ style }) => void calls.push(`impact:${style}`) },
  ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'android' },
  SystemBars: { hide: async () => void calls.push('hideBars') },
}));

const { createNativePlatform } = await import('../../src/platform/native.js');

describe('the phone app platform', () => {
  beforeEach(() => {
    store.clear();
    calls.length = 0;
  });

  it('reads every save before the game boots, then answers at once', async () => {
    store.set('profile', '{"v":2}');
    store.set('run', '{"debt":3}');
    const p = await createNativePlatform();
    expect(p.name).toBe('android');
    expect(p.native).toBe(true);
    expect(p.load('profile')).toBe('{"v":2}');
    expect(p.load('run')).toBe('{"debt":3}');
    expect(p.load('settings')).toBe(null);
  });

  it('keeps a save in memory at once and in the phone storage behind it', async () => {
    const p = await createNativePlatform();
    p.save('run', 'a');
    expect(p.load('run')).toBe('a');
    await Promise.resolve();
    expect(store.get('run')).toBe('a');
    p.remove('run');
    expect(p.load('run')).toBe(null);
    await Promise.resolve();
    expect(store.has('run')).toBe(false);
  });

  it('sends the app to the background only when the game has nothing to go back to', async () => {
    const p = await createNativePlatform();
    let handled = true;
    p.onBack(() => handled);
    listeners.backButton();
    await Promise.resolve();
    expect(calls).toEqual([]);
    handled = false;
    listeners.backButton();
    await Promise.resolve();
    expect(calls).toEqual(['minimize']);
  });

  it('pauses with the app, and hides the system bars again on its return', async () => {
    const p = await createNativePlatform();
    const seen = [];
    p.onPause(() => seen.push('pause'));
    p.onResume(() => seen.push('resume'));
    listeners.pause();
    listeners.resume();
    expect(seen).toEqual(['pause', 'resume']);
    expect(calls).toContain('hideBars');
  });

  it('buzzes lightly by default', async () => {
    const p = await createNativePlatform();
    p.haptic();
    p.haptic('medium');
    expect(calls).toEqual(['impact:LIGHT', 'impact:MEDIUM']);
  });
});
