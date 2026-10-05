import { describe, expect, it } from 'vitest';
import { num } from '../../src/core/num.js';
import { act, createRun } from '../../src/core/run.js';
import { deserializeRun, serializeRun } from '../../src/core/save.js';

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
    const playing = advance(createRun({ seed: 'TEST-SAVE' }), [{ type: 'choosePackage', packageId: 'long' }, { type: 'placeChip', chipId: 'c1', betId: 'red' }, { type: 'spin' }]);
    const old = JSON.parse(serializeRun(playing));
    delete old.state.spinsTonight;
    expect(deserializeRun(JSON.stringify(old)).spinsTonight).toBe(7);
    const over = JSON.parse(serializeRun(advance(createRun({ seed: 'TEST-SAVE' }), [{ type: 'choosePackage', packageId: 'sitout' }])));
    delete over.state.spinsTonight;
    expect(deserializeRun(JSON.stringify(over)).spinsTonight).toBe(null);
  });
});
