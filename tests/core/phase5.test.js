import { describe, expect, it } from 'vitest';
import { FORTUNES, ODDITIES } from '../../src/core/content/index.js';
import { rollOdditySlot } from '../../src/core/cabinet.js';
import { devilChanceFor } from '../../src/core/devil.js';
import { nudgeFor } from '../../src/core/nudge.js';
import { evaluate } from '../../src/core/payout.js';
import { Rng, hashSeed } from '../../src/core/rng.js';
import { act, createRun, grantTalisman } from '../../src/core/run.js';
import { deserializeRun, serializeRun } from '../../src/core/save.js';
import { cabinetView, numbersView, pickView, statsView, wheelView } from '../../src/core/selectors.js';
import { liveChances } from '../../src/core/widths.js';
import { WHEEL, doWork, workRefusal } from '../../src/core/wheelwork.js';
import { noHouseLuck, play, setup } from './helpers.js';

// Phase 5, first half (design doc 5.4, 5.11, 6.5, 6.7): wheel work, pocket
// enhancements, the Cabinet's oddities, the cards and the talisman that work
// on the wheel.

const at = (s, n) => s.wheel.pockets.findIndex((p) => p.number === n);
const idOf = (s, n) => s.wheel.pockets[at(s, n)].id;
const pocket = (s, id) => s.wheel.pockets.find((p) => p.id === id);
const paysOn = (s, n) => evaluate(s, [{ ball: 0, pocketIndex: at(s, n) }]);
const amounts = (plan) => plan.lines.map((l) => l.amount);
/** Wheel work straight on a copy of the run (as an oddity or a card would do it). */
function work(s, w, target) {
  const why = workRefusal(s, w, target);
  if (why) throw new Error(why);
  const d = { ...s, wheel: { ...s.wheel, pockets: s.wheel.pockets.map((p) => ({ ...p })) }, foreseen: s.foreseen && { ...s.foreseen } };
  const events = [];
  doWork(d, w, target, (e) => events.push(e), { kind: 'test' });
  return { state: d, events };
}
const GILD = { op: 'gild', on: 'pocket' };
const enhance = (enh) => ({ op: 'enhance', on: 'pocket', enh });
/** One spin with the ball made to land in the pocket with this id; the House's luck is off. */
function landOn(s, id) {
  if (s.phase !== 'betting') s = play(s, { type: 'choosePackage', packageId: 'long' }).state;
  const pocketIndex = s.wheel.pockets.findIndex((p) => p.id === id);
  s = { ...noHouseLuck(s), luckyNudge: 0, foreseen: { pocketIndex, pocketId: id, by: null } };
  return play(s, { type: 'spin' });
}
/** The run with this oddity in the fourth compartment. */
const offering = (s, id) => ({ ...s, coins: 100, cabinet: { ...s.cabinet, slots: [...s.cabinet.slots.slice(0, 3), { kind: 'oddity', id, sold: false }] } });
const dealt = (state, id) => ({ ...state, oracle: { debt: state.debt, kind: FORTUNES.find((f) => f.id === id).kind, cards: [id], rerolls: 0, taken: null } });

describe('the wheel as data', () => {
  it('a new wheel is the European one: 37 pockets, each with an id and no enhancement', () => {
    const s = createRun({ seed: 'P5' });
    expect(s.wheel.pockets).toHaveLength(37);
    expect(new Set(s.wheel.pockets.map((p) => p.id)).size).toBe(37);
    expect(s.wheel.pockets.every((p) => p.enh === null && p.width === 1)).toBe(true);
    expect(s.wheel.nextId).toBe(37);
  });
});

