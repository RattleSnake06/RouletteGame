import { describe, expect, it } from 'vitest';
import { deserializeProfile, markTaught, newProfile, serializeProfile } from '../../src/core/meta.js';

// Phase 8 (design doc 8.4): the first-time tips are kept in the profile, so
// each shows once.

describe('first-time tips', () => {
  it('a profile starts with none shown, and marks each once', () => {
    const p = newProfile();
    expect(p.taught).toEqual([]);
    const q = markTaught(p, 'lean');
    expect(q.taught).toEqual(['lean']);
    expect(markTaught(q, 'lean')).toBe(q);
  });

  it('survive a save; an older profile without them reads as none shown', () => {
    const p = markTaught(markTaught(newProfile(), 'lean'), 'bank');
    expect(deserializeProfile(serializeProfile(p)).taught).toEqual(['lean', 'bank']);
    const old = JSON.parse(serializeProfile(newProfile()));
    delete old.taught;
    expect(deserializeProfile(JSON.stringify(old)).taught).toEqual([]);
  });
});
