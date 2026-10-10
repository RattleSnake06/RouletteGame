import { act, createRun, grantTalisman } from '../../src/core/run.js';
import { EUROPEAN_ORDER } from '../../src/core/wheel.js';

/** Applies actions in order, failing on any rejection. Returns { state, events }. */
export function play(state, ...actions) {
  const events = [];
  for (const a of actions) {
    const r = act(state, a);
    const rejected = r.events.find((e) => e.type === 'rejected');
    if (rejected) throw new Error(`${a.type} rejected: ${rejected.reason}`);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

export const pocketOf = (n) => EUROPEAN_ORDER.indexOf(n);

/** A fresh run with these talismans on the rail (left to right) and chips placed. */
export function setup({ seed = 'TALISMAN-TEST', rail = [], chips = {}, coins = 100 } = {}) {
  let s = { ...createRun({ seed }), coins };
  for (const id of rail) s = grantTalisman(s, id);
  for (const [chipId, betId] of Object.entries(chips)) s = play(s, { type: 'placeChip', chipId, betId }).state;
  return s;
}

/** Spins once with the ball forced into the pocket holding `n`. */
export function spinOn(state, n) {
  let s = state;
  if (s.phase !== 'betting') s = play(s, { type: 'choosePackage', packageId: 'long' }).state;
  s = { ...s, foreseen: { pocketIndex: pocketOf(n), by: null } };
  return play(s, { type: 'spin' });
}

/** Deep-freezes plain data (Decimals excluded) to prove a function never mutates it. */
export function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o) && (Array.isArray(o) || Object.getPrototypeOf(o) === Object.prototype)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}