describe('wheel work', () => {
  it('widen and narrow act on every pocket with the number; narrowing stops at 0.25', () => {
    let s = setup();
    s = work(s, { op: 'duplicate', on: 'pocket' }, idOf(s, 17)).state;
    s = work(s, { op: 'widen', on: 'number' }, 17).state;
    expect(s.wheel.pockets.filter((p) => p.number === 17).map((p) => p.width)).toEqual([1.5, 1.5]);
    for (let i = 0; i < 3; i++) s = work(s, { op: 'narrow', on: 'number' }, 17).state;
    expect(s.wheel.pockets.filter((p) => p.number === 17).map((p) => p.width)).toEqual([0.25, 0.25]);
    expect(workRefusal(s, { op: 'narrow', on: 'number' }, 17)).toMatch(/narrow/);
  });

  it('a repainted pocket pays Red and Black by its paint', () => {
    let s = setup({ chips: { c1: 'red', c2: 'black' } });
    s = work(s, { op: 'paint', on: 'pocket', color: 'red' }, idOf(s, 2)).state; // 2 is black on the House's wheel
    expect(paysOn(s, 2).lines.map((l) => l.chipId)).toEqual(['c1']);
    expect(workRefusal(s, { op: 'paint', on: 'pocket', color: 'red' }, idOf(s, 2))).toMatch(/red already/);
  });

  it('a cast pocket sits beside the first, plain and one wide; the straight-up covers both', () => {
    let s = setup({ chips: { c1: 'straight:17' } });
    s = work(s, enhance('lucky'), idOf(s, 17)).state;
    const r = work(s, { op: 'duplicate', on: 'pocket' }, idOf(s, 17));
    s = r.state;
    const i = at(s, 17);
    expect(s.wheel.pockets[i + 1]).toEqual({ id: 'p37', number: 17, color: 'black', width: 1, enh: null });
    expect(r.events[0]).toMatchObject({ type: 'wheelWork', op: 'duplicate', made: { id: 'p37', index: i + 1 } });
    expect(amounts(evaluate(s, [{ ball: 0, pocketIndex: i + 1 }]))).toEqual([36]);
    // Two pockets of 37 + 1 wide in 38: the number's chance doubles, near enough.
    expect(numbersView(s).numbers[17].chance).toBeCloseTo(2 / 38, 9);
  });

  it('a chisel takes a pocket out, never below 18, and never the one the Glass Eye foresaw', () => {
    let s = setup();
    s = { ...s, foreseen: { pocketIndex: at(s, 5), pocketId: idOf(s, 5), by: null } };
    expect(workRefusal(s, { op: 'remove', on: 'pocket' }, idOf(s, 5))).toMatch(/Glass Eye/);
    // Taking out a pocket before it (32 sits next to zero) keeps the foreseen landing on its pocket.
    const was = s.foreseen.pocketIndex;
    s = work(s, { op: 'remove', on: 'pocket' }, idOf(s, 32)).state;
    expect(s.foreseen.pocketIndex).toBe(was - 1);
    expect(s.wheel.pockets[s.foreseen.pocketIndex].number).toBe(5);
    while (s.wheel.pockets.length > WHEEL.minPockets) s = work(s, { op: 'remove', on: 'pocket' }, s.wheel.pockets.find((p) => p.number !== 5).id).state;
    expect(workRefusal(s, { op: 'remove', on: 'pocket' }, s.wheel.pockets.find((p) => p.number !== 5).id)).toMatch(/No fewer than 18/);
  });

  it('the wheel stops taking pockets at 60', () => {
    let s = setup();
    while (s.wheel.pockets.length < WHEEL.maxPockets) s = work(s, { op: 'duplicate', on: 'pocket' }, idOf(s, 0)).state;
    expect(workRefusal(s, { op: 'duplicate', on: 'pocket' }, idOf(s, 0))).toMatch(/no room/);
  });
});

