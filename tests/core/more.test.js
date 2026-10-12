import { describe, expect, it } from 'vitest';
import { registerTestTalisman } from '../../src/core/content/index.js';
import { DEVIL, devilChanceFor } from '../../src/core/devil.js';
import { omen } from '../../src/core/effects.js';
import { nudgeFor, nudgeLandings } from '../../src/core/nudge.js';
import { evaluate } from '../../src/core/payout.js';
import { act, grantTalisman } from '../../src/core/run.js';
import { cabinetView, luckView, railView, wheelView } from '../../src/core/selectors.js';
import { EUROPEAN_ORDER } from '../../src/core/wheel.js';
import { liveChances, liveWheel } from '../../src/core/widths.js';
import { noHouseLuck, play, pocketOf, setup, spinOn } from './helpers.js';

// The twenty talismans added for variety and combos (design doc 6.1).

/** What these chips pay if the ball lands on `n` (no Nudge). */
const paysOn = (state, n) => evaluate(state, [{ ball: 0, pocketIndex: pocketOf(n) }]);
const amounts = (plan) => plan.lines.map((l) => l.amount);

/** Plays `n` spins, choosing long nights, ending nights and paying debts as needed. */
function spinMany(state, n) {
  let s = { ...state, coins: 1e6, deposited: 1e7 };
  let spins = 0;
  const events = [];
  while (spins < n) {
    const action = s.phase === 'roundStart' ? { type: 'choosePackage', packageId: 'long' } : s.phase === 'betting' ? { type: 'spin' } : { type: 'endNight' };
    const r = play(s, action);
    s = r.state;
    events.push(...r.events);
    if (action.type === 'spin') spins += 1;
  }
  return { state: s, events };
}

/** Forces the Devil to fire on every throw while `fn` runs. */
function withDevil(fn) {
  const cap = DEVIL.cap;
  DEVIL.cap = 1;
  try {
    return fn(registerTestTalisman({ id: 'test_hellfire', name: 'Hellfire', rarity: 'common', hooks: { devilChance: (ctx) => ctx.addChance(1) } }));
  } finally {
    DEVIL.cap = cap;
  }
}

describe('Tuning Fork', () => {
  it('triggers the talisman to its left again; the fork is what shakes', () => {
    const s = setup({ rail: ['red_ribbon', 'tuning_fork'], chips: { c1: 'red' } });
    const plan = paysOn(s, 32);
    expect(plan.lines[0].factors.stake).toBe(3);
    expect(amounts(plan)).toEqual([6]);
    const [ribbon, fork] = s.rail;
    const stakes = plan.steps.filter((e) => e.type === 'trigger' && e.effect === 'stake');
    expect(stakes.map((e) => e.src)).toEqual([
      { uid: ribbon.uid, id: 'red_ribbon', as: 'red_ribbon' },
      { uid: fork.uid, id: 'tuning_fork', as: 'red_ribbon', echo: ribbon.uid },
    ]);
  });

  it('forks pass through forks, and a fork with nothing to its left is dark', () => {
    const two = setup({ rail: ['horseshoe', 'tuning_fork', 'tuning_fork'], chips: { c1: 'straight:17' } });
    expect(paysOn(two, 17).lines[0].factors.odds).toBe(36 + 12 * 3);
    const alone = setup({ rail: ['tuning_fork', 'horseshoe'], chips: { c1: 'straight:17' } });
    expect(paysOn(alone, 17).lines[0].factors.odds).toBe(48);
    expect(railView(alone)[0]).toMatchObject({ echoing: null, dim: true });
    expect(railView(two)[1]).toMatchObject({ echoing: 'horseshoe', dim: false });
  });

  it('repeats on the original: a Piggy Bank grows twice a spin', () => {
    const s = setup({ rail: ['piggy_bank', 'tuning_fork'] });
    const { state } = spinOn(s, 5);
    expect(state.rail[0].data.value).toBe(2);
  });

  it('echoes a Twin Mirrors copy, and Twin Mirrors cannot copy a fork', () => {
    const s = setup({ rail: ['twin_mirrors', 'horseshoe', 'tuning_fork'], chips: { c1: 'straight:17' } });
    expect(paysOn(s, 17).lines[0].factors.odds).toBe(36 + 12 * 3);
    const dark = setup({ rail: ['horseshoe', 'twin_mirrors', 'tuning_fork'], chips: { c1: 'straight:17' } });
    expect(railView(dark)[1]).toMatchObject({ copying: null, dim: true });
    // The fork echoes the dark mirror, which does nothing.
    expect(paysOn(dark, 17).lines[0].factors.odds).toBe(48);
  });

  it('echoes Nudge and the Devil, but never a sale', () => {
    const lucky = setup({ rail: ['rabbits_foot', 'tuning_fork'] });
    expect(nudgeFor(noHouseLuck(lucky))).toMatchObject({ total: 2, charms: 2 });
    const eye = { ...setup({ rail: ['evil_eye', 'tuning_fork'] }), debt: 3 };
    expect(devilChanceFor(eye)).toBeCloseTo(0.015 / 4, 9);
    const tip = registerTestTalisman({ id: 'test_tip', name: 'Tip', rarity: 'common', hooks: { sold: (ctx) => ctx.isSelf && ctx.gainTokens(1) } });
    const s = setup({ rail: [tip.id, 'tuning_fork'] });
    const { state } = play(s, { type: 'sell', uid: s.rail[0].uid });
    expect(state.tokens).toBe(s.tokens + 1 + 1); // the refund and the tip, once
  });
});

