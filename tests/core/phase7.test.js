import { describe, expect, it } from 'vitest';
import { SPECIAL_KINDS, betOf, getBet } from '../../src/core/bets.js';
import { rollTalismanSlots } from '../../src/core/cabinet.js';
import { FORTUNES, RECORDS, TALISMANS, getTalisman } from '../../src/core/content/index.js';
import { openSpecials } from '../../src/core/effects.js';
import { almanacView, deserializeProfile, endRun, figureCause, newProfile, runOptions, serializeProfile } from '../../src/core/meta.js';
import { DEVIL } from '../../src/core/devil.js';
import { spinCostFor } from '../../src/core/economy.js';
import { eq, format, gt, isBig, lt, mul, num } from '../../src/core/num.js';
import { evaluate } from '../../src/core/payout.js';
import { ballsFor } from '../../src/core/resolve.js';
import { Rng, hashSeed } from '../../src/core/rng.js';
import { act, createRun, grantTalisman, owed, spinsOf } from '../../src/core/run.js';
import { deserializeRun, serializeRun } from '../../src/core/save.js';
import { play, setup } from './helpers.js';

// Phase 7 (design doc 6, 7; decision 30): the special bets on the racetrack,
// multi-ball, the rest of the talismans, five cards, two records, and the
// content the Vault and the Almanac open.

const at = (s, n) => s.wheel.pockets.findIndex((p) => p.number === n);
const one = (s, betId) => ({ ...s, chips: [{ id: 'c1', value: 1, material: 'normal', roundValue: 0 }], placements: { c1: betId } });
const paysOn = (s, n, extra = {}) => evaluate(s, [{ ball: 0, pocketIndex: at(s, n), ...extra }]).lines.map((l) => l.amount);
const withBoon = (s, id) => ({ ...s, boons: [...s.boons, { uid: 'b9', id, data: {} }] });
const betting = (s, spinsLeft = 7, spinsTonight = 7) => ({ ...s, phase: 'betting', spinsLeft, spinsTonight });

describe('special bets', () => {
  it('are closed until something opens them', () => {
    const s = setup();
    expect(act(s, { type: 'placeChip', chipId: 'c1', betId: 'voisins' }).events[0]).toMatchObject({ code: 'closed' });
    const g = grantTalisman(s, 'croupiers_glove');
    expect([...openSpecials(g)].sort()).toEqual(['finale', 'jeuZero', 'orphelins', 'tiers', 'voisins']);
    expect(play(g, { type: 'placeChip', chipId: 'c1', betId: 'voisins' }).state.placements.c1).toBe('voisins');
    expect(act(g, { type: 'placeChip', chipId: 'c1', betId: 'snake' }).events[0]).toMatchObject({ code: 'closed' });
  });

  it('pay 36 ÷ numbers, rounded down; the Glove pays its sectors ×1.5', () => {
    const s = grantTalisman(setup(), 'snakeskin');
    expect(paysOn(one(s, 'snake'), 5)).toEqual([9]); // 3 × (1 + 2 Stake)
    const g = grantTalisman(setup(), 'croupiers_glove');
    expect(paysOn(one(g, 'voisins'), 0)).toEqual([3]); // 2 × 1.5
    expect(paysOn(one(g, 'finale:7'), 27)).toEqual([18]); // 12 × 1.5
    expect(paysOn(one(g, 'finale:3'), 33)).toEqual([13]); // 9 × 1.5, rounded down
    expect(paysOn(one(g, 'orphelins'), 17)).toEqual([6]);
    expect(paysOn(one(g, 'tiers'), 0)).toEqual([]);
  });

  it('Neighbours open with the card and follow the run’s own wheel', () => {
    let s = withBoon(setup(), 'neighbours_talk');
    expect(openSpecials(s).has('neighbours')).toBe(true);
    expect(getBet('neighbours:17').numbers).toEqual([2, 6, 17, 25, 34]);
    expect(paysOn(one(s, 'neighbours:17'), 25)).toEqual([7]);
    s = withBoon(createRun({ seed: 'P7-MIRROR', wheel: 'mirror' }), 'neighbours_talk');
    expect(betOf(s, 'neighbours:17').numbers).toEqual([15, 16, 17, 18, 19]);
    expect(paysOn(one(s, 'neighbours:17'), 19)).toEqual([7]);
    expect(paysOn(one(s, 'neighbours:17'), 25)).toEqual([]);
  });

  it('a chip left on a special bet nothing opens any more neither wins nor loses', () => {
    let s = play(grantTalisman(setup(), 'croupiers_glove'), { type: 'placeChip', chipId: 'c1', betId: 'voisins' }).state;
    s = { ...s, rail: [] };
    const plan = evaluate(s, [{ ball: 0, pocketIndex: at(s, 0) }]);
    expect(plan.lines.some((l) => l.chipId === 'c1')).toBe(false);
    expect(plan.losses.some((l) => l.chipId === 'c1')).toBe(false);
  });
});

