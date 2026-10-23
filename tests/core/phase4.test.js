import { describe, expect, it } from 'vitest';
import { FORTUNES } from '../../src/core/content/index.js';
import { rollTalismanSlots } from '../../src/core/cabinet.js';
import { DEVIL, devilChanceFor } from '../../src/core/devil.js';
import { nudgeFor, upcomingLean } from '../../src/core/nudge.js';
import { evaluate } from '../../src/core/payout.js';
import { Rng } from '../../src/core/rng.js';
import { act, costOf, grantTalisman, hooksFor, owed } from '../../src/core/run.js';
import { deserializeRun, serializeRun } from '../../src/core/save.js';
import { cabinetView, oracleView, railView } from '../../src/core/selectors.js';
import { noHouseLuck, play, pocketOf, setup, spinOn } from './helpers.js';

// Phase 4 (design doc 5.9, 5.10, 6.2–6.4): Madame Zero's fortunes, records
// on the gramophone, and engravings.

const paysOn = (state, n) => evaluate(state, [{ ball: 0, pocketIndex: pocketOf(n) }]);
const amounts = (plan) => plan.lines.map((l) => l.amount);
/** A deal on her counter holding these cards (the lever's draw is tested on its own). */
const dealt = (state, cards, kind = 'white') => ({ ...state, oracle: { debt: state.debt, kind, cards, rerolls: 0, taken: null } });
const take = (state, id, kind) => play(dealt(state, [id], kind ?? FORTUNES.find((f) => f.id === id).kind), { type: 'takeFortune', index: 0 });
const withRecord = (state, id) => play({ ...state, records: [...state.records, id] }, { type: 'playRecord', id }).state;
const widthOf = (state, n) => state.wheel.pockets[pocketOf(n)].width;

describe('Madame Zero', () => {
  it('the first pull deals three different white cards for free; a reroll costs the debt plus rerolls so far', () => {
    let s = setup();
    let r = play(s, { type: 'pullLever' });
    expect(r.events[0]).toMatchObject({ type: 'fortunesDealt', kind: 'white', cost: 0, rerolls: 0 });
    const cards = r.state.oracle.cards;
    expect(new Set(cards).size).toBe(3);
    expect(cards.every((id) => FORTUNES.find((f) => f.id === id).kind === 'white')).toBe(true);
    expect(r.state.coins).toBe(s.coins);
    s = r.state;
    r = play(s, { type: 'pullLever' });
    expect(r.state.coins).toBe(s.coins - 1);
    r = play(r.state, { type: 'pullLever' });
    expect(r.state.coins).toBe(s.coins - 1 - 2);
    expect(oracleView(r.state)).toMatchObject({ dealt: true, rerolls: 2, rerollCost: 3 });
  });

  it('a deal never changes a spin: her cards come from their own stream', () => {
    const s = { ...setup({ chips: { c1: 'red' } }), phase: 'roundStart' };
    const a = play(s, { type: 'choosePackage', packageId: 'long' }, { type: 'spin' }).state;
    const b = play(s, { type: 'pullLever' }, { type: 'pullLever' }, { type: 'choosePackage', packageId: 'long' }, { type: 'spin' }).state;
    expect(b.lastSpin.number).toBe(a.lastSpin.number);
  });

  it('black cards when the Devil fired this debt before the first pull; the colour is fixed by that pull', () => {
    const fired = { ...setup(), devil: { firedThisDebt: true } };
    const black = play(fired, { type: 'pullLever' }).state;
    expect(black.oracle.kind).toBe('black');
    expect(black.oracle.cards.every((id) => FORTUNES.find((f) => f.id === id).kind === 'black')).toBe(true);
    // Pulled before the Devil: it stays white, rerolls included.
    let s = play(setup({ coins: 50 }), { type: 'pullLever' }).state;
    s = play({ ...s, devil: { firedThisDebt: true } }, { type: 'pullLever' }).state;
    expect(s.oracle.kind).toBe('white');
  });

  it('one card a debt: after taking, the lever gives nothing until the next debt', () => {
    let s = play(setup(), { type: 'pullLever' }).state;
    s = play(s, { type: 'takeFortune', index: 0 }).state;
    expect(act(s, { type: 'pullLever' }).events[0].code).toBe('used');
    expect(act(s, { type: 'takeFortune', index: 1 }).events[0].code).toBe('used');
    s = play({ ...s, phase: 'nightOver', round: 3, deposited: 1000 }, { type: 'endNight' }).state;
    expect(s.debt).toBe(2);
    expect(play(s, { type: 'pullLever' }).events[0]).toMatchObject({ type: 'fortunesDealt', cost: 0 });
  });

  it('a card that could do nothing is never dealt, and waits if the run changed since the deal', () => {
    const full = setup({ rail: ['red_ribbon', 'horseshoe', 'matchbook', 'lucky_penny', 'crumpled_receipt', 'pawn_ticket'] });
    const black = { ...full, devil: { firedThisDebt: true } };
    for (let i = 0; i < 20; i++) {
      const s = play({ ...black, rng: { ...black.rng, fortunes: [i, 7, 11, 13] } }, { type: 'pullLever' }).state;
      expect(s.oracle.cards).not.toContain('roll_bones');
    }
    expect(act(dealt(full, ['roll_bones'], 'black'), { type: 'takeFortune', index: 0 }).events[0].code).toBe('notUsable');
  });
});

