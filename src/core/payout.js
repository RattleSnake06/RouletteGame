import { betCovers, betOdds, getBet, levelOf } from './bets.js';
import { getEnhancement, getMaterial } from './content/index.js';
import { sources, srcRef, writeData } from './effects.js';
import { add, mulFloor } from './num.js';
import { isBlank } from './wheel.js';

// One spin's payout, worked out before anything changes (doc 5.5). evaluate()
// is pure: the spin uses it, Wheel of Fortune uses it to tell a miss, the bet
// notes use it for previews, and Phase 3's Nudge will use it to score pockets.
//
// Payout of one paying line (a chip on a hit pocket):
//   value × Stake × odds × Odds mult × pocket mult × hit mult × each × talisman
// floored once at the end. The chip's material acts first (its ×, decision
// 26), then the pocket's enhancement (gilded ×2, platinum ×3, glass ×4; doc
// 6.5); then talismans act left to right along the rail: for each line, each
// source runs chipStake, chipOdds and chipMult in turn. A blank pocket pays
// nothing, whatever covers it.

/** The plaques at rest. Later phases add global Stake and Odds here. */
export function baseFactors() {
  return { stake: 1, oddsMult: 1 };
}

export const chipValue = (chip) => chip.value + (chip.roundValue ?? 0);

/** How an event names a chip's material as its source: the chip, and what it is made of. */
const materialRef = (chip) => ({ uid: chip.id, id: getMaterial(chip.material).id, as: getMaterial(chip.material).id, chip: true });
/** How an event names a pocket's enhancement as its source. */
export const pocketRef = (pocket) => ({ uid: pocket.id, id: pocket.enh, as: pocket.enh, pocket: true });

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
    chipTokens: 0, // tokens from chip materials (Gold), counted against the night's cap
    pocketTokens: 0, // tokens from Bone pockets
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
    // A Bone pocket pays its token whatever was bet (doc 6.5).
    const landedOn = getEnhancement(pocket.enh);
    if (landedOn?.tokens) {
      plan.bonusTokens += landedOn.tokens;
      plan.pocketTokens += landedOn.tokens;
      plan.steps.push({ type: 'trigger', src: pocketRef(pocket), hook: 'ballLanded', effect: 'tokens', amount: landedOn.tokens, ball, pocketIndex });
    }

    const paidThisBall = new Set();
    for (const hit of hits) {
      if (isBlank(hit.pocket)) continue;
      const enh = getEnhancement(hit.pocket.enh);
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
          odds: betOdds(bet, levelOf(state, bet.kind)),
          oddsMult: base.oddsMult,
          pocketMult: 1,
          hitMult: hit.mult,
          mult: 1,
        };
        // Chips that already paid this spin, this one aside (the Domino counts them).
        const paidBefore = firstLineSeen.size - (firstLineSeen.has(chip.id) ? 1 : 0);
        const lineCtx = { state, ball, landing, hit, chip, bet, factors, paidBefore };
        const at = { ball, chipId: chip.id };
        // The chip's material acts first, on its own lines only (decision 26).
        const material = getMaterial(chip.material);
        if (material.payout !== 1) {
          factors.mult *= material.payout;
          plan.steps.push({ type: 'trigger', src: materialRef(chip), hook: 'chipMult', effect: 'mult', amount: material.payout, ...at });
        }
        // Then the pocket that pays: gilded, platinum or glass.
        if (enh && enh.mult !== 1) {
          factors.pocketMult *= enh.mult;
          plan.steps.push({ type: 'trigger', src: pocketRef(hit.pocket), hook: 'pocketMult', effect: 'mult', amount: enh.mult, ...at });
        }
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
        // Gold: a token for each chip that wins, up to the night's cap.
        if (firstLineOfChip && material.winTokens && (state.chipTokens ?? 0) + plan.chipTokens < material.tokenCap) {
          const n = Math.min(material.winTokens, material.tokenCap - (state.chipTokens ?? 0) - plan.chipTokens);
          plan.bonusTokens += n;
          plan.chipTokens += n;
          plan.steps.push({ type: 'trigger', src: materialRef(chip), hook: 'chipPaid', effect: 'tokens', amount: n, ...at });
        }
        // An Ember pocket: a chip that wins there grows, for good, once a spin.
        if (enh?.chipValue && !plan.deferred.some((d) => d.op === 'chipBase' && d.chipId === chip.id)) {
          plan.deferred.push({ op: 'chipBase', chipId: chip.id, amount: enh.chipValue });
          plan.steps.push({ type: 'trigger', src: pocketRef(hit.pocket), hook: 'chipPaid', effect: 'chipBase', amount: enh.chipValue, ...at });
        }

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

  // Once every line is known: talismans that pay on the spin as a whole (the
  // Beckoning Cat). Their coins are part of what a landing pays, so Nudge
  // and the previews see them.
  const winners = new Set(plan.lines.map((l) => l.chipId)).size;
  for (const src of srcs) {
    const fn = src.as.hooks?.spinPaid;
    if (!fn) continue;
    fn({
      state,
      self: src.self,
      winners,
      lines: plan.lines,
      ...bonus(src, 'spinPaid', null),
      setData(key, value) {
        plan.deferred.push({ op: 'data', uid: src.inst.uid, copyOf: src.copyOf, self: src.self, key, value });
      },
    });
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
  draft.chipTokens = (draft.chipTokens ?? 0) + plan.chipTokens;
  // Deferred changes land after the whole spin is paid, so every line in a
  // spin uses the chip values it started with.
  const touched = new Set();
  for (const d of plan.deferred) {
    if (d.op === 'data') {
      const inst = draft.rail.find((t) => t.uid === d.uid);
      if (inst) writeData(inst, d.copyOf, d.self, d.key, d.value);
      continue;
    }
    const chip = draft.chips.find((c) => c.id === d.chipId);
    if (!chip) continue;
    if (d.op === 'chipBase') chip.value += d.amount;
    else chip.roundValue = (chip.roundValue ?? 0) + d.amount;
    touched.add(chip);
  }
  for (const chip of touched) emit({ type: 'chipValue', chipId: chip.id, roundValue: chip.roundValue, value: chip.value });
}
