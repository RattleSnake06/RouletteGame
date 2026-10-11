import { describe, expect, it } from 'vitest';
import { registerTestTalisman } from '../../src/core/content/index.js';
import { DEVIL, devilChanceFor } from '../../src/core/devil.js';
import { LUCK, nudgeFor, nudgeLandings, pityFor, upcomingLean } from '../../src/core/nudge.js';
import { evaluate } from '../../src/core/payout.js';
import { act, createRun, grantTalisman } from '../../src/core/run.js';
import { cabinetView } from '../../src/core/selectors.js';
import { TALISMANS } from '../../src/core/content/index.js';
import { deserializeRun, serializeRun } from '../../src/core/save.js';
import { EUROPEAN_ORDER } from '../../src/core/wheel.js';
import { deepFreeze, noHouseLuck, play, pocketOf, setup } from './helpers.js';

const luck = (total, more = {}) => ({ total, lean: 0, pity: 0, charms: total, clockwise: false, straightOnly: false, kind: 'charm', ...more });

/** Where Nudge takes a ball that landed on `n`. */
function nudgedFrom(state, n, l) {
  const { landings, hops } = nudgeLandings(state, [{ ball: 0, pocketIndex: pocketOf(n) }], l);
  return { number: EUROPEAN_ORDER[landings[0].pocketIndex], hop: hops[0] ?? null };
}

/** Exact expected return of the placed chips over every landing, with this much Nudge. */
function exactEvWithNudge(state, l) {
  let total = 0;
  for (let i = 0; i < 37; i++) {
    const { landings } = nudgeLandings(state, [{ ball: 0, pocketIndex: i }], l);
    total += evaluate(state, landings).chipTotal;
  }
  return total / 37;
}

/** Plays the night's spins with chips on one bet, returning each spin's result. */
function playNight(state, packageId = 'long') {
  let s = play(state, { type: 'choosePackage', packageId }).state;
  const results = [];
  while (s.phase === 'betting') {
    s = play(s, { type: 'spin' }).state;
    results.push(s.lastSpin);
  }
  return { state: play(s, { type: 'endNight' }).state, results };
}

describe('Nudge', () => {
  it('hops to the reachable pocket that pays the most', () => {
    // 17 sits two pockets clockwise of 21 (… 21, 2, 25, 17 …): wheel order is 21, 2, 25, 17.
    const s = setup({ chips: { c1: 'straight:17' } });
    expect(nudgedFrom(s, 21, luck(2)).number).toBe(21); // three away: out of reach
    expect(nudgedFrom(s, 21, luck(3))).toMatchObject({ number: 17, hop: { steps: 3, path: [pocketOf(2), pocketOf(25), pocketOf(17)] } });
    expect(nudgedFrom(s, 34, luck(1))).toMatchObject({ number: 17, hop: { steps: -1 } });
  });

  it('stays put on the best pocket, and never moves for nothing', () => {
    const s = setup({ chips: { c1: 'straight:17' } });
    expect(nudgedFrom(s, 17, luck(5)).hop).toBe(null);
    const bare = setup();
    expect(nudgedFrom(bare, 0, luck(18)).hop).toBe(null);
  });

  it('breaks ties by fewer hops, then clockwise', () => {
    // 25 and 34 are both one pocket from 17; equal chips on both: clockwise (34) wins.
    const s = setup({ chips: { c1: 'straight:25', c2: 'straight:34' } });
    expect(nudgedFrom(s, 17, luck(1)).number).toBe(34);
    // A nearer equal pocket beats a farther one, whichever way it lies:
    // from 25, 2 is one pocket anticlockwise and 34 two clockwise.
    const t = setup({ chips: { c1: 'straight:2', c2: 'straight:34' } });
    expect(nudgedFrom(t, 25, luck(2)).number).toBe(2);
  });

  it('18 Nudge reaches every pocket on a 37-pocket wheel', () => {
    const s = setup({ chips: { c1: 'straight:17' } });
    for (const n of EUROPEAN_ORDER) expect(nudgedFrom(s, n, luck(18)).number).toBe(17);
    expect(nudgedFrom(s, 0, luck(40)).number).toBe(17);
  });

  it('prefers the bigger payout over the nearer one', () => {
    const s = setup({ chips: { c1: 'straight:17', c2: 'red' } });
    // From 21 (red) the ball can stay on red (2) or hop three pockets to 17 (36 + 0, since 17 is black).
    expect(nudgedFrom(s, 21, luck(3)).number).toBe(17);
  });

  it('Compass hops clockwise only; Lodestone only onto straight-up chips', () => {
    const s = setup({ chips: { c1: 'straight:17' } });
    expect(nudgedFrom(s, 34, luck(1, { clockwise: true })).number).toBe(34);
    expect(nudgedFrom(s, 25, luck(1, { clockwise: true })).number).toBe(17);
    const r = setup({ chips: { c1: 'red' } });
    expect(nudgedFrom(r, 17, luck(1)).number).not.toBe(17); // red is one hop away
    expect(nudgedFrom(r, 17, luck(1, { straightOnly: true })).number).toBe(17);
  });

  it('exact expected value: +1 Nudge makes a red chip pay every spin', () => {
    expect(exactEvWithNudge(setup({ chips: { c1: 'red' } }), luck(0))).toBeCloseTo(36 / 37, 12);
    expect(exactEvWithNudge(setup({ chips: { c1: 'red' } }), luck(1))).toBe(2);
    expect(exactEvWithNudge(setup({ chips: { c1: 'straight:17' } }), luck(1))).toBeCloseTo((36 * 3) / 37, 12);
    expect(exactEvWithNudge(setup({ chips: { c1: 'straight:17' } }), luck(5))).toBeCloseTo((36 * 11) / 37, 12);
  });
});

