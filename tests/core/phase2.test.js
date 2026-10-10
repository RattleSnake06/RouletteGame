import { describe, expect, it } from 'vitest';
import { evaluate } from '../../src/core/payout.js';
import { PHASE, act, createRun, grantTalisman } from '../../src/core/run.js';
import { deserializeRun, serializeRun } from '../../src/core/save.js';
import { previewBet, railView } from '../../src/core/selectors.js';
import { deepFreeze, play, setup } from './helpers.js';

/** Exact expected return of one value-1 chip, over all 37 landings. */
function exactEv(rail, betId) {
  const s = setup({ rail, chips: { c1: betId } });
  let total = 0;
  for (let i = 0; i < s.wheel.pockets.length; i++) {
    for (const line of evaluate(s, [{ ball: 0, pocketIndex: i }]).lines) total += line.amount;
  }
  return total / s.wheel.pockets.length;
}

describe('exact expected value with talismans', () => {
  it('matches the drafted multipliers', () => {
    const base = 36 / 37;
    expect(exactEv([], 'straight:17')).toBeCloseTo(base, 12);
    expect(exactEv(['croupiers_rake'], 'straight:17')).toBeCloseTo(base * 1.5, 12);
    expect(exactEv(['horseshoe'], 'straight:17')).toBeCloseTo((base * 4) / 3, 12);
    expect(exactEv(['house_key'], 'straight:17')).toBeCloseTo(base * 2, 12);
    expect(exactEv(['red_ribbon'], 'red')).toBeCloseTo(base * 2, 12);
    expect(exactEv(['brass_knuckles'], 'corner:1-2-4-5')).toBeCloseTo(base * 2, 12);
  });
});

describe('Phase 2 actions and invariants', () => {
  const actions = [
    { type: 'restock' },
    { type: 'ringBell' },
    { type: 'buy', slot: 0 },
  ];

  it('the Cabinet, rail and Bell work in every phase but gameOver', () => {
    const base = { ...createRun({ seed: 'P2-PHASES' }), coins: 100, tokens: 50 };
    const phases = {
      [PHASE.ROUND_START]: base,
      [PHASE.BETTING]: play(base, { type: 'choosePackage', packageId: 'long' }).state,
      [PHASE.NIGHT_OVER]: play(base, { type: 'choosePackage', packageId: 'sitout' }).state,
    };
    for (const [phase, s] of Object.entries(phases)) {
      for (const a of actions) expect(act(s, a).events[0].type, `${a.type} in ${phase}`).not.toBe('rejected');
    }
    const over = { ...base, phase: PHASE.GAME_OVER };
    for (const a of actions) expect(act(over, a).events[0]).toMatchObject({ type: 'rejected', code: 'wrongPhase' });
  });

  it('act never mutates its input', () => {
    let s = setup({ rail: ['piggy_bank', 'wheel_of_fortune', 'matchbook', 'ledger'], chips: { c1: 'red', c2: 'dozen:2' } });
    s = { ...s, tokens: 50, coins: 100 };
    const script = [
      { type: 'ringBell' },
      { type: 'choosePackage', packageId: 'long' },
      { type: 'spin' },
      { type: 'restock' },
      { type: 'buy', slot: 1 },
      { type: 'moveTalisman', uid: 't1', to: 2 },
      { type: 'ringBell', uid: 't1' },
      { type: 'spin' },
    ];
    for (const a of script) {
      const frozen = deepFreeze(s);
      const before = JSON.stringify(frozen);
      const r = act(frozen, a);
      expect(JSON.stringify(frozen), a.type).toBe(before);
      if (r.events[0]?.type !== 'rejected') s = r.state;
    }
  });

  it('the same seed and actions give the same events, through a save and load', () => {
    const script = (s) => [
      { type: 'buy', slot: s.cabinet.slots.findIndex((x) => x.id) },
      { type: 'placeChip', chipId: 'c1', betId: 'red' },
      { type: 'choosePackage', packageId: 'long' },
      { type: 'spin' },
      { type: 'restock' },
      { type: 'spin' },
    ];
    const runOnce = (reload) => {
      let s = { ...createRun({ seed: 'P2-DET' }), coins: 50, tokens: 20 };
      const out = [];
      for (const a of script(s)) {
        if (reload) s = deserializeRun(serializeRun(s));
        const r = act(s, a);
        out.push(r.events);
        s = r.state;
      }
      return JSON.stringify(out);
    };
    expect(runOnce(true)).toBe(runOnce(false));
  });

  it('round-trips a run with a rail, an armed throw and a foreseen landing', () => {
    let s = createRun({ seed: 'P2-SAVE' });
    for (const id of ['piggy_bank', 'wheel_of_fortune', 'glass_eye', 'twin_mirrors', 'red_ribbon']) s = grantTalisman(s, id);
    s = play(s, { type: 'ringBell' }, { type: 'ringBell' }).state;
    const back = deserializeRun(serializeRun(s));
    expect(back).toEqual(s);
  });

  it('describes the rail and what a bet pays for the notes', () => {
    let s = createRun({ seed: 'P2-VIEW' });
    for (const id of ['twin_mirrors', 'horseshoe', 'piggy_bank']) s = grantTalisman(s, id);
    const rail = railView(s);
    expect(rail[0]).toMatchObject({ id: 'twin_mirrors', copying: 'horseshoe', dim: false });
    expect(rail[2]).toMatchObject({ id: 'piggy_bank', active: true, targetOnly: true, usable: false, status: 'holds 0' });
    expect(previewBet(s, 'straight:17')).toMatchObject({ odds: 60, pays: 60 }); // 36 + 12 + 12
    expect(previewBet(s, 'red')).toMatchObject({ odds: 2, pays: 2 });
  });
});

