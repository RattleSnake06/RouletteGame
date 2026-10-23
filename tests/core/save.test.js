import { describe, expect, it } from 'vitest';
import { num } from '../../src/core/num.js';
import { nudgeFor } from '../../src/core/nudge.js';
import { seedStreams } from '../../src/core/rng.js';
import { act, createRun, grantTalisman } from '../../src/core/run.js';
import { deserializeRun, serializeRun } from '../../src/core/save.js';

const PHASE3_FIELDS = ['debtSpins', 'leans', 'missStreak', 'devil'];

/**
 * A save as Phase 2 wrote it: version 2, none of the Phase 3 fields. Phase 2
 * never drew from the lean stream, so it is put back to its seeded state, and
 * the last spin loses what Phase 3 added to it.
 */
function asVersion2(state) {
  const data = JSON.parse(serializeRun(state));
  data.v = 2;
  for (const k of PHASE3_FIELDS) delete data.state[k];
  for (const k of ['leans', 'hops', 'devils']) delete data.state.stats[k];
  data.state.rng.lean = seedStreams(state.seed).lean;
  if (data.state.lastSpin) for (const k of ['luck', 'hops', 'firstHops', 'devilChance', 'devil', 'lost']) delete data.state.lastSpin[k];
  data.state.version = 2;
  return data;
}

/** A save as Phase 1 wrote it: version 1, none of the Phase 2 fields. */
function asVersion1(state) {
  const data = asVersion2(state);
  data.v = 1;
  for (const k of ['railHooks', 'rail', 'nextUid', 'cabinet', 'foreseen', 'armed', 'tally']) delete data.state[k];
  data.state.version = 1;
  for (const c of data.state.chips) delete c.roundValue;
  return data;
}

function advance(state, actions) {
  for (const a of actions) state = act(state, a).state;
  return state;
}

