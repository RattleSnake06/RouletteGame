import { describe, expect, it } from 'vitest';
import { act, createRun } from '../../src/core/run.js';
import { noHouseLuck } from './helpers.js';

// Recorded with the Phase 1 rules. With nothing on the rail and the House's
// luck (Leans and pity, Phase 3) switched off, later phases must land the same
// numbers and pay the same coins, spin for spin.
const GOLDEN = {
  'GOLD-0001': {
    nums: [12, 0, 23, 23, 22, 3, 0, 30, 1, 30, 24, 3, 18, 29, 22, 22, 35, 20, 23, 29, 3],
    totals: [2, 0, 5, 5, 3, 2, 0, 2, 2, 2, 3, 2, 5, 0, 3, 3, 0, 3, 5, 0, 2],
    coins: 1028,
  },
  'GOLD-0002': {
    nums: [26, 11, 18, 13, 4, 19, 24, 22, 4, 26, 11, 7, 30, 3, 31, 20, 14, 6, 30, 33, 12],
    totals: [0, 0, 5, 3, 0, 5, 3, 3, 0, 0, 0, 2, 2, 2, 0, 3, 5, 0, 2, 0, 2],
    coins: 1016,
  },
  'GOLD-0003': {
    nums: [18, 8, 14, 6, 0, 0, 8, 26, 3, 11, 11, 36, 28, 14, 0, 23, 26, 22, 28, 31, 9],
    totals: [5, 0, 5, 0, 0, 0, 0, 0, 2, 0, 0, 2, 0, 5, 0, 5, 0, 3, 0, 0, 2],
    coins: 1008,
  },
};

// Recorded with the Phase 3 rules: the same seeds and chips with debt 1's
// teaching Leans and pity in play. The draws match the runs above; only the
// Lean spins hop elsewhere (no run misses five times in a row, so no pity).
const GOLDEN_LUCK = {
  'GOLD-0001': {
    nums: [12, 0, 23, 23, 22, 3, 0, 30, 1, 23, 24, 3, 18, 29, 18, 22, 35, 20, 23, 29, 3],
    totals: [2, 0, 5, 5, 3, 2, 0, 2, 2, 5, 3, 2, 5, 0, 5, 3, 0, 3, 5, 0, 2],
    coins: 1033,
  },
  'GOLD-0002': {
    nums: [26, 13, 18, 13, 21, 19, 24, 22, 21, 26, 11, 7, 30, 3, 31, 20, 14, 6, 30, 16, 12],
    totals: [0, 3, 5, 3, 5, 5, 3, 3, 5, 0, 0, 2, 2, 2, 0, 3, 5, 0, 2, 5, 2],
    coins: 1034,
  },
  'GOLD-0003': {
    nums: [18, 23, 14, 6, 15, 0, 8, 26, 3, 11, 11, 36, 28, 14, 0, 23, 26, 22, 28, 14, 9],
    totals: [5, 5, 5, 0, 3, 0, 0, 0, 2, 0, 0, 2, 0, 5, 0, 5, 0, 3, 0, 5, 2],
    coins: 1021,
  },
};

function replay(seed, { houseLuck }) {
  let s = createRun({ seed });
  const step = (a) => {
    const r = act(s, a);
    const rejected = r.events.find((e) => e.type === 'rejected');
    if (rejected) throw new Error(`${a.type} rejected: ${rejected.reason}`);
    s = r.state;
  };
  step({ type: 'placeChip', chipId: 'c1', betId: 'red' });
  step({ type: 'placeChip', chipId: 'c2', betId: 'straight:17' });
  step({ type: 'placeChip', chipId: 'c3', betId: 'dozen:2' });
  s = { ...s, coins: 1000 };
  const nums = [];
  const totals = [];
  for (let n = 0; n < 3; n++) {
    step({ type: 'choosePackage', packageId: 'long' });
    while (s.phase === 'betting') {
      if (!houseLuck) s = noHouseLuck(s);
      step({ type: 'spin' });
      nums.push(s.lastSpin.number);
      totals.push(s.lastSpin.total);
    }
    step({ type: 'endNight' });
  }
  return { nums, totals, coins: s.coins };
}

describe('golden runs', () => {
  for (const [seed, want] of Object.entries(GOLDEN)) {
    it(`replays ${seed} exactly with an empty rail and no House luck`, () => {
      expect(replay(seed, { houseLuck: false })).toEqual(want);
    });
  }
  for (const [seed, want] of Object.entries(GOLDEN_LUCK)) {
    it(`replays ${seed} exactly with the House's Leans and pity`, () => {
      expect(replay(seed, { houseLuck: true })).toEqual(want);
    });
  }
});
