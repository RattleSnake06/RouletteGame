import { describe, expect, it } from 'vitest';
import { BETS, betCovers, betOdds, getBet } from '../../src/core/bets.js';
import { FORTUNES } from '../../src/core/content/index.js';
import { devilLive } from '../../src/core/devil.js';
import { applyRun, almanacView, deserializeProfile, edgeChoices, endRun, newProfile, runOptions, serializeProfile, standingFigures, wheelChoices } from '../../src/core/meta.js';
import { upcomingLean } from '../../src/core/nudge.js';
import { evaluate } from '../../src/core/payout.js';
import { act, createRun, hooksFor, owed } from '../../src/core/run.js';
import { deserializeRun, serializeRun } from '../../src/core/save.js';
import { numbersView, statsView } from '../../src/core/selectors.js';
import { neighbourIndex, pocketChance } from '../../src/core/wheel.js';
import { workRefusal, workTargets } from '../../src/core/wheelwork.js';
import { play } from './helpers.js';

// Phase 6 (design doc 7, decision 29): starting wheels, House Edge levels, the
// Vault's locks and the goal, the figures in the dark and the Almanac.

const run = (opts = {}) => ({ ...createRun({ seed: 'PHASE-SIX', ...opts }), coins: 1000 });
const at = (s, n) => s.wheel.pockets.findIndex((p) => p.number === n);
const lineOn = (s, betId, index) => evaluate({ ...s, chips: [{ id: 'c1', value: 1, material: 'normal', roundValue: 0 }], placements: { c1: betId } }, [{ ball: 0, pocketIndex: index }]).lines.map((l) => l.amount);
/** The last night of the debt over, with this much in the Cage. */
const atCage = (s, debt, deposited) => ({ ...s, debt, round: 3, phase: 'nightOver', deposited, stats: { ...s.stats, debtsPaid: debt - 1 } });

describe('starting wheels', () => {
  it('the American wheel has a green 00 with its own bets; outside bets lose there', () => {
    const s = run({ wheel: 'american' });
    expect(s.wheel.pockets).toHaveLength(38);
    const dz = s.wheel.pockets[at(s, 37)];
    expect(dz).toMatchObject({ id: 'p37', color: 'green' });
    expect(lineOn(s, 'straight:37', at(s, 37))).toEqual([36]);
    expect(lineOn(s, 'split:0-37', at(s, 37))).toEqual([18]);
    for (const b of ['red', 'black', 'odd', 'even', 'low', 'high', 'dozen:1', 'column:3']) expect(lineOn(s, b, at(s, 37))).toEqual([]);
    // Every bet returns 36/38 on it.
    for (const bet of BETS) {
      let ev = 0;
      s.wheel.pockets.forEach((p, i) => betCovers(bet, p) && (ev += pocketChance(s.wheel, i) * betOdds(bet)));
      expect(ev, bet.id).toBeCloseTo(36 / 38, 12);
    }
    expect(numbersView(s).numbers).toHaveLength(38);
    expect(statsView(s).fair).toBeCloseTo(1 / 38, 12);
    expect(getBet('straight:37').label).toBe('Straight up 00');
  });

  it('the American wheel pays 2 tokens more for a paid debt', () => {
    const r = play(atCage(run({ wheel: 'american' }), 1, 1000), { type: 'endNight' });
    expect(r.events.find((e) => e.type === 'debtPaid').rewardTokens).toBe(4);
    expect(play(atCage(run(), 1, 1000), { type: 'endNight' }).events.find((e) => e.type === 'debtPaid').rewardTokens).toBe(2);
  });

  it('00 is worked like any number on the American wheel, and on no other', () => {
    const am = run({ wheel: 'american' });
    expect(workRefusal(am, { op: 'widen', on: 'number' }, 37)).toBe(null);
    expect(workRefusal(am, { op: 'stamp' }, { pocket: 'p17', number: 37 })).toBe(null);
    const eu = run();
    expect(workRefusal(eu, { op: 'widen', on: 'number' }, 37)).toBe('Choose a number.');
    expect(workRefusal(eu, { op: 'stamp' }, { pocket: 'p17', number: 37 })).toBe('Choose a number to stamp.');
  });

  it('the Mirror wheel runs 0 to 36 as the felt does', () => {
    const s = run({ wheel: 'mirror' });
    expect(s.wheel.pockets.map((p) => p.number)).toEqual(Array.from({ length: 37 }, (_, n) => n));
    const i = at(s, 17);
    expect([s.wheel.pockets[neighbourIndex(s.wheel, i, -1)].number, s.wheel.pockets[neighbourIndex(s.wheel, i, 1)].number]).toEqual([16, 18]);
    expect(s.wheel.pockets[at(s, 18)].color).toBe('red');
  });

  it('the Gilded wheel starts with 6 gilded pockets and owes a quarter more', () => {
    const s = run({ wheel: 'gilded' });
    const gilded = s.wheel.pockets.filter((p) => p.enh === 'gilded');
    expect(gilded).toHaveLength(6);
    expect(gilded.every((p) => p.number > 0)).toBe(true);
    expect(owed(s)).toBe(75);
    expect(owed(s, 2)).toBe(500);
    // The draw is the run's own: the same seed gilds the same pockets.
    expect(run({ wheel: 'gilded' }).wheel.pockets.filter((p) => p.enh === 'gilded').map((p) => p.id)).toEqual(gilded.map((p) => p.id));
    // The other wheels draw nothing, so a European run is the run it always was.
    expect(run().rng).toEqual(createRun({ seed: 'PHASE-SIX' }).rng);
  });

  it('the Bone wheel makes every third black pocket Bone and wakes the Devil at debt 1', () => {
    const s = run({ wheel: 'bone' });
    const blacks = s.wheel.pockets.filter((p) => p.color === 'black');
    expect(blacks.map((p) => p.enh)).toEqual(blacks.map((_, i) => (i % 3 ? null : 'bone')));
    expect(s.wheel.pockets.filter((p) => p.enh === 'bone')).toHaveLength(6);
    expect(devilLive(s)).toBe(true);
    expect(devilLive(run())).toBe(false);
  });
});

