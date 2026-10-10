import { describe, expect, it } from 'vitest';
import { bellQueue } from '../../src/core/bell.js';
import { act, createRun, grantTalisman } from '../../src/core/run.js';
import { play } from './helpers.js';

const withRail = (ids, seed = 'BELL') => ids.reduce((s, id) => grantTalisman(s, id), createRun({ seed }));

describe('the Bell', () => {
  it('queues usable actives in rail order, never the Piggy Bank', () => {
    const s = withRail(['piggy_bank', 'glass_eye', 'red_ribbon', 'wheel_of_fortune']);
    expect(bellQueue(s)).toEqual([s.rail[1].uid, s.rail[3].uid]);
  });

  it('wakes one talisman per ring, the leftmost that can answer', () => {
    let s = withRail(['wheel_of_fortune', 'glass_eye']);
    let r = play(s, { type: 'ringBell' });
    expect(r.events[0]).toMatchObject({ type: 'bellRung', uid: s.rail[0].uid });
    expect(r.state.armed.rethrow).toEqual({ by: s.rail[0].uid });
    expect(r.state.foreseen).toBe(null);
    // Wheel of Fortune is armed now, so the next ring falls to the Glass Eye.
    r = play(r.state, { type: 'ringBell' });
    expect(r.events[0]).toMatchObject({ type: 'bellRung', uid: s.rail[1].uid });
    expect(r.state.foreseen.by).toBe(s.rail[1].uid);
  });

  it('rings dull when nothing answers, and changes nothing', () => {
    const s = withRail(['red_ribbon']);
    const r = act(s, { type: 'ringBell' });
    expect(r.state).toBe(s);
    expect(r.events).toEqual([{ type: 'bellRung', uid: null, id: null }]);
  });

  it('refuses a ring aimed at a talisman that cannot answer', () => {
    const s = withRail(['red_ribbon', 'piggy_bank']);
    expect(act(s, { type: 'ringBell', uid: s.rail[0].uid }).events[0]).toMatchObject({ type: 'rejected', code: 'notUsable' });
    expect(act(s, { type: 'ringBell', uid: s.rail[1].uid }).events[0].code).toBe('notUsable'); // an empty pig
  });

  it('refills charges at each new debt', () => {
    let s = withRail(['wheel_of_fortune']);
    s = play(s, { type: 'ringBell' }).state;
    s = play(s, { type: 'placeChip', chipId: 'c1', betId: 'red' }, { type: 'choosePackage', packageId: 'long' }, { type: 'spin' }).state;
    expect(s.rail[0].charges).toBe(1);
    s = { ...s, round: 3, phase: 'nightOver', deposited: 1000 };
    const { state, events } = play(s, { type: 'endNight' });
    expect(state.rail[0].charges).toBe(2);
    const order = events.map((e) => e.type).filter((t) => ['debtPaid', 'chargesRefilled', 'roundStart', 'offersRestocked'].includes(t));
    expect(order).toEqual(['debtPaid', 'chargesRefilled', 'roundStart', 'offersRestocked']);
  });

  it('a charge still waiting at the end of a debt is not refilled', () => {
    let s = withRail(['glass_eye']);
    s = { ...s, round: 3, phase: 'nightOver', deposited: 1000 };
    s = play(s, { type: 'ringBell' }).state;
    expect(s.foreseen).not.toBe(null);
    s = play(s, { type: 'endNight' }).state;
    expect(s.debt).toBe(2);
    expect(s.rail[0].charges).toBe(0); // the foreseen spin is still to come
    s = play(s, { type: 'placeChip', chipId: 'c1', betId: 'red' }, { type: 'choosePackage', packageId: 'long' }, { type: 'spin' }).state;
    expect(s.foreseen).toBe(null);
    expect(act(s, { type: 'ringBell', uid: s.rail[0].uid }).events[0].code).toBe('notUsable');
  });
});

describe('the Bell across a debt', () => {
  it('an armed Wheel of Fortune keeps its waiting charge out of the refill, not the other', () => {
    let s = withRail(['wheel_of_fortune'], 'BELL-ARM');
    s = play(s, { type: 'placeChip', chipId: 'c1', betId: 'red' }, { type: 'choosePackage', packageId: 'long' }).state;
    s = play(s, { type: 'ringBell' }, { type: 'spin' }, { type: 'ringBell' }).state;
    expect(s.rail[0].charges).toBe(0);
    s = { ...s, round: 3, phase: 'nightOver', deposited: 1000 };
    s = play(s, { type: 'endNight' }).state;
    expect(s.debt).toBe(2);
    expect(s.armed.rethrow).toEqual({ by: s.rail[0].uid });
    expect(s.rail[0].charges).toBe(1);
  });
});
