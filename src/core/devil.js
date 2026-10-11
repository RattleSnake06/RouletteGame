import { sources, srcRef } from './effects.js';
import { Rng } from './rng.js';

// The Devil (design doc 5.7). The wheel's numbers sum to 666. Once the second
// debt is paid the Devil is live: every throw it may fire, after Nudge and
// beyond its reach, and take every coin in hand. Deposits are safe.

export const DEVIL = {
  liveFrom: 3, // the debt after the second is paid
  base: 0.015,
  perDebt: 0.005,
  cap: 0.25,
};

export const devilLive = (state) => state.debt >= DEVIL.liveFrom;

const round6 = (x) => Math.round(x * 1e6) / 1e6;

/**
 * The Devil's chance on the next throw, 0 before it is live. Talismans adjust
 * it in rail order (`devilChance` hooks: add, then the next one's multiplier
 * applies to the running total), capped at 25%. Pure; with `emit`, each
 * adjustment emits a `trigger`.
 */
export function devilChanceFor(state, emit = null) {
  if (!devilLive(state)) return 0;
  let chance = DEVIL.base + DEVIL.perDebt * (state.debt - DEVIL.liveFrom);
  for (const src of sources(state)) {
    const fn = src.as.hooks?.devilChance;
    if (!fn) continue;
    const trigger = (effect, amount) => emit?.({ type: 'trigger', src: srcRef(src), hook: 'devilChance', effect, amount });
    fn({
      state,
      self: src.self,
      addChance(p) {
        chance = round6(chance + p);
        trigger('devil', p);
      },
      mulChance(x) {
        chance = round6(chance * x);
        trigger('devilMult', x);
      },
    });
  }
  return Math.min(DEVIL.cap, Math.max(0, chance));
}

/** Rolls one throw on the draft's devil stream. Draws nothing when the chance is 0. */
export function rollDevil(draft, chance) {
  if (chance <= 0) return false;
  const rng = new Rng(draft.rng.devil);
  const fired = rng.chance(chance);
  draft.rng.devil = rng.state();
  return fired;
}
