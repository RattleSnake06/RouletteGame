import { betCovers, betOf } from './bets.js';
import { playingRecords } from './content/index.js';
import { ECONOMY } from './economy.js';
import { sources, srcRef } from './effects.js';
import { leanAfterEdge } from './house.js';
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
//               (a Wind-Up Key starts it sooner)
//   talismans   their `nudge` hooks (Rabbit's Foot, Compass...), and a Lucky
//               pocket the last spin landed in (doc 6.5)

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
 * Between nights it is the first spin of the coming night. `ofNight` is null
 * when the night's size is only a guess (a save from before it was kept), so
 * no first-spin-of-the-night rule fires on a spin that may not be the first.
 */
export function nextSpin(state) {
  if (state.phase === 'betting') {
    // The night's last spin is known even when its size is only a guess.
    const last = state.spinsLeft === 1;
    if (state.spinsTonightGuessed) return { ofNight: null, ofDebt: state.debtSpins + 1, last };
    const tonight = state.spinsTonight ?? state.spinsLeft;
    return { ofNight: tonight - state.spinsLeft + 1, ofDebt: state.debtSpins + 1, last };
  }
  // Before a night is chosen its size is unknown, so no spin is its last yet.
  return { ofNight: 1, ofDebt: state.debtSpins + 1, last: false };
}

/**
 * No spin of this debt is left: its last night is over (the next spin, if any,
 * belongs to the next debt, which starts with a schedule of its own).
 */
const debtSpinsOver = (state) => state.phase === 'gameOver' || (state.phase === 'nightOver' && state.round === ECONOMY.roundsPerDebt);

/** The House's Lean on the next spin (0 for none). This is what the LEAN lamp shows. */
export function upcomingLean(state) {
  // Lullaby for Zero: the House does not lean while it plays (the Leans are
  // still rolled, so the run's other draws stay as they were).
  if (playingRecords(state).some((r) => r.noLeans)) return 0;
  const spin = nextSpin(state);
  let strength = 0;
  // Debt 1's schedule counts spins of the debt, so a Lean can be announced at
  // the end of one night for the next night's first spin, but never across
  // the end of the debt.
  if (!debtSpinsOver(state)) for (const l of state.leans.debt) if (l.at === spin.ofDebt) strength += l.strength;
  const night = state.leans.night;
  if (night && state.phase === 'betting' && night.at === spin.ofNight) strength += night.strength;
  return leanAfterEdge(state, strength);
}

/** Pity on the next spin, from the misses in a row so far (it starts after `after` misses). */
export function pityFor(missStreak, { after = LUCK.pityAfter } = {}) {
  if (missStreak < after) return 0;
  return LUCK.pityBase + LUCK.pityStep * (missStreak - after);
}

// --- Totals ------------------------------------------------------------------

/**
 * The next spin's Nudge, with what restricts it. Pure; with `emit`, every
 * talisman that adds or restricts something emits a `trigger`.
 * Returns { total, lean, pity, charms, clockwise, straightOnly, pityBlocked,
 * pityAfter, blocked, anchors, anchorSrcs, kind }.
 */
