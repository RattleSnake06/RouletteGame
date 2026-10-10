import { getTalisman } from './content/index.js';
import { srcRef } from './effects.js';
import { add } from './num.js';
import { Rng } from './rng.js';
import { drawPocket } from './wheel.js';

// The Bell (doc 5.8): a brass service bell that wakes active talismans. One
// ring wakes one talisman, the leftmost that can answer. Ringing at a
// talisman's tag wakes that one. Some actives (the Piggy Bank) only answer a
// ring aimed at them, because what they do cannot be undone.

const actingSource = (inst) => {
  const def = getTalisman(inst.id);
  return { inst, def, as: def, self: inst.data };
};

function bellCtx(state, inst) {
  return { state, self: inst.data, charges: inst.charges ?? 0, inst };
}

/** Can this rail instance answer the Bell right now? */
export function canAnswer(state, inst) {
  const def = getTalisman(inst.id);
  return !!def?.bell && def.bell.usable(bellCtx(state, inst));
}

/** Who a plain ring would wake, in order. */
export function bellQueue(state) {
  return state.rail.filter((inst) => !getTalisman(inst.id)?.bell?.targetOnly && canAnswer(state, inst)).map((t) => t.uid);
}

/**
 * Rings the Bell on a draft. With `uid`, wakes that talisman; without, the
 * head of the queue. Returns the uid that answered, or null.
 */
export function ringBell(draft, uid, emit) {
  const target = uid ? draft.rail.find((t) => t.uid === uid) : draft.rail.find((t) => t.uid === bellQueue(draft)[0]);
  if (!target) {
    emit({ type: 'bellRung', uid: null, id: null });
    return null;
  }
  const src = actingSource(target);
  const ref = srcRef(src);
  const trigger = (effect, more = {}) => emit({ type: 'trigger', src: ref, hook: 'bell', effect, ...more });
  emit({ type: 'bellRung', uid: target.uid, id: target.id });
  draft.stats.bellRings += 1;
  src.def.bell.ring({
    state: draft,
    self: target.data,
    charges: target.charges ?? 0,
    spendCharge() {
      target.charges -= 1;
      trigger('charge', { amount: target.charges });
    },
    armRethrow() {
      draft.armed = { rethrow: { by: target.uid } };
      trigger('armed');
    },
    foresee() {
      // The next landing is drawn now and kept: the next spin uses it instead
      // of drawing, so the wheel stream ends up where it would have anyway.
      const rng = new Rng(draft.rng.wheel);
      const pocketIndex = drawPocket(draft.wheel, rng);
      draft.rng.wheel = rng.state();
      draft.foreseen = { pocketIndex, by: target.uid };
      const p = draft.wheel.pockets[pocketIndex];
      trigger('foreseen', { pocketIndex });
      emit({ type: 'foreseen', uid: target.uid, pocketIndex, number: p.number, color: p.color });
    },
    gainCoins(n) {
      draft.coins = add(draft.coins, n);
      trigger('coins', { amount: n });
    },
    setData(key, value) {
      target.data[key] = value;
      trigger('data', { key, amount: value });
    },
    destroySelf() {
      draft.rail = draft.rail.filter((t) => t !== target);
      emit({ type: 'talismanDestroyed', uid: target.uid, id: target.id, reason: 'smashed' });
    },
  });
  return target.uid;
}
