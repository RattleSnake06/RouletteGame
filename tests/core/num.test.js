import { describe, expect, it } from 'vitest';
import { add, deserialize, floor, format, gte, isBig, lt, mul, num, ratio, serialize, sub } from '../../src/core/num.js';

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
