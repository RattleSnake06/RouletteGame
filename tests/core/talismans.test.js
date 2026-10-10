import { describe, expect, it } from 'vitest';
import { registerTestTalisman } from '../../src/core/content/index.js';
import { evaluate } from '../../src/core/payout.js';
import { act } from '../../src/core/run.js';
import { deepFreeze, play, pocketOf, setup, spinOn } from './helpers.js';

const paid = (events) => events.filter((e) => e.type === 'chipPaid');
const triggers = (events) => events.filter((e) => e.type === 'trigger');
const spinResult = (events) => events.find((e) => e.type === 'spin').result;

describe('payout pipeline', () => {
  it('pays a hand-worked line: value 2 on 32, a Rake neighbour hit, with Horseshoe', () => {
    let s = setup({ rail: ['croupiers_rake', 'horseshoe'], chips: { c1: 'straight:32' } });
    s = { ...s, chips: s.chips.map((c) => (c.id === 'c1' ? { ...c, value: 2 } : c)) };
    // 15 sits between 32 and 19 on the wheel.
    const { events } = spinOn(s, 15);
    expect(paid(events).map((e) => e.amount)).toEqual([24]); // 2 × 1 × 48 × 1 × 1 × ¼
  });

  it('floors once per line, not per factor', () => {
    registerTestTalisman({
      id: 'test_quarter_echo',
      name: 'Quarter echo',
      rarity: 'common',
      text: 'test only',
      hooks: {
        hits(ctx) {
          ctx.addHit({ pocketIndex: ctx.landing.pocketIndex, mult: 0.25 });
        },
      },
    });
    let s = setup({ rail: ['test_quarter_echo'], chips: { c1: 'split:17-20' } });
    s = { ...s, chips: s.chips.map((c) => (c.id === 'c1' ? { ...c, value: 3 } : c)) };
    const { events } = spinOn(s, 17);
    // Primary: 3 × 18 = 54. Echo: floor(3 × 18 × ¼) = floor(13.5) = 13, not 3 × floor(4.5) = 12.
    expect(paid(events).map((e) => e.amount)).toEqual([54, 13]);
  });

  it('evaluate never changes the state it reads', () => {
    const s = deepFreeze(setup({ rail: ['twin_mirrors', 'red_ribbon', 'ledger', 'abacus', 'croupiers_rake', 'house_key'], chips: { c1: 'red', c2: 'dozen:1', c3: 'straight:32' } }));
    const before = JSON.stringify(s);
    evaluate(s, [{ ball: 0, pocketIndex: pocketOf(15) }]);
    evaluate(s, [{ ball: 0, pocketIndex: pocketOf(0) }]);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('plays talismans strictly left to right along the rail', () => {
    const base = setup({ chips: { c1: 'red' } });
    const seen = { ...base.tally, debt: { numbers: { 32: 1 } } };
    const order = (rail) => {
      const s = { ...setup({ rail, chips: { c1: 'red' } }), tally: seen };
      return triggers(spinOn(s, 32).events).map((e) => e.src.id);
    };
    expect(order(['ledger', 'red_ribbon'])).toEqual(['ledger', 'red_ribbon']);
    expect(order(['red_ribbon', 'ledger'])).toEqual(['red_ribbon', 'ledger']);
  });

  it('a spin that only pays bonus coins is still a miss', () => {
    const s = setup({ rail: ['lucky_penny'], chips: { c1: 'red', c2: 'black', c3: 'straight:17' } });
    const r = spinResult(spinOn(s, 0).events);
    expect(r.miss).toBe(true);
    expect(r.total).toBe(3);
  });
});

describe('the first fifteen talismans', () => {
  it('Red Ribbon: chips on Red get +1 Stake, nothing else does', () => {
    const s = setup({ rail: ['red_ribbon'], chips: { c1: 'red', c2: 'straight:32' } });
    expect(paid(spinOn(s, 32).events).map((e) => [e.chipId, e.amount])).toEqual([
      ['c1', 4],
      ['c2', 36],
    ]);
    const black = setup({ rail: ['red_ribbon'], chips: { c1: 'black' } });
    expect(paid(spinOn(black, 15).events)[0].amount).toBe(2);
  });

  it('Horseshoe: straight-ups pay 48, splits are untouched', () => {
    const s = setup({ rail: ['horseshoe'], chips: { c1: 'straight:17', c2: 'split:17-20' } });
    expect(paid(spinOn(s, 17).events).map((e) => e.amount)).toEqual([48, 18]);
  });

  it('Matchbook: a winning chip gains +1 value until the night ends', () => {
    let s = setup({ rail: ['matchbook'], chips: { c1: 'red' } });
    let r = spinOn(s, 32);
    expect(paid(r.events)[0].amount).toBe(2);
    expect(r.state.chips[0].roundValue).toBe(1);
    r = spinOn(r.state, 32);
    expect(paid(r.events)[0].amount).toBe(4); // value 2 × 2
    s = r.state;
    while (s.phase === 'betting') s = spinOn(s, 15).state; // black: no more wins
    s = play(s, { type: 'endNight' }).state;
    expect(s.chips[0].roundValue).toBe(0);
  });

  it('Matchbook: one chip paying two lines in a spin gains +1 once', () => {
    const s = setup({ rail: ['twin_mirrors', 'croupiers_rake', 'matchbook'], chips: { c1: 'straight:32' } });
    // Mirrored Rake: two ×¼ lines on the neighbour 32.
    const r = spinOn(s, 15);
    expect(paid(r.events)).toHaveLength(2);
    expect(r.state.chips[0].roundValue).toBe(1);
  });

  it('Lucky Penny: each losing chip refunds 1 coin', () => {
    const s = setup({ rail: ['lucky_penny'], chips: { c1: 'red', c2: 'black', c3: 'straight:17' } });
    const r = spinResult(spinOn(s, 32).events);
    expect(r.chipTotal).toBe(2);
    expect(r.bonusCoins).toBe(2);
    expect(r.total).toBe(4);
  });

  it('Crumpled Receipt: +1 token at the end of every night, doubled by Twin Mirrors', () => {
    const night = (rail) => {
      const s = play(setup({ rail }), { type: 'choosePackage', packageId: 'sitout' }).state;
      return play(s, { type: 'endNight' }).state.tokens - s.tokens;
    };
    expect(night([])).toBe(1); // every night's token
    expect(night(['crumpled_receipt'])).toBe(2);
    expect(night(['twin_mirrors', 'crumpled_receipt'])).toBe(3);
  });

  it('Pawn Ticket: the Cage pays 2% more interest', () => {
    let s = play(setup({ rail: ['pawn_ticket'] }), { type: 'deposit', amount: 100 }).state;
    s = play(s, { type: 'choosePackage', packageId: 'sitout' }).state;
    const { state, events } = play(s, { type: 'endNight' });
    expect(events.find((e) => e.type === 'interest')).toMatchObject({ amount: 7, rate: 0.07 });
    expect(state.deposited).toBe(107);
  });

  it('Brass Knuckles: corners pay ×2, First Four does not', () => {
    const s = setup({ rail: ['brass_knuckles'], chips: { c1: 'corner:1-2-4-5', c2: 'firstFour' } });
    expect(paid(spinOn(s, 1).events).map((e) => [e.chipId, e.amount])).toEqual([
      ['c1', 18],
      ['c2', 9],
    ]);
  });

  it("Croupier's Rake: straight-ups beside the result pay ×¼, outside bets do not", () => {
    const s = setup({ rail: ['croupiers_rake'], chips: { c1: 'straight:32', c2: 'straight:19', c3: 'red' } });
    const lines = paid(spinOn(s, 15).events);
    expect(lines.map((e) => [e.chipId, e.amount, e.hit.mult])).toEqual([
      ['c1', 9, 0.25],
      ['c2', 9, 0.25],
    ]);
  });

  it("Croupier's Rake: zero's neighbours wrap around the wheel", () => {
    const s = setup({ rail: ['croupiers_rake'], chips: { c1: 'straight:26', c2: 'straight:32' } });
    expect(paid(spinOn(s, 0).events).map((e) => e.chipId)).toEqual(['c1', 'c2']);
  });

  it('Ledger: a number already seen this debt pays ×2', () => {
    let r = spinOn(setup({ rail: ['ledger'], chips: { c1: 'red' } }), 32);
    expect(paid(r.events)[0].amount).toBe(2);
    r = spinOn(r.state, 32);
    expect(paid(r.events)[0].amount).toBe(4);
  });

  it('Ledger: the tally starts over with each debt', () => {
    let s = setup({ rail: ['ledger'] });
    s = { ...s, round: 3, phase: 'nightOver', deposited: 1000, tally: { ...s.tally, debt: { numbers: { 32: 1 } } } };
    s = play(s, { type: 'endNight' }).state;
    expect(s.debt).toBe(2);
    expect(s.tally.debt.numbers).toEqual({});
  });

  it('Abacus: dozen chips gain +1 Odds per earlier hit on that dozen tonight', () => {
    let r = spinOn(setup({ rail: ['abacus'], chips: { c1: 'dozen:1' } }), 5);
    expect(paid(r.events)[0].amount).toBe(3);
    r = spinOn(r.state, 7);
    expect(paid(r.events)[0].amount).toBe(6); // odds 3 × Odds mult 2
    r = spinOn(r.state, 0); // zero is in no dozen
    r = spinOn(r.state, 8);
    expect(paid(r.events)[0].amount).toBe(9);
    let s = r.state;
    while (s.phase === 'betting') s = spinOn(s, 0).state;
    s = play(s, { type: 'endNight' }).state;
    expect(s.tally.round.dozens).toEqual([0, 0, 0]);
  });

  it('Abacus: Rake neighbour hits do not count toward the tally', () => {
    const r = spinOn(setup({ rail: ['abacus', 'croupiers_rake'], chips: { c1: 'straight:32' } }), 15);
    expect(r.state.tally.round.dozens).toEqual([0, 1, 0]); // 15 only, not 32 or 19
  });

  it('Twin Mirrors: copies the talisman to its right, follows a chain, skips Bell actives', () => {
    const pay = (rail) => paid(spinOn(setup({ rail, chips: { c1: 'red' } }), 32).events)[0].amount;
    expect(pay(['twin_mirrors', 'red_ribbon'])).toBe(6); // Stake 3
    expect(pay(['red_ribbon', 'twin_mirrors'])).toBe(4); // rightmost: nothing to copy
    expect(pay(['twin_mirrors', 'twin_mirrors', 'red_ribbon'])).toBe(8); // Stake 4
    const s = setup({ rail: ['twin_mirrors', 'wheel_of_fortune'] });
    expect(triggers(spinOn({ ...s, placements: { c1: 'red' } }, 32).events)).toEqual([]);
  });

  it('House Key: when zero hits every chip wins, once each, and none is lost', () => {
    const s = setup({ rail: ['house_key', 'lucky_penny'], chips: { c1: 'red', c2: 'straight:17', c3: 'straight:0' } });
    const r = spinResult(spinOn(s, 0).events);
    expect(r.lines.map((l) => [l.chipId, l.amount])).toEqual([
      ['c1', 2],
      ['c2', 36],
      ['c3', 36],
    ]);
    expect(r.bonusCoins).toBe(0);
  });

  it('Piggy Bank: gains 1 coin a spin; only a ring aimed at it smashes it', () => {
    let s = setup({ rail: ['piggy_bank'], chips: { c1: 'red' } });
    for (let i = 0; i < 3; i++) s = spinOn(s, 15).state;
    const pig = s.rail[0];
    expect(pig.data.value).toBe(3);
    // A plain ring passes the pig by.
    const bare = act(s, { type: 'ringBell' });
    expect(bare.state).toBe(s);
    expect(bare.events).toEqual([{ type: 'bellRung', uid: null, id: null }]);
    const { state } = play(s, { type: 'ringBell', uid: pig.uid });
    expect(state.coins).toBe(s.coins + 6);
    expect(state.rail).toEqual([]);
  });

  it('Glass Eye: the foreseen pocket is where the next ball lands, and the stream ends up the same', () => {
    let plain = play(setup({ chips: { c1: 'red' } }), { type: 'choosePackage', packageId: 'long' }).state;
    let eyed = play(setup({ rail: ['glass_eye'], chips: { c1: 'red' } }), { type: 'choosePackage', packageId: 'long' }).state;
    const rung = play(eyed, { type: 'ringBell' });
    const seen = rung.events.find((e) => e.type === 'foreseen');
    eyed = play(rung.state, { type: 'spin' }).state;
    plain = play(plain, { type: 'spin' }).state;
    expect(eyed.lastSpin.pocketIndex).toBe(seen.pocketIndex);
    expect(eyed.lastSpin.number).toBe(plain.lastSpin.number);
    expect(eyed.rng.wheel).toEqual(plain.rng.wheel);
    expect(eyed.rail[0].charges).toBe(0);
    expect(act(eyed, { type: 'ringBell', uid: eyed.rail[0].uid }).events[0]).toMatchObject({ type: 'rejected', code: 'notUsable' });
  });

  it('Wheel of Fortune: an armed miss is thrown again; a win spends the charge anyway', () => {
    let s = play(setup({ rail: ['wheel_of_fortune'], chips: { c1: 'straight:32' } }), { type: 'ringBell' }).state;
    expect(s.rail[0].charges).toBe(1);
    expect(s.armed.rethrow).toEqual({ by: s.rail[0].uid });
    const r = spinOn(s, 15);
    const rethrow = r.events.find((e) => e.type === 'rethrow');
    expect(rethrow.first[0].number).toBe(15);
    expect(r.state.armed.rethrow).toBe(null);
    expect(r.state.stats.rethrows).toBe(1);
    // The discarded throw never reaches the tally.
    const final = r.state.lastSpin.number;
    if (final !== 15) expect(r.state.tally.debt.numbers[15]).toBeUndefined();

    let w = play(r.state, { type: 'ringBell' }).state;
    expect(w.rail[0].charges).toBe(0);
    const win = spinOn(w, 32);
    expect(win.events.some((e) => e.type === 'rethrow')).toBe(false);
    expect(win.state.armed.rethrow).toBe(null);
    expect(act(win.state, { type: 'ringBell', uid: w.rail[0].uid }).events[0].code).toBe('notUsable');
  });
});
