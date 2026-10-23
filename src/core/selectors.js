import { bellQueue, canAnswer } from './bell.js';
import { betCovers, getBet } from './bets.js';
import { RECORDS, getEnhancement, getEngraving, getFortune, getMaterial, getOddity, getRecord, getTalisman } from './content/index.js';
import { ECONOMY, RARITY, priceOf, sellValueOf } from './economy.js';
import { devilChanceFor, devilLive } from './devil.js';
import { copyTarget, echoTarget, sources } from './effects.js';
import { nudgeFor } from './nudge.js';
import { evaluate } from './payout.js';
import { TALISMANS } from './content/index.js';
import { copyRun, costOf, freeRestockBy, hooksFor, oddityPrice, offerPrice, owed, restockPrice } from './run.js';
import { canTake, dealOf, rerollCost } from './oracle.js';
import { restockCost } from './economy.js';
import { gte, max, sub } from './num.js';
import { liveWheel } from './widths.js';
import { BET_KINDS, levelOdds, levelOf, tableCell } from './bets.js';
import { isBlank, isHousePocket } from './wheel.js';
import { getStartingWheel } from './content/index.js';
import { numberCount } from './house.js';
import { doWork, workRefusal, workTargets } from './wheelwork.js';

// Pure read models for the view and the sim. Nothing here changes state.