describe('pocket enhancements', () => {
  it('gilded pays ×2, platinum ×3, glass ×4; the material acts first, then the pocket, then the rail', () => {
    let s = setup({ chips: { c1: 'red' }, rail: ['red_ribbon'] });
    const base = amounts(paysOn(s, 32))[0];
    s = work(s, GILD, idOf(s, 32)).state;
    expect(amounts(paysOn(s, 32))).toEqual([base * 2]);
    s = work(s, GILD, idOf(s, 32)).state;
    expect(pocket(s, idOf(s, 32)).enh).toBe('platinum');
    expect(amounts(paysOn(s, 32))).toEqual([base * 3]);
    expect(workRefusal(s, GILD, idOf(s, 32))).toMatch(/platinum already/);
    s = work(s, enhance('glass'), idOf(s, 32)).state;
    const plan = paysOn(s, 32);
    expect(amounts(plan)).toEqual([base * 4]);
    const triggers = plan.steps.filter((e) => e.type === 'trigger');
    expect(triggers[0]).toMatchObject({ hook: 'pocketMult', effect: 'mult', amount: 4, src: { uid: idOf(s, 32), id: 'glass', pocket: true } });
    expect(triggers[1].src.id).toBe('red_ribbon');
  });

  it('Bone pays a token whenever the ball lands there, whatever was bet', () => {
    let s = setup();
    s = work(s, enhance('bone'), idOf(s, 9)).state;
    const t0 = s.tokens;
    const r = landOn(s, idOf(s, 9));
    expect(r.state.tokens).toBe(t0 + 1);
    expect(r.events.some((e) => e.type === 'trigger' && e.src.pocket && e.effect === 'tokens')).toBe(true);
  });

  it('Lucky: +2 Nudge on the next spin only', () => {
    let s = setup();
    s = work(s, enhance('lucky'), idOf(s, 9)).state;
    s = landOn(s, idOf(s, 9)).state;
    expect(s.luckyNudge).toBe(2);
    expect(nudgeFor(noHouseLuck(s)).total).toBe(2);
    expect(nudgeFor(noHouseLuck(s)).charms).toBe(2);
    s = landOn({ ...s, luckyNudge: s.luckyNudge }, idOf(s, 10)).state;
    expect(s.luckyNudge).toBe(0);
  });

  it('Ember: a chip that wins there gains +1 value for good; a losing chip does not', () => {
    let s = setup({ chips: { c1: 'straight:17', c2: 'red' } });
    s = work(s, enhance('ember'), idOf(s, 17)).state;
    const r = landOn(s, idOf(s, 17));
    expect(r.state.chips.map((c) => c.value)).toEqual([2, 1, 1]);
    // It lasts past the night, unlike a Matchbook's value.
    let next = play(r.state, { type: 'removeChip', chipId: 'c2' }).state;
    next = { ...next, phase: 'nightOver' };
    next = play(next, { type: 'endNight' }).state;
    expect(next.chips[0].value).toBe(2);
  });

  it('Glass shatters into a blank one landing in four (pockets stream); a blank pays nothing and is never recorded', () => {
    let s = setup({ chips: { c1: 'straight:17' } });
    s = work(s, enhance('glass'), idOf(s, 17)).state;
    const id = idOf(s, 17);
    let landings = 0;
    while (pocket(s, id).enh === 'glass' && landings < 40) {
      s = landOn({ ...s, spinsLeft: 5 }, id).state;
      landings += 1;
    }
    expect(pocket(s, id)).toMatchObject({ number: null, color: null, enh: 'blank' });
    expect(landings).toBeGreaterThan(0);
    const r = landOn({ ...s, spinsLeft: 5 }, id);
    expect(r.events.find((e) => e.type === 'spin').result.miss).toBe(true);
    expect(r.state.tally.debt.numbers.null).toBeUndefined();
    // Brass Scales leans on even numbers only: a blank is not even.
    const scales = grantTalisman(r.state, 'brass_scales');
    expect(liveChances(scales)[r.state.wheel.pockets.findIndex((p) => p.id === id)]).toBeLessThan(1 / 37);
  });

  it('Cursed: a landing raises the Devil’s chance 1% until the night ends', () => {
    let s = { ...setup(), debt: 3 };
    s = work(s, enhance('cursed'), idOf(s, 9)).state;
    const before = devilChanceFor(s);
    // The Devil may fire on the spin itself; the curse acts only on a spin he spared.
    s = { ...s, devil: { ...s.devil }, rng: { ...s.rng, devil: hashSeed('no-devil-tonight') } };
    const r = landOn(s, idOf(s, 9));
    expect(r.events.find((e) => e.type === 'spin').result.devil).toBe(false);
    expect(devilChanceFor(r.state)).toBeCloseTo(before + 0.01, 9);
    const dawn = play({ ...r.state, phase: 'nightOver' }, { type: 'endNight' }).state;
    expect(devilChanceFor(dawn)).toBeCloseTo(before, 9);
  });
});

