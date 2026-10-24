import { devilChanceFor, rollDevil } from './devil.js';
import { getEnhancement } from './content/index.js';
import { commitCtx, lifecycle, sources, srcRef } from './effects.js';
import { nextSpin, nudgeFor, nudgeLandings } from './nudge.js';
import { commitPlan, evaluate, pocketRef } from './payout.js';
import { Rng } from './rng.js';
import { recordLanding } from './tally.js';
import { drawPocket, isBlank } from './wheel.js';
import { liveWheel } from './widths.js';

// Settles one spin on a draft (doc 5.5). The outcome is decided here, before
// anything is animated:
//   1. beforeSpin hooks; the live wheel's widths; total up Nudge (Lean +
//      pity + talismans) and the Devil's chance
//   2. land each ball           (a foreseen landing from the Glass Eye, else a
//                                draw by the live widths)
//   3. Nudge                    (each ball hops to the best reachable pocket)
//   4. the Devil                (rolled after Nudge; a ward such as Holy Water
//                                turns him away once; otherwise nothing pays
//                                and every coin in hand is lost)
//   5. evaluate the payout      (pure)
//   6. Wheel of Fortune         (an armed miss is thrown again: steps 2–5 anew)
//   7. commit the payout, tally the final landings, then afterSpin hooks;
//      the pockets the balls came to rest in act (doc 6.5): a Lucky pocket's
//      Nudge waits for the next spin, a Cursed one raises the Devil's chance
//      for the night, and a Glass one may shatter (pockets stream)
//   8. a ward that turned the Devil away is used up (the vial shatters): only
//      now, so the whole spin paid with the rail it was thrown with

/**
 * The balls thrown this spin (doc 6.1, multi-ball): the House's own, then one
 * more for each `balls` hook that adds one, in rail order. Each is
 * { ball, mult, by }: an extra ball's lines pay × mult. Pure; with `emit`,
 * each extra ball emits a `trigger` (so the next spin's balls can be shown).
 */
export function ballsFor(state, emit = null) {
  const balls = [{ ball: 0, mult: 1, by: null }];
  const spin = nextSpin(state);
  for (const src of sources(state)) {
    const fn = src.as.hooks?.balls;
    if (!fn) continue;
    fn({
      state,
      self: src.self,
      spin,
      addBall({ mult = 1 } = {}) {
        balls.push({ ball: balls.length, mult, by: srcRef(src) });
        emit?.({ type: 'trigger', src: srcRef(src), hook: 'balls', effect: 'ball', amount: mult });
      },
    });
  }
  return balls;
}

export const ballCount = (state) => ballsFor(state).length;

const describe = (state, landings) =>
  landings.map(({ ball, pocketIndex, mult = 1 }) => {
    const p = state.wheel.pockets[pocketIndex];
    return { ball, pocketIndex, pocketId: p.id, number: p.number, color: p.color, enh: p.enh, mult };
  });

/**
 * What the pockets the balls came to rest in do once the spin is paid. A
 * pocket two balls share acts for each, but shatters at most once.
 */
function pocketsAct(s, landings, emit) {
  const rolled = new Set();
  for (const { ball, pocketIndex } of landings) {
    const pocket = s.wheel.pockets[pocketIndex];
    const enh = getEnhancement(pocket.enh);
    if (!enh) continue;
    const trigger = (effect, amount) => emit({ type: 'trigger', src: pocketRef(pocket), hook: 'pocket', effect, amount, ball, pocketIndex });
    if (enh.nudge) {
      s.luckyNudge = (s.luckyNudge ?? 0) + enh.nudge;
      trigger('nudge', enh.nudge);
    }
    if (enh.devil) {
      s.devil = { ...s.devil, nightCurse: Math.round(((s.devil.nightCurse ?? 0) + enh.devil) * 1e6) / 1e6 };
      trigger('devil', enh.devil);
    }
    if (enh.shatter && !rolled.has(pocket.id)) {
      rolled.add(pocket.id);
      const rng = new Rng(s.rng.pockets);
      const breaks = rng.chance(enh.shatter);
      s.rng.pockets = rng.state();
      if (breaks) {
        emit({ type: 'pocketShattered', pocketId: pocket.id, pocketIndex, number: pocket.number, color: pocket.color });
        Object.assign(pocket, { number: null, color: null, enh: 'blank' });
        s.stats.shattered = (s.stats.shattered ?? 0) + 1;
      }
    }
  }
}

