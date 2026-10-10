import { describe, expect, it } from 'vitest';
import { act, createRun } from '../../src/core/run.js';

// Recorded with the Phase 1 rules. With nothing on the rail, later phases must
// land the same numbers and pay the same coins, spin for spin.
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

describe('golden runs', () => {
  for (const [seed, want] of Object.entries(GOLDEN)) {
    it(`replays ${seed} exactly with an empty rail`, () => {
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
          step({ type: 'spin' });
          nums.push(s.lastSpin.number);
          totals.push(s.lastSpin.total);
        }
        step({ type: 'endNight' });
      }
      expect(nums).toEqual(want.nums);
      expect(totals).toEqual(want.totals);
      expect(s.coins).toBe(want.coins);
    });
  }
});