describe('Brass Scales: wider even pockets', () => {
  it('doubles every even pocket, on the live wheel only', () => {
    const s = setup({ rail: ['brass_scales'] });
    const live = liveWheel(s);
    for (const p of live.pockets) expect(p.width).toBe(p.number !== 0 && p.number % 2 === 0 ? 2 : 1);
    expect(s.wheel.pockets.every((p) => p.width === 1)).toBe(true);
    const evenChance = liveChances(s).reduce((t, c, i) => t + (live.pockets[i].number % 2 === 0 && live.pockets[i].number ? c : 0), 0);
    expect(evenChance).toBeCloseTo(36 / 55, 9);
    expect(wheelView(s).find((p) => p.number === 2)).toMatchObject({ width: 2, chance: 2 / 55 });
  });

  it('a fork widens them again', () => {
    const s = setup({ rail: ['brass_scales', 'tuning_fork'] });
    expect(liveWheel(s).pockets.find((p) => p.number === 2).width).toBe(3);
  });

  it('the spin and the Glass Eye draw from the live widths', () => {
    const magnet = registerTestTalisman({ id: 'test_magnet', name: 'Magnet', rarity: 'common', hooks: { widths: (ctx) => ctx.widen((p) => p.number === 17, 1e9) } });
    let s = setup({ rail: [magnet.id, 'glass_eye'] });
    s = play(s, { type: 'choosePackage', packageId: 'long' }).state;
    for (let i = 0; i < 5; i++) {
      const r = play(s, { type: 'spin' });
      expect(r.state.lastSpin.number).toBe(17);
      expect(r.events.some((e) => e.type === 'trigger' && e.hook === 'widths')).toBe(true);
      s = r.state;
    }
    s = play(s, { type: 'ringBell' }).state;
    expect(EUROPEAN_ORDER[s.foreseen.pocketIndex]).toBe(17);
  });
});

describe('String of Pearls', () => {
  it('Even chips +1 Odds, and +1 more for each even number tonight; the string breaks at dawn', () => {
    let s = setup({ rail: ['string_of_pearls'], chips: { c1: 'even' } });
    expect(paysOn(s, 2).lines[0].factors.odds).toBe(3);
    s = spinOn(s, 2).state;
    expect(s.rail[0].data.pearls).toBe(1);
    s = spinOn(s, 0).state; // zero is not even
    s = spinOn(s, 7).state;
    expect(s.rail[0].data.pearls).toBe(1);
    expect(paysOn(s, 4).lines[0].factors.odds).toBe(4);
    s = play({ ...s, phase: 'nightOver' }, { type: 'endNight' }).state;
    expect(s.rail[0].data.pearls).toBe(0);
  });

  it('with a fork it strings two pearls a hit, and pays both', () => {
    let s = setup({ rail: ['string_of_pearls', 'tuning_fork'], chips: { c1: 'even' } });
    s = spinOn(s, 2).state;
    expect(s.rail[0].data.pearls).toBe(2);
    expect(paysOn(s, 4).lines[0].factors.odds).toBe(2 + 3 + 3);
  });
});