/** Returns the spin's result summary; detail events go through `emit`. */
export function resolveSpin(s, emit) {
  lifecycle(s, 'beforeSpin', emit);
  const wheel = liveWheel(s, emit);
  const luck = nudgeFor(s, emit);
  const devilChance = devilChanceFor(s, emit);
  // A Lucky pocket's Nudge was for this spin only.
  s.luckyNudge = 0;

  const rng = new Rng(s.rng.wheel);
  const thrown = ballsFor(s, emit);
  const balls = thrown.map((b) => b.ball);
  const multOf = (ball) => thrown[ball].mult;
  const foreseen = s.foreseen;
  s.foreseen = null;

  /** One throw: land, Nudge, the Devil, then what it would pay. */
  const throwBalls = (first) => {
    const landed = balls.map((ball) => {
      if (first && ball === 0 && foreseen) {
        emit({ type: 'foreseenUsed', pocketIndex: foreseen.pocketIndex, by: foreseen.by });
        return { ball, pocketIndex: foreseen.pocketIndex };
      }
      return { ball, pocketIndex: drawPocket(wheel, rng) };
    });
    const nudged = nudgeLandings(s, landed, luck);
    const { hops, holds } = nudged;
    // An extra ball pays at its own mult (the Ivory Ball's half).
    const landings = nudged.landings.map((l) => (multOf(l.ball) === 1 ? l : { ...l, mult: multOf(l.ball) }));
    for (const hop of hops) emit({ type: 'nudged', ...hop, nudge: luck.total, kind: luck.kind, first });
    // An anchor that kept the ball from hopping to something better shows itself.
    for (const hold of holds) {
      for (const a of luck.anchorSrcs) if (a.number === hold.number) emit({ type: 'trigger', src: a.src, hook: 'nudge', effect: 'anchor', amount: a.number, ball: hold.ball, first });
    }
    const devil = rollDevil(s, devilChance) && !warded(landings, first);
    return { landings, hops, devil, plan: devil ? null : evaluate(s, landings) };
  };

  // Wards that turned the Devil away this spin. Each wards once (a re-throw
  // needs another), and is used up after the spin.
  const wards = [];
  const wardKey = (x) => `${x.inst.uid}|${x.copyOf ?? ''}|${x.by?.uid ?? ''}`;
  const warded = (landings, first) => {
    const spent = new Set(wards.map(wardKey));
    const src = sources(s).find((x) => x.as.hooks?.ward && !spent.has(wardKey(x)));
    if (!src) return false;
    wards.push(src);
    emit({ type: 'devilWarded', src: srcRef(src), ball: 0, pocketIndex: landings[0].pocketIndex, first });
    s.stats.wards = (s.stats.wards ?? 0) + 1;
    return true;
  };

  let t = throwBalls(true);
  let firstThrow = null;
  let firstHops = [];
  if (s.armed.rethrow) {
    const { by } = s.armed.rethrow;
    // A throw the Devil took is over: there is nothing left to throw again.
    if (!t.devil && t.plan.miss) {
      firstThrow = describe(s, t.landings);
      firstHops = t.hops;
      emit({ type: 'rethrow', by, first: firstThrow });
      s.stats.rethrows += 1;
      t = throwBalls(false);
    }
    // Armed for one spin only: a spin that pays spends the charge anyway.
    s.armed = { rethrow: null };
  }
  s.rng.wheel = rng.state();

  const final = describe(s, t.landings);
  let lost = 0;
  if (t.devil) {
    // The number under the ball burns away to 666, and the coins in hand go with it.
    lost = s.coins;
    s.coins = 0;
    s.stats.devils += 1;
    s.devil = { ...s.devil, firedThisDebt: true };
    emit({ type: 'devil', ball: 0, pocketIndex: final[0].pocketIndex, number: final[0].number, lost, chance: devilChance });
  } else {
    commitPlan(s, t.plan, emit);
    for (const { pocketIndex } of t.landings) if (!isBlank(s.wheel.pockets[pocketIndex])) recordLanding(s.tally, s.wheel.pockets[pocketIndex].number);
    pocketsAct(s, t.landings, emit);
  }

  const plan = t.plan;
  const miss = t.devil || plan.miss;
  s.missStreak = miss ? s.missStreak + 1 : 0;
  s.stats.hops += t.hops.reduce((n, h) => n + Math.abs(h.steps), 0);
  if (luck.lean) s.stats.leans += 1;

  const result = {
    balls: final,
    pocketIndex: final[0].pocketIndex,
    number: final[0].number,
    color: final[0].color,
    foreseen: !!foreseen,
    firstThrow,
    firstHops,
    hops: t.hops,
    luck,
    devilChance,
    devil: t.devil,
    lost,
    lines: plan?.lines ?? [],
    losses: plan?.losses ?? [],
    wins: (plan?.lines ?? []).map(({ ball, chipId, betId, amount, hit }) => ({ ball, chipId, betId, amount, hitMult: hit.mult })),
    chipTotal: plan?.chipTotal ?? 0,
    bonusCoins: plan?.bonusCoins ?? 0,
    bonusTokens: plan?.bonusTokens ?? 0,
    miss,
    forgiven: false,
  };
  // A miss may be forgiven once ("Hot hands."): streak keepers then hold their streak.
  if (miss) lifecycle(s, 'forgiveMiss', emit, { result, forgive: () => (result.forgiven = true) });
  lifecycle(s, 'afterSpin', emit, { result });
  for (const src of wards) if (s.rail.includes(src.inst)) src.as.hooks.ward(commitCtx(s, src, emit, 'ward'));
  return result;
}
