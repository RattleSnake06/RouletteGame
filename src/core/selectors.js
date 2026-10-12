import { bellQueue, canAnswer } from './bell.js';
import { betCovers, getBet } from './bets.js';
import { getTalisman } from './content/index.js';
import { RARITY, priceOf, sellValueOf } from './economy.js';
import { devilChanceFor, devilLive } from './devil.js';
import { copyTarget, echoTarget, sources } from './effects.js';
import { nudgeFor } from './nudge.js';
import { evaluate } from './payout.js';
import { TALISMANS } from './content/index.js';
import { nextRestockCost } from './run.js';
import { restockCost } from './economy.js';
import { gte } from './num.js';
import { liveWheel } from './widths.js';

// Pure read models for the view and the sim. Nothing here changes state.

/** The rail as the view needs it, left to right. */
export function railView(state) {
  return state.rail.map((inst, index) => {
    const def = getTalisman(inst.id);
    const mirror = def?.copies === 'right';
    const target = mirror ? copyTarget(state.rail, index) : null;
    const echo = def?.echoes ? echoTarget(state.rail, index) : null;
    return {
      uid: inst.uid,
      id: inst.id,
      name: def?.name ?? inst.id,
      rarity: def?.rarity ?? 'common',
      text: def?.text ?? '',
      charges: inst.charges,
      maxCharges: def?.charges?.max ?? null,
      status: def?.status ? def.status(inst.data, state, inst) : null,
      cursed: !!def?.cursed,
      sellValue: def?.cursed ? null : sellValueOf(inst.price),
      copying: target?.id ?? null,
      echoing: echo?.id ?? null,
      // A fork with nothing to its left that has hooks to repeat stays dark too.
      dim: (mirror && (!target || !!inst.data.copy?.[target.id]?.gone)) || (!!def?.echoes && !Object.keys(echo?.hooks ?? {}).length),
      active: !!def?.bell,
      targetOnly: !!def?.bell?.targetOnly,
      usable: canAnswer(state, inst),
      data: inst.data,
    };
  });
}

/**
 * Each rarity's chance in the first compartment. Talismans on the rail are
 * never offered, so with a state the odds follow what is owned.
 */
export function rarityOdds(state = null) {
  const owned = new Set(state?.rail.map((t) => t.id) ?? []);
  const totals = {};
  let sum = 0;
  for (const d of TALISMANS) {
    if (!d.inCabinet || owned.has(d.id)) continue;
    totals[d.rarity] = (totals[d.rarity] ?? 0) + RARITY[d.rarity].weight;
    sum += RARITY[d.rarity].weight;
  }
  return Object.fromEntries(Object.keys(RARITY).map((r) => [r, sum ? (totals[r] ?? 0) / sum : 0]));
}

export function cabinetView(state) {
  const railFree = state.rail.length < state.railHooks;
  return {
    slots: state.cabinet.slots.map((offer, slot) => {
      if (offer.kind !== 'talisman') return { slot, kind: offer.kind, shut: !!offer.shut };
      const def = offer.id ? getTalisman(offer.id) : null;
      if (!def) return { slot, kind: 'talisman', sold: true };
      const price = priceOf(def.rarity);
      return {
        slot,
        kind: 'talisman',
        id: def.id,
        name: def.name,
        rarity: def.rarity,
        text: def.text,
        price,
        sold: false,
        affordable: state.tokens >= price,
        short: Math.max(0, price - state.tokens),
        // An instant talisman never takes a hook, so a full rail never stops it.
        hookFree: railFree || def.instant,
        instant: def.instant,
      };
    }),
    restockCost: nextRestockCost(state),
    canRestock: gte(state.coins, nextRestockCost(state)),
    nextRestockCost: restockCost(state.debt, state.cabinet.paidRestocks + 1),
    rarityOdds: rarityOdds(state),
  };
}

/**
 * The House's luck as the room shows it, for the next spin: the Nudge (with
 * what it is made of and what restricts it) and the Devil's chance.
 */
export function luckView(state) {
  const charms = [];
  const nudge = nudgeFor(state, (e) => charms.push({ uid: e.src.uid, id: e.src.id, as: e.src.as, effect: e.effect, amount: e.amount ?? null }));
  const devil = [];
  const chance = devilChanceFor(state, (e) => devil.push({ uid: e.src.uid, id: e.src.id, as: e.src.as, effect: e.effect, amount: e.amount }));
  return {
    ...nudge,
    charmSources: charms,
    missStreak: state.missStreak,
    devil: {
      live: devilLive(state),
      chance,
      sources: devil,
      firedThisDebt: state.devil.firedThisDebt,
      // The talisman that would turn him away (Holy Water), if any.
      ward: sources(state).find((src) => src.as.hooks?.ward)?.inst.uid ?? null,
    },
  };
}

/**
 * The wheel as the ball meets it, for the view: each pocket's number, colour,
 * live width (talismans included) and chance, in wheel order.
 */
export function wheelView(state) {
  const { pockets } = liveWheel(state);
  let total = 0;
  for (const p of pockets) total += p.width;
  return pockets.map((p) => ({ number: p.number, color: p.color, width: p.width, chance: p.width / total }));
}

export function bellView(state) {
  const queue = bellQueue(state);
  return {
    queue,
    head: queue[0] ?? null,
    owned: state.rail.filter((t) => getTalisman(t.id)?.bell).map((t) => t.uid),
  };
}

/**
 * What one chip on this bet pays when the bet wins, with the rail as it is:
 * { odds, stake, oddsMult, mult, pays, paysMax, amount, sources }. pays is the
 * return per unit of chip value on the least generous number the bet covers
 * (some talismans care which number lands, e.g. the Ledger); paysMax is the
 * most generous.
 */
export function previewBet(state, betId, value = 1) {
  const bet = getBet(betId);
  const chip = { id: '__preview', value, material: 'clay', roundValue: 0 };
  const probe = { ...state, chips: [chip], placements: { [chip.id]: betId } };
  let worst = null;
  let best = null;
  state.wheel.pockets.forEach((pocket, at) => {
    if (!betCovers(bet, pocket)) return;
    const plan = evaluate(probe, [{ ball: 0, pocketIndex: at }]);
    const line = plan.lines.find((l) => l.chipId === chip.id && l.hit.primary);
    if (!line) return;
    const f = line.factors;
    const pays = f.stake * f.odds * f.oddsMult * f.mult;
    if (!best || pays > best) best = pays;
    if (worst && pays >= worst.pays) return;
    const sources = plan.steps.filter((s) => s.type === 'trigger' && s.chipId === chip.id).map((s) => ({ ...s.src, effect: s.effect, amount: s.amount }));
    worst = { odds: f.odds, stake: f.stake, oddsMult: f.oddsMult, mult: f.mult, amount: line.amount, pays, sources };
  });
  return worst && { ...worst, paysMax: best };
}
