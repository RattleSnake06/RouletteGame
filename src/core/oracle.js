import { BET_KINDS, levelOdds, levelOf } from './bets.js';
import { FORTUNES, RECORDS, getTalisman } from './content/index.js';
import { rollEngraving } from './cabinet.js';
import { RARITY } from './economy.js';
import { mul, num } from './num.js';
import { doWork, workRefusal } from './wheelwork.js';

// Madame Zero (design doc 5.9). Once a debt, a pull of her lever deals three
// fortune cards and you take one. The first pull is free and fixes the deal's
// colour: black when the Devil fired this debt before it, white otherwise. A
// reroll deals three new cards of the same colour and costs coins: the debt's
// number plus the rerolls already made. Every deal draws on the fortunes
// stream only, so visiting her never changes a spin.

export const ORACLE = { cards: 3 };

const round6 = (x) => Math.round(x * 1e6) / 1e6;

/** This debt's deal ({ debt, kind, cards, rerolls, taken }), or null before her lever is pulled. */
export const dealOf = (state) => (state.oracle?.debt === state.debt ? state.oracle : null);

/** Coins for a reroll: the debt's number plus the rerolls already made this debt. */
export const rerollCost = (state) => num(state.debt + (dealOf(state)?.rerolls ?? 0));

/**
 * The fortunes that could be dealt now: the right colour, not yet taken as
 * often as a run allows, and able to do something (`hooks`: the rail's hooks).
 */
export function fortunePool(state, kind, hooks) {
  return FORTUNES.filter((d) => d.kind === kind && canTake(state, d, hooks));
}

/** Could this card be taken now: under its limit, and with something to do? */
export function canTake(state, def, hooks) {
  if (def.maxPicks !== null && (state.picks[def.id] ?? 0) >= def.maxPicks) return false;
  const recordsLeft = RECORDS.filter((r) => !state.records.includes(r.id)).length;
  return !def.requires || def.requires(state, { hooks, recordsLeft });
}

/** Up to three different cards, by the Cabinet's rarity reroll. */
export function dealCards(state, kind, rng, hooks) {
  const pool = fortunePool(state, kind, hooks);
  const cards = [];
  while (cards.length < ORACLE.cards && cards.length < pool.length) {
    const left = pool.filter((d) => !cards.includes(d.id));
    let pick = null;
    for (let tries = 0; tries < 64; tries++) {
      pick = left[rng.int(left.length)];
      if (rng.next() < RARITY[pick.rarity].weight) break;
    }
    cards.push(pick.id);
  }
  return cards;
}

/**
 * What a card can do when taken, on the draft. Each change emits a
 * `fortuneEffect` event for the view. `helpers` comes from run.js: hang(def)
 * puts a talisman on the rail for nothing, play(id) puts a record on if a
 * slot of the gramophone is free.
 */
export function fortuneCtx(s, def, emit, rng, helpers) {
  const effect = (kind, more = {}) => emit({ type: 'fortuneEffect', id: def.id, effect: kind, ...more });
  return {
    state: s,
    gainTokens(n) {
      s.tokens += n;
      s.stats.tokensEarned += n;
      effect('tokens', { amount: n });
    },
    setTokens(n) {
      s.tokens = n;
      effect('setTokens', { amount: n });
    },
    setCoins(n) {
      s.coins = num(n);
      effect('setCoins', { amount: s.coins });
    },
    doubleCoins() {
      s.coins = mul(s.coins, 2);
      effect('setCoins', { amount: s.coins });
    },
    rechargeBell() {
      const uids = [];
      for (const inst of s.rail) {
        const max = getTalisman(inst.id)?.charges?.max;
        if (!max || inst.charges >= max) continue;
        inst.charges = max;
        uids.push(inst.uid);
      }
      effect('recharged', { uids });
    },
    discount(n) {
      s.cabinet.discount += n;
      effect('discount', { amount: n });
    },
    freeBuys(n) {
      s.cabinet.freeBuys += n;
      effect('freeBuys', { amount: n });
    },
    /** Pockets passing `test` grow by `amount`, for good: wheel work, not a talisman's lean. */
    widen(test, amount) {
      let count = 0;
      s.wheel = {
        ...s.wheel,
        pockets: s.wheel.pockets.map((p) => {
          if (!test(p)) return p;
          count += 1;
          return { ...p, width: round6(p.width + amount) };
        }),
      };
      effect('widen', { amount, count });
    },
    /** Wheel work on one target (it must be able to act there). */
    work(work, target) {
      if (!workRefusal(s, work, target)) doWork(s, work, target, emit, { kind: 'fortune', id: def.id });
    },
    /**
     * The work on up to `n` different pockets at random, from the fortunes
     * stream; `plain` keeps to pockets with no enhancement yet.
     */
    workRandom(work, n, { plain = false } = {}) {
      const free = s.wheel.pockets.filter((p) => (!plain || !p.enh) && !workRefusal(s, work, p.id));
      for (let i = 0; i < n && free.length; i++) {
        const [pocket] = free.splice(rng.int(free.length), 1);
        doWork(s, work, pocket.id, emit, { kind: 'fortune', id: def.id });
      }
    },
    /** These kinds of bet go up a level each (doc 5.3). */
    levelUp(kinds) {
      for (const kind of kinds) {
        const level = levelOf(s, kind) + 1;
        s.levels = { ...s.levels, [kind]: level };
        emit({ type: 'betLevel', kind, level, odds: levelOdds(kind, level), by: { kind: 'fortune', id: def.id } });
      }
      effect('levels', { kinds });
    },
    /** The oldest figure standing in the dark goes (doc 7.3): the run counts one fewer, and the profile drops it. */
    sendFigureAway() {
      if (s.figures > 0) s.figures -= 1;
      effect('figureGone');
    },
    addHook() {
      s.railHooks += 1;
      effect('hook', { amount: 1 });
    },
    giveRecord() {
      const left = RECORDS.filter((r) => !s.records.includes(r.id));
      if (!left.length) return;
      const record = left[rng.int(left.length)];
      s.records = [...s.records, record.id];
      effect('record', { record: record.id });
      helpers.play(record.id);
    },
    /** A random talisman gets a random engraving; `only` names it instead (and may replace one). */
    engraveTalisman({ cursed = true, only = null } = {}) {
      const pool = only ? s.rail : s.rail.filter((t) => !t.engraving);
      if (!pool.length) return;
      const inst = pool[rng.int(pool.length)];
      inst.engraving = only ?? rollEngraving(rng, { cursed, always: true });
      effect('engraved', { uid: inst.uid, engraving: inst.engraving });
    },
    /** Every talisman on offer in the Cabinet is engraved. */
    engraveOffers() {
      for (const offer of s.cabinet.slots) {
        if (offer.kind !== 'talisman' || !offer.id || offer.sold) continue;
        offer.engraving = rollEngraving(rng, { always: true });
      }
      effect('offersEngraved');
    },
    /** A talisman hangs on the rail for nothing (a cursed one, from a black card). */
    hang(id) {
      const inst = helpers.hang(getTalisman(id));
      effect('hung', { uid: inst.uid, talisman: id });
    },
  };
}
