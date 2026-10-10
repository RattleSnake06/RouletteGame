import { lifecycle } from './effects.js';
import { commitPlan, evaluate } from './payout.js';
import { Rng } from './rng.js';
import { recordLanding } from './tally.js';
import { drawPocket } from './wheel.js';

// Settles one spin on a draft (doc 5.5). The outcome is decided here, before
// anything is animated:
//   1. beforeSpin hooks           (Phase 3: Nudge and the Devil's chance)
//   2. land each ball             (a foreseen landing from the Glass Eye, else a draw)
//   3. evaluate the payout        (pure)
//   4. Wheel of Fortune           (an armed miss is thrown again; the first throw counts for nothing)
//   5. commit the payout
//   6. tally the final landings, then afterSpin hooks

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

  const rng = new Rng(s.rng.wheel);
  const balls = Array.from({ length: ballCount(s) }, (_, i) => i);
  const foreseen = s.foreseen;
  let landings = balls.map((ball) => {
    if (ball === 0 && foreseen) {
      emit({ type: 'foreseenUsed', pocketIndex: foreseen.pocketIndex, by: foreseen.by });
      return { ball, pocketIndex: foreseen.pocketIndex };
    }
    return { ball, pocketIndex: drawPocket(s.wheel, rng) };
  });
  s.foreseen = null;

  let plan = evaluate(s, landings);
  let firstThrow = null;
  if (s.armed.rethrow) {
    const { by } = s.armed.rethrow;
    if (plan.miss) {
      firstThrow = describe(s, landings);
      landings = balls.map((ball) => ({ ball, pocketIndex: drawPocket(s.wheel, rng) }));
      plan = evaluate(s, landings);
      s.stats.rethrows += 1;
      emit({ type: 'rethrow', by, first: firstThrow });
    }
    // Armed for one spin only: a spin that pays spends the charge anyway.
    s.armed = { rethrow: null };
  }
  s.rng.wheel = rng.state();

  commitPlan(s, plan, emit);
  for (const { pocketIndex } of landings) recordLanding(s.tally, s.wheel.pockets[pocketIndex].number);

  const final = describe(s, landings);
  const result = {
    balls: final,
    pocketIndex: final[0].pocketIndex,
    number: final[0].number,
    color: final[0].color,
    foreseen: !!foreseen,
    firstThrow,
    lines: plan.lines,
    losses: plan.losses,
    wins: plan.lines.map(({ ball, chipId, betId, amount, hit }) => ({ ball, chipId, betId, amount, hitMult: hit.mult })),
    chipTotal: plan.chipTotal,
    bonusCoins: plan.bonusCoins,
    bonusTokens: plan.bonusTokens,
    miss: plan.miss,
  };
  lifecycle(s, 'afterSpin', emit, { result });
  return result;
}
