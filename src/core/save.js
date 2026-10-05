import { isBig, num } from './num.js';

// Runs save as versioned JSON. Big money values are stored as { $d: "1.2e500" };
// everything else in the run state is plain data.

export const SAVE_VERSION = 1;

export function serializeRun(state) {
  // JSON.stringify calls Decimal#toJSON before the replacer sees the value,
  // so read the original from the parent object instead.
  return JSON.stringify({ v: SAVE_VERSION, state }, function replacer(key, value) {
    const original = this[key];
    return isBig(original) ? { $d: original.toString() } : value;
  });
}

/** Returns the run state, or null if the save is unreadable or from another version. */
export function deserializeRun(json) {
  let data;
  try {
    data = JSON.parse(json, (key, value) =>
      value && typeof value === 'object' && typeof value.$d === 'string' && Object.keys(value).length === 1
        ? num(value.$d)
        : value,
    );
  } catch {
    return null;
  }
  if (!data || data.v !== SAVE_VERSION || !data.state) return null;
  return data.state;
}