export function nudgeFor(state, emit = null) {
  const lean = upcomingLean(state);
  const basePity = pityFor(state.missStreak);
  const spin = nextSpin(state);
  let charms = 0;
  let clockwise = false;
  let straightOnly = false;
  let pityAfter = LUCK.pityAfter;
  let pityBlocker = null;
  let blocked = false;
  const anchors = [];
  const anchorSrcs = [];
  for (const src of sources(state)) {
    const fn = src.as.hooks?.nudge;
    if (!fn) continue;
    const trigger = (effect, more = {}) => emit?.({ type: 'trigger', src: srcRef(src), hook: 'nudge', effect, ...more });
    fn({
      state,
      self: src.self,
      lean,
      pity: basePity,
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
        // Shown once every talisman has had its say (pity may start sooner).
        pityBlocker ??= trigger;
      },
      pityAfter(n) {
        if (n >= pityAfter) return;
        pityAfter = n;
        if (state.missStreak >= n) trigger('pityAfter', { amount: n });
      },
      noNudge() {
        blocked = true;
        trigger('noNudge');
      },
      // A passive hold: it shows only on a spin where it keeps the ball from
      // hopping somewhere better (resolve.js emits that trigger).
      anchor(number) {
        if (!anchors.includes(number)) anchors.push(number);
        anchorSrcs.push({ number, src: srcRef(src) });
      },
    });
  }
  // A Lucky pocket the last ball came to rest in: brass luck, like a charm's.
  if (state.luckyNudge > 0) {
    charms += state.luckyNudge;
    emit?.({ type: 'trigger', src: { uid: 'lucky', id: 'lucky', as: 'lucky', pocket: true }, hook: 'nudge', effect: 'nudge', amount: state.luckyNudge });
  }
  const rawPity = pityFor(state.missStreak, { after: pityAfter });
  if (pityBlocker && rawPity > 0) pityBlocker('noPity', { amount: rawPity });
  // A blocked spin (the Black Cat crossing) has no Nudge at all, the House's
  // included, so the board shows no pity for it either.
  const pity = pityBlocker || blocked ? 0 : rawPity;
  // Carousel: Nudge that is there at all reaches a pocket further.
  const reach = playingRecords(state).filter((r) => r.reach);
  if (reach.length && !blocked && lean + pity + charms > 0) {
    for (const record of reach) {
      charms += record.reach;
      emit?.({ type: 'trigger', src: { uid: 'record', id: record.id, as: record.id }, hook: 'nudge', effect: 'nudge', amount: record.reach });
    }
  }
  const total = blocked ? 0 : lean + pity + charms;
  // What the hops look like on screen: a Lean's warm spark, pity's cold one,
  // or the brass of a talisman's own luck.
  const kind = lean > 0 ? 'lean' : pity > 0 ? 'pity' : 'charm';
  return { total, lean, pity, charms, clockwise, straightOnly, pityBlocked: !!pityBlocker, pityAfter, blocked, anchors, anchorSrcs, kind };
}

// --- Hops --------------------------------------------------------------------

const scoreOf = (plan) => add(plan.chipTotal, plan.bonusCoins);

/** Pockets holding a straight-up chip (where a Lodestone lets the ball go). */
function straightPockets(state) {
  const out = new Set();
  for (const chip of state.chips) {
    const betId = state.placements[chip.id];
    if (!betId) continue;
    const bet = betOf(state, betId);
    if (bet.kind !== 'straight') continue;
    state.wheel.pockets.forEach((p, i) => betCovers(bet, p) && out.add(i));
  }
  return out;
}

/**
 * Moves one ball up to `luck.total` pockets to the reachable pocket that pays
 * the most. Ties go to fewer hops, then clockwise; a ball already on the best
 * pocket stays. Returns the new landings and the hop, null for no move, or
 * `{ held }` when an anchored number kept the ball from a better pocket.
 */
export function nudgeBall(state, landings, ball, luck) {
  const n = state.wheel.pockets.length;
  // Half the wheel each way reaches every pocket (18 on a 37-pocket wheel);
  // one way only, it takes the whole wheel less one.
  const reach = Math.min(luck.total, luck.clockwise ? n - 1 : Math.floor(n / 2));
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
  // An anchored number holds the ball (the Thirteen Ball on 13).
  const number = state.wheel.pockets[from].number;
  if (luck.anchors?.includes(number)) return { held: { ball, pocketIndex: from, number } };
  const dir = Math.sign(best.steps);
  const path = Array.from({ length: Math.abs(best.steps) }, (_, i) => neighbourIndex(state.wheel, from, dir * (i + 1)));
  return { landings: at(best.idx), hop: { ball, from, to: best.idx, steps: best.steps, path } };
}

/** Nudges every ball in turn. Returns { landings, hops, holds }. */
export function nudgeLandings(state, landings, luck) {
  const hops = [];
  const holds = [];
  let out = landings;
  for (let ball = 0; ball < landings.length; ball++) {
    const moved = nudgeBall(state, out, ball, luck);
    if (!moved) continue;
    if (moved.held) {
      holds.push(moved.held);
      continue;
    }
    out = moved.landings;
    hops.push(moved.hop);
  }
  return { landings: out, hops, holds };
}