describe('multi-ball', () => {
  it('each talisman throws its balls; an extra ball pays at its own mult', () => {
    expect(ballsFor(setup())).toHaveLength(1);
    expect(ballsFor(grantTalisman(setup(), 'ivory_ball')).map((b) => b.mult)).toEqual([1, 0.5]);
    expect(ballsFor(grantTalisman(setup(), 'bag_of_marbles')).map((b) => b.mult)).toEqual([1, 0.5, 0.5]);
    // The Marble on the night's last spin only; the Juggler's Ball on every third.
    const m = grantTalisman(setup(), 'marble');
    expect(ballsFor(betting(m, 2))).toHaveLength(1);
    expect(ballsFor(betting(m, 1))).toHaveLength(2);
    const j = grantTalisman(setup(), 'jugglers_ball');
    expect([7, 6, 5, 4].map((left) => ballsFor(betting(j, left)).length)).toEqual([1, 1, 2, 1]);
    const s = one(setup(), 'straight:17');
    expect(evaluate(s, [{ ball: 0, pocketIndex: at(s, 17) }, { ball: 1, pocketIndex: at(s, 17), mult: 0.5 }]).lines.map((l) => l.amount)).toEqual([36, 18]);
  });

  it('a spin throws them all; the result names each ball', () => {
    let s = play(grantTalisman(setup({ chips: { c1: 'red' } }), 'bag_of_marbles'), { type: 'choosePackage', packageId: 'long' }).state;
    s = { ...s, leans: { debt: [], night: null } };
    const r = play(s, { type: 'spin' });
    const result = r.events.find((e) => e.type === 'spin').result;
    expect(result.balls).toHaveLength(3);
    expect(result.balls.map((b) => b.mult)).toEqual([1, 0.5, 0.5]);
  });

  it('Two-Step: a second ball every spin, every payout ×0.6', () => {
    const s = { ...one(setup(), 'straight:17'), records: ['two_step'], playing: 'two_step' };
    expect(ballsFor(s)).toHaveLength(2);
    expect(paysOn(s, 17)).toEqual([21]);
  });
});

