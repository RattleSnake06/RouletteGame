import { describe, expect, it } from 'vitest';
import { owedFor, packageCost, spinCostFor } from '../../src/core/economy.js';
import { isBig } from '../../src/core/num.js';

describe('economy', () => {
  it('uses the debt table (debt 3 stays 666; debts 2 and 5-9 tuned in Phase 7)', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(owedFor)).toEqual([
      60, 370, 666, 2664, 8000, 18000, 40000, 95000, 250000,
    ]);
  });

  it('grows debts by ×6, ×12, ×24… from debt 10', () => {
    expect(owedFor(10)).toBe(1500000);
    expect(owedFor(11)).toBe(1500000 * 12);
    expect(owedFor(12)).toBe(1500000 * 12 * 24);
    const late = owedFor(120);
    expect(isBig(late)).toBe(true);
    expect(late.exponent).toBeGreaterThan(1000);
  });

  it('prices spins by Fibonacci', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(spinCostFor)).toEqual([1, 2, 3, 5, 8, 13, 21, 34, 55, 89]);
  });

  it('prices nights by their spins', () => {
    expect(packageCost(1, 'long')).toBe(7);
    expect(packageCost(3, 'short')).toBe(9);
    expect(packageCost(5, 'sitout')).toBe(0);
  });
});