describe('white cards', () => {
  it('tokens, and a hook (once a run)', () => {
    const s = setup();
    expect(take(s, 'stranger_tips').state.tokens).toBe(s.tokens + 2);
    const hook = take(s, 'another_hook').state;
    expect(hook.railHooks).toBe(7);
    expect(act(dealt(hook, ['another_hook']), { type: 'takeFortune', index: 0 }).events[0].code).toBe('notUsable');
  });

  it('the bell rings twice: every Bell talisman back to full', () => {
    let s = setup({ rail: ['wheel_of_fortune', 'glass_eye'] });
    s = { ...s, rail: s.rail.map((t) => ({ ...t, charges: 0 })) };
    expect(take(s, 'bell_rings_twice').state.rail.map((t) => t.charges)).toEqual([2, 1]);
  });

  it('the cabinet owes you: a token off every talisman until the next restock', () => {
    let s = take(setup(), 'cabinet_owes').state;
    const offer = cabinetView(s).slots[0];
    expect(offer.price).toBe(offer.listPrice - 1);
    s = play({ ...s, coins: 100 }, { type: 'restock' }).state;
    expect(cabinetView(s).slots[0].price).toBe(cabinetView(s).slots[0].listPrice);
  });

  it('the reds run warm: every red pocket +0.15, for good', () => {
    const s = take(setup(), 'reds_run_warm').state;
    expect([widthOf(s, 32), widthOf(s, 15), widthOf(s, 0)]).toEqual([1.15, 1, 1]);
  });

  it('someone left a record: it goes in the crate and plays if nothing is playing', () => {
    const s = take(setup(), 'record_left').state;
    expect(s.records).toHaveLength(1);
    expect(s.playing).toBe(s.records[0]);
  });

  it('something carved in brass: an engraving, never Cursed, on a talisman that had none', () => {
    for (let i = 0; i < 12; i++) {
      const base = setup({ rail: ['red_ribbon'] });
      const s = take({ ...base, rng: { ...base.rng, fortunes: [i, 3, 5, 7] } }, 'carved_in_brass').state;
      expect(s.rail[0].engraving).toBeTruthy();
      expect(s.rail[0].engraving).not.toBe('cursed');
    }
  });
});