describe('luck talismans', () => {
  it('Wind-Up Key: pity after 2 misses, not 5; a Black Candle still blocks it', () => {
    const s = setup({ rail: ['wind_up_key'] });
    const pity = (streak, state = s) => nudgeFor({ ...noHouseLuck(state), missStreak: streak }).pity;
    expect([0, 1, 2, 3, 4, 5].map((n) => pity(n))).toEqual([0, 0, 1, 2, 3, 4]);
    const candle = setup({ rail: ['wind_up_key', 'black_candle'] });
    expect(nudgeFor({ ...noHouseLuck(candle), missStreak: 3 })).toMatchObject({ pity: 0, pityBlocked: true });
  });

  it('Hamsa: +3 on the night\'s last spin only', () => {
    let s = setup({ rail: ['hamsa'] });
    expect(nudgeFor(noHouseLuck(s)).total).toBe(0); // no night chosen yet
    s = play(s, { type: 'choosePackage', packageId: 'short' }).state;
    expect(nudgeFor(noHouseLuck(s)).total).toBe(0);
    s = { ...s, spinsLeft: 1 };
    expect(nudgeFor(noHouseLuck(s))).toMatchObject({ total: 3, charms: 3 });
  });

  it('Four-Leaf Clover: +3 on about 1 spin in 4, known before the spin; wilts after 6 blooms', () => {
    const s = setup({ rail: ['four_leaf_clover'] });
    let blooms = 0;
    for (let k = 0; k < 2000; k++) if (omen({ ...s, stats: { ...s.stats, spins: k } }, 'four_leaf_clover') < 0.25) blooms += 1;
    expect(blooms / 2000).toBeGreaterThan(0.22);
    expect(blooms / 2000).toBeLessThan(0.28);
    // Play until it wilts: exactly six spins had its +3.
    let state = s;
    let bloomed = 0;
    for (let i = 0; i < 200 && state.rail.length; i++) {
      if (state.phase === 'betting' && nudgeFor(state).charms === 3) bloomed += 1;
      state = spinMany(state, 1).state;
    }
    expect(state.rail).toEqual([]);
    expect(bloomed).toBe(6);
  });

  it('Dowsing Rod: Bell, three times a debt, +5 Nudge on the next spin; a waiting charge is kept', () => {
    let s = setup({ rail: ['dowsing_rod'] });
    s = play(s, { type: 'ringBell' }).state;
    expect(s.rail[0]).toMatchObject({ charges: 2, data: { armed: true } });
    expect(nudgeFor(noHouseLuck(s))).toMatchObject({ total: 5 });
    expect(act(s, { type: 'ringBell', uid: s.rail[0].uid }).events[0].code).toBe('notUsable');
    s = spinOn(s, 5).state;
    expect(s.rail[0].data.armed).toBe(false);
    expect(nudgeFor(noHouseLuck(s)).total).toBe(0);
    // Armed when the debt turns over: that charge stays spent.
    s = play(s, { type: 'ringBell' }).state;
    s = { ...s, phase: 'nightOver', round: 3, deposited: 1000 };
    s = play(s, { type: 'endNight' }).state;
    expect(s.debt).toBe(2);
    expect(s.rail[0]).toMatchObject({ charges: 2, data: { armed: true } });
  });

  it('Black Cat: Black ×2, and every 13th spin no Nudge at all, the Lean included', () => {
    let s = setup({ rail: ['black_cat', 'rabbits_foot'], chips: { c1: 'black' } });
    expect(amounts(paysOn(s, 2))).toEqual([4]);
    s = { ...s, leans: { debt: [{ at: s.debtSpins + 1, strength: 4 }], night: null }, stats: { ...s.stats, spins: 12 } };
    expect(nudgeFor(s)).toMatchObject({ total: 0, lean: 4, blocked: true });
    expect(nudgeFor({ ...s, stats: { ...s.stats, spins: 13 } })).toMatchObject({ total: 5, blocked: false });
  });

  it('Thirteen Ball: 13 pays ×2, and Nudge never moves the ball off 13', () => {
    let s = setup({ rail: ['thirteen_ball', 'rabbits_foot'], chips: { c1: 'straight:13', c2: 'straight:36' } });
    expect(amounts(paysOn(s, 13))).toEqual([72]);
    s = { ...s, chips: s.chips.map((c) => (c.id === 'c2' ? { ...c, value: 10 } : c)) };
    const luck = nudgeFor(noHouseLuck(s));
    expect(luck.anchors).toEqual([13]);
    expect(nudgeLandings(s, [{ ball: 0, pocketIndex: pocketOf(13) }], luck).hops).toEqual([]);
    // Without the ball, 36 is worth more than 13 and the ball would go there.
    expect(nudgeLandings(s, [{ ball: 0, pocketIndex: pocketOf(13) }], { ...luck, anchors: [] }).hops[0].to).toBe(pocketOf(36));
  });
});

