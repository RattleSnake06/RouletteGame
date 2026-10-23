import { describe, expect, it } from 'vitest';
import { MATERIALS } from '../../src/core/content/index.js';
import { UNLOCK_DEBT, chipSets, deserializeProfile, newProfile, recordDebtPaid, serializeProfile } from '../../src/core/meta.js';
import { evaluate } from '../../src/core/payout.js';
import { act, createRun } from '../../src/core/run.js';
import { deserializeRun, serializeRun } from '../../src/core/save.js';
import { play, pocketOf, spinOn } from './helpers.js';

// Chip sets (decision 26, design doc 6.6, 7): the starting chips' material,
// the rules each material plays by, and the unlock chain between runs.

const run = (chipSet, chips = {}) => {
  let s = { ...createRun({ seed: 'CHIPS-TEST', chipSet }), coins: 100 };
  for (const [chipId, betId] of Object.entries(chips)) s = play(s, { type: 'placeChip', chipId, betId }).state;
  return s;
};
const paysOn = (state, n) => evaluate(state, [{ ball: 0, pocketIndex: pocketOf(n) }]);

describe('starting sets', () => {
  it('each set starts with its own number of chips, all of its material', () => {
    const counts = Object.fromEntries(MATERIALS.map((m) => [m.id, run(m.id).chips.length]));
    expect(counts).toEqual({ normal: 3, clay: 4, bone: 3, glass: 2, gold: 3 });
    expect(run('glass').chips.every((c) => c.material === 'glass' && c.value === 1)).toBe(true);
    expect(run('gold').chipSet).toBe('gold');
    expect(createRun({ seed: 'X' }).chipSet).toBe('normal');
  });
});

describe('material rules', () => {
  it('a straight-up pays 36: ×0.75 for Clay, ×1.15 for Bone, ×1.65 for Glass, ×0.6 for Gold, rounded down', () => {
    const pays = Object.fromEntries(MATERIALS.map((m) => [m.id, paysOn(run(m.id, { c1: 'straight:17' }), 17).lines[0].amount]));
    expect(pays).toEqual({ normal: 36, clay: 27, bone: 41, glass: 59, gold: 21 });
  });

  it('the House rounds down: a 1-value chip on red pays 1 in Clay and Gold, 2 in Bone, 3 in Glass', () => {
    expect(paysOn(run('clay', { c1: 'red' }), 32).lines[0].amount).toBe(1);
    expect(paysOn(run('gold', { c1: 'red' }), 32).lines[0].amount).toBe(1);
    expect(paysOn(run('bone', { c1: 'red' }), 32).lines[0].amount).toBe(2);
    expect(paysOn(run('glass', { c1: 'red' }), 32).lines[0].amount).toBe(3);
  });

  it('the material shows as the first thing that acts on the line', () => {
    const steps = paysOn(run('glass', { c1: 'red' }), 32).steps;
    expect(steps[0]).toMatchObject({ type: 'trigger', hook: 'chipMult', effect: 'mult', amount: 1.65, chipId: 'c1', src: { uid: 'c1', id: 'glass', chip: true } });
  });

  it('Gold: a token for each chip that wins, three a night at most', () => {
    let s = run('gold', { c1: 'red', c2: 'red', c3: 'black' });
    expect(paysOn(s, 32).bonusTokens).toBe(2);
    const t0 = s.tokens;
    s = spinOn(s, 32).state; // two win
    s = spinOn(s, 32).state; // one more, then the cap
    s = spinOn(s, 32).state;
    expect(s.tokens - t0).toBe(3);
    expect(s.chipTokens).toBe(3);
  });

  it('Gold earns afresh each night', () => {
    let s = { ...run('gold', { c1: 'red' }), chipTokens: 3 };
    expect(paysOn(s, 32).bonusTokens).toBe(0);
    s = play({ ...s, phase: 'nightOver' }, { type: 'endNight' }).state;
    expect(s.chipTokens).toBe(0);
    expect(paysOn(s, 32).bonusTokens).toBe(1);
  });

  it('Bone: once placed, a chip stays until the night ends', () => {
    let s = run('bone', { c1: 'red' });
    expect(act(s, { type: 'placeChip', chipId: 'c1', betId: 'black' }).events[0].code).toBe('fixed');
    expect(act(s, { type: 'removeChip', chipId: 'c1' }).events[0].code).toBe('fixed');
    s = play(s, { type: 'placeChip', chipId: 'c2', betId: 'even' }).state; // an unplaced one may still go down
    s = play({ ...s, phase: 'nightOver' }, { type: 'endNight' }).state;
    expect(s.fixed).toEqual([]);
    s = play(s, { type: 'placeChip', chipId: 'c1', betId: 'black' }).state;
    expect(s.placements.c1).toBe('black');
  });

  it('other materials move freely', () => {
    const s = run('glass', { c1: 'red' });
    expect(play(s, { type: 'placeChip', chipId: 'c1', betId: 'black' }).state.placements.c1).toBe('black');
  });
});