describe('black cards', () => {
  it('burn the ledger, give it all back, bargain at the cabinet', () => {
    const s = { ...setup({ coins: 40 }), tokens: 7 };
    expect(take(s, 'burn_ledger').state).toMatchObject({ tokens: 14, coins: 0 });
    expect(take(s, 'give_it_back').state).toMatchObject({ tokens: 0, coins: 80 });
    let b = take(s, 'bargain').state;
    expect(b.tokens).toBe(0);
    expect(cabinetView(b).slots[0].price).toBe(0);
    b = play(b, { type: 'buy', slot: 0 }, { type: 'buy', slot: 1 }).state;
    expect(b.rail).toHaveLength(2);
    expect(b.cabinet.freeBuys).toBe(0);
    expect(act(b, { type: 'buy', slot: 2 }).events[0].code).toBe('noTokens');
  });

  it('feed the zero: a second zero pocket beside the first, and chips pay ×2 for the rest of the run', () => {
    const s = take(setup({ chips: { c1: 'red' } }), 'feed_zero').state;
    expect(s.wheel.pockets.slice(0, 3).map((p) => [p.number, p.color])).toEqual([[0, 'green'], [0, 'green'], [32, 'red']]);
    expect(s.wheel.pockets.length).toBe(38);
    expect(amounts(evaluate(s, [{ ball: 0, pocketIndex: pocketOf(32, s) }]))).toEqual([4]);
    expect(s.boons.map((b) => b.id)).toEqual(['feed_zero']);
  });

  it('roll the bones and a candle for the dark hang the cursed talismans, for good', () => {
    const bones = take(setup(), 'roll_bones').state;
    expect(bones.rail.map((t) => t.id)).toEqual(['bone_dice']);
    expect(act(bones, { type: 'sell', uid: bones.rail[0].uid }).events[0].code).toBe('cursed');
    expect(take(setup(), 'candle').state.rail.map((t) => t.id)).toEqual(['black_candle']);
  });

  it('shiny things: every offer engraved, one of yours Cursed', () => {
    const s = take(setup({ rail: ['red_ribbon', 'horseshoe'] }), 'shiny_things').state;
    expect(s.cabinet.slots.filter((x) => x.kind === 'talisman' && x.id).every((x) => x.engraving)).toBe(true);
    expect(s.rail.filter((t) => t.engraving === 'cursed')).toHaveLength(1);
  });

  it('ask the figures: +1 Nudge on every spin, for the rest of the run', () => {
    const s = take(setup(), 'ask_figures').state;
    expect(nudgeFor(noHouseLuck(s))).toMatchObject({ total: 1, charms: 1 });
  });
});

