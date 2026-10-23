import { emptyCabinet, restockSlots } from './cabinet.js';
import { getEngraving, getFortune, getRecord, getTalisman } from './content/index.js';
import { ECONOMY, PACKAGES, sellValueOf } from './economy.js';
import { decimalText, isBig, num } from './num.js';
import { newStats } from './run.js';
import { rollDebtLeans } from './nudge.js';
import { seedStreams } from './rng.js';
import { emptyTally } from './tally.js';

// Runs save as versioned JSON. Big money values are stored as { $d: "1.2e500" };
// everything else in the run state is plain data.

export const SAVE_VERSION = 6;

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
    if (!wellFormed(state)) return null;
    return tidy(state);
  } catch {
    return null;
  }
}

/** The fields every phase of the game reads without checking. */
function wellFormed(state) {
  return (
    Array.isArray(state.chips) &&
    Array.isArray(state.rail) &&
    Array.isArray(state.cabinet?.slots) &&
    Array.isArray(state.wheel?.pockets) &&
    !!state.tally?.debt &&
    !!state.tally?.round &&
    Array.isArray(state.leans?.debt) &&
    !!state.devil &&
    Number.isInteger(state.debtSpins) &&
    Number.isInteger(state.missStreak)
  );
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
      // With 3 spins or fewer left it could be a short night or the end of a
      // long one: rules that count spins of the night stay off until the next night.
      if (state.phase === 'betting' && state.spinsLeft <= 3) state.spinsTonightGuessed = true;
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
  // Phase 3: Nudge, the Lean, pity and the Devil.
  2(state) {
    const s = {
      ...state,
      version: 3,
      // Only debt 1's Leans count spins of the debt, and every spin so far was in it.
      debtSpins: state.debt === 1 ? state.stats.spins : 0,
      leans: { debt: [], night: null },
      missStreak: 0,
      devil: { firedThisDebt: false },
      stats: { ...newStats(), ...state.stats },
    };
    // Debt 1 keeps its teaching Leans; tonight's Lean of a later debt, never rolled, is skipped.
    if (s.debt === 1) s.leans.debt = rollDebtLeans(s);
    return s;
  },
  // Phase 4: Madame Zero, the gramophone and engravings. Nothing taken or
  // played yet; offers rolled before keep no engraving.
  3(state) {
    return {
      ...state,
      version: 4,
      oracle: null,
      picks: {},
      boons: [],
      nextBoonUid: 1,
      records: [],
      playing: null,
      recordData: {},
      overture: null,
      cabinet: { ...state.cabinet, discount: 0, freeBuys: 0 },
      rail: state.rail.map((t) => ({ ...t, engraving: t.engraving ?? null })),
    };
  },
  // Chip sets (decision 26): a run before them played the plain chip, which
  // was stored as 'clay'; Clay is now a material of its own.
  4(state) {
    return {
      ...state,
      version: 5,
      chipSet: 'normal',
      chips: state.chips.map((c) => ({ ...c, material: c.material === 'clay' ? 'normal' : c.material })),
      fixed: [],
      chipTokens: 0,
    };
  },
  // Phase 5's wheel work: pockets get ids and enhancements, the oddity
  // compartment opens at the next restock, and a stream for shattering glass.
  5(state) {
    // Every wheel before them was the European one, one pocket per number.
    const pockets = state.wheel.pockets.map((p) => ({ id: `p${p.number}`, ...p, enh: p.enh ?? null }));
    const foreseen = state.foreseen && { ...state.foreseen, pocketId: pockets[state.foreseen.pocketIndex]?.id ?? null };
    const slots = state.cabinet.slots.map((x) => (x.kind === 'oddity' ? { kind: 'oddity', id: null, sold: true } : x));
    return {
      ...state,
      version: 6,
      wheel: { ...state.wheel, pockets, nextId: pockets.length },
      foreseen,
      luckyNudge: 0,
      devil: { ...state.devil, nightCurse: 0 },
      cabinet: { ...state.cabinet, slots },
      rng: { ...state.rng, pockets: seedStreams(state.seed).pockets },
    };
  },
};

/**
 * Every load: talismans the game no longer knows are refunded and dropped, and
 * Cabinet offers of them are marked sold, so a content change never breaks a
 * saved run. Records, lasting fortunes and engravings it no longer knows are
 * dropped too.
 */
function tidy(state) {
  // Stats added since the save was made start at zero.
  if (Object.keys(newStats()).some((k) => state.stats?.[k] === undefined)) state = { ...state, stats: { ...newStats(), ...state.stats } };
  if (state.records.some((id) => !getRecord(id)) || state.boons.some((b) => !getFortune(b.id)) || state.rail.some((t) => t.engraving && !getEngraving(t.engraving))) {
    state = {
      ...state,
      records: state.records.filter((id) => getRecord(id)),
      playing: getRecord(state.playing) ? state.playing : null,
      boons: state.boons.filter((b) => getFortune(b.id)),
      rail: state.rail.map((t) => (t.engraving && !getEngraving(t.engraving) ? { ...t, engraving: null } : t)),
    };
  }
  // A deal on her counter keeps the cards it still knows; a taken card that
  // is gone leaves the deal taken (-1), with nothing marked.
  const deal = state.oracle;
  if (deal?.cards.some((id) => !getFortune(id))) {
    const cards = deal.cards.filter((id) => getFortune(id));
    const taken = deal.taken === null ? null : cards.indexOf(deal.cards[deal.taken]);
    state = { ...state, oracle: { ...deal, cards, taken } };
  }
  const unknown = state.rail.filter((t) => !getTalisman(t.id));
  const staleOffer = (x) => x.kind === 'talisman' && x.id && !getTalisman(x.id);
  const stale = state.cabinet.slots.some(staleOffer);
  if (!unknown.length && !stale) return state;
  // A talisman hung for nothing (a cursed one) refunds nothing.
  const refund = unknown.reduce((sum, t) => sum + (t.price === 0 ? 0 : sellValueOf(t.price ?? 2)), 0);
  return {
    ...state,
    rail: state.rail.filter((t) => getTalisman(t.id)),
    tokens: state.tokens + refund,
    cabinet: { ...state.cabinet, slots: state.cabinet.slots.map((x) => (staleOffer(x) ? { kind: 'talisman', id: null, sold: true } : x)) },
  };
}