describe('saves', () => {
  it('round-trips a run in progress', () => {
    const state = advance(createRun({ seed: 'SAVE-TEST' }), [
      { type: 'placeChip', chipId: 'c1', betId: 'split:17-20' },
      { type: 'choosePackage', packageId: 'long' },
      { type: 'spin' },
      { type: 'spin' },
    ]);
    expect(deserializeRun(serializeRun(state))).toEqual(state);
  });

  it('continues a loaded run exactly as the original would', () => {
    const state = advance(createRun({ seed: 'SAVE-TEST' }), [
      { type: 'placeChip', chipId: 'c1', betId: 'red' },
      { type: 'choosePackage', packageId: 'long' },
      { type: 'spin' },
    ]);
    const loaded = deserializeRun(serializeRun(state));
    const a = advance(state, [{ type: 'spin' }, { type: 'spin' }]);
    const b = advance(loaded, [{ type: 'spin' }, { type: 'spin' }]);
    expect(b.history).toEqual(a.history);
    expect(b.coins).toBe(a.coins);
  });

  it('keeps big numbers big', () => {
    const state = { ...createRun({ seed: 'BIG' }), deposited: num('4.2e321') };
    const loaded = deserializeRun(serializeRun(state));
    expect(loaded.deposited.exponent).toBe(321);
    expect(loaded.deposited.mantissa).toBeCloseTo(4.2, 10);
  });

  it('rejects unreadable or foreign saves', () => {
    expect(deserializeRun('not json')).toBeNull();
    expect(deserializeRun(JSON.stringify({ v: 999, state: {} }))).toBeNull();
  });

  it('fills in the night size for saves made before the tally', () => {
    const playing = asVersion1(advance(createRun({ seed: 'TEST-SAVE' }), [{ type: 'choosePackage', packageId: 'long' }, { type: 'placeChip', chipId: 'c1', betId: 'red' }, { type: 'spin' }]));
    delete playing.state.spinsTonight;
    expect(deserializeRun(JSON.stringify(playing)).spinsTonight).toBe(7);
    const over = asVersion1(advance(createRun({ seed: 'TEST-SAVE' }), [{ type: 'choosePackage', packageId: 'sitout' }]));
    delete over.state.spinsTonight;
    expect(deserializeRun(JSON.stringify(over)).spinsTonight).toBe(null);
  });

  it('migrates a Phase 1 save: empty rail, offers rolled from its own cabinet stream', () => {
    const v1 = asVersion1(advance(createRun({ seed: 'TEST-SAVE' }), [{ type: 'choosePackage', packageId: 'long' }]));
    const a = deserializeRun(JSON.stringify(v1));
    const b = deserializeRun(JSON.stringify(v1));
    expect(a.version).toBe(7);
    expect(a.rail).toEqual([]);
    expect(a.railHooks).toBe(6);
    expect(a.cabinet.slots.slice(0, 3).every((s) => s.kind === 'talisman' && s.id)).toBe(true);
    // The oddity compartment opens at the next restock.
    expect(a.cabinet.slots[3]).toEqual({ kind: 'oddity', id: null, sold: true });
    expect(a.cabinet).toEqual(b.cabinet);
    expect(a.chips.every((c) => c.roundValue === 0)).toBe(true);
    expect(a.armed).toEqual({ rethrow: null });
    // It plays on: the next spin works.
    const next = act(advance(a, [{ type: 'placeChip', chipId: 'c1', betId: 'red' }]), { type: 'spin' });
    expect(next.events[0].type).toBe('spin');
  });

  it('migrates a Phase 2 save: debt 1 keeps its teaching Leans and its count of spins', () => {
    const played = advance(createRun({ seed: 'TEST-SAVE' }), [
      { type: 'choosePackage', packageId: 'long' },
      { type: 'placeChip', chipId: 'c1', betId: 'red' },
      { type: 'spin' },
      { type: 'spin' },
    ]);
    const v2 = asVersion2(played);
    const a = deserializeRun(JSON.stringify(v2));
    expect(a.version).toBe(7);
    expect(a.debtSpins).toBe(2);
    expect(a.leans.debt).toHaveLength(5);
    expect(a.leans.night).toBe(null);
    expect(a.missStreak).toBe(0);
    expect(a.devil).toEqual({ firedThisDebt: false, nightCurse: 0 });
    expect(a.stats).toMatchObject({ leans: 0, hops: 0, devils: 0, spins: 2 });
    expect(deserializeRun(JSON.stringify(v2))).toEqual(a);
    // The schedule is the one a new run of the seed draws; no other stream is touched.
    expect(a.leans.debt).toEqual(createRun({ seed: 'TEST-SAVE' }).leans.debt);
    for (const k of ['wheel', 'cabinet', 'devil', 'fortunes', 'misc']) expect(a.rng[k]).toEqual(v2.state.rng[k]);
    const later = asVersion2({ ...played, debt: 3 });
    expect(deserializeRun(JSON.stringify(later))).toMatchObject({ debtSpins: 0, leans: { debt: [], night: null } });
    const next = act(a, { type: 'spin' });
    expect(next.events[0].type).toBe('spin');
  });

  it('a Phase 1 save with a guessed night size keeps first-of-the-night luck off until the next night', () => {
    let s = advance(createRun({ seed: 'TEST-SAVE' }), [{ type: 'choosePackage', packageId: 'long' }, { type: 'placeChip', chipId: 'c1', betId: 'red' }]);
    for (let i = 0; i < 4; i++) s = advance(s, [{ type: 'spin' }]);
    const v1 = asVersion1(s);
    delete v1.state.spinsTonight;
    let loaded = deserializeRun(JSON.stringify(v1));
    expect(loaded.spinsTonight).toBe(3); // a guess: it was really a long night
    expect(loaded.spinsTonightGuessed).toBe(true);
    loaded = grantTalisman(loaded, 'pocket_watch');
    expect(nudgeFor({ ...loaded, leans: { debt: [], night: null } }).charms).toBe(0);
    let next = advance(loaded, [{ type: 'spin' }, { type: 'spin' }, { type: 'spin' }, { type: 'endNight' }, { type: 'choosePackage', packageId: 'long' }]);
    expect(next.spinsTonightGuessed).toBeUndefined();
    expect(nudgeFor({ ...next, leans: { debt: [], night: null } }).charms).toBe(3);
  });

  it('a cursed talisman the game no longer knows is dropped without a refund', () => {
    const s = grantTalisman(createRun({ seed: 'TEST-SAVE' }), 'bone_dice');
    const data = JSON.parse(serializeRun(s));
    data.state.rail[0].id = 'retired_curse';
    const back = deserializeRun(JSON.stringify(data));
    expect(back.rail).toEqual([]);
    expect(back.tokens).toBe(s.tokens);
  });

  it('refunds and drops talismans the game no longer knows', () => {
    const s = grantTalisman(createRun({ seed: 'TEST-SAVE' }), 'horseshoe');
    const data = JSON.parse(serializeRun(s));
    data.state.rail[0].id = 'retired_charm';
    const back = deserializeRun(JSON.stringify(data));
    expect(back.rail).toEqual([]);
    expect(back.tokens).toBe(s.tokens + 1);
  });
});

describe('malformed saves', () => {
  it('a save that parses but has the wrong shape starts over instead of throwing', async () => {
    const { deserializeRun } = await import('../../src/core/save.js');
    for (const bad of ['{"v":2,"state":{}}', '{"v":2,"state":{"rail":[]}}', '{"v":1,"state":{}}']) expect(deserializeRun(bad)).toBe(null);
    // A version 3 save missing what Phase 3 reads everywhere.
    for (const field of ['leans', 'devil', 'debtSpins', 'missStreak']) {
      const data = JSON.parse(serializeRun(createRun({ seed: 'BAD-SAVE' })));
      delete data.state[field];
      expect(deserializeRun(JSON.stringify(data)), field).toBe(null);
    }
  });
});
