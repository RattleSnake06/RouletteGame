import { describe, expect, it } from 'vitest';
import { rollTalismanSlots } from '../../src/core/cabinet.js';
import { TALISMANS, getTalisman } from '../../src/core/content/index.js';
import { restockCost, sellValueOf } from '../../src/core/economy.js';
import { Rng, hashSeed } from '../../src/core/rng.js';
import { act, createRun, grantTalisman } from '../../src/core/run.js';
import { cabinetView, rarityOdds } from '../../src/core/selectors.js';
import { play } from './helpers.js';

const offered = (s) => s.cabinet.slots.filter((x) => x.kind === 'talisman' && x.id).map((x) => x.id);
const firstAffordable = (s) => s.cabinet.slots.findIndex((x) => x.id && getTalisman(x.id).rarity === 'common');

describe('Curio Cabinet', () => {
  it('stocks three talismans and a shuttered oddity compartment from the start', () => {
    const s = createRun({ seed: 'CAB-1' });
    expect(offered(s)).toHaveLength(3);
    expect(s.cabinet.slots[3]).toEqual({ kind: 'oddity', id: null, shut: true });
    expect(createRun({ seed: 'CAB-1' }).cabinet).toEqual(s.cabinet);
  });

  it('never offers what is on the rail, nor the same talisman twice', () => {
    let s = createRun({ seed: 'CAB-2' });
    for (const id of ['red_ribbon', 'horseshoe', 'ledger', 'house_key']) s = grantTalisman(s, id);
    s = { ...s, coins: 1e6 };
    for (let i = 0; i < 300; i++) {
      // Paid restocks get dearer each time; keep the price flat for the test.
      s = play({ ...s, cabinet: { ...s.cabinet, paidRestocks: 0 } }, { type: 'restock' }).state;
      const ids = offered(s);
      expect(new Set(ids).size).toBe(ids.length);
      for (const t of s.rail) expect(ids).not.toContain(t.id);
    }
  });

  it('rolls rarities in proportion to their weights (first compartment)', () => {
    const odds = rarityOdds();
    expect(odds.common).toBeCloseTo(6 / 11.8, 6);
    expect(odds.legendary).toBeCloseTo(0.6 / 11.8, 6);
    const rng = new Rng(hashSeed('rarity'));
    const counts = { common: 0, uncommon: 0, rare: 0, legendary: 0 };
    const N = 100000;
    for (let i = 0; i < N; i++) counts[getTalisman(rollTalismanSlots([], rng)[0].id).rarity] += 1;
    for (const r of Object.keys(counts)) expect(Math.abs(counts[r] / N - odds[r]), r).toBeLessThan(0.01);
  });

  it('prices paid restocks from the debt base, +20% each, rounded up, reset every debt', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((k) => restockCost(1, k))).toEqual([2, 3, 4, 5, 6, 8, 10]);
    expect([0, 1, 2, 3].map((k) => restockCost(3, k))).toEqual([15, 18, 22, 27]);
    let s = { ...createRun({ seed: 'CAB-3' }), coins: 100 };
    s = play(s, { type: 'restock' }, { type: 'restock' }).state;
    expect(s.coins).toBe(95);
    expect(cabinetView(s).restockCost).toBe(4);
    // Free restocks (each new night) do not count; a new debt starts over.
    s = play(s, { type: 'choosePackage', packageId: 'sitout' }, { type: 'endNight' }).state;
    expect(s.cabinet.paidRestocks).toBe(2);
    s = { ...s, round: 3, phase: 'nightOver', deposited: 1000 };
    s = play(s, { type: 'endNight' }).state;
    expect(s.cabinet.paidRestocks).toBe(0);
    expect(cabinetView(s).restockCost).toBe(5);
  });

  it('restocking never changes the spins', () => {
    const run = (restocks) => {
      let s = { ...createRun({ seed: 'CAB-4' }), coins: 1000 };
      s = play(s, { type: 'placeChip', chipId: 'c1', betId: 'red' }, { type: 'choosePackage', packageId: 'long' }).state;
      const nums = [];
      while (s.phase === 'betting') {
        for (let i = 0; i < restocks; i++) s = play(s, { type: 'restock' }).state;
        s = play(s, { type: 'spin' }).state;
        nums.push(s.lastSpin.number);
      }
      return nums;
    };
    expect(run(2)).toEqual(run(0));
  });

  it('buys a talisman: tokens down, hung at the right end, compartment sold', () => {
    const s = createRun({ seed: 'CAB-5' });
    const slot = firstAffordable(s);
    expect(slot).toBeGreaterThanOrEqual(0);
    const id = s.cabinet.slots[slot].id;
    const { state, events } = play(s, { type: 'buy', slot });
    expect(state.tokens).toBe(s.tokens - 3);
    expect(state.rail.map((t) => t.id)).toEqual([id]);
    expect(state.rail[0].price).toBe(3);
    expect(state.cabinet.slots[slot]).toEqual({ kind: 'talisman', id: null, sold: true });
    expect(events[0]).toMatchObject({ type: 'bought', slot, id, price: 3 });
    expect(act(state, { type: 'buy', slot }).events[0]).toMatchObject({ type: 'rejected', code: 'soldOut' });
  });

  it('refuses a purchase without the tokens or a free hook', () => {
    const s = { ...createRun({ seed: 'CAB-6' }), tokens: 0 };
    const slot = s.cabinet.slots.findIndex((x) => x.id);
    expect(act(s, { type: 'buy', slot }).events[0]).toMatchObject({ type: 'rejected', code: 'noTokens' });
    let full = { ...createRun({ seed: 'CAB-6' }), tokens: 99 };
    const fillers = TALISMANS.map((d) => d.id).filter((id) => !offered(full).includes(id)).slice(0, 6);
    for (const id of fillers) full = grantTalisman(full, id);
    expect(act(full, { type: 'buy', slot }).events[0]).toMatchObject({ type: 'rejected', code: 'railFull' });
    // Selling one in the same step makes room.
    const { state } = play(full, { type: 'buy', slot, sellUid: full.rail[0].uid });
    expect(state.rail).toHaveLength(6);
    expect(state.rail.map((t) => t.uid)).not.toContain(full.rail[0].uid);
  });

  it('a trade-in can be paid for with the refund', () => {
    let s = { ...createRun({ seed: 'CAB-7' }), tokens: 0 };
    s = grantTalisman(s, 'house_key'); // sells for 4
    const slot = firstAffordable(s);
    const { state } = play(s, { type: 'buy', slot, sellUid: s.rail[0].uid });
    expect(state.tokens).toBe(1);
  });

  it('sells for half the rarity price, rounded down, and the talisman can come back', () => {
    expect([3, 4, 6, 9].map(sellValueOf)).toEqual([1, 2, 3, 4]);
    let s = grantTalisman(createRun({ seed: 'CAB-8' }), 'piggy_bank');
    const { state, events } = play(s, { type: 'sell', uid: s.rail[0].uid });
    expect(state.tokens).toBe(s.tokens + 3);
    expect(events).toEqual([{ type: 'sold', uid: s.rail[0].uid, id: 'piggy_bank', refund: 3 }]);
    s = { ...state, coins: 1e6 };
    let seen = false;
    for (let i = 0; i < 200 && !seen; i++) {
      s = play({ ...s, cabinet: { ...s.cabinet, paidRestocks: 0 } }, { type: 'restock' }).state;
      seen = offered(s).includes('piggy_bank');
    }
    expect(seen).toBe(true);
  });

  it('reorders the rail; order is kept exactly', () => {
    let s = createRun({ seed: 'CAB-9' });
    for (const id of ['red_ribbon', 'horseshoe', 'ledger']) s = grantTalisman(s, id);
    const [a, b, c] = s.rail.map((t) => t.uid);
    const { state, events } = play(s, { type: 'moveTalisman', uid: c, to: 0 });
    expect(state.rail.map((t) => t.uid)).toEqual([c, a, b]);
    expect(events[0]).toMatchObject({ type: 'talismanMoved', from: 2, to: 0, order: [c, a, b] });
    expect(act(state, { type: 'moveTalisman', uid: c, to: 0 }).events).toEqual([]);
  });
});

describe('grantTalisman', () => {
  it('keeps the rules: a free hook, and the Cabinet stops offering it', () => {
    let s = createRun({ seed: 'GR' });
    const slot = s.cabinet.slots.findIndex((x) => x.id);
    const id = s.cabinet.slots[slot].id;
    s = grantTalisman(s, id);
    expect(s.cabinet.slots[slot]).toEqual({ kind: 'talisman', id: null, sold: true });
    const ids = TALISMANS.map((d) => d.id).filter((x) => x !== id).slice(0, 5);
    for (const x of ids) s = grantTalisman(s, x);
    expect(() => grantTalisman(s, TALISMANS.find((d) => !s.rail.some((t) => t.id === d.id)).id)).toThrow(/free hook/);
  });
});