describe('the new talismans', () => {
  it('Chalk Stub, Wishbone and Zero’s Coin pay coins and tokens', () => {
    const chalk = evaluate(grantTalisman(setup(), 'chalk_stub'), [{ ball: 0, pocketIndex: at(setup(), 17) }]);
    expect(chalk.bonusCoins).toBe(1);
    const wish = evaluate(one(grantTalisman(setup(), 'wishbone'), 'red'), [{ ball: 0, pocketIndex: at(setup(), 2) }]);
    expect(wish.bonusCoins).toBe(1);
    const zero = evaluate(grantTalisman(setup(), 'zeros_coin'), [{ ball: 0, pocketIndex: at(setup(), 0) }]);
    expect([zero.bonusTokens, zero.bonusCoins]).toEqual([3, 3]);
  });

  it('Mirror Shard pays the pocket opposite; Saint’s Medal makes zero both colours; Table Map pays beside', () => {
    const s = grantTalisman(setup(), 'mirror_shard');
    const i = at(s, 17);
    const across = s.wheel.pockets[(i + 18) % 37].number;
    expect(paysOn(one(s, `straight:${across}`), 17)).toEqual([18]);
    expect(paysOn(one(grantTalisman(setup(), 'saints_medal'), 'black'), 0)).toEqual([2]);
    const map = grantTalisman(setup(), 'table_map');
    expect(paysOn(one(map, 'split:17-20'), 14)).toEqual([9]);
    expect(paysOn(one(map, 'split:17-20'), 26)).toEqual([]);
  });

  it('Hourglass adds a spin to a night that has any', () => {
    const s = grantTalisman(setup(), 'hourglass');
    expect([spinsOf(s, 'long'), spinsOf(s, 'short'), spinsOf(s, 'sitout')]).toEqual([8, 4, 0]);
    expect(play(s, { type: 'choosePackage', packageId: 'long' }).state.spinsLeft).toBe(8);
  });

  it('Fortune Cookie, Rose Brooch, Tally Stick, Green Thread and Surveyor’s Chain', async () => {
    const { cookieNumber } = await import('../../src/core/content/talismans.js');
    const c = grantTalisman(setup(), 'fortune_cookie');
    const n = cookieNumber(c);
    expect(paysOn(one(c, `straight:${n}`), n)).toEqual([108]);
    const rose = { ...grantTalisman(setup(), 'rose_brooch'), history: [{ number: 3, color: 'red' }] };
    expect(paysOn(one(rose, 'red'), 1)).toEqual([4]);
    expect(paysOn(one(rose, 'black'), 2)).toEqual([2]);
    const tally = { ...grantTalisman(setup(), 'tally_stick'), lastSpin: { wins: [{ betId: 'red' }] } };
    expect(paysOn(one(tally, 'red'), 1)).toEqual([4]);
    expect(paysOn(one(grantTalisman(setup(), 'green_thread'), 'firstFour'), 0)).toEqual([27]);
    expect(paysOn(one(grantTalisman(setup(), 'surveyors_chain'), 'corner:1-2-4-5'), 5)).toEqual([27]);
  });

  it('Hot Coals glow with each paying spin and go out on a miss', () => {
    let s = play(grantTalisman(setup({ chips: { c1: 'red', c2: 'black', c3: 'straight:0' } }), 'hot_coals'), { type: 'choosePackage', packageId: 'long' }).state;
    s = { ...s, leans: { debt: [], night: null } };
    s = play(s, { type: 'spin' }).state;
    const coals = s.rail.find((t) => t.id === 'hot_coals');
    expect(coals.data.streak).toBe(s.lastSpin.miss ? 0 : 1);
    s = { ...s, rail: s.rail.map((t) => (t.id === 'hot_coals' ? { ...t, data: { streak: 3 } } : t)) };
    expect(paysOn(one(s, 'straight:17'), 17)).toEqual([90]);
  });

  it('Metronome, Gilder’s Knife, Loaded Wheel, Usurer’s Seal and Brimstone', () => {
    const met = grantTalisman(setup(), 'metronome');
    expect(play(betting(met, 4), { type: 'spin' }).events.some((e) => e.type === 'trigger' && e.src.id === 'metronome')).toBe(true);
    let k = play(grantTalisman(setup(), 'gilders_knife'), { type: 'choosePackage', packageId: 'long' }).state;
    k = { ...k, leans: { debt: [], night: null } };
    k = play(k, { type: 'spin' }).state;
    expect(k.wheel.pockets.find((p) => p.id === k.lastSpin.balls[0].pocketId).enh).toBe('gilded');
    k = play(k, { type: 'spin' }).state;
    expect(k.wheel.pockets.filter((p) => p.enh === 'gilded')).toHaveLength(1);
    const s = { ...setup(), coins: 100, tokens: 20, cabinet: { ...setup().cabinet, slots: [{ kind: 'talisman', id: 'loaded_wheel', sold: false }, ...setup().cabinet.slots.slice(1)] } };
    const bought = play(s, { type: 'buy', slot: 0 }).state;
    expect(bought.wheel.pockets.filter((p) => p.color === 'red').every((p) => p.width === 1.5)).toBe(true);
    const seal = { ...grantTalisman(grantTalisman(setup(), 'pawn_ticket'), 'usurers_seal'), phase: 'nightOver', deposited: 1000 };
    expect(play(seal, { type: 'endNight' }).events.find((e) => e.type === 'interest')).toMatchObject({ rate: 0.14, amount: 140 });
    const fire = grantTalisman(setup(), 'brimstone');
    expect(paysOn(one(fire, 'red'), 1)).toEqual([2]);
    expect(paysOn(one({ ...fire, devil: { ...fire.devil, firedThisDebt: true } }, 'red'), 1)).toEqual([4]);
  });
});