describe('oddities', () => {
  it('the fourth compartment rolls by rarity from the cabinet stream', () => {
    const rng = new Rng(hashSeed('odd'));
    const counts = {};
    for (let i = 0; i < 20000; i++) {
      const o = rollOdditySlot(rng);
      counts[o.id] = (counts[o.id] ?? 0) + 1;
    }
    expect(Object.keys(counts).sort()).toEqual(ODDITIES.map((o) => o.id).sort());
    expect(counts.brass_shim).toBeGreaterThan(counts.glass_pane);
  });

  it('buying one pays its price in coins (its spins at the debt’s spin cost) and does its work at once; each pick sees the one before', () => {
    let s = offering(setup({ chips: { c1: 'straight:17' } }), 'gold_leaf');
    const id = idOf(s, 17);
    const r = play(s, { type: 'buyOddity', slot: 3, targets: [id, id] });
    expect(r.state.coins).toBe(100 - 40);
    expect(r.state.tokens).toBe(s.tokens);
    // Debt 4's spins cost 5 coins: five times the price.
    expect(cabinetView({ ...s, debt: 4 }).slots[3].price).toBe(200);
    expect(pocket(r.state, id).enh).toBe('platinum');
    expect(r.state.cabinet.slots[3]).toEqual({ kind: 'oddity', id: null, sold: true });
    expect(r.events.map((e) => e.type)).toEqual(['oddityBought', 'wheelWork', 'wheelWork']);
    expect(act(r.state, { type: 'buyOddity', slot: 3, targets: [id, id] }).events[0].code).toBe('soldOut');
  });

  it('a pick that cannot act refuses the whole purchase, and so do the wrong number of picks', () => {
    let s = offering(setup(), 'red_lacquer');
    // 32 is red already: nothing is painted, nothing is paid.
    expect(act(s, { type: 'buyOddity', slot: 3, targets: [idOf(s, 2), idOf(s, 32), idOf(s, 4)] }).events[0]).toMatchObject({ code: 'badTarget' });
    expect(act(s, { type: 'buyOddity', slot: 3, targets: [] }).events[0]).toMatchObject({ code: 'targets' });
    const three = [idOf(s, 2), idOf(s, 4), idOf(s, 6)];
    expect(act({ ...s, coins: 19 }, { type: 'buyOddity', slot: 3, targets: three }).events[0]).toMatchObject({ code: 'noCoins' });
    const r = play(s, { type: 'buyOddity', slot: 3, targets: three });
    expect(three.map((id) => pocket(r.state, id).color)).toEqual(['red', 'red', 'red']);
  });

  it('number work takes a number; the shim widens every pocket with it', () => {
    const s = offering(setup(), 'brass_shim');
    const r = play(s, { type: 'buyOddity', slot: 3, targets: [17] });
    expect(r.state.wheel.pockets[at(r.state, 17)].width).toBe(1.5);
    expect(r.events[1]).toMatchObject({ type: 'wheelWork', op: 'widen', number: 17, amount: 0.5 });
  });

  it('the offer says what it costs and whether it can work; pickView shows where each pick can go', () => {
    let s = offering(setup(), 'gold_leaf');
    expect(cabinetView(s).slots[3]).toMatchObject({ kind: 'oddity', id: 'gold_leaf', price: 40, currency: 'coins', affordable: true, workable: true });
    const id = idOf(s, 17);
    s = work(work(s, GILD, id).state, GILD, id).state;
    // Platinum takes no more gilding: 17 has nowhere left for Gold Leaf.
    const pick = pickView(s, ODDITIES.find((o) => o.id === 'gold_leaf').picks, []);
    expect(pick.numbers[17]).toEqual([]);
    expect(pick.numbers[16]).toHaveLength(1);
    // After gilding 16 once, the second pick can still take 16 (it turns platinum).
    const second = pickView(s, ODDITIES.find((o) => o.id === 'gold_leaf').picks, [idOf(s, 16)]);
    expect(second.numbers[16]).toHaveLength(1);
    expect(second.last).toBe(true);
  });

  it('restocking rolls the oddity again, and a new night does too', () => {
    let s = { ...createRun({ seed: 'ODD-RESTOCK' }), coins: 100 };
    const first = s.cabinet.slots[3];
    s = play(s, { type: 'restock' }).state;
    expect(s.cabinet.slots[3].kind).toBe('oddity');
    expect(createRun({ seed: 'ODD-RESTOCK' }).cabinet.slots[3]).toEqual(first);
  });
});

describe('the Number Punches', () => {
  it('rings only at its tag, with up to 3 stamps; a stamped pocket keeps its paint', () => {
    let s = setup({ rail: ['number_punches'], chips: { c1: 'straight:17' } });
    const uid = s.rail[0].uid;
    // A plain ring never reaches it: you choose what it stamps.
    expect(play(s, { type: 'ringBell' }).events[0]).toMatchObject({ type: 'bellRung', uid: null });
    expect(act(s, { type: 'ringBell', uid }).events[0].code).toBe('targets');
    const p32 = idOf(s, 32);
    const r = play(s, { type: 'ringBell', uid, targets: [{ pocket: p32, number: 17 }] });
    expect(pocket(r.state, p32)).toMatchObject({ number: 17, color: 'red' });
    expect(r.state.rail[0].charges).toBe(0);
    expect(numbersView(r.state).numbers[32].pockets).toEqual([]);
    expect(numbersView(r.state).numbers[17].pockets).toHaveLength(2);
    expect(act(r.state, { type: 'ringBell', uid, targets: [{ pocket: p32, number: 3 }] }).events[0].code).toBe('notUsable');
  });

  it('a blank pocket takes the number and its colour; a stamp the same as the pocket is refused', () => {
    let s = setup({ rail: ['number_punches'] });
    const id = idOf(s, 9);
    s = { ...s, wheel: { ...s.wheel, pockets: s.wheel.pockets.map((p) => (p.id === id ? { ...p, number: null, color: null, enh: 'blank' } : p)) } };
    const uid = s.rail[0].uid;
    expect(act(s, { type: 'ringBell', uid, targets: [{ pocket: idOf(s, 4), number: 4 }] }).events[0].code).toBe('badTarget');
    const r = play(s, { type: 'ringBell', uid, targets: [{ pocket: id, number: 2 }, { pocket: idOf(s, 4), number: 5 }] });
    expect(pocket(r.state, id)).toMatchObject({ number: 2, color: 'black', enh: null });
    expect(pocket(r.state, 'p4')).toMatchObject({ number: 5, color: 'black' });
  });
});

