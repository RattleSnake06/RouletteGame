import { describe, expect, it } from 'vitest';
import { getTalisman } from '../../src/core/content/index.js';
import { calendarSpin, racetrackBets } from '../../src/core/content/talismans.js';
import { ECONOMY } from '../../src/core/economy.js';
import { interestRateFor, openSpecials, useUp } from '../../src/core/effects.js';
import { evaluate } from '../../src/core/payout.js';
import { ballsFor } from '../../src/core/resolve.js';
import { act, copyRun, createRun, grantTalisman, spinsOf } from '../../src/core/run.js';
import { play, setup, spinOn } from './helpers.js';

// The builds pass (design doc 6.8, decision 32): the Pyre, and the pieces
// each build lacked (a card, a record or a talisman).

const at = (s, n) => s.wheel.pockets.findIndex((p) => p.number === n);
const one = (s, betId) => ({ ...s, chips: [{ id: 'c1', value: 1, material: 'normal', roundValue: 0 }], placements: { c1: betId } });
const paysOn = (s, n) => evaluate(s, [{ ball: 0, pocketIndex: at(s, n) }]).lines.map((l) => l.amount);
const withBoon = (s, id, data = {}) => ({ ...s, boons: [...s.boons, { uid: `b${s.boons.length + 9}`, id, data }] });
const withRecord = (s, id) => play({ ...s, records: [...s.records, id] }, { type: 'playRecord', id }).state;
const dealt = (s, id, kind) => ({ ...s, oracle: { debt: s.debt, kind, cards: [id], rerolls: 0, taken: null } });
const withStats = (s, stats) => ({ ...s, stats: { ...s.stats, ...stats } });
/** The last night of the debt over, with plenty in the Cage. */
const atCage = (s) => ({ ...s, round: 3, phase: 'nightOver', deposited: 100000 });

describe('the Pyre', () => {
  it('Kindling: +2 tokens when it is sold, on top of its price', () => {
    const s = grantTalisman(setup(), 'kindling');
    const r = play(s, { type: 'sell', uid: s.rail[0].uid });
    expect(r.state.tokens).toBe(s.tokens + 1 + 2);
  });

  it('Funeral Urn: +1 Stake for every talisman sold this run, up to +4', () => {
    const s = one(grantTalisman(setup(), 'funeral_urn'), 'red');
    expect(paysOn(withStats(s, { talismansSold: 2 }), 1)).toEqual([6]);
    expect(paysOn(withStats(s, { talismansSold: 9 }), 1)).toEqual([10]);
  });

  it('The Pyre: chips +×0.5 for every talisman sold or used up', () => {
    const s = one(grantTalisman(setup(), 'the_pyre'), 'red');
    expect(paysOn(s, 1)).toEqual([2]);
    expect(paysOn(withStats(s, { talismansSold: 2, talismansGone: 1 }), 1)).toEqual([5]);
  });

  it('Phoenix Feather: the first talisman used up each debt comes back fresh; the next one goes', () => {
    const s = grantTalisman(grantTalisman(grantTalisman(setup(), 'phoenix_feather'), 'grandmothers_purse'), 'holy_water');
    const draft = copyRun(s);
    const events = [];
    const purse = draft.rail[1];
    purse.data = { nights: 5 };
    useUp(draft, purse, 'crumbled', (e) => events.push(e));
    expect(draft.rail).toContain(purse);
    expect(purse.data).toEqual(getTalisman('grandmothers_purse').init?.() ?? {});
    expect(events.map((e) => e.type)).toEqual(['trigger', 'talismanRevived']);
    useUp(draft, draft.rail[2], 'shattered', (e) => events.push(e));
    expect(draft.rail.map((t) => t.id)).toEqual(['phoenix_feather', 'grandmothers_purse']);
    expect(draft.stats.talismansGone).toBe(2);
    // A new debt, a new life.
    draft.debt += 1;
    useUp(draft, draft.rail[1], 'crumbled', () => {});
    expect(draft.rail).toHaveLength(2);
  });

  it('"Burn it all.": every talisman that can come off is sold for its full price; Requiem doubles a sale', () => {
    let s = grantTalisman(grantTalisman(setup(), 'red_ribbon'), 'horseshoe');
    s = play(dealt(s, 'roll_bones', 'black'), { type: 'takeFortune', index: 0 }).state;
    const r = play(dealt(s, 'burn_it_all', 'black'), { type: 'takeFortune', index: 0 });
    expect(r.state.rail.map((t) => t.id)).toEqual(['bone_dice']);
    expect(r.state.tokens).toBe(s.tokens + 3 + 3);
    expect(r.state.stats.talismansSold).toBe(2);
    const q = withRecord(grantTalisman(setup(), 'red_ribbon'), 'requiem');
    expect(play(q, { type: 'sell', uid: q.rail[0].uid }).state.tokens).toBe(q.tokens + 2);
  });
});