describe('payout talismans', () => {
  it('Domino: each winning chip +1 Stake per chip that paid before it', () => {
    const s = setup({ rail: ['domino'], chips: { c1: 'red', c2: 'even', c3: 'low' } });
    expect(paysOn(s, 12).lines.map((l) => l.factors.stake)).toEqual([1, 2, 3]);
    expect(amounts(paysOn(s, 12))).toEqual([2, 4, 6]);
  });

  it('Magpie: +1 Stake per 8 tokens held', () => {
    const s = { ...setup({ rail: ['magpie'], chips: { c1: 'red' } }), tokens: 17 };
    expect(paysOn(s, 32).lines[0].factors.stake).toBe(3);
  });

  it('Mousetrap: +1 Stake per miss in a row before the win', () => {
    const s = { ...setup({ rail: ['mousetrap'], chips: { c1: 'red' } }), missStreak: 4 };
    expect(amounts(paysOn(s, 32))).toEqual([10]);
  });

  it('Weathervane: ×3 on a Lean\'s spin', () => {
    const s = setup({ rail: ['weathervane'], chips: { c1: 'red' } });
    expect(amounts(paysOn(noHouseLuck(s), 32))).toEqual([2]);
    const lean = { ...s, leans: { debt: [{ at: s.debtSpins + 1, strength: 2 }], night: null } };
    expect(amounts(paysOn(lean, 32))).toEqual([6]);
  });

  it('Seesaw: 1–18 or 19–36 ×3 after a spin in the other half', () => {
    const s = { ...setup({ rail: ['seesaw'], chips: { c1: 'high', c2: 'low' } }), history: [{ number: 5, color: 'red' }] };
    expect(amounts(paysOn(s, 30))).toEqual([6]);
    expect(amounts(paysOn(s, 7))).toEqual([2]);
    expect(amounts(paysOn({ ...s, history: [{ number: 0, color: 'green' }] }, 30))).toEqual([2]);
  });

  it('Ouroboros: the same number twice in a row ×2, never after a burned number', () => {
    const s = { ...setup({ rail: ['ouroboros'], chips: { c1: 'straight:17', c2: 'black' } }), history: [{ number: 17, color: 'black' }] };
    expect(amounts(paysOn(s, 17))).toEqual([72, 4]);
    expect(amounts(paysOn({ ...s, history: [{ number: 17, color: 'black', devil: true }] }, 17))).toEqual([36, 2]);
  });

  it('Golden Ball: ×3, and the Devil +3% once he is live', () => {
    const s = setup({ rail: ['golden_ball'], chips: { c1: 'red' } });
    expect(amounts(paysOn(s, 32))).toEqual([6]);
    expect(devilChanceFor(s)).toBe(0);
    expect(devilChanceFor({ ...s, debt: 3 })).toBeCloseTo(0.045, 9);
  });
});