describe('cards and records', () => {
  it('Zero smiles, Break the wheel, The ball has a twin, Shake the Devil’s hand', () => {
    const deal = (s, id) => ({ ...s, opened: [id], oracle: { debt: s.debt, kind: FORTUNES.find((f) => f.id === id).kind, cards: [id], rerolls: 0, taken: null } });
    let s = play(deal(setup(), 'zero_smiles'), { type: 'takeFortune', index: 0 }).state;
    expect(s.wheel.pockets[at(s, 0)].width).toBe(1.5);
    const r = play(deal(setup(), 'break_the_wheel'), { type: 'takeFortune', index: 0 });
    expect(r.state.wheel.pockets).toHaveLength(35);
    expect(r.state.tokens).toBe(setup().tokens + 4);
    s = play(deal(setup(), 'twin_ball'), { type: 'takeFortune', index: 0 }).state;
    expect(ballsFor(s).map((b) => b.mult)).toEqual([1, 0.5]);
    s = play(deal(setup(), 'devils_hand'), { type: 'takeFortune', index: 0 }).state;
    expect(paysOn(one(s, 'red'), 1)).toEqual([4]);
  });

  it('Habanera opens every special bet while it plays', () => {
    const s = { ...setup(), records: ['habanera'], playing: 'habanera' };
    expect([...openSpecials(s)].sort()).toEqual([...SPECIAL_KINDS].sort());
    expect(paysOn(one(s, 'tiers'), 27)).toEqual([6]); // 3 × (1 + 1 Stake)
  });
});

describe('the Vault and the feats open new content (decision 29)', () => {
  it('a new run offers none of it; the profile opens it lock by lock and feat by feat', () => {
    const gated = new Set(TALISMANS.filter((d) => d.unlock).map((d) => d.id));
    const rng = new Rng(hashSeed('gates'));
    for (let i = 0; i < 2000; i++) for (const slot of rollTalismanSlots([], rng)) expect(gated.has(slot.id)).toBe(false);
    expect(runOptions(newProfile()).opened).toEqual([]);
    const p = { ...newProfile(), locks: 2, achievements: ['same_again'] };
    expect(runOptions(p).opened.sort()).toEqual(['croupiers_glove', 'habanera', 'hot_coals', 'neighbours_talk', 'snakeskin', 'two_step']);
    const opened = createRun({ seed: 'GATES', ...runOptions(p) });
    let seen = false;
    const r2 = new Rng(hashSeed('gates-open'));
    for (let i = 0; i < 4000 && !seen; i++) seen = rollTalismanSlots([], r2, 1, opened.opened).some((x) => x.id === 'hot_coals');
    expect(seen).toBe(true);
  });

  it('the pool holds 60+ talismans, 25 cards and 12 records, every family at every rarity', () => {
    expect(TALISMANS.length).toBeGreaterThanOrEqual(60);
    expect(FORTUNES).toHaveLength(25);
    expect(RECORDS).toHaveLength(12);
    const families = { colour: ['colour'], hunting: ['luck'], wheel: ['wheel', 'special'], table: ['inside'], streaks: ['streaks'], zero: ['zero'], multi: ['multi'], economy: ['economy'], devil: ['devil', 'risk', 'safety'] };
    for (const [family, tags] of Object.entries(families)) {
      for (const rarity of ['common', 'uncommon', 'rare', 'legendary']) {
        expect(TALISMANS.some((t) => t.rarity === rarity && t.tags.some((x) => tags.includes(x))), `${family} ${rarity}`).toBe(true);
      }
    }
    expect(getTalisman('croupiers_glove').unlock).toEqual({ lock: 1 });
  });
});