describe('what each build lacked', () => {
  it('inside: "The table remembers." levels the lines; Stride Piano gives them Stake and halves straight-ups', () => {
    const r = play(dealt(setup(), 'table_remembers', 'white'), { type: 'takeFortune', index: 0 });
    for (const kind of ['split', 'street', 'corner', 'sixLine']) expect(r.state.levels[kind]).toBe(2);
    const s = withRecord(setup(), 'stride_piano');
    expect(paysOn(one(s, 'corner:1-2-4-5'), 5)).toEqual([18]);
    expect(paysOn(one(s, 'straight:17'), 17)).toEqual([18]);
  });

  it('streaks: "Hot hands." keeps a streak through the first miss of a night, not the second', () => {
    let s = grantTalisman(setup({ chips: { c1: 'straight:17' } }), 'hot_coals');
    s = withBoon({ ...s, rail: s.rail.map((t) => ({ ...t, data: { streak: 2 } })) }, 'hot_hands');
    let r = spinOn(s, 5);
    expect(r.state.rail[0].data.streak).toBe(2);
    r = spinOn(r.state, 5);
    expect(r.state.rail[0].data.streak).toBe(0);
  });

  it('zero: Bolero pays every chip when a green zero lands', () => {
    const s = withRecord(setup(), 'bolero');
    expect(paysOn(one(s, 'red'), 0)).toEqual([2]);
    expect(paysOn(one(setup(), 'red'), 0)).toEqual([]);
  });

  it('multi-ball: "A spare ball." for five spins; Pair of Dice doubles two balls on one colour', () => {
    let s = withBoon(setup({ chips: { c1: 'red' } }), 'spare_ball', { left: 5 });
    expect(ballsFor(s)).toHaveLength(2);
    s = spinOn(s, 1).state;
    expect(s.boons.at(-1).data.left).toBe(4);
    expect(ballsFor(withBoon(setup(), 'spare_ball', { left: 0 }))).toHaveLength(1);
    const d = one(grantTalisman(setup(), 'pair_of_dice'), 'red');
    const two = evaluate(d, [{ ball: 0, pocketIndex: at(d, 1) }, { ball: 1, pocketIndex: at(d, 3) }]);
    expect(two.lines.map((l) => l.amount)).toEqual([4, 4]);
    const mixed = evaluate(d, [{ ball: 0, pocketIndex: at(d, 1) }, { ball: 1, pocketIndex: at(d, 2) }]);
    expect(mixed.lines.map((l) => l.amount)).toEqual([2]);
  });

  it('interest: "Compound interest." +3% each time; Savings Book +1% per debt paid, up to +5%', () => {
    const base = ECONOMY.interestRate;
    const s = withBoon(withBoon(setup(), 'compound_interest'), 'compound_interest');
    expect(interestRateFor(s, base)).toBeCloseTo(base + 0.06, 9);
    const b = grantTalisman(setup(), 'savings_book');
    expect(interestRateFor(withStats(b, { debtsPaid: 3 }), base)).toBeCloseTo(base + 0.03, 9);
    expect(interestRateFor(withStats(b, { debtsPaid: 9 }), base)).toBeCloseTo(base + 0.05, 9);
  });

  it('tokens: Gold Tooth pays ×(1 + tokens ÷ 20)', () => {
    const s = one(grantTalisman(setup(), 'gold_tooth'), 'red');
    expect(paysOn({ ...s, tokens: 10 }, 1)).toEqual([3]);
    expect(paysOn({ ...s, tokens: 0 }, 1)).toEqual([2]);
  });

  it('timing: the Pocket Calendar marks one spin a night (×3); "The night is young." adds a spin this debt', () => {
    const s = one(grantTalisman(setup(), 'pocket_calendar'), 'red');
    const night = { ...s, phase: 'betting', spinsTonight: 7 };
    const mark = calendarSpin(night);
    expect(mark).toBeGreaterThanOrEqual(1);
    expect(mark).toBeLessThanOrEqual(7);
    expect(paysOn({ ...night, spinsLeft: 7 - mark + 1 }, 1)).toEqual([6]);
    expect(paysOn({ ...night, spinsLeft: mark === 1 ? 6 : 7 }, 1)).toEqual([2]);
    const y = withBoon(setup(), 'night_is_young', { debt: 1 });
    expect(spinsOf(y, 'long')).toBe(8);
    expect(spinsOf({ ...y, debt: 2 }, 'long')).toBe(7);
  });

  it('the Bell: the Hand Bell gives the leftmost Bell talisman one more charge each debt', () => {
    const s = grantTalisman(grantTalisman(setup(), 'wheel_of_fortune'), 'hand_bell');
    const r = play(atCage(s), { type: 'endNight' });
    expect(r.state.debt).toBe(2);
    expect(r.state.rail[0].charges).toBe(getTalisman('wheel_of_fortune').charges.max + 1);
  });

  it('sectors: the Racing Form opens the Neighbours, and waits for the first lock', () => {
    expect([...openSpecials(grantTalisman(setup(), 'racing_form'))]).toEqual(['neighbours']);
    expect(getTalisman('racing_form').unlock).toEqual({ lock: 1 });
  });

  it('black: Raven Feather +1 Stake on Black; Midnight Blues doubles black and halves red', () => {
    expect(paysOn(one(grantTalisman(setup(), 'raven_feather'), 'black'), 2)).toEqual([4]);
    const s = withRecord(setup(), 'midnight_blues');
    expect(paysOn(one(s, 'black'), 2)).toEqual([4]);
    expect(paysOn(one(s, 'red'), 1)).toEqual([1]);
  });

  it('a new run deals none of what waits for a lock', () => {
    for (const [id, lock] of [['tote_board', 1], ['carillon', 2], ['patience_jar', 3], ['grandfather_clock', 4]]) expect(getTalisman(id).unlock).toEqual({ lock });
    expect(createRun({ seed: 'POOL' }).opened).toEqual([]);
    expect(act(setup(), { type: 'placeChip', chipId: 'c1', betId: 'neighbours:17' }).events[0]).toMatchObject({ code: 'closed' });
  });
});