describe('unlocks', () => {
  it('paying debt 4 with a set unlocks the next, once', () => {
    let p = newProfile();
    expect(chipSets(p).filter((x) => x.unlocked).map((x) => x.id)).toEqual(['normal']);
    let r = recordDebtPaid(p, { chipSet: 'normal', debtsPaid: UNLOCK_DEBT - 1 });
    expect(r.unlocked).toBe(null);
    r = recordDebtPaid(r.profile, { chipSet: 'normal', debtsPaid: UNLOCK_DEBT });
    expect(r.unlocked).toBe('clay');
    p = r.profile;
    expect(recordDebtPaid(p, { chipSet: 'normal', debtsPaid: 5 }).unlocked).toBe(null);
    expect(p.best.normal).toBe(UNLOCK_DEBT);
    // A set unlocks only the one after it.
    expect(recordDebtPaid(p, { chipSet: 'clay', debtsPaid: 4 }).unlocked).toBe('bone');
    expect(chipSets(p).find((x) => x.id === 'bone').unlocks).toBe('Pay debt 4 with Clay chips.');
  });

  it('the last set unlocks nothing', () => {
    expect(recordDebtPaid(newProfile(), { chipSet: 'gold', debtsPaid: 6 }).unlocked).toBe(null);
  });

  it('a profile round-trips; a broken or foreign one starts fresh, keeping only what it knows', () => {
    const p = recordDebtPaid(newProfile(), { chipSet: 'normal', debtsPaid: 4 }).profile;
    expect(deserializeProfile(serializeProfile(p))).toEqual(p);
    expect(deserializeProfile('not json')).toEqual(newProfile());
    expect(deserializeProfile(null)).toEqual(newProfile());
    expect(deserializeProfile(JSON.stringify({ v: 1, unlocked: ['clay', 'mystery'], best: { clay: 2, mystery: 9 } }))).toEqual({ ...newProfile(), unlocked: ['normal', 'clay'], best: { clay: 2 } });
  });
});

describe('saves', () => {
  it('a version 4 save plays Normal chips (its plain chips were stored as clay)', () => {
    const s = createRun({ seed: 'OLD-RUN' });
    const old = { ...s, version: 4, chips: s.chips.map((c) => ({ ...c, material: 'clay' })) };
    delete old.chipSet;
    delete old.fixed;
    delete old.chipTokens;
    const json = serializeRun(old).replace('"v":9', '"v":4');
    const back = deserializeRun(json);
    expect(back.chipSet).toBe('normal');
    expect(back.chips.every((c) => c.material === 'normal')).toBe(true);
    expect(back).toMatchObject({ fixed: [], chipTokens: 0, version: 9 });
  });

  it('a run with fixed chips and Gold tokens round-trips', () => {
    const s = { ...run('bone', { c1: 'red' }), chipTokens: 2 };
    expect(deserializeRun(serializeRun(s))).toEqual(s);
  });
});
