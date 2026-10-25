import { describe, expect, it } from 'vitest';
import { deserializeProfile, markVaultSeen, newProfile, serializeProfile, vaultView } from '../../src/core/meta.js';

// The Vault screen (doc 7.1, decision 36): four compartments, each opened by
// its lock, holding what that lock opened.

describe('the Vault screen', () => {
  it('starts with four shut compartments and names the debt each needs', () => {
    const v = vaultView(newProfile());
    expect(v.locks.map((l) => [l.lock, l.open, l.fresh, l.debt])).toEqual([
      [1, false, false, 4],
      [2, false, false, 5],
      [3, false, false, 6],
      [4, false, false, 7],
    ]);
    expect(v.goal).toBe(4);
    expect(v.vaultDebt).toBe(8);
    expect(v.vault).toBe(false);
  });

  it('holds what each lock opens: its wheel first, then its talismans, cards and records', () => {
    const v = vaultView(newProfile());
    const names = v.locks.map((l) => l.contents.map((c) => c.name));
    expect(names[0]).toEqual(['The American wheel', 'Snakeskin', 'Croupier’s Glove', 'Racing Form', 'The Tote Board', 'Neighbours talk.', 'Habanera']);
    expect(names[1]).toEqual(['The Golden wheel', 'A second gramophone slot', 'The Carillon', 'Two-Step']);
    expect(names[2]).toEqual(['The Bone wheel', 'Patience Jar', 'Break the wheel.']);
    expect(names[3]).toEqual(['The Mirror wheel', 'Grandfather Clock', 'The ball has a twin.']);
    for (const l of v.locks) for (const c of l.contents) expect(c.text, c.name).toBeTruthy();
    expect(v.locks[2].contents.find((c) => c.kind === 'fortune').black).toBe(true);
  });

  it('opens a compartment with its lock, fresh until the player has watched it open', () => {
    const p = { ...newProfile(), locks: 2 };
    expect(vaultView(p).locks.map((l) => [l.open, l.fresh])).toEqual([[true, true], [true, true], [false, false], [false, false]]);
    const seen = markVaultSeen(p);
    expect(seen.vaultSeen).toBe(2);
    expect(vaultView(seen).locks.map((l) => l.fresh)).toEqual([false, false, false, false]);
    expect(markVaultSeen(seen)).toBe(seen);
    // The third lock opens later: only it is fresh.
    expect(vaultView({ ...seen, locks: 3 }).locks.map((l) => l.fresh)).toEqual([false, false, true, false]);
  });

  it('keeps what was watched through a save, never past the open locks', () => {
    const p = markVaultSeen({ ...newProfile(), locks: 3, vault: false });
    expect(deserializeProfile(serializeProfile(p)).vaultSeen).toBe(3);
    expect(deserializeProfile(JSON.stringify({ ...p, vaultSeen: 9 })).vaultSeen).toBe(3);
    expect(deserializeProfile(JSON.stringify({ ...p, vaultSeen: 'x' })).vaultSeen).toBe(0);
    // A profile from before the screen: every open compartment swings open once.
    const { vaultSeen, ...old } = p;
    expect(vaultView(deserializeProfile(JSON.stringify(old))).locks.filter((l) => l.fresh)).toHaveLength(3);
  });
});
