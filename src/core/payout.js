import { betCovers, betOdds, getBet } from './bets.js';
import { sources, srcRef } from './effects.js';
import { add, mulFloor } from './num.js';

// One spin's payout, worked out before anything changes (doc 5.5). evaluate()
// is pure: the spin uses it, Wheel of Fortune uses it to tell a miss, the bet
// notes use it for previews, and Phase 3's Nudge will use it to score pockets.
//
// Payout of one paying line (a chip on a hit pocket):
//   value × Stake × odds × Odds mult × pocket mult × hit mult × each × talisman
// floored once at the end. Talismans act left to right along the rail: for
// each line, each source runs chipStake, chipOdds and chipMult in turn.

/** The plaques at rest. Later phases add global Stake and Odds here. */
export function baseFactors() {
  return { stake: 1, oddsMult: 1 };
}

export const chipValue = (chip) => chip.value + (chip.roundValue ?? 0);

function lineAmount(f) {
  return mulFloor(f.value, f.stake, f.odds, f.oddsMult, f.pocketMult, f.hitMult, f.mult);
}

/**
 * What these landings would pay. Never changes state, draws no randomness.
 * landings: [{ ball, pocketIndex }]
 * Returns a plan: { landings, lines, losses, deferred, steps, chipTotal,
 * bonusCoins, bonusTokens, miss }. `steps` are exactly the events commitPlan
 * will emit, in playback order.
 */
