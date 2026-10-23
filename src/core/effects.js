import { getEngraving, getFortune, getTalisman, playingRecords } from './content/index.js';
import { add } from './num.js';
import { hashSeed } from './rng.js';
import { doWork, workRefusal } from './wheelwork.js';

// Hook dispatch (design doc 9.7). Content never writes state: a hook calls
// methods on its ctx, and every method that changes something emits one
// `trigger` event naming its source, which is what makes the talisman shake
// on screen.
//
// Hook points, by phase:
//   pure (payout.js, recorded into a plan, no randomness):
//     hits        per ball            ctx.addHit({ pocketIndex, mult, betKinds })
//     ballLanded  per ball            ctx.bonusCoins(n), ctx.bonusTokens(n)
//     covers      per uncovered chip  ctx.cover(mult = 1): it pays, at × mult (Table Map: ½)
//     chipStake   per paying line     ctx.addStake(n); every line hook reads ctx.paidBefore
//     chipOdds    per paying line     ctx.addOdds(n), ctx.addOddsMult(n)
//     chipMult    per paying line     ctx.mul(x)
//     chipPaid    per paying line     ctx.addChipValue(n), ctx.bonusCoins(n), ctx.bonusTokens(n)
//     chipLost    per losing chip     ctx.bonusCoins(n), ctx.bonusTokens(n)
//     spinPaid    once, after them    ctx.bonusCoins(n), ctx.setData(k, v) (applied when the
//                                     spin is committed); reads ctx.winners, ctx.lines
//   pure prices (run.js):
//     packageCost  a night's cost     ctx.mulCost(x)
//     nightSpins   a night's spins    ctx.addSpins(n) (only a night that has spins)
//   pure balls (resolve.js; also shown before the spin):
//     balls        per spin           ctx.addBall({ mult }): one more ball, its lines × mult;
//                                     reads ctx.spin (nudge.js nextSpin)
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
//     interestRate (endNight)         ctx.addRate(r); reads ctx.rate, the rate so far
//
// A definition may also open special bets while it acts (`opens`: kinds of
// bet, bets.js): a talisman on the rail, a lasting card or a record.
//     bell (def.bell.ring, bell.js)   see bell.js
//
// Calling a method a hook point does not offer throws (its ctx lacks it).

/**
 * The things that act, in order: the record on the gramophone, then lasting
 * fortunes (boons) in the order they were taken, then the rail left to right,
 * each talisman's engraving straight after it. Chip materials and pocket
 * enhancements will slot in ahead of the record (Phase 5).
 * Each source: { index, inst, def, as, self, copyOf, by, kind }
 *   inst    the rail instance that acts (whose data it reads and writes)
 *   def     its own definition
 *   as      the definition whose hooks run (differs when Twin Mirrors copies)
 *   self    the instance data the hooks read
 *   copyOf  for a Twin Mirrors, the uid of the instance it copies: the copy's
 *           data belongs to that instance, so a new one starts fresh
 *   by      a Tuning Fork echoing it: the source runs again, straight after
 *           itself, and the fork is what shakes on screen
 *   kind    'record', 'boon', 'talisman' or 'engraving'. A record or a boon
 *           acts through a stand-in instance ({ uid, id, data }) so its data
 *           reads and writes like a talisman's.
 */
export function sources(state) {
  const out = [];
  // The gramophone's records act first, its first slot before the second.
  for (const record of playingRecords(state)) {
    const inst = { uid: 'record', id: record.id, data: state.recordData?.[record.id] ?? record.init?.() ?? {} };
    out.push({ index: -1, inst, def: record, as: record, self: inst.data, copyOf: null, by: null, kind: 'record' });
  }
  for (const boon of state.boons ?? []) {
    const def = getFortune(boon.id);
    if (def && (Object.keys(def.hooks).length || def.opens)) out.push({ index: -1, inst: boon, def, as: def, self: boon.data, copyOf: null, by: null, kind: 'boon' });
  }
  const rail = state.rail;
  for (let i = 0; i < rail.length; i++) {
    const inst = rail[i];
    const src = talismanSource(rail, i);
    if (src) {
      out.push(src);
      // Some effects cannot happen twice (a ward, a pity threshold, a Bell's
      // arming): a fork beside them has nothing to repeat.
      if (src.as.echoable !== false) {
        // Each fork to its right triggers it again; forks pass through forks.
        for (let j = i + 1; j < rail.length && getTalisman(rail[j].id)?.echoes; j++) out.push({ ...src, by: rail[j] });
      }
    }
    // Its engraving acts straight after it, on its own data, even when the
    // talisman itself does nothing (a dark mirror, a fork). A mirror's or a
    // fork's repeat is of the talisman, never of its engraving.
    const engraving = inst.engraving ? getEngraving(inst.engraving) : null;
    if (engraving) out.push({ index: i, inst, def: engraving, as: engraving, self: inst.data, copyOf: null, by: null, kind: 'engraving' });
  }
  return out;
}

/** The rail talisman at `i` as a source, or null when it does not act on its own. */
function talismanSource(rail, i) {
  const inst = rail[i];
  const def = getTalisman(inst.id);
  // A fork never acts on its own, only through the talisman to its left.
  if (!def || def.echoes) return null;
  let as = def;
  let self = inst.data;
  let copyOf = null;
  if (def.copies === 'right') {
    const target = copyTargetInst(rail, i);
    if (!target) return null; // nothing to copy: the mirror stays dark
    as = getTalisman(target.id);
    copyOf = target.uid;
    self = inst.data.copy?.[copyOf] ?? as.init?.() ?? {};
    if (self.gone) return null; // a copy that was used up stays dark
  }
  return { index: i, inst, def, as, self, copyOf, by: null, kind: 'talisman' };
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
    /** Wheel work on a target (wheelwork.js), when it can act there. */
    work(work, target) {
      if (workRefusal(draft, work, target)) return false;
      doWork(draft, work, target, emit, { kind: 'talisman', id: src.def.id, uid: src.inst.uid });
      return true;
    },
    /** Pockets passing `test` grow by `amount`, for good (wheel work, as a fortune's widen). */
    widenPockets(test, amount) {
      let count = 0;
      for (const p of draft.wheel.pockets) {
        if (!test(p)) continue;
        p.width = Math.round((p.width + amount) * 1e6) / 1e6;
        count += 1;
      }
      trigger('widen', { amount, count });
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

/** The special bets open this run: whatever acts now opens them (a talisman, a card, a record). */
export function openSpecials(state) {
  const out = new Set();
  for (const src of sources(state)) for (const kind of src.as.opens ?? []) out.add(kind);
  return out;
}

/** Runs a commit-phase hook on every source in order. */
export function lifecycle(draft, hook, emit, extra = {}) {
  for (const src of sources(draft)) {
    const fn = src.as.hooks?.[hook];
    if (!fn) continue;
    // A talisman used up earlier in this pass (and its echoes) is gone.
    if (src.index >= 0 && !draft.rail.includes(src.inst)) continue;
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
      get rate() {
        return rate;
      },
      addRate(r) {
        rate = Math.round((rate + r) * 1e6) / 1e6;
        emit({ type: 'trigger', src: srcRef(src), hook: 'interestRate', effect: 'interest', amount: r });
      },
    });
  }
  return rate;
}