describe('the Lean', () => {
  it('debt 1 teaches: spins 2, 5, 9, 14 and 20 of the debt, each the same strength, shifted by 0 or 1', () => {
    const shifts = new Set();
    for (let i = 0; i < 40; i++) {
      const s = createRun({ seed: `LEAN-${i}` });
      const ats = s.leans.debt.map((l) => l.at);
      const shift = ats[0] - 2;
      expect([0, 1]).toContain(shift);
      expect(ats).toEqual(LUCK.teachingSpins.map((a) => a + shift));
      expect(s.leans.debt.every((l) => l.strength === LUCK.teachingStrength)).toBe(true);
      shifts.add(shift);
    }
    expect(shifts).toEqual(new Set([0, 1]));
  });

  it('is announced one spin early: the lamp lights only once the spin before it is done', () => {
    let s = setup({ seed: 'LEAN-EARLY', chips: { c1: 'red' } });
    const first = s.leans.debt[0].at; // 2 or 3
    s = play(s, { type: 'choosePackage', packageId: 'long' }).state;
    const seen = [];
    for (let spin = 1; spin <= 7; spin++) {
      seen.push(upcomingLean(s));
      s = play(s, { type: 'spin' }).state;
      if (spin + 1 === first) expect(upcomingLean(s)).toBe(LUCK.teachingStrength);
    }
    expect(seen[first - 1]).toBe(LUCK.teachingStrength);
    expect(seen[0]).toBe(0);
    expect(seen.filter((x) => x > 0)).toHaveLength(2); // spins 2 and 5, or 3 and 6
  });

  it('the Lean spin carries the Lean in its Nudge, and hops show on that spin', () => {
    let s = setup({ seed: 'LEAN-HOP', chips: { c1: 'straight:17', c2: 'straight:5', c3: 'straight:30' } });
    s = play(s, { type: 'choosePackage', packageId: 'long' }).state;
    const at = s.leans.debt[0].at;
    let r;
    for (let spin = 1; spin <= at; spin++) {
      s = { ...s, missStreak: 0 }; // keep the schedule, drop pity
      r = play(s, { type: 'spin' });
      s = r.state;
    }
    expect(s.lastSpin.luck).toMatchObject({ lean: LUCK.teachingStrength, total: LUCK.teachingStrength, kind: 'lean' });
    expect(s.stats.leans).toBe(1);
  });

  it('from debt 2: one Lean on a long night, after the first spin, +3 to +5 (+3 more on the last spin)', () => {
    const ats = new Set();
    for (let i = 0; i < 60; i++) {
      let s = { ...setup({ seed: `NIGHT-${i}`, chips: { c1: 'red' } }), debt: 2, coins: 1000 };
      s = play(s, { type: 'choosePackage', packageId: 'long' }).state;
      const lean = s.leans.night;
      expect(lean.at).toBeGreaterThanOrEqual(2);
      expect(lean.at).toBeLessThanOrEqual(7);
      const base = lean.strength - (lean.at === 7 ? 3 : 0);
      expect(base).toBeGreaterThanOrEqual(3);
      expect(base).toBeLessThanOrEqual(5);
      ats.add(lean.at);
    }
    expect(ats.size).toBe(6);
  });

  it('a short night gets one on a coin flip; sitting out gets none', () => {
    let some = 0;
    for (let i = 0; i < 200; i++) {
      const s = play({ ...createRun({ seed: `SHORT-${i}` }), debt: 2, coins: 1000 }, { type: 'choosePackage', packageId: 'short' }).state;
      if (s.leans.night) {
        some += 1;
        expect([2, 3]).toContain(s.leans.night.at);
      }
    }
    expect(some / 200).toBeGreaterThan(0.38);
    expect(some / 200).toBeLessThan(0.62);
    const out = play({ ...createRun({ seed: 'SIT' }), debt: 2 }, { type: 'choosePackage', packageId: 'sitout' }).state;
    expect(out.leans.night).toBe(null);
  });

  it('from debt 5 the House grows stingy: Leans only every other night', () => {
    const nights = [];
    for (const [debt, round] of [
      [5, 1],
      [5, 2],
      [5, 3],
      [6, 1],
      [6, 2],
      [6, 3],
    ]) {
      const s = play({ ...createRun({ seed: 'STINGY' }), debt, round, coins: 1e6 }, { type: 'choosePackage', packageId: 'long' }).state;
      nights.push(!!s.leans.night);
    }
    expect(nights).toEqual([true, false, true, false, true, false]);
  });

  it('the Lean never changes where the ball is drawn: only the hops differ', () => {
    const chips = { c1: 'straight:17', c2: 'straight:5', c3: 'straight:30' };
    let a = setup({ seed: 'SAME-DRAWS', chips });
    let b = noHouseLuck(a);
    a = play(a, { type: 'choosePackage', packageId: 'long' }).state;
    b = play(b, { type: 'choosePackage', packageId: 'long' }).state;
    for (let i = 0; i < 7; i++) {
      const ra = play({ ...a, missStreak: 0 }, { type: 'spin' });
      const rb = play({ ...b, missStreak: 0 }, { type: 'spin' });
      a = ra.state;
      b = rb.state;
      const drawnA = a.lastSpin.hops[0]?.from ?? a.lastSpin.pocketIndex;
      expect(drawnA).toBe(b.lastSpin.pocketIndex);
    }
    expect(a.rng.wheel).toEqual(b.rng.wheel);
  });
});

