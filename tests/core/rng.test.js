import { describe, expect, it } from 'vitest';
import { Rng, STREAMS, hashSeed, randomSeed, seedStreams } from '../../src/core/rng.js';

describe('seeded randomness', () => {
  it('repeats exactly for the same seed', () => {
    const a = new Rng(hashSeed('ABCD-EFGH'));
    const b = new Rng(hashSeed('ABCD-EFGH'));
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('gives each stream of a run its own sequence', () => {
    const streams = seedStreams('ABCD-EFGH');
    expect(Object.keys(streams)).toEqual(STREAMS);
    const firsts = STREAMS.map((name) => new Rng(streams[name]).next());
    expect(new Set(firsts).size).toBe(STREAMS.length);
  });

  it('continues identically from a saved state', () => {
    const a = new Rng(hashSeed('x'));
    for (let i = 0; i < 10; i++) a.next();
    const b = new Rng(a.state());
    for (let i = 0; i < 50; i++) expect(b.nextUint()).toBe(a.nextUint());
  });

  it('draws integers evenly across their range', () => {
    const r = new Rng(hashSeed('uniform'));
    const counts = new Array(37).fill(0);
    const N = 370000;
    for (let i = 0; i < N; i++) counts[r.int(37)] += 1;
    for (const c of counts) expect(Math.abs(c - N / 37)).toBeLessThan(N / 37 * 0.05);
  });

  it('makes readable seeds', () => {
    expect(randomSeed()).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });
});
