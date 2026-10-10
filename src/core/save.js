import { emptyCabinet, restockSlots } from './cabinet.js';
import { getTalisman } from './content/index.js';
import { ECONOMY, PACKAGES, sellValueOf } from './economy.js';
import { decimalText, isBig, num } from './num.js';
import { newStats } from './run.js';
import { emptyTally } from './tally.js';

// Runs save as versioned JSON. Big money values are stored as { $d: "1.2e500" };
// everything else in the run state is plain data.

export const SAVE_VERSION = 2;

export function serializeRun(state) {
  // JSON.stringify calls Decimal#toJSON before the replacer sees the value,
  // so read the original from the parent object instead.
  return JSON.stringify({ v: SAVE_VERSION, state }, function replacer(key, value) {
    const original = this[key];
    // Mantissa and exponent, not toString: below 1e21 that prints plain
    // digits, which re-parse inexactly and would change a reloaded run.
    return isBig(original) ? { $d: decimalText(original) } : value;
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
  if (!data || !Number.isInteger(data.v) || data.v < 1 || data.v > SAVE_VERSION || !data.state) return null;
  // A save that parses but has the wrong shape (hand-edited, or from a dev
  // build) starts a new run instead of breaking every launch.
  try {
    let state = data.state;
    for (let v = data.v; v < SAVE_VERSION; v++) state = MIGRATIONS[v](state);
    if (!Array.isArray(state.chips) || !Array.isArray(state.rail) || !Array.isArray(state.cabinet?.slots)) return null;
    return tidy(state);
  } catch {
    return null;
  }
}

/** Step v -> v + 1. */
const MIGRATIONS = {
  // Phase 2: talismans, the Curio Cabinet and the Bell.
  1(state) {
    if (state.spinsTonight === undefined) {
      // The night's allowance: the smallest night that fits the spins still left.
      // Past the betting phase it cannot be known, so it stays unknown (null).
      const fits = Object.values(PACKAGES)
        .map((p) => p.spins)
        .filter((n) => n > 0 && n >= state.spinsLeft);
      state.spinsTonight = state.phase === 'betting' && fits.length ? Math.min(...fits) : null;
    }
    const s = {
      ...state,
      version: 2,
      chips: state.chips.map((c) => ({ ...c, roundValue: c.roundValue ?? 0 })),
      railHooks: ECONOMY.startHooks,
      rail: [],
      nextUid: 1,
      cabinet: emptyCabinet(),
      foreseen: null,
      armed: { rethrow: null },
      // The debt's tally cannot be rebuilt from a history that spans debts.
      tally: emptyTally(),
      stats: { ...newStats(), ...state.stats },
    };
    if (s.phase !== 'gameOver') restockSlots(s);
    return s;
  },
};

/**
 * Every load: talismans the game no longer knows are refunded and dropped, and
 * Cabinet offers of them are marked sold, so a content change never breaks a
 * saved run.
 */
function tidy(state) {
  const unknown = state.rail.filter((t) => !getTalisman(t.id));
  const staleOffer = (x) => x.kind === 'talisman' && x.id && !getTalisman(x.id);
  const stale = state.cabinet.slots.some(staleOffer);
  if (!unknown.length && !stale) return state;
  const refund = unknown.reduce((sum, t) => sum + sellValueOf(t.price ?? 2), 0);
  return {
    ...state,
    rail: state.rail.filter((t) => getTalisman(t.id)),
    tokens: state.tokens + refund,
    cabinet: { ...state.cabinet, slots: state.cabinet.slots.map((x) => (staleOffer(x) ? { kind: 'talisman', id: null, sold: true } : x)) },
  };
}
