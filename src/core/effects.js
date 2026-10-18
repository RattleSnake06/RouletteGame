import { getTalisman } from './content/index.js';
import { add } from './num.js';
import { hashSeed } from './rng.js';

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
//     chipStake   per paying line     ctx.addStake(n); every line hook reads ctx.paidBefore
//     chipOdds    per paying line     ctx.addOdds(n), ctx.addOddsMult(n)
//     chipMult    per paying line     ctx.mul(x)
//     chipPaid    per paying line     ctx.addChipValue(n), ctx.bonusCoins(n), ctx.bonusTokens(n)
//     chipLost    per losing chip     ctx.bonusCoins(n), ctx.bonusTokens(n)
//     spinPaid    once, after them    ctx.bonusCoins(n), ctx.setData(k, v) (applied when the
//                                     spin is committed); reads ctx.winners
//   pure luck (nudge.js, devil.js, widths.js; also shown before the spin):
//     nudge        per spin           ctx.addNudge(n), ctx.clockwiseOnly(), ctx.straightOnly(),
//                                     ctx.noPity(), ctx.pityAfter(n), ctx.noNudge(), ctx.anchor(number);
//                                     reads ctx.lean, ctx.pity, ctx.spin
//     devilChance  per spin           ctx.addChance(p), ctx.mulChance(x)
//     widths       per spin           ctx.widen(test, amount): pockets passing test(pocket) grow
//   commit (applied to the draft at once):
//     runStart, debtStart, roundStart, beforeSpin, afterSpin, roundEnd,
//     debtPaid, purchased, sold       ctx.gainCoins(n), ctx.gainTokens(n), ctx.setData(k, v),
//                                     ctx.destroySelf(reason)
//     ward (resolve.js)               the Devil fired: the first ward turned him away, and is
//                                     used up once the spin is over
//     interestRate (endNight)         ctx.addRate(r)
//     bell (def.bell.ring, bell.js)   see bell.js
//
// Calling a method a hook point does not offer throws (its ctx lacks it).

/**
 * The things that act, in order. Phase 2 has only the rail, left to right.
 * Later groups slot in ahead of it: chip material, pocket enhancement, record.
 * Each source: { index, inst, def, as, self, copyOf, by }
 *   inst    the rail instance that acts (whose data it reads and writes)
 *   def     its own definition
 *   as      the definition whose hooks run (differs when Twin Mirrors copies)
 *   self    the instance data the hooks read
 *   copyOf  for a Twin Mirrors, the uid of the instance it copies: the copy's
 *           data belongs to that instance, so a new one starts fresh
 *   by      a Tuning Fork echoing it: the source runs again, straight after
 *           itself, and the fork is what shakes on screen
 */
export function sources(state) {
  const out = [];
  const rail = state.rail;
  for (let i = 0; i < rail.length; i++) {
    const inst = rail[i];
    const def = getTalisman(inst.id);
    // A fork never acts on its own, only through the talisman to its left.
    if (!def || def.echoes) continue;
    let as = def;
    let self = inst.data;
    let copyOf = null;
    if (def.copies === 'right') {
      const target = copyTargetInst(rail, i);
      if (!target) continue; // nothing to copy: the mirror stays dark
      as = getTalisman(target.id);
      copyOf = target.uid;
      self = inst.data.copy?.[copyOf] ?? as.init?.() ?? {};
      if (self.gone) continue; // a copy that was used up stays dark
    }
    const src = { index: i, inst, def, as, self, copyOf, by: null };
    out.push(src);
    // Some effects cannot happen twice (a ward, a pity threshold, a Bell's
    // arming): a fork beside them has nothing to repeat.
    if (as.echoable === false) continue;
    // Each fork to its right triggers it again; forks pass through forks.
    for (let j = i + 1; j < rail.length && getTalisman(rail[j].id)?.echoes; j++) out.push({ ...src, by: rail[j] });
  }
  return out;
}

/** What a Tuning Fork at `index` echoes: the definition that would run again, or null. */
export function echoTarget(rail, index) {
  let j = index - 1;
  while (j >= 0 && getTalisman(rail[j].id)?.echoes) j--;
  if (j < 0) return null;
  const def = getTalisman(rail[j].id);
  if (!def) return null;
  return def.copies === 'right' ? copyTarget(rail, j) : def;
}

/** The instance a Twin Mirrors at `index` copies: the next non-mirror to its right, if copyable. */
export function copyTargetInst(rail, index) {
  let j = index + 1;
  while (j < rail.length && getTalisman(rail[j].id)?.copies === 'right') j++;
  const inst = rail[j];
  const def = inst && getTalisman(inst.id);
  return def && def.copyable !== false ? inst : null;
}

/** What a Twin Mirrors at `index` copies: the definition, or null. */
export function copyTarget(rail, index) {
  const inst = copyTargetInst(rail, index);
  return inst ? getTalisman(inst.id) : null;
}

/** How an event names its source: the instance that shakes, and whose hooks ran. */
export const srcRef = (src) => (src.by ? { uid: src.by.uid, id: src.by.id, as: src.as.id, echo: src.inst.uid } : { uid: src.inst.uid, id: src.def.id, as: src.as.id });

/**
 * A number in [0, 1) fixed by the run's seed, the spin about to happen and
 * `salt`. Pure, so an omen can be shown before the spin and replays exactly.
 */
export function omen(state, salt) {
  return hashSeed(`${state.seed}|${state.stats.spins}|${salt}`)[0] / 4294967296;
}

/** Sets one key of a source's data: its own, or a mirror's copy of another instance's. */
export function writeData(inst, copyOf, self, key, value) {
  if (!copyOf) {
    inst.data[key] = value;
    return;
  }
  inst.data.copy ??= {};
  inst.data.copy[copyOf] = { ...(inst.data.copy[copyOf] ?? self), [key]: value };
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
      writeData(src.inst, src.copyOf, src.self, key, value);
      trigger('data', { key, amount: value });
    },
    /**
     * The talisman is used up (crumbled, wilted, shattered) and leaves the
     * rail. A Twin Mirrors' copy cannot take the mirror with it: the copy
     * goes dark instead (`self.gone`) and the mirror stays on its hook.
     */
    destroySelf(reason = 'spent') {
      if (src.copyOf) {
        writeData(src.inst, src.copyOf, src.self, 'gone', true);
        trigger('gone', { reason });
        return;
      }
      if (!draft.rail.includes(src.inst)) return;
      draft.rail = draft.rail.filter((t) => t !== src.inst);
      emit({ type: 'talismanDestroyed', uid: src.inst.uid, id: src.inst.id, reason, by: src.by?.uid ?? null });
    },
  };
}

const OWN_ONLY = new Set(['purchased', 'sold']);

/** Runs a commit-phase hook on every source in order. */
export function lifecycle(draft, hook, emit, extra = {}) {
  for (const src of sources(draft)) {
    const fn = src.as.hooks?.[hook];
    if (!fn) continue;
    // A talisman used up earlier in this pass (and its echoes) is gone.
    if (!draft.rail.includes(src.inst)) continue;
    // A copy or an echo repeats effects, never the purchase or sale of the original.
    if (OWN_ONLY.has(hook) && (src.as !== src.def || src.by)) continue;
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
