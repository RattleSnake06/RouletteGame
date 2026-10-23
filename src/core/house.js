import { getStartingWheel } from './content/index.js';
import { ECONOMY } from './economy.js';
import { DOUBLE_ZERO, createWheel, isBlank } from './wheel.js';

// What a run's starting wheel and House Edge level change (design doc 7.2,
// decision 29). A run keeps both from its start; these read them.
//
// House Edge levels stack: 1 the House's pocket, 2 the Devil from debt 2,
// 3 no token at the end of a night, 4 debts ×1.25, 5 every Lean 1 weaker.

export const EDGE_RULES = { devilFrom: 2, debtMult: 1.25, leanCut: 1 };

const edgeAt = (state, level) => (state.edge ?? 0) >= level;

/**
 * The run's wheel at its start: the starting wheel's order, its gilded or
 * Bone pockets, and the House's pocket across from the zero at House Edge 1.
 * Gilded pockets are drawn on `rng` (the pockets stream); no other wheel draws.
 */
export function startingWheel(wheelId, edge, rng) {
  const def = getStartingWheel(wheelId);
  const wheel = createWheel(def.order);
  if (def.boneBlacks) for (const p of wheel.pockets) if (p.color === 'black') p.enh = 'bone';
  if (def.gilded) {
    const free = wheel.pockets.filter((p) => p.color === 'red' || p.color === 'black');
    for (let i = 0; i < def.gilded && free.length; i++) free.splice(rng.int(free.length), 1)[0].enh = 'gilded';
  }
  if (edge >= 1) {
    const house = { id: `p${wheel.nextId}`, number: null, color: 'green', width: 1, enh: 'house' };
    wheel.nextId += 1;
    wheel.pockets.splice(Math.ceil(wheel.pockets.length / 2), 0, house);
  }
  return wheel;
}

/** How much more every debt owes: the starting wheel's, then House Edge 4's. */
export const debtMultiplier = (state) => getStartingWheel(state.wheelId).debtMult * (edgeAt(state, 4) ? EDGE_RULES.debtMult : 1);

/** The tokens the Cage pays at the end of a night. */
export const nightTokensFor = (state) => Math.max(0, ECONOMY.nightTokens + getStartingWheel(state.wheelId).nightTokens - (edgeAt(state, 3) ? 1 : 0));

/** The debt the Devil wakes at: the doc's debt 3, sooner on the Bone wheel or at House Edge 2. */
export function devilFrom(state, base) {
  let from = base;
  const wheel = getStartingWheel(state.wheelId);
  if (wheel.devilFrom) from = Math.min(from, wheel.devilFrom);
  if (edgeAt(state, 2)) from = Math.min(from, EDGE_RULES.devilFrom);
  return from;
}

/** A Lean as the House plays it: 1 weaker at House Edge 5, but never gone. */
export const leanAfterEdge = (state, strength) => (strength > 0 && edgeAt(state, 5) ? Math.max(1, strength - EDGE_RULES.leanCut) : strength);

/** Does this run's wheel have a 00 (the American)? Then the felt and wheel work know number 37. */
export const hasDoubleZero = (state) => getStartingWheel(state.wheelId).order.includes(DOUBLE_ZERO);

/** How many numbers the felt shows: 0–36, and 00 on the American wheel. */
export const numberCount = (state) => (hasDoubleZero(state) ? 38 : 37);

/** Pockets no wheel work may touch: the House's own. */
export const untouchable = (pocket) => pocket.enh === 'house' && isBlank(pocket);