describe('House Edge', () => {
  it('level 1 adds a green pocket with no number: every bet loses, no tool touches it', () => {
    const s = run({ edge: 1 });
    expect(s.wheel.pockets).toHaveLength(38);
    const i = s.wheel.pockets.findIndex((p) => p.enh === 'house');
    expect(i).toBe(19);
    expect(s.wheel.pockets[i]).toMatchObject({ number: null, color: 'green' });
    for (const b of ['straight:0', 'red', 'black', 'dozen:1', 'firstFour']) expect(lineOn(s, b, i)).toEqual([]);
    const id = s.wheel.pockets[i].id;
    for (const work of [{ op: 'remove' }, { op: 'gild' }, { op: 'duplicate' }]) expect(workRefusal(s, work, id)).toMatch(/House/);
    expect(workRefusal(s, { op: 'stamp' }, { pocket: id, number: 5 })).toMatch(/House/);
    expect(workTargets(s, { op: 'stamp' })).not.toContain(id);
    expect(numbersView(s).house.pockets).toHaveLength(1);
    expect(statsView(s).colors.green).toBeCloseTo(2 / 38, 12);
  });

  it('level 2 wakes the Devil at debt 2; at level 3 a paid debt gives a token less', () => {
    expect(devilLive({ ...run({ edge: 1 }), debt: 2 })).toBe(false);
    expect(devilLive({ ...run({ edge: 2 }), debt: 2 })).toBe(true);
    const r = play(atCage(run({ edge: 3 }), 1, 1000), { type: 'endNight' });
    expect(r.events.find((e) => e.type === 'debtPaid').rewardTokens).toBe(1);
    expect(r.events.find((e) => e.type === 'tokens')).toMatchObject({ amount: 1 });
  });

  it('level 4 makes debts owe a quarter more; level 5 weakens every Lean by 1', () => {
    expect(owed(run({ edge: 4 }))).toBe(75);
    expect(owed(run({ edge: 4, wheel: 'gilded' }))).toBe(94);
    const plain = run();
    const spin = plain.leans.debt[0].at;
    const s = { ...plain, phase: 'betting', debtSpins: spin - 1, spinsLeft: 3, spinsTonight: 7 };
    expect(upcomingLean(s)).toBe(2);
    expect(upcomingLean({ ...s, edge: 5 })).toBe(1);
    expect(upcomingLean({ ...s, edge: 5, leans: { debt: [{ at: spin, strength: 1 }], night: null } })).toBe(1);
  });
});

