import { describe, expect, it } from 'vitest';
import { owedFor, packageCost, spinCostFor } from '../../src/core/economy.js';
import { isBig } from '../../src/core/num.js';

describe('economy', () => {
  it('uses the drafted debt table', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(owedFor)).toEqual([
      60, 180, 666, 2500, 12000, 36000, 120000, 370000, 1300000,
    ]);
  });

  it('grows debts by ×6, ×12, ×24… from debt 10', () => {
    expect(owedFor(10)).toBe(7800000);
    expect(owedFor(11)).toBe(7800000 * 12);
    expect(owedFor(12)).toBe(7800000 * 12 * 24);
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
