import { betCovers, getBet } from './bets.js';
import { sources, srcRef } from './effects.js';
import { evaluate } from './payout.js';
import { add, gt } from './num.js';
import { Rng } from './rng.js';
import { neighbourIndex } from './wheel.js';

// Luck as a number of pocket hops (design doc 5.6). After the ball settles it
// may creep up to N pockets along the wheel to whichever reachable pocket pays
// the most. N is the sum of three things, all known before the bets close:
//
//   the Lean    spontaneous Nudge from the House, announced one spin early
//   pity        after 5 misses in a row, +1, then +1 for each further miss
//   talismans   their `nudge` hooks (Rabbit's Foot, Compass...)

// Tuned with the simulator (doc 9.8). One point of Nudge is worth a lot: it
// lets each straight-up reach two more pockets, so a straight-up's expected
// return grows with 2N + 1. Debt 1's teaching Leans and pity stay small.
export const LUCK = {
  teachingSpins: [2, 5, 9, 14, 20], // debt 1: spins of the debt, shifted by 0 or 1
  teachingStrength: 2,
  strength: [3, 5], // from debt 2, inclusive
  lastSpinBonus: 3, // a Lean on the night's last spin
  shortNightChance: 0.5,
  stingyFrom: 5, // from this debt, Leans come only every other night
  pityAfter: 5, // misses in a row
  pityBase: 1,
  pityStep: 1,
};

// --- The Lean ----------------------------------------------------------------

/** Debt 1's teaching schedule, rolled when the debt begins (lean stream). */
export function rollDebtLeans(draft) {
  if (draft.debt !== 1) return [];
  const rng = new Rng(draft.rng.lean);
  const shift = rng.int(2);
  draft.rng.lean = rng.state();
  return LUCK.teachingSpins.map((at) => ({ at: at + shift, strength: LUCK.teachingStrength }));
}

/**
 * The night's Lean, rolled when the night is chosen (lean stream): one on a
 * random spin after the first of a long night, a coin flip on a short night.
 * Debt 1 has its schedule instead; from debt 5 only every other night of the
 * run has one.
 */
export function rollNightLean(draft, spins) {
  if (draft.debt === 1 || spins < 2) return null;
  const runNight = (draft.debt - 1) * 3 + draft.round;
  if (draft.debt >= LUCK.stingyFrom && runNight % 2 === 0) return null;
  const rng = new Rng(draft.rng.lean);
  let lean = null;
  if (spins >= 7 || rng.chance(LUCK.shortNightChance)) {
    const at = 2 + rng.int(spins - 1);
    const [lo, hi] = LUCK.strength;
    const strength = lo + rng.int(hi - lo + 1) + (at === spins ? LUCK.lastSpinBonus : 0);
    lean = { at, strength };
  }
  draft.rng.lean = rng.state();
  return lean;
}

/**
 * Which spin comes next: its number within the night and within the debt.
 * Between nights it is the first spin of the coming night.
 */
export function nextSpin(state) {
  if (state.phase === 'betting') {
    const tonight = state.spinsTonight ?? state.spinsLeft;
    return { ofNight: tonight - state.spinsLeft + 1, ofDebt: state.debtSpins + 1 };
  }
  return { ofNight: 1, ofDebt: state.debtSpins + 1 };
}

/** The House's Lean on the next spin (0 for none). This is what the LEAN lamp shows. */
export function upcomingLean(state) {
  const spin = nextSpin(state);
  let strength = 0;
  for (const l of state.leans.debt) if (l.at === spin.ofDebt) strength += l.strength;
  const night = state.leans.night;
  if (night && state.phase === 'betting' && night.at === spin.ofNight) strength += night.strength;
  return strength;
}

/** Pity on the next spin, from the misses in a row so far. */
export function pityFor(missStreak) {
  if (missStreak < LUCK.pityAfter) return 0;
  return LUCK.pityBase + LUCK.pityStep * (missStreak - LUCK.pityAfter);
}

// --- Totals ------------------------------------------------------------------

/**
 * The next spin's Nudge, with what restricts it. Pure; with `emit`, every
 * talisman that adds or restricts something emits a `trigger`.
 * Returns { total, lean, pity, charms, clockwise, straightOnly, kind }.
 */