describe('records', () => {
  it('Waltz in Green: +1 Nudge, and nights cost half again (rounded up)', () => {
    const s = withRecord(setup(), 'waltz_in_green');
    expect(nudgeFor(noHouseLuck(s)).total).toBe(1);
    expect([costOf(setup(), 'long'), costOf(s, 'long'), costOf(s, 'short')]).toEqual([7, 11, 5]);
  });

  it('Red Light Tango: ×2 on a red landing, ×0.5 on a black one, for every bet', () => {
    const s = withRecord(setup({ chips: { c1: 'even', c2: 'straight:2' } }), 'red_light_tango');
    expect(amounts(paysOn(s, 32))).toEqual([4]);
    expect(amounts(paysOn(s, 2))).toEqual([1, 18]);
  });

  it('Lullaby for Zero: no Devil and no Leans while it plays', () => {
    const lean = { ...setup(), debt: 3, leans: { debt: [{ at: 1, strength: 3 }], night: null } };
    const s = withRecord(lean, 'lullaby_for_zero');
    expect(upcomingLean(lean)).toBe(3);
    expect([upcomingLean(s), nudgeFor(s).lean, devilChanceFor(s)]).toEqual([0, 0, 0]);
    expect(devilChanceFor(lean)).toBeGreaterThan(0);
  });

  it('Overture of Excess: ×3, and a debt it plays during owes double, even if it stops', () => {
    let s = withRecord(setup({ chips: { c1: 'red' } }), 'overture_of_excess');
    expect(amounts(paysOn(s, 32))).toEqual([6]);
    s = play(s, { type: 'playRecord', id: null }).state;
    expect(owed(s)).toBe(120);
    s = play({ ...s, phase: 'nightOver', round: 3, deposited: 200 }, { type: 'endNight' }).state;
    expect(s.deposited).toBe(200 + 10 - 120); // the night's interest, then the doubled debt
    expect(owed(s)).toBe(400);
  });

  it('Funeral March: +2 tokens every night, chips pay ×0.75', () => {
    const s = withRecord(setup({ chips: { c1: 'straight:17' } }), 'funeral_march');
    expect(amounts(paysOn(s, 17))).toEqual([27]);
    const night = play({ ...s, phase: 'nightOver' }, { type: 'endNight' }).state;
    expect(night.tokens).toBe(s.tokens + 1 + 2);
  });

  it('Boogie-Woogie: +1 Stake per paying spin in a row (up to +2), gone on a miss', () => {
    let s = withRecord(setup({ chips: { c1: 'red' } }), 'boogie_woogie');
    s = spinOn(s, 32).state;
    s = spinOn(s, 32).state;
    expect(paysOn(s, 32).lines[0].factors.stake).toBe(3);
    s = spinOn(s, 32).state;
    expect(paysOn(s, 32).lines[0].factors.stake).toBe(3);
    s = spinOn(s, 2).state;
    expect(paysOn(s, 32).lines[0].factors.stake).toBe(1);
  });

  it("Nocturne: the night's last spin pays ×3", () => {
    const s = play(withRecord(setup({ chips: { c1: 'red' } }), 'nocturne'), { type: 'choosePackage', packageId: 'short' }).state;
    expect(amounts(paysOn(s, 32))).toEqual([2]);
    expect(amounts(paysOn({ ...s, spinsLeft: 1 }, 32))).toEqual([6]);
  });

  it('Carousel: Nudge that is there at all reaches a pocket further', () => {
    const s = withRecord(setup(), 'carousel');
    expect(nudgeFor(noHouseLuck(s)).total).toBe(0);
    const figures = take(s, 'ask_figures').state;
    expect(nudgeFor(noHouseLuck(figures))).toMatchObject({ total: 2, charms: 2 });
  });

  it('Static: +1 hook, and it will not stop while a talisman hangs on that hook', () => {
    let s = withRecord(setup({ rail: ['red_ribbon', 'horseshoe', 'matchbook', 'lucky_penny', 'crumpled_receipt', 'pawn_ticket'] }), 'static');
    expect(hooksFor(s)).toBe(7);
    s = grantTalisman(s, 'ledger');
    expect(act(s, { type: 'playRecord', id: null }).events[0].code).toBe('railFull');
  });

  it('only the record playing acts, and a record keeps its data between plays', () => {
    let s = withRecord(withRecord(setup({ chips: { c1: 'red' } }), 'boogie_woogie'), 'nocturne');
    expect(s.playing).toBe('nocturne');
    s = play(s, { type: 'playRecord', id: 'boogie_woogie' }).state;
    s = spinOn(s, 32).state;
    s = play(s, { type: 'playRecord', id: 'nocturne' }, { type: 'playRecord', id: 'boogie_woogie' }).state;
    expect(paysOn(s, 32).lines[0].factors.stake).toBe(2);
  });
});

