// Seeded randomness. Every run has one seed; each kind of randomness draws
// from its own stream derived from it, so (for example) restocking the
// Cabinet can never change the next spin. Stream states are plain arrays so
// they save and load with the run.

export const STREAMS = ['wheel', 'devil', 'lean', 'cabinet', 'fortunes', 'misc'];

/** cyrb128: hashes a string into four 32-bit words. */
export function hashSeed(str) {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** sfc32 generator with explicit, serialisable state. */
export class Rng {
  constructor(state) {
    [this.a, this.b, this.c, this.d] = state;
  }

  nextUint() {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Float in [0, 1). */
  next() {
    return this.nextUint() / 4294967296;
  }

  /** Integer in [0, n). */
  int(n) {
    return Math.floor(this.next() * n);
  }

  chance(p) {
    return this.next() < p;
  }

  state() {
    return [this.a >>> 0, this.b >>> 0, this.c >>> 0, this.d >>> 0];
  }
}

/** Initial state for every stream of a run. */
export function seedStreams(seed) {
  const out = {};
  for (const name of STREAMS) {
    const r = new Rng(hashSeed(`${seed}/${name}`));
    // sfc32 needs a few rounds to mix a fresh state.
    for (let i = 0; i < 12; i++) r.nextUint();
    out[name] = r.state();
  }
  return out;
}

const SEED_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I

/** A shareable seed like "K7QX-M4PZ". `rand` must return floats in [0, 1). */
export function randomSeed(rand = Math.random) {
  let s = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) s += '-';
    s += SEED_ALPHABET[Math.floor(rand() * SEED_ALPHABET.length)];
  }
  return s;
}
