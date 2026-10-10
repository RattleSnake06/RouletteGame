import { describe, expect, it } from 'vitest';
import { getBet, betCovers } from '../../src/core/bets.js';
import { PHASE, act, createRun } from '../../src/core/run.js';

const SEED = 'TEST-SEED';

/** Applies actions in order, failing on any rejection. */
function play(state, ...actions) {
  const events = [];
  for (const a of actions) {
    const r = act(state, a);
    const rejected = r.events.find((e) => e.type === 'rejected');
    if (rejected) throw new Error(`${a.type} rejected: ${rejected.reason}`);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

const spins = (n) => Array.from({ length: n }, () => ({ type: 'spin' }));

describe('run state machine', () => {
  it('starts with the drafted opening state', () => {
    const s = createRun({ seed: SEED });
    expect(s.phase).toBe(PHASE.ROUND_START);
    expect(s.coins).toBe(10);
    expect(s.tokens).toBe(4);
    expect(s.chips).toHaveLength(3);
    expect(s.debt).toBe(1);
    expect(s.round).toBe(1);
  });

  it('charges for a long night and allows seven spins', () => {
    let { state } = play(createRun({ seed: SEED }), { type: 'choosePackage', packageId: 'long' });
    expect(state.coins).toBe(3);
    expect(state.spinsLeft).toBe(7);
    expect(state.phase).toBe(PHASE.BETTING);
    ({ state } = play(state, ...spins(7)));
    expect(state.spinsLeft).toBe(0);
    expect(state.spinsTonight).toBe(7);
    expect(state.phase).toBe(PHASE.NIGHT_OVER);
    expect(act(state, { type: 'spin' }).events[0].type).toBe('rejected');
  });

  it('gives a token for a short night and lets you sit out', () => {
    let { state } = play(createRun({ seed: SEED }), { type: 'choosePackage', packageId: 'short' });
    expect(state.tokens).toBe(5);
    expect(state.spinsLeft).toBe(3);
    ({ state } = play(createRun({ seed: SEED }), { type: 'choosePackage', packageId: 'sitout' }));
    expect(state.phase).toBe(PHASE.NIGHT_OVER);
    expect(state.satOut).toBe(1);
    expect(state.coins).toBe(10);
  });

  it('refuses a night you cannot afford, and a second package mid-night', () => {
    const poor = { ...createRun({ seed: SEED }), coins: 2 };
    expect(act(poor, { type: 'choosePackage', packageId: 'long' }).events[0].type).toBe('rejected');
    const { state } = play(createRun({ seed: SEED }), { type: 'choosePackage', packageId: 'short' });
    expect(act(state, { type: 'choosePackage', packageId: 'short' }).events[0].type).toBe('rejected');
  });

  it('pays placed chips according to the landed pocket', () => {
    let { state } = play(
      createRun({ seed: SEED }),
      { type: 'placeChip', chipId: 'c1', betId: 'red' },
      { type: 'placeChip', chipId: 'c2', betId: 'straight:17' },
      { type: 'placeChip', chipId: 'c3', betId: 'dozen:1' },
      { type: 'choosePackage', packageId: 'long' },
    );
    for (let i = 0; i < 7; i++) {
      const before = state.coins;
      const r = play(state, { type: 'spin' });
      state = r.state;
      const { result } = r.events.find((e) => e.type === 'spin');
      const pocket = { number: result.number, color: result.color };
      let expected = 0;
      for (const [chipId, betId] of Object.entries(state.placements)) {
        const bet = getBet(betId);
        if (betCovers(bet, pocket)) expected += { red: 2, straight: 36, dozen: 3 }[bet.kind];
        expect(result.wins.some((w) => w.chipId === chipId)).toBe(betCovers(bet, pocket));
      }
      expect(result.total).toBe(expected);
      expect(state.coins).toBe(before + expected);
    }
  });

  it('is deterministic for a seed and never mutates its input', () => {
    const actions = [
      { type: 'placeChip', chipId: 'c1', betId: 'black' },
      { type: 'choosePackage', packageId: 'long' },
      ...spins(7),
    ];
    const start = createRun({ seed: SEED });
    const snapshot = JSON.stringify(start);
    const a = play(start, ...actions);
    const b = play(createRun({ seed: SEED }), ...actions);
    expect(JSON.stringify(start)).toBe(snapshot);
    expect(a.state.history).toEqual(b.state.history);
    const c = play(createRun({ seed: 'OTHER-SEED' }), ...actions);
    expect(c.state.history).not.toEqual(a.state.history);
  });

  it('moves coins into the Cage one way', () => {
    const s = createRun({ seed: SEED });
    expect(act(s, { type: 'deposit', amount: 11 }).events[0].type).toBe('rejected');
    expect(act(s, { type: 'deposit', amount: 0 }).events[0].type).toBe('rejected');
    const { state } = play(s, { type: 'deposit', amount: 8 });
    expect(state.coins).toBe(2);
    expect(state.deposited).toBe(8);
  });

  it('pays interest at the end of each night and moves to the next round', () => {
    const s = { ...createRun({ seed: SEED }), coins: 100 };
    const { state, events } = play(
      s,
      { type: 'deposit', amount: 90 },
      { type: 'choosePackage', packageId: 'sitout' },
      { type: 'endNight' },
    );
    expect(events.find((e) => e.type === 'interest').amount).toBe(4); // floor(90 × 5%)
    expect(state.deposited).toBe(94);
    expect(state.round).toBe(2);
    expect(state.phase).toBe(PHASE.ROUND_START);
  });

  it('collects at the end of the third night and pays the debt reward', () => {
    let state = { ...createRun({ seed: SEED }), coins: 100 };
    ({ state } = play(state, { type: 'deposit', amount: 70 }));
    for (let r = 0; r < 3; r++) {
      ({ state } = play(state, { type: 'choosePackage', packageId: 'sitout' }, { type: 'endNight' }));
    }
    // 70 → 73 → 76 → 79 with interest, minus 60 owed.
    expect(state.debt).toBe(2);
    expect(state.round).toBe(1);
    expect(state.deposited).toBe(19);
    // Start, a token every night, the debt reward and three sat-out nights.
    expect(state.tokens).toBe(4 + 3 * 1 + 2 + 3 * 3);
    expect(state.coins).toBe(30 + 3 * 2); // three spins at debt 2's cost of 2
    expect(state.satOut).toBe(0);
    expect(state.stats.debtsPaid).toBe(1);
  });

  it('ends the run when the deposits fall short', () => {
    let state = createRun({ seed: SEED });
    ({ state } = play(state, { type: 'deposit', amount: 10 }));
    for (let r = 0; r < 3; r++) {
      ({ state } = play(state, { type: 'choosePackage', packageId: 'sitout' }, { type: 'endNight' }));
    }
    expect(state.phase).toBe(PHASE.GAME_OVER);
    expect(state.outcome).toMatchObject({ reason: 'collected', debt: 1, owed: 60 });
    expect(act(state, { type: 'deposit', amount: 0 }).events[0].type).toBe('rejected');
  });
});