describe('the Vault and the goal', () => {
  it('the goal is debt 4 at first; paying it opens lock 1, and the player may step out', () => {
    let s = run();
    expect(s.goal).toBe(4);
    expect(act(s, { type: 'leave' }).events[0]).toMatchObject({ code: 'notWon' });
    s = atCage(s, 4, 100000);
    const r = play(s, { type: 'endNight' });
    expect(r.events.map((e) => e.type)).toEqual(expect.arrayContaining(['debtPaid', 'lockOpened', 'goalReached']));
    expect(r.events.find((e) => e.type === 'lockOpened').lock).toBe(1);
    expect(r.state).toMatchObject({ won: 4, locks: 1, debt: 5, phase: 'roundStart' });
    const out = play(r.state, { type: 'leave' });
    expect(out.state.phase).toBe('gameOver');
    expect(out.state.outcome).toMatchObject({ reason: 'left', debtsPaid: 4 });
  });

  it('the goal moves with the locks; with four open, debt 8 opens the Vault', () => {
    let s = run({ locks: 3 });
    expect(s.goal).toBe(7);
    // Debt 6 opens nothing more: lock 3 is open already.
    let r = play(atCage(s, 6, 1e7), { type: 'endNight' });
    expect(r.events.some((e) => e.type === 'lockOpened' || e.type === 'goalReached')).toBe(false);
    r = play(atCage(s, 7, 1e7), { type: 'endNight' });
    expect(r.events.find((e) => e.type === 'lockOpened').lock).toBe(4);
    expect(r.events.some((e) => e.type === 'goalReached')).toBe(true);
    // Playing on past the goal, debt 8 opens the Vault.
    r = play(atCage(r.state, 8, 1e8), { type: 'endNight' });
    expect(r.events.some((e) => e.type === 'vaultOpened')).toBe(true);
    expect(r.state.vault).toBe(true);
    // A Vault opened before does not open again.
    const again = play(atCage(run({ locks: 4, vault: true }), 8, 1e8), { type: 'endNight' });
    expect(again.events.some((e) => e.type === 'vaultOpened')).toBe(false);
    expect(again.events.some((e) => e.type === 'goalReached')).toBe(true);
  });

  it('the second lock gives the gramophone a second slot; both records act', () => {
    expect(run({ locks: 1 }).gramophoneSlots).toBe(1);
    let s = { ...run({ locks: 2 }), records: ['static', 'nocturne', 'carousel'] };
    expect(act({ ...s, gramophoneSlots: 1 }, { type: 'playRecord', id: 'static', slot: 1 }).events[0]).toMatchObject({ code: 'noSlot' });
    s = play(s, { type: 'playRecord', id: 'static' }, { type: 'playRecord', id: 'nocturne', slot: 1 }).state;
    expect([s.playing, s.playing2]).toEqual(['static', 'nocturne']);
    expect(hooksFor(s)).toBe(7);
    expect(act(s, { type: 'playRecord', id: 'static', slot: 1 }).events[0]).toMatchObject({ code: 'playing' });
    // A record given while both slots play waits in the crate.
    const r = play({ ...s, cabinet: { ...s.cabinet, slots: [...s.cabinet.slots.slice(0, 3), { kind: 'oddity', id: 'record_sleeve', record: 'funeral_march', sold: false }] } }, { type: 'buyOddity', slot: 3, targets: [] });
    expect([r.state.playing, r.state.playing2]).toEqual(['static', 'nocturne']);
  });
});

describe('the figures in the dark', () => {
  it('Danse Macabre: +1% interest for each figure standing', () => {
    const s = { ...run({ figures: 5 }), records: ['danse_macabre'], playing: 'danse_macabre', phase: 'nightOver', deposited: 1000 };
    const r = play(s, { type: 'endNight' });
    expect(r.events.find((e) => e.type === 'interest')).toMatchObject({ rate: 0.1, amount: 100 });
  });

  it('Ask the figures sends the oldest standing figure away', () => {
    const def = FORTUNES.find((f) => f.id === 'ask_figures');
    const s = { ...run({ figures: 2 }), oracle: { debt: 1, kind: def.kind, cards: [def.id], rerolls: 0, taken: null } };
    const r = play(s, { type: 'takeFortune', index: 0 });
    expect(r.state.figures).toBe(1);
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'fortuneEffect', effect: 'figureGone' }));
    let p = endRun(newProfile(), { ...run(), debt: 3 }, 'collected');
    expect(standingFigures(p)).toHaveLength(2);
    p = applyRun(p, r.state, r.events).profile;
    expect(standingFigures(p).map((f) => f.n)).toEqual([1]);
    expect(p.figures[0].gone).toBe(true);
  });

  it('every run but one that steps out leaves a figure; twelve stand at most', () => {
    let p = newProfile();
    expect(standingFigures(p)).toHaveLength(1);
    expect(standingFigures(p)[0].stranger).toBe(true);
    const lost = { ...run({ chipSet: 'normal' }), debt: 3, stats: { ...run().stats, debtsPaid: 2, bestSpin: 140, spins: 30 } };
    p = endRun(p, lost, 'collected');
    expect(p.figures.at(-1)).toMatchObject({ n: 1, cause: 'collected', debt: 3, paid: 2, best: 140, wheel: 'european' });
    p = endRun(p, lost, 'left');
    expect(p.figures).toHaveLength(2);
    expect(p.stats).toMatchObject({ runs: 2, left: 1, lost: 1, bestDebt: 2, bestSpin: 140, spins: 60 });
    for (let i = 0; i < 20; i++) p = endRun(p, lost, 'gaveUp');
    expect(standingFigures(p)).toHaveLength(12);
    expect(runOptions(p).figures).toBe(12);
    expect(almanacView(p).figures[0]).toMatchObject({ cause: 'Gave up at debt 3', standing: true });
  });
});

