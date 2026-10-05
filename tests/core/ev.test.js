import { describe, expect, it } from 'vitest';
import { BETS, betCovers, betOdds } from '../../src/core/bets.js';
import { resolveSpin } from '../../src/core/resolve.js';
import { Rng, hashSeed } from '../../src/core/rng.js';
import { createEuropeanWheel, pocketChance } from '../../src/core/wheel.js';

const wheel = createEuropeanWheel();

describe('expected value', () => {
  it('is exactly 36/37 per unit of chip value for every base bet', () => {
    for (const bet of BETS) {
      let ev = 0;
      wheel.pockets.forEach((p, i) => {
        if (betCovers(bet, p)) ev += pocketChance(wheel, i) * betOdds(bet);
      });
      expect(ev, bet.id).toBeCloseTo(36 / 37, 12);
    }
  });

  it('matches 36/37 over many simulated spins', () => {
    const chips = [
      { id: 'red', value: 1 },
      { id: 'straight', value: 1 },
      { id: 'dozen', value: 1 },
    ];
    const placements = { red: 'red', straight: 'straight:17', dozen: 'dozen:3' };
    const rng = new Rng(hashSeed('ev-test'));
    const totals = { red: 0, straight: 0, dozen: 0 };
    const N = 200000;
    for (let i = 0; i < N; i++) {
      for (const w of resolveSpin({ wheel, chips, placements }, rng).wins) totals[w.chipId] += w.amount;
    }
    expect(totals.red / N).toBeCloseTo(36 / 37, 1);
    expect(Math.abs(totals.red / N - 36 / 37)).toBeLessThan(0.01);
    expect(Math.abs(totals.dozen / N - 36 / 37)).toBeLessThan(0.02);
    expect(Math.abs(totals.straight / N - 36 / 37)).toBeLessThan(0.06);
  });
});