describe('pity', () => {
  it('after 5 misses in a row: +1, then +1 more for each further miss, until something pays', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(pityFor)).toEqual([0, 0, 0, 0, 0, 1, 2, 3]);
    const s = setup({ chips: { c1: 'straight:17' } });
    expect(nudgeFor(noHouseLuck(s))).toMatchObject({ pity: 0 });
    expect(nudgeFor({ ...noHouseLuck(s), missStreak: 6 })).toMatchObject({ pity: 2, total: 2, kind: 'pity' });
  });

  it('counts misses across spins and resets on a pay', () => {
    let s = setup({ chips: { c1: 'straight:17' } });
    s = noHouseLuck(play(s, { type: 'choosePackage', packageId: 'long' }).state);
    s = { ...s, spinsLeft: 20, spinsTonight: 20 }; // a long enough night for eight spins
    // Force misses on 0 (eight pockets from 17, out of pity's early reach), then a hit on 17.
    for (let i = 0; i < 7; i++) s = play({ ...s, foreseen: { pocketIndex: pocketOf(0), by: null } }, { type: 'spin' }).state;
    expect(s.missStreak).toBe(7);
    expect(nudgeFor(s).pity).toBe(3);
    // The next throw lands three pockets from 17 (on 21): pity reaches it.
    s = play({ ...s, foreseen: { pocketIndex: pocketOf(21), by: null } }, { type: 'spin' }).state;
    expect(s.lastSpin).toMatchObject({ number: 17, miss: false });
    expect(s.lastSpin.hops[0]).toMatchObject({ steps: 3 });
    expect(s.missStreak).toBe(0);
  });

  it('Black Candle: Leans are twice as strong, and no pity', () => {
    const s = grantTalisman({ ...setup(), missStreak: 8 }, 'black_candle');
    const plain = nudgeFor(s);
    expect(plain).toMatchObject({ pity: 0, total: 0 });
    const leaning = { ...s, leans: { debt: [{ at: 1, strength: 5 }], night: null } };
    expect(nudgeFor(leaning)).toMatchObject({ lean: 5, charms: 5, total: 10 });
  });
});