describe('the profile', () => {
  it('locks open wheels; reaching the goal at the top House Edge opens the next', () => {
    let p = newProfile();
    expect(wheelChoices(p).filter((w) => w.unlocked).map((w) => w.id)).toEqual(['european']);
    expect(edgeChoices(p).filter((e) => e.unlocked).map((e) => e.level)).toEqual([0]);
    const s = run();
    let r = applyRun(p, s, [{ type: 'lockOpened', lock: 1 }, { type: 'goalReached', debt: 4, edge: 0 }]);
    p = r.profile;
    expect(r.news).toEqual([{ kind: 'lock', lock: 1, wheels: ['american'], slot: false }, { kind: 'edge', level: 1 }]);
    expect(wheelChoices(p).filter((w) => w.unlocked).map((w) => w.id)).toEqual(['european', 'american']);
    // The goal at a level below the top opens nothing.
    r = applyRun({ ...p, edge: 3 }, { ...s, edge: 1 }, [{ type: 'goalReached', debt: 4, edge: 1 }]);
    expect(r.news.filter((n) => n.kind === 'edge')).toEqual([]);
    r = applyRun(p, s, [{ type: 'lockOpened', lock: 2 }]);
    expect(r.news[0]).toMatchObject({ wheels: ['gilded'], slot: true });
    expect(applyRun(p, s, [{ type: 'vaultOpened' }]).profile.vault).toBe(true);
  });

  it('what the run shows goes into the Almanac; achievements are kept', () => {
    const s = { ...run(), rail: [{ uid: 't1', id: 'red_ribbon', data: {}, charges: null, engraving: 'gilt', price: 3 }], records: ['nocturne'] };
    const { profile, news } = applyRun(newProfile(), { ...s, stats: { ...s.stats, debtsPaid: 4 } }, [{ type: 'debtPaid', debt: 4 }]);
    expect(profile.seen.talismans).toContain('red_ribbon');
    expect(profile.seen.records).toEqual(['nocturne']);
    expect(profile.seen.engravings).toEqual(['gilt']);
    expect(news).toContainEqual({ kind: 'achievement', id: 'out_of_the_red' });
    expect(news).toContainEqual({ kind: 'chips', id: 'clay' });
    const view = almanacView(profile);
    const talismans = view.sections.find((x) => x.kind === 'talismans');
    expect(talismans.entries.find((e) => e.id === 'red_ribbon')).toMatchObject({ seen: true, name: 'Red Ribbon' });
    expect(talismans.entries.find((e) => e.id === 'horseshoe')).toEqual({ id: 'horseshoe', seen: false });
    expect(view.achievements.find((a) => a.id === 'out_of_the_red').done).toBe(true);
    // Nothing new: the same profile comes back.
    expect(applyRun(profile, s, []).profile).toBe(profile);
  });

  it('a version 2 profile round-trips; a version 1 profile opens the locks its debts reached', () => {
    let p = endRun(newProfile(), { ...run(), debt: 2 }, 'collected');
    p = { ...p, locks: 2, edge: 1, achievements: ['same_again'] };
    expect(deserializeProfile(serializeProfile(p))).toEqual(p);
    const old = deserializeProfile(JSON.stringify({ v: 1, unlocked: ['normal', 'clay'], best: { normal: 5, clay: 2 } }));
    expect(old).toMatchObject({ v: 2, locks: 2, edge: 0, unlocked: ['normal', 'clay'] });
    expect(standingFigures(old)).toHaveLength(1);
  });
});

describe('saves', () => {
  it('a version 7 save plays the European wheel at no House Edge, toward debt 4', () => {
    const s = run();
    const old = { ...s, version: 7, tally: { ...s.tally, round: { dozens: [0, 0, 0], columns: [0, 0, 0] } } };
    for (const k of ['wheelId', 'edge', 'locks', 'goal', 'vault', 'won', 'figures', 'playing2', 'gramophoneSlots']) delete old[k];
    const back = deserializeRun(serializeRun(old).replace('"v":8', '"v":7'));
    expect(back).toMatchObject({ version: 8, wheelId: 'european', edge: 0, goal: 4, won: null, gramophoneSlots: 1, playing2: null });
    expect(back.tally.round.numbers).toEqual({});
    const past = deserializeRun(serializeRun({ ...old, debt: 6 }).replace('"v":8', '"v":7'));
    expect(past.won).toBe(4);
  });

  it('wheels, edges and the gramophone round-trip', () => {
    const s = { ...run({ wheel: 'american', edge: 3, locks: 2, figures: 4 }), playing2: null };
    expect(deserializeRun(serializeRun(s))).toEqual(s);
  });
});
