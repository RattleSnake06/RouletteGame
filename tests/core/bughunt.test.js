import { describe, expect, it } from 'vitest';
import { PACKAGES } from '../../src/core/economy.js';
import { act, createRun } from '../../src/core/run.js';

// Regressions for what the fuzz and monkey bots found (sim/fuzz.js,
// tests/smoke/monkey.mjs, tests/smoke/marathon.mjs).

const betting = (wheel) => act(createRun({ seed: 'BUGHUNT', wheel }), { type: 'choosePackage', packageId: Object.keys(PACKAGES)[1] }).state;

describe('bets on the 00', () => {
  it('are refused on a wheel without one', () => {
    const s = betting('european');
    for (const betId of ['straight:37', 'split:0-37', 'split:2-37', 'split:3-37']) {
      expect(act(s, { type: 'placeChip', chipId: 'c1', betId }).events[0].type).toBe('rejected');
    }
  });

  it('are taken on the American wheel', () => {
    const s = betting('american');
    expect(act(s, { type: 'placeChip', chipId: 'c1', betId: 'straight:37' }).state.placements.c1).toBe('straight:37');
  });
});
