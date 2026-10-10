import { describe, expect, it } from 'vitest';
import { num } from '../../src/core/num.js';
import { act, createRun, grantTalisman } from '../../src/core/run.js';
import { deserializeRun, serializeRun } from '../../src/core/save.js';

/** A save as Phase 1 wrote it: version 1, none of the Phase 2 fields. */
function asVersion1(state) {
  const data = JSON.parse(serializeRun(state));
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
    expect(a.version).toBe(2);
    expect(a.rail).toEqual([]);
    expect(a.railHooks).toBe(6);
    expect(a.cabinet.slots.slice(0, 3).every((s) => s.kind === 'talisman' && s.id)).toBe(true);
    expect(a.cabinet.slots[3]).toMatchObject({ kind: 'oddity', shut: true });
    expect(a.cabinet).toEqual(b.cabinet);
    expect(a.chips.every((c) => c.roundValue === 0)).toBe(true);
    expect(a.armed).toEqual({ rethrow: null });
    // It plays on: the next spin works.
    const next = act(advance(a, [{ type: 'placeChip', chipId: 'c1', betId: 'red' }]), { type: 'spin' });
    expect(next.events[0].type).toBe('spin');
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
  });
});
