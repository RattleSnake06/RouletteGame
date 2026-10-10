import { getTalisman } from './content/index.js';
import { add } from './num.js';

// Hook dispatch (design doc 9.7). Content never writes state: a hook calls
// methods on its ctx, and every method that changes something emits one
// `trigger` event naming its source, which is what makes the talisman shake
// on screen.
//
// Hook points, by phase:
//   pure (payout.js, recorded into a plan, no randomness):
//     hits        per ball            ctx.addHit({ pocketIndex, mult, betKinds })
//     ballLanded  per ball            ctx.bonusCoins(n), ctx.bonusTokens(n)
//     covers      per uncovered chip  ctx.cover()
//     chipStake   per paying line     ctx.addStake(n)
//     chipOdds    per paying line     ctx.addOdds(n), ctx.addOddsMult(n)
//     chipMult    per paying line     ctx.mul(x)
//     chipPaid    per paying line     ctx.addChipValue(n), ctx.bonusCoins(n), ctx.bonusTokens(n)
//     chipLost    per losing chip     ctx.bonusCoins(n), ctx.bonusTokens(n)
//   commit (applied to the draft at once):
//     runStart, debtStart, roundStart, beforeSpin, afterSpin, roundEnd,
//     debtPaid, purchased, sold       ctx.gainCoins(n), ctx.gainTokens(n), ctx.setData(k, v)
//     interestRate (endNight)         ctx.addRate(r)
//     bell (def.bell.ring, bell.js)   see bell.js
//
// Calling a method a hook point does not offer throws (its ctx lacks it).

/**
 * The things that act, in order. Phase 2 has only the rail, left to right.
 * Later groups slot in ahead of it: chip material, pocket enhancement, record.
 * Each source: { index, inst, def, as, self }
 *   inst  the rail instance that acts (what shakes on screen)
 *   def   its own definition
 *   as    the definition whose hooks run (differs when Twin Mirrors copies)
 *   self  the instance data the hooks read
 */
export function sources(state) {
  const out = [];
  const rail = state.rail;
  for (let i = 0; i < rail.length; i++) {
    const inst = rail[i];
    const def = getTalisman(inst.id);
    if (!def) continue;
    let as = def;
    let self = inst.data;
    if (def.copies === 'right') {
      as = copyTarget(rail, i);
      if (!as) continue; // nothing to copy: the mirror stays dark
      self = inst.data.copy?.[as.id] ?? as.init?.() ?? {};
    }
    out.push({ index: i, inst, def, as, self });
  }
  return out;
}

/** What a Twin Mirrors at `index` copies: the next non-mirror to its right, if copyable. */
export function copyTarget(rail, index) {
  let j = index + 1;
  while (j < rail.length && getTalisman(rail[j].id)?.copies === 'right') j++;
  const target = j < rail.length ? getTalisman(rail[j].id) : null;
  return target && target.copyable !== false ? target : null;
}

export const srcRef = (src) => ({ uid: src.inst.uid, id: src.def.id, as: src.as.id });

function writeData(src, key, value) {
  if (src.as === src.def) {
    src.inst.data[key] = value;
    return;
  }
  src.inst.data.copy ??= {};
  src.inst.data.copy[src.as.id] = { ...(src.inst.data.copy[src.as.id] ?? src.self), [key]: value };
}

/** Commit-phase ctx: changes land on the draft straight away. */
export function commitCtx(draft, src, emit, hook, extra = {}) {
  const ref = srcRef(src);
  const trigger = (effect, more = {}) => emit({ type: 'trigger', src: ref, hook, effect, ...more });
  return {
    state: draft,
    self: src.self,
    ...extra,
    gainCoins(n) {
      draft.coins = add(draft.coins, n);
      trigger('coins', { amount: n });
    },
    gainTokens(n) {
      draft.tokens += n;
      draft.stats.tokensEarned += n;
      trigger('tokens', { amount: n });
    },
    setData(key, value) {
      writeData(src, key, value);
      trigger('data', { key, amount: value });
    },
  };
}

const OWN_ONLY = new Set(['purchased', 'sold']);

/** Runs a commit-phase hook on every source in order. */
export function lifecycle(draft, hook, emit, extra = {}) {
  for (const src of sources(draft)) {
    const fn = src.as.hooks?.[hook];
    if (!fn) continue;
    // A copy echoes effects, never the purchase or sale of the original.
    if (OWN_ONLY.has(hook) && src.as !== src.def) continue;
    const more = typeof extra === 'function' ? extra(src) : extra;
    fn(commitCtx(draft, src, emit, hook, more));
  }
}

/** The interest rate this night: the base plus every talisman's addRate. */
export function interestRateFor(state, base, emit = () => {}) {
  let rate = base;
  for (const src of sources(state)) {
    const fn = src.as.hooks?.interestRate;
    if (!fn) continue;
    fn({
      state,
      self: src.self,
      addRate(r) {
        rate = Math.round((rate + r) * 1e6) / 1e6;
        emit({ type: 'trigger', src: srcRef(src), hook: 'interestRate', effect: 'interest', amount: r });
      },
    });
  }
  return rate;
}