describe('review fixes', () => {
  it('a big line with a ×¼ hit floors once, at the end', async () => {
    const { mulFloor } = await import('../../src/core/num.js');
    expect(mulFloor(1e14 + 1, 18, 0.25)).toBe(450000000000004);
    expect(mulFloor(3, 18, 0.25)).toBe(13);
  });

  it('saves big numbers exactly, so a reloaded run plays the same', async () => {
    const { num } = await import('../../src/core/num.js');
    const s = { ...createRun({ seed: 'DEC' }), deposited: num('6.07753125e20'), phase: PHASE.NIGHT_OVER };
    const a = act(s, { type: 'endNight' }).events.find((e) => e.type === 'interest');
    const b = act(deserializeRun(serializeRun(s)), { type: 'endNight' }).events.find((e) => e.type === 'interest');
    expect(String(b.amount)).toBe(String(a.amount));
  });

  it('a save that offers a talisman the game no longer knows loads with that compartment sold', () => {
    const data = JSON.parse(serializeRun(createRun({ seed: 'OLD' })));
    const slot = data.state.cabinet.slots.findIndex((x) => x.id);
    data.state.cabinet.slots[slot].id = 'black_cat';
    const back = deserializeRun(JSON.stringify(data));
    expect(back.cabinet.slots[slot]).toEqual({ kind: 'talisman', id: null, sold: true });
    expect(act(back, { type: 'buy', slot }).events[0].code).toBe('soldOut');
  });

  it('the bet preview does not depend on which covered pocket it tries', () => {
    let s = grantTalisman(createRun({ seed: 'LEDGER' }), 'ledger');
    s = { ...s, tally: { ...s.tally, debt: { ...s.tally.debt, numbers: { 32: 1 } } } };
    expect(previewBet(s, 'red')).toMatchObject({ pays: 2, paysMax: 4 });
    expect(previewBet(s, 'straight:32')).toMatchObject({ pays: 72 });
  });

  it('the rarity chart leaves out what is on the rail', async () => {
    const { rarityOdds } = await import('../../src/core/selectors.js');
    let s = createRun({ seed: 'ODDS' });
    for (const id of ['red_ribbon', 'horseshoe', 'matchbook', 'lucky_penny', 'crumpled_receipt', 'pawn_ticket']) s = grantTalisman(s, id);
    expect(rarityOdds(s).common).toBe(0);
    expect(rarityOdds(s).legendary).toBeCloseTo(0.6 / 5.8, 9);
  });
});
