import { devilChanceFor, rollDevil } from './devil.js';
import { lifecycle } from './effects.js';
import { nudgeFor, nudgeLandings } from './nudge.js';
import { commitPlan, evaluate } from './payout.js';
import { Rng } from './rng.js';
import { recordLanding } from './tally.js';
import { drawPocket } from './wheel.js';

// Settles one spin on a draft (doc 5.5). The outcome is decided here, before
// anything is animated:
//   1. beforeSpin hooks; total up Nudge (Lean + pity + talismans) and the
//      Devil's chance
//   2. land each ball           (a foreseen landing from the Glass Eye, else a draw)
//   3. Nudge                    (each ball hops to the best reachable pocket)
//   4. the Devil                (rolled after Nudge; if it fires, nothing pays
//                                and every coin in hand is lost)
//   5. evaluate the payout      (pure)
//   6. Wheel of Fortune         (an armed miss is thrown again: steps 2–5 anew)
//   7. commit the payout, tally the final landings, then afterSpin hooks

/** Balls per spin. Multi-ball talismans arrive later. */
export const ballCount = () => 1;

const describe = (state, landings) =>
  landings.map(({ ball, pocketIndex }) => {
    const p = state.wheel.pockets[pocketIndex];
    return { ball, pocketIndex, number: p.number, color: p.color };
  });

/** Returns the spin's result summary; detail events go through `emit`. */
export function resolveSpin(s, emit) {
  lifecycle(s, 'beforeSpin', emit);
  const luck = nudgeFor(s, emit);
  const devilChance = devilChanceFor(s, emit);

  const rng = new Rng(s.rng.wheel);
  const balls = Array.from({ length: ballCount(s) }, (_, i) => i);
  const foreseen = s.foreseen;
  s.foreseen = null;

  /** One throw: land, Nudge, the Devil, then what it would pay. */
  const throwBalls = (first) => {
    const landed = balls.map((ball) => {
      if (first && ball === 0 && foreseen) {
        emit({ type: 'foreseenUsed', pocketIndex: foreseen.pocketIndex, by: foreseen.by });
        return { ball, pocketIndex: foreseen.pocketIndex };
      }
      return { ball, pocketIndex: drawPocket(s.wheel, rng) };
    });
    const { landings, hops } = nudgeLandings(s, landed, luck);
    for (const hop of hops) emit({ type: 'nudged', ...hop, nudge: luck.total, kind: luck.kind, first });
    const devil = rollDevil(s, devilChance);
    return { landings, hops, devil, plan: devil ? null : evaluate(s, landings) };
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
    for (const { pocketIndex } of t.landings) recordLanding(s.tally, s.wheel.pockets[pocketIndex].number);
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
  };
  lifecycle(s, 'afterSpin', emit, { result });
  return result;
}
