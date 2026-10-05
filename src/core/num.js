import Decimal from 'break_infinity.js';

// Money in this game starts small and ends absurd (debts pass 1e300 in endless
// play). break_infinity's Decimal handles the absurd end, but its mantissa
// arithmetic is slightly inexact even for small integers (1.3e6 × 72 gives
// 93600000.00000001), which would make "deposited ≥ owed" unreliable.
//
// So a value is a plain JS number while it is below LIMIT, where integer
// arithmetic is exact, and becomes a Decimal above it. All money is integral;
// operations that can produce fractions are floored by the caller.

const LIMIT = 1e15;

const isDec = (x) => x instanceof Decimal;

/** True for values that have outgrown plain numbers. */
export const isBig = isDec;
const toDec = (x) => (isDec(x) ? x : new Decimal(x));

function norm(x) {
  if (isDec(x)) return x.abs().lt(LIMIT) ? Math.round(x.toNumber()) : x;
  if (Math.abs(x) >= LIMIT || !Number.isFinite(x)) return new Decimal(x);
  return x;
}

/** Normalise a number, numeric string or Decimal into the game's money type. */
export function num(x) {
  if (typeof x === 'string') return norm(new Decimal(x));
  return norm(x);
}

export function add(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return norm(a + b);
  return norm(toDec(a).add(toDec(b)));
}

export function sub(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return norm(a - b);
  return norm(toDec(a).sub(toDec(b)));
}

export function mul(a, b) {
  if (typeof a === 'number' && typeof b === 'number') {
    const r = a * b;
    if (Math.abs(r) < LIMIT) return r;
  }
  return norm(toDec(a).mul(toDec(b)));
}

export function pow(base, exponent) {
  const r = base ** exponent;
  if (Math.abs(r) < LIMIT) return r;
  return norm(Decimal.pow(base, exponent));
}

/** Floor to a whole coin. The epsilon absorbs float noise such as 60 × 0.05. */
export function floor(a) {
  if (typeof a === 'number') return Math.floor(a + 1e-9);
  return norm(a.floor());
}

export function cmp(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
  return toDec(a).cmp(toDec(b));
}

export const gte = (a, b) => cmp(a, b) >= 0;
export const gt = (a, b) => cmp(a, b) > 0;
export const lt = (a, b) => cmp(a, b) < 0;
export const lte = (a, b) => cmp(a, b) <= 0;
export const eq = (a, b) => cmp(a, b) === 0;
export const max = (a, b) => (cmp(a, b) >= 0 ? a : b);
export const min = (a, b) => (cmp(a, b) <= 0 ? a : b);
export const isZero = (a) => cmp(a, 0) === 0;

/** Approximate JS number (Infinity past ~1e308). For animation, not rules. */
export function toNumber(a) {
  return typeof a === 'number' ? a : a.toNumber();
}

/** a / b as a plain number, e.g. how much of a debt is banked. For display, not rules. */
export function ratio(a, b) {
  if (isZero(b)) return 0;
  if (typeof a === 'number' && typeof b === 'number') return a / b;
  return toDec(a).div(toDec(b)).toNumber();
}

const SUFFIXES = ['', 'K', 'M', 'B', 'T'];

/**
 * 1,234 → 12.3K → 4.56M → 7.89e45.
 * Below 10,000 the full number is shown; up to 1e15 a suffix; then e-notation.
 */
export function format(a, { scientific = false } = {}) {
  if (typeof a === 'number' && !scientific) {
    const abs = Math.abs(a);
    if (abs < 10000) return Math.trunc(a).toLocaleString('en-US');
    const tier = Math.min(SUFFIXES.length - 1, Math.floor(Math.log10(abs) / 3));
    const scaled = a / 10 ** (tier * 3);
    const digits = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
    return `${trimFixed(scaled, digits)}${SUFFIXES[tier]}`;
  }
  const d = toDec(a);
  if (d.abs().lt(10000)) return Math.trunc(d.toNumber()).toLocaleString('en-US');
  return `${trimFixed(d.mantissa, 2)}e${d.exponent}`;
}

function trimFixed(x, digits) {
  // Truncate rather than round, so 9,999,999 reads 9.99M and never "10.0M".
  // The epsilon keeps float noise (4.56 × 100 = 455.999…) from losing a digit.
  const f = 10 ** digits;
  return (Math.trunc(x * f + Math.sign(x) * 1e-7) / f).toFixed(digits);
}

/** JSON-safe form: numbers stay numbers, Decimals become { $d: "1.2e500" }. */
export function serialize(a) {
  return typeof a === 'number' ? a : { $d: a.toString() };
}

export function deserialize(v) {
  if (typeof v === 'number') return v;
  if (v && typeof v.$d === 'string') return num(v.$d);
  throw new Error(`Not a money value: ${JSON.stringify(v)}`);
}
