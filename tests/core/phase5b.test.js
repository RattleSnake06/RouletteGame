import { describe, expect, it } from 'vitest';
import { FORTUNES, RECORDS } from '../../src/core/content/index.js';
import { rollOdditySlot } from '../../src/core/cabinet.js';
import { ECONOMY } from '../../src/core/economy.js';
import { evaluate } from '../../src/core/payout.js';
import { Rng, hashSeed } from '../../src/core/rng.js';
import { act } from '../../src/core/run.js';
import { deserializeRun, serializeRun } from '../../src/core/save.js';
import { cabinetView, levelsView, previewBet } from '../../src/core/selectors.js';
import { play, setup } from './helpers.js';

// Phase 5, second half (design doc 5.3, 5.11, 6.2, 6.7): bet levels, chips
// and records from the Cabinet's fourth compartment, and the two bet-level
// cards. The two chip cards were left out (decision 28).

const at = (s, n) => s.wheel.pockets.findIndex((p) => p.number === n);
const paysOn = (s, n) => evaluate(s, [{ ball: 0, pocketIndex: at(s, n) }]).lines.map((l) => l.amount);
const offering = (s, id, extra = {}) => ({ ...s, coins: 1000, cabinet: { ...s.cabinet, slots: [...s.cabinet.slots.slice(0, 3), { kind: 'oddity', id, sold: false, ...extra }] } });
const dealt = (state, id) => ({ ...state, oracle: { debt: state.debt, kind: FORTUNES.find((f) => f.id === id).kind, cards: [id], rerolls: 0, taken: null } });
const take = (state, id) => play(dealt(state, id), { type: 'takeFortune', index: 0 });

describe('bet levels', () => {
  it('each level adds a quarter of the base odds: a straight-up 36, 45, 54', () => {
    let s = setup({ chips: { c1: 'straight:17', c2: 'red' } });
    expect(paysOn(s, 17)).toEqual([36]);
    s = { ...s, levels: { straight: 2 } };
    expect(paysOn(s, 17)).toEqual([45]);
    s = { ...s, levels: { straight: 3, red: 3 } };
    expect(paysOn(s, 17)).toEqual([54]);
    // Red at level 3 pays 3 for a chip of value 1 (2 × 1.5).
    expect(paysOn(s, 32)).toEqual([3]);
    expect(previewBet(s, 'straight:5').odds).toBe(54);
    expect(levelsView(s).find((k) => k.kind === 'straight')).toMatchObject({ base: 36, level: 3, odds: 54 });
  });

  it('the Brass Odds Plate raises the kind of bet tapped', () => {
    const s = offering(setup(), 'odds_plate');
    expect(act(s, { type: 'buyOddity', slot: 3, targets: ['nonsense'] }).events[0]).toMatchObject({ code: 'badTarget' });
    const r = play(s, { type: 'buyOddity', slot: 3, targets: ['dozen'] });
    expect(r.state.levels).toEqual({ dozen: 2 });
    expect(r.events.find((e) => e.type === 'betLevel')).toMatchObject({ kind: 'dozen', level: 2, odds: 3.75 });
    expect(r.state.coins).toBe(1000 - 80);
  });
});

describe('chips and records from the Cabinet', () => {
  it('a chip oddity puts a chip of its material in your hands, six at most', () => {
    let s = offering(setup(), 'glass_chip');
    const r = play(s, { type: 'buyOddity', slot: 3, targets: [] });
    expect(r.state.chips.at(-1)).toEqual({ id: 'c4', value: 1, material: 'glass', roundValue: 0 });
    expect(r.events.map((e) => e.type)).toEqual(['oddityBought', 'chipGained']);
    expect(r.state.nextChipId).toBe(5);
    s = { ...offering(setup(), 'clay_chip'), chips: Array.from({ length: ECONOMY.maxChips }, (_, i) => ({ id: `c${i + 1}`, value: 1, material: 'normal', roundValue: 0 })) };
    expect(act(s, { type: 'buyOddity', slot: 3, targets: [] }).events[0]).toMatchObject({ code: 'full' });
    expect(cabinetView(s).slots[3]).toMatchObject({ chip: 'clay', workable: false });
  });

  it('a record oddity holds one record not yet owned; it plays if nothing does', () => {
    const s = offering(setup(), 'record_sleeve', { record: 'nocturne' });
    expect(cabinetView(s).slots[3].record).toMatchObject({ id: 'nocturne' });
    const r = play(s, { type: 'buyOddity', slot: 3, targets: [] });
    expect(r.state.records).toEqual(['nocturne']);
    expect(r.state.playing).toBe('nocturne');
    expect(act({ ...s, records: ['nocturne'] }, { type: 'buyOddity', slot: 3, targets: [] }).events[0]).toMatchObject({ code: 'owned' });
  });

  it('the compartment offers no chip to a full hand and no record when every record is owned', () => {
    const rng = new Rng(hashSeed('full-hand'));
    for (let i = 0; i < 3000; i++) {
      const o = rollOdditySlot(rng, { owned: RECORDS.map((r) => r.id), chips: ECONOMY.maxChips });
      expect(o.id.endsWith('_chip') || o.id === 'record_sleeve').toBe(false);
    }
    const r2 = new Rng(hashSeed('records'));
    let seen = 0;
    for (let i = 0; i < 3000; i++) {
      const o = rollOdditySlot(r2, { owned: ['nocturne'], chips: 3 });
      if (o.id !== 'record_sleeve') continue;
      seen += 1;
      expect(o.record).not.toBe('nocturne');
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('the bet-level cards', () => {
  it('Outside bets are safe bets and Fortune favours the bold raise their kinds a level', () => {
    let s = take(setup(), 'outside_safe').state;
    expect(s.levels).toEqual({ dozen: 2, column: 2, red: 2, black: 2, odd: 2, even: 2, low: 2, high: 2 });
    s = take(setup(), 'fortune_bold').state;
    expect(s.levels).toEqual({ straight: 2 });
  });
});

describe('saves', () => {
  it('a version 6 save plays every bet at level 1', () => {
    const s = setup();
    const old = { ...s, version: 6 };
    delete old.levels;
    const back = deserializeRun(serializeRun(old).replace('"v":8', '"v":6'));
    expect(back).toMatchObject({ version: 8, levels: {} });
  });

  it('levels and new chips round-trip', () => {
    const s = { ...setup(), levels: { straight: 3 }, chips: [...setup().chips, { id: 'c4', value: 2, material: 'gold', roundValue: 0 }], nextChipId: 5 };
    expect(deserializeRun(serializeRun(s))).toEqual(s);
  });
});

describe('cards left out', () => {
  it('the two chip cards are never dealt (decision 28)', () => {
    expect(FORTUNES.map((f) => f.id)).not.toContain('stack_heavy');
    expect(FORTUNES.map((f) => f.id)).not.toContain('new_chip');
  });
});