describe('the weak builds\' multipliers (decision 33)', () => {
  const chips = (s, bets) => ({ ...s, chips: bets.map((_, i) => ({ id: `c${i + 1}`, value: 1, material: 'normal', roundValue: 0 })), placements: Object.fromEntries(bets.map((b, i) => [`c${i + 1}`, b])) });

  it('the Carillon: chips +×1 for every ring answered this debt; a new debt starts over', () => {
    const s = one(grantTalisman(setup(), 'carillon'), 'red');
    expect(paysOn(s, 1)).toEqual([2]);
    expect(paysOn({ ...s, debtRings: 2 }, 1)).toEqual([6]);
    let r = play(grantTalisman(setup(), 'wheel_of_fortune'), { type: 'ringBell' });
    expect(r.state.debtRings).toBe(1);
    r = play(atCage(r.state), { type: 'endNight' });
    expect(r.state.debt).toBe(2);
    expect(r.state.debtRings).toBe(0);
  });

  it('the Tote Board: racetrack chips ×1 for each different racetrack bet with chips', () => {
    const three = chips(setup(), ['voisins', 'tiers', 'orphelins']);
    expect(racetrackBets(three)).toBe(3);
    const bare = paysOn(three, 0);
    expect(paysOn(grantTalisman(three, 'tote_board'), 0)).toEqual(bare.map((x) => x * 3));
    const alone = chips(setup(), ['voisins']);
    expect(paysOn(grantTalisman(alone, 'tote_board'), 0)).toEqual(paysOn(alone, 0));
  });

  it('the Patience Jar: +×0.5 a spin without a green zero, paid on the next zero, then empty', () => {
    let s = grantTalisman(setup({ chips: { c1: 'straight:0' } }), 'patience_jar');
    s = spinOn(s, 5).state;
    s = spinOn(s, 7).state;
    expect(s.rail[0].data.wait).toBe(2);
    const r = spinOn(s, 0);
    expect(r.state.lastSpin.total).toBe(36 * 2);
    expect(r.state.rail[0].data.wait).toBe(0);
  });

  it('the Grandfather Clock: chips +×0.5 for every spin already played tonight, new each night', () => {
    let s = grantTalisman(setup({ chips: { c1: 'red' } }), 'grandfather_clock');
    s = spinOn(s, 2).state;
    s = spinOn(s, 4).state;
    expect(s.rail[0].data.clock.played).toBe(2);
    expect(spinOn(s, 1).state.lastSpin.total).toBe(2 * 2);
    expect(paysOn(one({ ...s, round: s.round + 1 }, 'red'), 1)).toEqual([2]);
  });
});