describe('economy talismans', () => {
  it('Beckoning Cat: 3 winning chips bring tonight\'s interest early, as coins', () => {
    const s = { ...setup({ rail: ['beckoning_cat', 'pawn_ticket'], chips: { c1: 'red', c2: 'even', c3: 'low' } }), deposited: 100 };
    const { state, events } = spinOn(s, 12);
    expect(events.find((e) => e.type === 'trigger' && e.src.id === 'beckoning_cat')).toMatchObject({ effect: 'coins', amount: 7 });
    expect(state.lastSpin.total).toBe(6 + 7);
    expect(state.deposited).toBe(100); // the Cage still pays tonight
    const two = { ...s, placements: { c1: 'red', c2: 'even' } };
    expect(spinOn(two, 12).events.some((e) => e.type === 'trigger' && e.src.id === 'beckoning_cat')).toBe(false);
  });

  it('Grandmother\'s Purse: +12% interest, 2% less each night, then it crumbles', () => {
    let s = { ...setup({ rail: ['grandmothers_purse'] }), phase: 'nightOver', deposited: 1000, coins: 1e6 };
    const rates = [];
    let crumbled = null;
    for (let night = 0; night < 7; night++) {
      const r = play({ ...s, phase: 'nightOver' }, { type: 'endNight' });
      rates.push(r.events.find((e) => e.type === 'interest').rate);
      crumbled ??= r.events.find((e) => e.type === 'talismanDestroyed') ?? null;
      s = r.state;
    }
    expect(rates).toEqual([0.17, 0.15, 0.13, 0.11, 0.09, 0.07, 0.05]);
    expect(crumbled).toMatchObject({ id: 'grandmothers_purse', reason: 'crumbled' });
    expect(s.rail).toEqual([]);
  });

  it('a Twin Mirrors copy that is used up goes dark, and the mirror keeps its hook', () => {
    const fuse = registerTestTalisman({
      id: 'test_fuse',
      name: 'Fuse',
      rarity: 'common',
      init: () => ({ n: 0 }),
      hooks: {
        afterSpin(ctx) {
          if (ctx.self.n + 1 >= 2) ctx.destroySelf('burnt');
          else ctx.setData('n', ctx.self.n + 1);
        },
      },
    });
    let s = setup({ rail: ['twin_mirrors', fuse.id] });
    s.rail[0].data.copy = { test_fuse: { n: 1 } };
    s = spinOn(s, 5).state;
    expect(s.rail.map((t) => t.id)).toEqual(['twin_mirrors', 'test_fuse']);
    expect(s.rail[0].data.copy.test_fuse.gone).toBe(true);
    expect(s.rail[1].data.n).toBe(1);
    expect(railView(s)[0]).toMatchObject({ copying: 'test_fuse', dim: true });
  });

  it('Lost Wallet: needs no hook; a fifth of the debt in coins when bought', () => {
    let s = setup({ rail: ['red_ribbon', 'horseshoe', 'matchbook', 'lucky_penny', 'crumpled_receipt', 'pawn_ticket'], coins: 10 });
    s = { ...s, tokens: 5, cabinet: { ...s.cabinet, slots: [{ kind: 'talisman', id: 'lost_wallet', sold: false }, ...s.cabinet.slots.slice(1)] } };
    expect(cabinetView(s).slots[0]).toMatchObject({ hookFree: true, instant: true });
    expect(act(s, { type: 'buy', slot: 0, sellUid: s.rail[0].uid }).events[0].code).toBe('noHookNeeded');
    const { state, events } = play(s, { type: 'buy', slot: 0 });
    expect(state.coins).toBe(10 + 12);
    expect(state.tokens).toBe(2);
    expect(state.rail).toHaveLength(6);
    expect(events[0]).toMatchObject({ type: 'bought', id: 'lost_wallet', instant: true });
    expect(grantTalisman({ ...s, debt: 2 }, 'lost_wallet').coins).toBe(10 + 66);
  });
});

describe('Holy Water', () => {
  it('turns the Devil away once, then shatters; the next time he takes the coins', () => {
    withDevil((hellfire) => {
      let s = { ...setup({ rail: ['holy_water', hellfire.id], chips: { c1: 'red' }, coins: 500 }), debt: 3 };
      expect(luckView(s).devil.ward).toBe(s.rail[0].uid);
      s = play(s, { type: 'choosePackage', packageId: 'long' }).state;
      const coins = s.coins;
      let r = play(s, { type: 'spin' });
      expect(r.events.find((e) => e.type === 'devilWarded')).toMatchObject({ src: { id: 'holy_water' } });
      expect(r.events.find((e) => e.type === 'talismanDestroyed')).toMatchObject({ id: 'holy_water', reason: 'shattered' });
      expect(r.events.some((e) => e.type === 'devil')).toBe(false);
      expect(r.state.lastSpin.devil).toBe(false);
      expect(r.state.lastSpin.lost).toBe(0);
      expect(r.state.coins).toBe(coins + r.state.lastSpin.total);
      expect(r.state.devil.firedThisDebt).toBe(false);
      expect(r.state.stats.wards).toBe(1);
      expect(luckView(r.state).devil.ward).toBe(null);
      r = play(r.state, { type: 'spin' });
      expect(r.state.lastSpin.devil).toBe(true);
      expect(r.state.coins).toBe(0);
    });
  });
});