describe('saves', () => {
  it('a version 8 save opens nothing new and plays on its own wheel', () => {
    const s = createRun({ seed: 'P7-SAVE', wheel: 'american' });
    const old = { ...s, version: 8 };
    for (const k of ['opened', 'endless', 'wheelOrder']) delete old[k];
    const back = deserializeRun(serializeRun(old).replace('"v":9', '"v":8'));
    expect(back).toMatchObject({ version: 9, opened: [], endless: false });
    expect(back.wheelOrder).toHaveLength(38);
    expect(deserializeRun(serializeRun(s))).toEqual(s);
  });
});

describe('endless (doc 7.1)', () => {
  /** The last night of debt `debt` over, with the Cage owed twice over. */
  const atCage = (s, debt) => {
    const t = { ...s, debt, round: 3, phase: 'nightOver', stats: { ...s.stats, debtsPaid: debt - 1 } };
    return { ...t, deposited: mul(owed(t), 2) };
  };

  it('has no goal: paying debt 8 reaches nothing, and the Cage never lets the player go', () => {
    const s = createRun({ seed: 'ENDLESS', endless: true, ...runOptions({ ...newProfile(), locks: 4, vault: true }) });
    expect(s.goal).toBeNull();
    const r = play(atCage(s, 8), { type: 'endNight' });
    expect(r.events.some((e) => e.type === 'debtPaid')).toBe(true);
    expect(r.events.some((e) => e.type === 'goalReached')).toBe(false);
    expect(r.state.won).toBeNull();
    expect(act(r.state, { type: 'leave' }).events[0]).toMatchObject({ code: 'notWon' });
  });

  it('carries big numbers end to end: debts past 1e15, spin costs, a spin, a save', () => {
    let s = { ...createRun({ seed: 'ENDLESS-BIG', endless: true, locks: 4, vault: true }), coins: num(0) };
    let last = 0;
    for (let d = 9; d <= 40; d++) {
      const r = play(atCage(s, d), { type: 'endNight' });
      const paid = r.events.find((e) => e.type === 'debtPaid');
      expect(paid.debt).toBe(d);
      expect(gt(paid.owed, last)).toBe(true);
      last = paid.owed;
      s = r.state;
    }
    expect(s.debt).toBe(41);
    expect(isBig(owed(s))).toBe(true);
    expect(format(owed(s))).toMatch(/^\d\.\d\de\d+$/);
    expect(isBig(spinCostFor(80))).toBe(true);
    // A night and a spin with coins past what a plain number holds (the
    // Devil kept out of it: by debt 80 he fires on one throw in four).
    s = { ...s, debt: 80, coins: mul(spinCostFor(80), 1000) };
    const before = s.coins;
    const cap = DEVIL.cap;
    DEVIL.cap = 0;
    try {
      s = play(s, { type: 'choosePackage', packageId: 'long' }, { type: 'placeChip', chipId: 'c1', betId: 'red' }, { type: 'spin' }).state;
    } finally {
      DEVIL.cap = cap;
    }
    expect(lt(s.coins, before)).toBe(true);
    expect(isBig(s.coins)).toBe(true);
    const back = deserializeRun(serializeRun(s));
    expect(eq(back.coins, s.coins)).toBe(true);
    expect(eq(owed(back), owed(s))).toBe(true);
    expect(back.endless).toBe(true);
  });

  it('the profile keeps the deepest endless run, and the figure says it was endless', () => {
    const p = newProfile();
    const s = { ...createRun({ seed: 'ENDLESS-END', endless: true, locks: 4, vault: true }), debt: 13, stats: { ...createRun({ seed: 'x' }).stats, debtsPaid: 12 } };
    const after = endRun(p, s, 'collected');
    expect(after.stats.deepest).toBe(12);
    expect(endRun(after, { ...s, endless: false, stats: { ...s.stats, debtsPaid: 20 } }, 'collected').stats.deepest).toBe(12);
    expect(figureCause(after.figures.at(-1))).toBe('Collected at debt 13, endless');
    expect(almanacView(after).stats.deepest).toBe(12);
    expect(deserializeProfile(serializeProfile(after)).stats.deepest).toBe(12);
  });
});