describe('engravings', () => {
  it('the Cabinet engraves from the second debt only, about one offer in ten', () => {
    const at = (debt) => {
      const rng = new Rng([1, 2, 3, 4]);
      let n = 0;
      for (let i = 0; i < 2000; i++) n += rollTalismanSlots([], rng, debt).filter((o) => o.engraving).length;
      return n / 6000;
    };
    expect(at(1)).toBe(0);
    expect(at(2)).toBeGreaterThan(0.085);
    expect(at(2)).toBeLessThan(0.125);
  });

  it('a bought offer keeps its engraving; Keen +1 Stake and Sharp +1 Odds act after their talisman', () => {
    let s = setup({ chips: { c1: 'red' } });
    s = { ...s, tokens: 10, cabinet: { ...s.cabinet, slots: [{ kind: 'talisman', id: 'red_ribbon', sold: false, engraving: 'keen' }, ...s.cabinet.slots.slice(1)] } };
    s = play(s, { type: 'buy', slot: 0 }).state;
    expect(s.rail[0].engraving).toBe('keen');
    expect(railView(s)[0].engraving).toMatchObject({ name: 'Keen' });
    expect(paysOn(s, 32).lines[0].factors).toMatchObject({ stake: 3 });
    const sharp = { ...s, rail: [{ ...s.rail[0], engraving: 'sharp' }] };
    expect(paysOn(sharp, 32).lines[0].factors).toMatchObject({ stake: 2, oddsMult: 2 });
  });

  it("Echo: the spin's last payout pays again", () => {
    const s = setup({ rail: ['lucky_penny'], chips: { c1: 'red', c2: 'even' } });
    const echo = { ...s, rail: [{ ...s.rail[0], engraving: 'echo' }] };
    expect(paysOn(echo, 32).bonusCoins).toBe(2);
  });

  it('Restless: the first restock of each debt is free and does not raise the price', () => {
    let s = setup({ rail: ['red_ribbon'], coins: 0 });
    s = { ...s, rail: [{ ...s.rail[0], engraving: 'restless' }] };
    expect(cabinetView(s)).toMatchObject({ restockCost: 0, restockFree: true });
    s = play(s, { type: 'restock' }).state;
    expect(s.cabinet.paidRestocks).toBe(0);
    expect(act(s, { type: 'restock' }).events[0].code).toBe('noCoins');
  });

  it('Thrifty +3% interest, Gilt +2 tokens when a debt is paid, Cursed +0.6% Devil once he is live', () => {
    const base = setup({ rail: ['red_ribbon'] });
    const engraved = (e) => ({ ...base, rail: [{ ...base.rail[0], engraving: e }] });
    const night = play({ ...engraved('thrifty'), phase: 'nightOver', deposited: 1000 }, { type: 'endNight' });
    expect(night.events.find((e) => e.type === 'interest').rate).toBe(0.08);
    const paid = play({ ...engraved('gilt'), phase: 'nightOver', round: 3, deposited: 1000 }, { type: 'endNight' });
    expect(paid.events.some((e) => e.type === 'trigger' && e.src.as === 'gilt' && e.effect === 'tokens')).toBe(true);
    expect(devilChanceFor({ ...engraved('cursed'), debt: 3 })).toBeCloseTo(DEVIL.base + 0.006, 9);
    expect(devilChanceFor(engraved('cursed'))).toBe(0);
  });

  it('a Twin Mirrors copies the talisman, not its engraving', () => {
    const s = setup({ rail: ['twin_mirrors', 'red_ribbon'], chips: { c1: 'red' } });
    const keen = { ...s, rail: [s.rail[0], { ...s.rail[1], engraving: 'keen' }] };
    // Base 1, the mirror's copy +1, the ribbon +1, the ribbon's Keen +1 (no second Keen).
    expect(paysOn(keen, 32).lines[0].factors.stake).toBe(1 + 1 + 1 + 1);
  });
});

describe('saves', () => {
  it('a run with a deal, a boon, records and engravings round-trips', () => {
    let s = take(setup({ rail: ['red_ribbon'] }), 'feed_zero', 'black').state;
    s = withRecord(s, 'boogie_woogie');
    s = { ...s, rail: [{ ...s.rail[0], engraving: 'keen' }] };
    const back = deserializeRun(serializeRun(s));
    expect(back).toEqual(s);
  });

  it('a card the game no longer knows leaves the deal on load', () => {
    const open = dealt(setup(), ['stranger_tips', 'gone_card', 'cabinet_owes']);
    expect(deserializeRun(serializeRun(open)).oracle).toMatchObject({ cards: ['stranger_tips', 'cabinet_owes'], taken: null });
    const took = { ...open, oracle: { ...open.oracle, taken: 2 } };
    expect(deserializeRun(serializeRun(took)).oracle.taken).toBe(1);
    const gone = { ...open, oracle: { ...open.oracle, taken: 1 } };
    expect(oracleView(deserializeRun(serializeRun(gone)))).toMatchObject({ taken: -1, cards: [{ takeable: false }, { takeable: false }] });
  });
});