describe('the Devil', () => {
  const at = (debt, rail = []) => {
    let s = { ...createRun({ seed: 'DEVIL' }), debt };
    for (const id of rail) s = grantTalisman(s, id);
    return s;
  };

  it('is asleep until debt 2 is paid, then 1.5% and +0.5% per debt, capped at 25%', () => {
    expect(devilChanceFor(at(1))).toBe(0);
    expect(devilChanceFor(at(2))).toBe(0);
    expect(devilChanceFor(at(2, ['bone_dice']))).toBe(0);
    expect(devilChanceFor(at(3))).toBeCloseTo(0.015, 9);
    expect(devilChanceFor(at(4))).toBeCloseTo(0.02, 9);
    expect(devilChanceFor(at(200))).toBe(0.25);
  });

  it('Salt Cellar, Evil Eye and Bone Dice act in rail order', () => {
    expect(devilChanceFor(at(3, ['salt_cellar']))).toBeCloseTo(0.01, 9);
    expect(devilChanceFor(at(3, ['evil_eye']))).toBeCloseTo(0.0075, 9);
    expect(devilChanceFor(at(3, ['salt_cellar', 'evil_eye']))).toBeCloseTo(0.005, 9);
    expect(devilChanceFor(at(3, ['evil_eye', 'salt_cellar']))).toBeCloseTo(0.0025, 9);
    expect(devilChanceFor(at(3, ['bone_dice']))).toBeCloseTo(0.035, 9);
    expect(devilChanceFor(at(3, ['twin_mirrors', 'evil_eye']))).toBeCloseTo(0.00375, 9);
  });

  it('draws nothing from its stream while asleep', () => {
    let s = setup({ chips: { c1: 'red' } });
    const before = s.rng.devil;
    s = playNight(s).state;
    expect(s.rng.devil).toEqual(before);
  });

  it('when it fires: coins in hand are lost, deposits are safe, nothing pays, and it counts as a miss', () => {
    const cap = DEVIL.cap;
    const boost = registerTestTalisman({ id: 'test_brimstone', name: 'Brimstone', rarity: 'common', hooks: { devilChance: (ctx) => ctx.addChance(1) } });
    DEVIL.cap = 1;
    try {
      let s = { ...setup({ rail: ['wheel_of_fortune', boost.id], chips: { c1: 'red', c2: 'black' }, coins: 500 }), debt: 3, deposited: 70 };
      s = play(s, { type: 'ringBell' }).state; // arm the Wheel of Fortune: a Devil's throw is not thrown again
      s = play(s, { type: 'choosePackage', packageId: 'long' }).state;
      const coins = s.coins;
      const { state, events } = play(s, { type: 'spin' });
      const devil = events.find((e) => e.type === 'devil');
      expect(devil).toMatchObject({ lost: coins, chance: 1 });
      expect(state.coins).toBe(0);
      expect(state.deposited).toBe(70);
      expect(events.some((e) => e.type === 'chipPaid' || e.type === 'rethrow')).toBe(false);
      expect(state.lastSpin).toMatchObject({ devil: true, miss: true, lost: coins, lines: [] });
      expect(state.armed).toEqual({ rethrow: null });
      expect(state.missStreak).toBe(1);
      expect(state.history.at(-1)).toMatchObject({ devil: true });
      expect(state.devil.firedThisDebt).toBe(true);
      expect(state.stats.devils).toBe(1);
    } finally {
      DEVIL.cap = cap;
    }
  });
});