export function evaluate(state, landings) {
  const srcs = sources(state);
  const placed = state.chips.filter((c) => state.placements[c.id]);
  const base = baseFactors(state);
  const plan = {
    landings,
    lines: [],
    losses: [],
    deferred: [],
    steps: [],
    chipTotal: 0,
    bonusCoins: 0,
    bonusTokens: 0,
    miss: true,
  };
  const trigger = (src, hook, effect, more = {}) => plan.steps.push({ type: 'trigger', src: srcRef(src), hook, effect, ...more });
  const bonus = (src, hook, ball, chipId) => ({
    bonusCoins(n) {
      plan.bonusCoins = add(plan.bonusCoins, n);
      trigger(src, hook, 'coins', { amount: n, ball, chipId });
    },
    bonusTokens(n) {
      plan.bonusTokens += n;
      trigger(src, hook, 'tokens', { amount: n, ball, chipId });
    },
  });
  const firstLineSeen = new Set();

  for (const { ball, pocketIndex } of landings) {
    const pocket = state.wheel.pockets[pocketIndex];
    const landing = { ball, pocketIndex, pocket, number: pocket.number, color: pocket.color };
    const hits = [{ pocketIndex, pocket, mult: 1, primary: true, betKinds: null, src: null }];

    for (const src of srcs) {
      const fn = src.as.hooks?.hits;
      if (!fn) continue;
      fn({
        state,
        self: src.self,
        ball,
        landing,
        addHit({ pocketIndex: at, mult = 1, betKinds = null }) {
          hits.push({ pocketIndex: at, pocket: state.wheel.pockets[at], mult, primary: false, betKinds, src: srcRef(src) });
          trigger(src, 'hits', 'hit', { ball, pocketIndex: at, amount: mult });
        },
      });
    }
    for (const src of srcs) {
      const fn = src.as.hooks?.ballLanded;
      if (fn) fn({ state, self: src.self, ball, landing, hits, ...bonus(src, 'ballLanded', ball) });
    }

    const paidThisBall = new Set();
    for (const hit of hits) {
      for (const chip of placed) {
        const bet = getBet(state.placements[chip.id]);
        if (hit.betKinds && !hit.betKinds.includes(bet.kind)) continue;
        let covered = betCovers(bet, hit.pocket);
        if (!covered) {
          for (const src of srcs) {
            const fn = src.as.hooks?.covers;
            if (!fn) continue;
            fn({
              state,
              self: src.self,
              ball,
              landing,
              hit,
              chip,
              bet,
              cover() {
                if (covered) return;
                covered = true;
                trigger(src, 'covers', 'covers', { ball, chipId: chip.id, pocketIndex: hit.pocketIndex });
              },
            });
          }
        }
        if (!covered) continue;

        const factors = {
          value: chipValue(chip),
          stake: base.stake,
          odds: betOdds(bet),
          oddsMult: base.oddsMult,
          pocketMult: 1,
          hitMult: hit.mult,
          mult: 1,
        };
        const lineCtx = { state, ball, landing, hit, chip, bet, factors };
        const at = { ball, chipId: chip.id };
        for (const src of srcs) {
          const h = src.as.hooks;
          if (!h) continue;
          if (h.chipStake) {
            h.chipStake({
              ...lineCtx,
              self: src.self,
              addStake(n) {
                factors.stake += n;
                trigger(src, 'chipStake', 'stake', { amount: n, ...at });
              },
            });
          }
          if (h.chipOdds) {
            h.chipOdds({
              ...lineCtx,
              self: src.self,
              addOdds(n) {
                factors.odds += n;
                trigger(src, 'chipOdds', 'odds', { amount: n, ...at });
              },
              addOddsMult(n) {
                factors.oddsMult += n;
                trigger(src, 'chipOdds', 'oddsMult', { amount: n, ...at });
              },
            });
          }
          if (h.chipMult) {
            h.chipMult({
              ...lineCtx,
              self: src.self,
              mul(x) {
                factors.mult *= x;
                trigger(src, 'chipMult', 'mult', { amount: x, ...at });
              },
            });
          }
        }

        const amount = lineAmount(factors);
        const line = {
          ball,
          chipId: chip.id,
          betId: bet.id,
          amount,
          factors,
          hit: { pocketIndex: hit.pocketIndex, mult: hit.mult, primary: hit.primary, src: hit.src },
        };
        plan.lines.push(line);
        plan.chipTotal = add(plan.chipTotal, amount);
        plan.steps.push({ type: 'chipPaid', ...line });
        paidThisBall.add(chip.id);
        const firstLineOfChip = !firstLineSeen.has(chip.id);
        firstLineSeen.add(chip.id);

        for (const src of srcs) {
          const fn = src.as.hooks?.chipPaid;
          if (!fn) continue;
          fn({
            ...lineCtx,
            self: src.self,
            amount,
            firstLineOfChip,
            ...bonus(src, 'chipPaid', ball, chip.id),
            addChipValue(n) {
              plan.deferred.push({ op: 'chipValue', chipId: chip.id, amount: n });
              trigger(src, 'chipPaid', 'chipValue', { amount: n, ...at });
            },
          });
        }
      }
    }

    for (const chip of placed) {
      if (paidThisBall.has(chip.id)) continue;
      const bet = getBet(state.placements[chip.id]);
      plan.losses.push({ ball, chipId: chip.id, betId: bet.id });
      plan.steps.push({ type: 'chipLost', ball, chipId: chip.id, betId: bet.id });
      for (const src of srcs) {
        const fn = src.as.hooks?.chipLost;
        if (fn) fn({ state, self: src.self, ball, landing, chip, bet, ...bonus(src, 'chipLost', ball, chip.id) });
      }
    }
  }

  // A miss is a spin where no chip paid; bonus coins do not undo it (doc 5.5).
  plan.miss = plan.lines.length === 0;
  return plan;
}

/** Applies a plan to a draft and emits its steps as events, in order. */
export function commitPlan(draft, plan, emit) {
  for (const step of plan.steps) emit(step);
  draft.coins = add(draft.coins, add(plan.chipTotal, plan.bonusCoins));
  draft.tokens += plan.bonusTokens;
  draft.stats.tokensEarned += plan.bonusTokens;
  // Deferred changes land after the whole spin is paid, so every line in a
  // spin uses the chip values it started with.
  const touched = new Set();
  for (const d of plan.deferred) {
    const chip = draft.chips.find((c) => c.id === d.chipId);
    if (!chip) continue;
    chip.roundValue = (chip.roundValue ?? 0) + d.amount;
    touched.add(chip);
  }
  for (const chip of touched) emit({ type: 'chipValue', chipId: chip.id, roundValue: chip.roundValue });
}