/** The rail as the view needs it, left to right. */
export function railView(state) {
  const srcs = sources(state);
  return state.rail.map((inst, index) => {
    const def = getTalisman(inst.id);
    const mirror = def?.copies === 'right';
    const target = mirror ? copyTarget(state.rail, index) : null;
    const echo = def?.echoes ? echoTarget(state.rail, index) : null;
    // Lit when it really acts: a used-up copy, or a fork beside something it
    // cannot repeat (no hooks, or an effect that cannot happen twice), is dark.
    const acts = mirror ? srcs.some((x) => x.inst === inst && x.kind === 'talisman') : def?.echoes ? srcs.some((x) => x.by === inst && Object.keys(x.as.hooks ?? {}).length) : true;
    const engraving = getEngraving(inst.engraving);
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
      dim: !acts,
      active: !!def?.bell,
      targetOnly: !!def?.bell?.targetOnly,
      // Wheel work its ring does (the Number Punches): you choose where.
      work: def?.bell?.work ?? null,
      usable: canAnswer(state, inst),
      data: inst.data,
      engraving: engraving && { id: engraving.id, name: engraving.name, text: engraving.text, cursed: !!engraving.cursed },
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
  const railFree = state.rail.length < hooksFor(state);
  return {
    slots: state.cabinet.slots.map((offer, slot) => {
      if (offer.kind === 'oddity') return oddityOffer(state, slot, offer);
      if (offer.kind !== 'talisman') return { slot, kind: offer.kind, shut: !!offer.shut };
      const def = offer.id ? getTalisman(offer.id) : null;
      if (!def) return { slot, kind: 'talisman', sold: true };
      const price = offerPrice(state, def);
      const engraving = getEngraving(offer.engraving);
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
        // Full price, when a fortune lowered it.
        listPrice: priceOf(def.rarity),
        engraving: engraving && { id: engraving.id, name: engraving.name, text: engraving.text, cursed: !!engraving.cursed },
      };
    }),
    restockCost: restockPrice(state),
    restockFree: !!freeRestockBy(state),
    canRestock: gte(state.coins, restockPrice(state)),
    freeBuys: state.cabinet.freeBuys,
    discount: state.cabinet.discount,
    nextRestockCost: restockCost(state.debt, state.cabinet.paidRestocks + 1),
    rarityOdds: rarityOdds(state),
  };
}

/** The oddity compartment: what is in it, its price in coins, and whether it could do its work now. */
function oddityOffer(state, slot, offer) {
  const def = offer.id && !offer.sold ? getOddity(offer.id) : null;
  if (!def) return { slot, kind: 'oddity', sold: true };
  const price = oddityPrice(state, def);
  return {
    slot,
    kind: 'oddity',
    id: def.id,
    name: def.name,
    rarity: def.rarity,
    text: def.text,
    price,
    currency: 'coins',
    spins: def.spins,
    sold: false,
    affordable: gte(state.coins, price),
    short: max(0, sub(price, state.coins)),
    picks: def.picks,
    // What it puts in your hands: a chip's material, or the record it holds.
    chip: def.gives?.chip ?? null,
    record: offer.record ? { id: offer.record, name: getRecord(offer.record)?.name ?? offer.record, rule: getRecord(offer.record)?.rule ?? '' } : null,
    // Its first pick needs somewhere to act (a later one can always take the
    // same pocket again or another); a chip needs room in your hands.
    workable: def.picks.length ? workTargets(state, def.picks[0]).length > 0 : def.gives?.chip ? state.chips.length < ECONOMY.maxChips : !state.records.includes(offer.record),
  };
}

/**
 * The payout placard (doc 5.11): every kind of bet with its base odds, its
 * level and what it pays now, in the felt's order.
 */
export function levelsView(state) {
  return Object.entries(BET_KINDS).map(([kind, k]) => ({ kind, name: k.name, base: k.odds, level: levelOf(state, kind), odds: levelOdds(kind, levelOf(state, kind)) }));
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
 * The wheel as the ball meets it, for the view: each pocket's id, number,
 * colour, enhancement, live width (talismans included) and chance, in wheel
 * order. A blank pocket has no number and no colour.
 */
export function wheelView(state) {
  const { pockets } = liveWheel(state);
  let total = 0;
  for (const p of pockets) total += p.width;
  return pockets.map((p) => ({ id: p.id, number: p.number, color: p.color, enh: p.enh ?? null, width: p.width, chance: p.width / total }));
}

/**
 * Every number as the felt shows it (doc 5.4): its chance on the live wheel
 * and the pockets that carry it (none when it was chiselled away or stamped
 * over), so the felt can follow the paint, mark duplicates "×2" and show
 * enhancements. `blanks` are the pockets with no number.
 */
export function numbersView(state) {
  const wheel = wheelView(state);
  const numbers = Array.from({ length: numberCount(state) }, (_, n) => ({ number: n, chance: 0, pockets: [] }));
  const blanks = { chance: 0, pockets: [] };
  const house = { chance: 0, pockets: [] };
  for (const p of wheel) {
    const into = isHousePocket(p) ? house : isBlank(p) ? blanks : numbers[p.number];
    into.chance += p.chance;
    into.pockets.push({ id: p.id, color: p.color, enh: p.enh, width: p.width });
  }
  return { numbers, blanks, house };
}

/**
 * The stats chalkboard (doc 5.11): the live chance of every number, colour,
 * dozen, column and half, the pockets and what is done to them, and how the
 * wheel differs from the House's own.
 */
export function statsView(state) {
  const wheel = wheelView(state);
  const { numbers, blanks, house } = numbersView(state);
  const colors = { red: 0, black: 0, green: house.chance, blank: blanks.chance };
  const dozens = [0, 0, 0];
  const columns = [0, 0, 0];
  const halves = { low: 0, high: 0, odd: 0, even: 0 };
  for (const p of wheel) {
    if (isBlank(p)) continue;
    colors[p.color] += p.chance;
    if (p.number < 1 || p.number > 36) continue;
    const { col, row } = tableCell(p.number);
    dozens[Math.floor(col / 4)] += p.chance;
    columns[row] += p.chance;
    halves[p.number <= 18 ? 'low' : 'high'] += p.chance;
    halves[p.number % 2 ? 'odd' : 'even'] += p.chance;
  }
  const enhanced = wheel.filter((p) => p.enh && !isHousePocket(p)).map((p) => ({ id: p.id, number: p.number, enh: p.enh, name: getEnhancement(p.enh)?.name ?? p.enh }));
  // The run's starting wheel as it came, to compare against.
  const plain = getStartingWheel(state.wheelId).order.length;
  return {
    pockets: wheel.length,
    plainPockets: plain,
    numbers: numbers.map((n) => ({ number: n.number, chance: n.chance, count: n.pockets.length, colors: [...new Set(n.pockets.map((p) => p.color))], enh: n.pockets.map((p) => p.enh).filter(Boolean) })),
    blanks: blanks.pockets.length,
    house: house.pockets.length,
    colors,
    dozens,
    columns,
    halves,
    enhanced,
    // The fair chance of one number on the starting wheel, to compare against.
    fair: 1 / plain,
  };
}

/**
 * What the next pick of some wheel work could act on, after the picks chosen
 * so far (each done in turn on a copy of the run): `works` are the picks in
 * order (an oddity's, or the Number Punches' stamps), `chosen` their targets
 * so far. Returns { work, index, last, numbers, blanks } for the felt: for
 * pocket work, each number lists the pockets with it the work could act on
 * (`blanks` the blank ones); for number work, `numbers[n]` is true when it
 * can act on n. A stamp's pocket can be any pocket; its number is a second tap.
 */
export function pickView(state, works, chosen = []) {
  let s = state;
  if (chosen.length) {
    s = copyRun(state);
    chosen.forEach((t, i) => !workRefusal(s, works[i], t) && doWork(s, works[i], t, () => {}, null));
  }
  const index = chosen.length;
  const work = works[index];
  if (!work) return null;
  const numbers = {};
  const blanks = [];
  // A level is for a kind of bet: every spot on the felt can take it.
  if (work.on === 'bet') return { work, index, last: index === works.length - 1, numbers, blanks, bets: true, pockets: s.wheel.pockets.length };
  const count = numberCount(s);
  if (work.on === 'number') {
    for (let n = 0; n < count; n++) numbers[n] = !workRefusal(s, work, n);
  } else {
    const ok = new Set(workTargets(s, work));
    for (let n = 0; n < count; n++) numbers[n] = [];
    for (const p of s.wheel.pockets) {
      if (!ok.has(p.id)) continue;
      const entry = { id: p.id, color: p.color, enh: p.enh, width: p.width };
      if (isBlank(p)) blanks.push(entry);
      else numbers[p.number].push(entry);
    }
  }
  return { work, index, last: index === works.length - 1, numbers, blanks, pockets: s.wheel.pockets.length };
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
  // The run's own material, so a note says what this run's chips would pay.
  const chip = { id: '__preview', value, material: state.chipSet ?? 'normal', roundValue: 0 };
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

/** How often this bet wins on the live wheel, before Nudge (doc 5.4: the felt says what the wheel does). */
export function betChance(state, betId) {
  const bet = getBet(betId);
  const { pockets } = liveWheel(state);
  let total = 0;
  let hit = 0;
  for (const p of pockets) {
    total += p.width;
    if (betCovers(bet, p)) hit += p.width;
  }
  return hit / total;
}

/**
 * Madame Zero (doc 5.9): whether her lever has been pulled this debt, the
 * cards on her counter, what a reroll costs, and whether a card can be taken.
 */
export function oracleView(state) {
  const deal = dealOf(state);
  const hooks = hooksFor(state);
  return {
    dealt: !!deal,
    kind: deal?.kind ?? (state.devil.firedThisDebt ? 'black' : 'white'),
    taken: deal?.taken ?? null,
    rerolls: deal?.rerolls ?? 0,
    rerollCost: deal ? rerollCost(state) : 0,
    canReroll: !!deal && deal.taken === null && gte(state.coins, rerollCost(state)),
    cards: (deal?.cards ?? []).map((id, index) => {
      const def = getFortune(id);
      return { index, id, kind: def.kind, rarity: def.rarity, text: def.text, effect: def.effect, lore: def.lore, takeable: deal.taken === null && canTake(state, def, hooks), taken: deal.taken === index };
    }),
  };
}

/**
 * The gramophone (doc 5.10): what plays, and the crate. `playing` is its
 * first slot, `second` the slot the Vault's second lock opens (`slots` 2).
 */
export function gramophoneView(state) {
  const view = (id) => {
    const r = getRecord(id);
    return r && { id: r.id, name: r.name, rule: r.rule, tune: r.tune, reverse: !!r.reverse };
  };
  const playing = view(state.playing);
  const second = view(state.playing2);
  return {
    playing,
    second,
    slots: state.gramophoneSlots ?? 1,
    // The wheel turns backwards if either slot plays Carousel.
    reverse: !!(playing?.reverse || second?.reverse),
    crate: state.records.map((id) => {
      const r = getRecord(id);
      return { id, name: r.name, rule: r.rule, tune: r.tune, playing: id === state.playing || id === state.playing2 };
    }),
    known: RECORDS.length,
  };
}

/** What the Cage collects and a night's prices, with the gramophone's rules (Overture, Waltz). */
export function pricesView(state) {
  return { owed: owed(state), doubled: state.overture === state.debt, long: costOf(state, 'long'), short: costOf(state, 'short') };
}