describe('Phase 3 talismans', () => {
  it("Rabbit's Foot adds 1 Nudge every spin; Twin Mirrors copies it", () => {
    expect(nudgeFor(noHouseLuck(setup({ rail: ['rabbits_foot'] })))).toMatchObject({ charms: 1, total: 1, kind: 'charm' });
    expect(nudgeFor(noHouseLuck(setup({ rail: ['twin_mirrors', 'rabbits_foot'] })))).toMatchObject({ total: 2 });
  });

  it('Pocket Watch adds 3 Nudge on the first spin of each night only', () => {
    let s = noHouseLuck(setup({ rail: ['pocket_watch'], chips: { c1: 'red' } }));
    expect(nudgeFor(s).total).toBe(3); // choosing the night: the next spin is the first
    s = play(s, { type: 'choosePackage', packageId: 'long' }).state;
    expect(nudgeFor(noHouseLuck(s)).total).toBe(3);
    s = noHouseLuck(play(noHouseLuck(s), { type: 'spin' }).state);
    expect(nudgeFor(s).total).toBe(0);
  });

  it('Compass and Lodestone restrict where the ball may go', () => {
    expect(nudgeFor(noHouseLuck(setup({ rail: ['compass'] })))).toMatchObject({ total: 3, clockwise: true, straightOnly: false });
    expect(nudgeFor(noHouseLuck(setup({ rail: ['lodestone'] })))).toMatchObject({ total: 1, clockwise: false, straightOnly: true });
  });

  it('Bone Dice adds 4 Stake to every winning chip', () => {
    const s = setup({ rail: ['bone_dice'], chips: { c1: 'red' } });
    const plan = evaluate(s, [{ ball: 0, pocketIndex: pocketOf(1) }]);
    expect(plan.lines[0]).toMatchObject({ amount: 10 }); // 1 × (1 + 4) × 2
  });

  it('cursed talismans are never offered and cannot be sold or traded in', () => {
    const cursed = TALISMANS.filter((d) => d.cursed).map((d) => d.id);
    expect(cursed).toEqual(['bone_dice', 'black_candle']);
    expect(TALISMANS.filter((d) => d.cursed).every((d) => !d.inCabinet)).toBe(true);
    for (let i = 0; i < 50; i++) {
      let s = { ...createRun({ seed: `OFFER-${i}` }), coins: 1e6 };
      s = play(s, { type: 'restock' }).state;
      expect(cabinetView(s).slots.some((o) => cursed.includes(o.id))).toBe(false);
    }
    let s = { ...setup({ rail: ['bone_dice', 'red_ribbon', 'horseshoe', 'matchbook', 'ledger', 'abacus'] }), tokens: 50 };
    const dice = s.rail[0].uid;
    expect(act(s, { type: 'sell', uid: dice }).events[0]).toMatchObject({ type: 'rejected', code: 'cursed' });
    const slot = s.cabinet.slots.findIndex((x) => x.id);
    expect(act(s, { type: 'buy', slot, sellUid: dice }).events[0]).toMatchObject({ type: 'rejected', code: 'cursed' });
  });
});

describe('Phase 3 invariants', () => {
  it('act never mutates its input through Leans, pity, hops and the Devil', () => {
    let s = { ...setup({ seed: 'P3-FREEZE', rail: ['rabbits_foot', 'compass', 'salt_cellar'], chips: { c1: 'straight:17', c2: 'red' } }), debt: 3, coins: 1000 };
    const script = [{ type: 'choosePackage', packageId: 'long' }, ...Array.from({ length: 7 }, () => ({ type: 'spin' })), { type: 'endNight' }];
    for (const a of script) {
      const frozen = deepFreeze(s);
      const before = JSON.stringify(frozen);
      const r = act(frozen, a);
      expect(JSON.stringify(frozen), a.type).toBe(before);
      s = r.state;
    }
  });

  it('a saved run with Leans to come plays on exactly as the original', () => {
    let s = setup({ seed: 'P3-SAVE', rail: ['rabbits_foot'], chips: { c1: 'straight:17', c2: 'straight:5' } });
    s = play({ ...s, debt: 3 }, { type: 'choosePackage', packageId: 'long' }).state;
    const loaded = deserializeRun(serializeRun(s));
    expect(loaded).toEqual(s);
    const go = (x) => {
      for (let i = 0; i < 7; i++) x = play(x, { type: 'spin' }).state;
      return x;
    };
    const a = go(s);
    const b = go(loaded);
    expect(b.history).toEqual(a.history);
    expect(b.coins).toEqual(a.coins);
    expect(b.missStreak).toBe(a.missStreak);
  });
});
