import { describe, expect, it } from 'vitest';
import { add, decimalText, deserialize, floor, format, gte, isBig, lt, mul, num, ratio, serialize, sub } from '../../src/core/num.js';

describe('money values', () => {
  it('stays exact in the everyday range', () => {
    expect(mul(1300000, 72)).toBe(93600000);
    expect(add(59, 1)).toBe(60);
    expect(gte(60, 60)).toBe(true);
    expect(floor(mul(60, 0.05))).toBe(3);
    expect(floor(mul(20, 0.05))).toBe(1);
  });

  it('switches to big numbers past 1e15 and back', () => {
    const big = mul(1e14, 100);
    expect(isBig(big)).toBe(true);
    expect(lt(1e14, big)).toBe(true);
    const back = sub(big, mul(1e14, 99));
    expect(back).toBe(1e14);
    const huge = mul(num('1e500'), 3);
    expect(huge.exponent).toBe(500);
  });

  it('formats like the HUD expects', () => {
    expect(format(0)).toBe('0');
    expect(format(1234)).toBe('1,234');
    expect(format(12345)).toBe('12.3K');
    expect(format(4560000)).toBe('4.56M');
    expect(format(9999999)).toBe('9.99M');
    expect(format(2.5e12)).toBe('2.50T');
    expect(format(num('7.89e45'))).toBe('7.89e45');
  });

  it('never rounds a subtraction above what it started from', () => {
    // break_infinity keeps about 15 digits: 25981192920453587000 − 4270
    // rounded up to 25981192920453600000, and banking "all but a night's
    // cost" was refused for want of coins.
    const coins = num('25981192920453587000');
    const left = sub(coins, 4270);
    expect(gte(coins, left)).toBe(true);
    expect(gte(sub(coins, left), 0)).toBe(true);
    expect(gte(add(coins, 4270), coins)).toBe(true);
  });

  it('round-trips through JSON', () => {
    expect(deserialize(serialize(42))).toBe(42);
    const big = num('1.5e300');
    const back = deserialize(JSON.parse(JSON.stringify(serialize(big))));
    expect(back.exponent).toBe(300);
    expect(back.mantissa).toBeCloseTo(1.5, 10);
  });

  it('gives display ratios for plain and big values', () => {
    expect(ratio(64, 180)).toBeCloseTo(0.3556, 4);
    expect(ratio(5, 0)).toBe(0);
    expect(ratio(num('3e500'), num('6e500'))).toBeCloseTo(0.5, 10);
    expect(ratio(10, num('1e400'))).toBe(0);
  });
});

describe('just under a power of ten', () => {
  it('formats with three digits at most, never carrying up', () => {
    expect(format(9999999999)).toBe('9.99B');
    expect(format(99999999999)).toBe('99.9B');
    expect(format(999999999999)).toBe('999B');
    expect(format(999999999999999)).toBe('999T');
    expect(format(num('9.99999999999999e15'))).toBe('9.99e15');
    expect(format(num('9.99999999999999e40'))).toBe('9.99e40');
    expect(format(9999999999, { scientific: true })).toBe('9.99e9');
    // Float noise still keeps its digit.
    expect(format(4560000)).toBe('4.56M');
    expect(format(num('4.56e20'))).toBe('4.56e20');
  });

  it('keeps a big value’s mantissa in [1, 10), so a save reloads the same', () => {
    const r = add(num('9.99999999999999e23'), 1e8);
    expect(r.mantissa).toBeGreaterThanOrEqual(1);
    expect(r.mantissa).toBeLessThan(10);
    expect(decimalText(num(decimalText(r)))).toBe(decimalText(r));
  });
});