export function nudgeFor(state, emit = null) {
  const lean = upcomingLean(state);
  const rawPity = pityFor(state.missStreak);
  const spin = nextSpin(state);
  let charms = 0;
  let clockwise = false;
  let straightOnly = false;
  let pityBlocked = false;
  for (const src of sources(state)) {
    const fn = src.as.hooks?.nudge;
    if (!fn) continue;
    const trigger = (effect, more = {}) => emit?.({ type: 'trigger', src: srcRef(src), hook: 'nudge', effect, ...more });
    fn({
      state,
      self: src.self,
      lean,
      pity: rawPity,
      spin,
      addNudge(n) {
        if (n <= 0) return;
        charms += n;
        trigger('nudge', { amount: n });
      },
      clockwiseOnly() {
        clockwise = true;
        trigger('clockwise');
      },
      straightOnly() {
        straightOnly = true;
        trigger('straightOnly');
      },
      noPity() {
        pityBlocked = true;
        if (rawPity > 0) trigger('noPity', { amount: rawPity });
      },
    });
  }
  const pity = pityBlocked ? 0 : rawPity;
  const total = lean + pity + charms;
  // What the hops look like on screen: a Lean's warm spark, pity's cold one,
  // or the brass of a talisman's own luck.
  const kind = lean > 0 ? 'lean' : pity > 0 ? 'pity' : 'charm';
  return { total, lean, pity, charms, clockwise, straightOnly, kind };
}

// --- Hops --------------------------------------------------------------------

const scoreOf = (plan) => add(plan.chipTotal, plan.bonusCoins);

/** Pockets holding a straight-up chip (where a Lodestone lets the ball go). */
function straightPockets(state) {
  const out = new Set();
  for (const chip of state.chips) {
    const betId = state.placements[chip.id];
    if (!betId) continue;
    const bet = getBet(betId);
    if (bet.kind !== 'straight') continue;
    state.wheel.pockets.forEach((p, i) => betCovers(bet, p) && out.add(i));
  }
  return out;
}

/**
 * Moves one ball up to `luck.total` pockets to the reachable pocket that pays
 * the most. Ties go to fewer hops, then clockwise; a ball already on the best
 * pocket stays. Returns the new landings and the hop, or null for no move.
 */
export function nudgeBall(state, landings, ball, luck) {
  const n = state.wheel.pockets.length;
  // Half the wheel each way reaches every pocket (18 on a 37-pocket wheel).
  const reach = Math.min(luck.total, Math.floor(n / 2));
  if (reach <= 0) return null;
  const from = landings[ball].pocketIndex;
  const allowed = luck.straightOnly ? straightPockets(state) : null;
  const at = (idx) => landings.map((l, i) => (i === ball ? { ...l, pocketIndex: idx } : l));
  let best = { idx: from, steps: 0, score: scoreOf(evaluate(state, landings)) };
  for (let k = 1; k <= reach; k++) {
    for (const dir of [1, -1]) {
      if (dir < 0 && luck.clockwise) continue;
      const idx = neighbourIndex(state.wheel, from, dir * k);
      if (allowed && !allowed.has(idx)) continue;
      const score = scoreOf(evaluate(state, at(idx)));
      if (gt(score, best.score)) best = { idx, steps: dir * k, score };
    }
  }
  if (!best.steps) return null;
  const dir = Math.sign(best.steps);
  const path = Array.from({ length: Math.abs(best.steps) }, (_, i) => neighbourIndex(state.wheel, from, dir * (i + 1)));
  return { landings: at(best.idx), hop: { ball, from, to: best.idx, steps: best.steps, path } };
}

/** Nudges every ball in turn. Returns { landings, hops }. */
export function nudgeLandings(state, landings, luck) {
  const hops = [];
  let out = landings;
  for (let ball = 0; ball < landings.length; ball++) {
    const moved = nudgeBall(state, out, ball, luck);
    if (!moved) continue;
    out = moved.landings;
    hops.push(moved.hop);
  }
  return { landings: out, hops };
}