describe('cards that work on the wheel', () => {
  it('Gold finds gold gilds three pockets at random', () => {
    const r = play(dealt(setup(), 'gold_finds_gold'), { type: 'takeFortune', index: 0 });
    expect(r.state.wheel.pockets.filter((p) => p.enh === 'gilded')).toHaveLength(3);
    expect(r.events.filter((e) => e.type === 'wheelWork')).toHaveLength(3);
  });

  it('Borrowed gold gilds four and curses two others', () => {
    const r = play(dealt(setup(), 'borrowed_gold'), { type: 'takeFortune', index: 0 });
    const enh = r.state.wheel.pockets.map((p) => p.enh).filter(Boolean).sort();
    expect(enh).toEqual(['cursed', 'cursed', 'gilded', 'gilded', 'gilded', 'gilded']);
  });
});

describe('read models', () => {
  it('the chalkboard: every chance from the live wheel, colours summing to one', () => {
    let s = setup();
    s = work(s, { op: 'paint', on: 'pocket', color: 'red' }, idOf(s, 2)).state;
    s = work(s, { op: 'duplicate', on: 'pocket' }, idOf(s, 0)).state;
    const v = statsView(s);
    expect(v.pockets).toBe(38);
    expect(v.colors.red).toBeCloseTo(19 / 38, 9);
    expect(v.colors.green).toBeCloseTo(2 / 38, 9);
    expect(v.colors.red + v.colors.black + v.colors.green + v.colors.blank).toBeCloseTo(1, 9);
    expect(v.dozens.reduce((a, b) => a + b, 0) + v.colors.green).toBeCloseTo(1, 9);
    expect(v.numbers[0]).toMatchObject({ count: 2, colors: ['green'] });
    expect(wheelView(s)[1]).toMatchObject({ number: 0, enh: null });
  });
});

describe('saves', () => {
  it('a version 5 save gets pocket ids, its foreseen pocket, a pockets stream and an empty oddity compartment', () => {
    const s = setup();
    const old = { ...s, version: 5, foreseen: { pocketIndex: 3, by: 't1' }, wheel: { pockets: s.wheel.pockets.map(({ id, enh, ...p }) => p) } };
    delete old.luckyNudge;
    old.devil = { firedThisDebt: false };
    old.rng = { ...old.rng };
    delete old.rng.pockets;
    old.cabinet = { ...old.cabinet, slots: [...old.cabinet.slots.slice(0, 3), { kind: 'oddity', id: null, shut: true }] };
    const back = deserializeRun(serializeRun(old).replace('"v":8', '"v":5'));
    expect(back.version).toBe(8);
    expect(back.wheel.pockets.map((p) => p.id)).toEqual(s.wheel.pockets.map((p) => p.id));
    expect(back.wheel.nextId).toBe(37);
    expect(back.foreseen).toEqual({ pocketIndex: 3, pocketId: s.wheel.pockets[3].id, by: 't1' });
    expect(back.rng.pockets).toEqual(createRun({ seed: s.seed }).rng.pockets);
    expect(back.cabinet.slots[3]).toEqual({ kind: 'oddity', id: null, sold: true });
    expect(back).toMatchObject({ luckyNudge: 0, devil: { firedThisDebt: false, nightCurse: 0 } });
  });

  it('a worked wheel round-trips', () => {
    let s = setup();
    s = work(s, { op: 'duplicate', on: 'pocket' }, idOf(s, 17)).state;
    s = work(s, enhance('glass'), idOf(s, 9)).state;
    expect(deserializeRun(serializeRun(s))).toEqual(s);
  });
});
