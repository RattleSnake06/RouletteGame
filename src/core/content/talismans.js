import { add, format, gt, mul } from '../num.js';
import { neighbourIndex } from '../wheel.js';

// The first fifteen talismans (design doc 6.1, Phase 2). Each is data plus
// hooks; src/core/effects.js and payout.js decide when the hooks run.
//
//   rarity     common | uncommon | rare | legendary
//   tags       build families (the sim's bots and, later, the Almanac)
//   copyable   false: Twin Mirrors cannot copy it
//   copies     'right' for Twin Mirrors
//   init       () => instance data
//   charges    { max, refill: 'debt' } for Bell actives
//   bell       { targetOnly?, usable(ctx), ring(ctx) }
//   status     (data, state) => short line for the talisman's note
//   hooks      effect hooks; see the table in effects.js
//
// The array order is the Cabinet's pool order and part of determinism: append
// new talismans, never reorder.

const greenZero = (pocket) => pocket.color === 'green';

export const TALISMAN_LIST = [
  {
    id: 'red_ribbon',
    name: 'Red Ribbon',
    rarity: 'common',
    tags: ['colour'],
    text: 'Chips on Red: +1 Stake.',
    hooks: {
      chipStake(ctx) {
        if (ctx.bet.kind === 'red') ctx.addStake(1);
      },
    },
  },
  {
    id: 'horseshoe',
    name: 'Horseshoe',
    rarity: 'common',
    tags: ['inside'],
    text: 'Straight-ups: odds +12.',
    hooks: {
      chipOdds(ctx) {
        if (ctx.bet.kind === 'straight') ctx.addOdds(12);
      },
    },
  },
  {
    id: 'matchbook',
    name: 'Matchbook',
    rarity: 'common',
    tags: ['scaling', 'colour', 'outside'],
    text: 'A chip that wins gains +1 value until the night ends.',
    hooks: {
      chipPaid(ctx) {
        if (ctx.firstLineOfChip) ctx.addChipValue(1);
      },
    },
  },
  {
    id: 'lucky_penny',
    name: 'Lucky Penny',
    rarity: 'common',
    tags: ['economy', 'inside'],
    text: 'Each chip that loses refunds 1 coin.',
    hooks: {
      chipLost(ctx) {
        ctx.bonusCoins(1);
      },
    },
  },
  {
    id: 'crumpled_receipt',
    name: 'Crumpled Receipt',
    rarity: 'common',
    tags: ['tokens'],
    text: '+1 token at the end of every night.',
    hooks: {
      roundEnd(ctx) {
        ctx.gainTokens(1);
      },
    },
  },
  {
    id: 'pawn_ticket',
    name: 'Pawn Ticket',
    rarity: 'common',
    tags: ['economy'],
    text: 'The Cage pays 2% more interest.',
    hooks: {
      interestRate(ctx) {
        ctx.addRate(0.02);
      },
    },
  },
  {
    id: 'brass_knuckles',
    name: 'Brass Knuckles',
    rarity: 'uncommon',
    tags: ['inside'],
    text: 'Corner chips pay ×2.',
    hooks: {
      chipMult(ctx) {
        if (ctx.bet.kind === 'corner') ctx.mul(2);
      },
    },
  },
  {
    id: 'croupiers_rake',
    name: "Croupier's Rake",
    rarity: 'uncommon',
    tags: ['inside', 'wheel'],
    text: 'Straight-ups on the two pockets beside the result also pay, at ×¼.',
    hooks: {
      hits(ctx) {
        for (const step of [-1, 1]) {
          ctx.addHit({ pocketIndex: neighbourIndex(ctx.state.wheel, ctx.landing.pocketIndex, step), mult: 0.25, betKinds: ['straight'] });
        }
      },
    },
  },
  {
    id: 'ledger',
    name: 'Ledger',
    rarity: 'uncommon',
    tags: ['streaks', 'colour', 'outside', 'inside'],
    text: 'A number already seen this debt pays ×2.',
    status: (data, state) => {
      const seen = Object.keys(state.tally.debt.numbers).length;
      return `${seen} number${seen === 1 ? '' : 's'} seen this debt`;
    },
    hooks: {
      chipMult(ctx) {
        if (ctx.state.tally.debt.numbers[ctx.landing.number] > 0) ctx.mul(2);
      },
    },
  },
  {
    id: 'abacus',
    name: 'Abacus',
    rarity: 'uncommon',
    tags: ['outside', 'streaks'],
    text: 'Dozen and column chips: +1 Odds for each earlier hit on that dozen or column tonight.',
    status: (data, state) => {
      const { dozens, columns } = state.tally.round;
      return `dozens ${dozens.join('·')}, columns ${columns.join('·')}`;
    },
    hooks: {
      chipOdds(ctx) {
        const [kind, n] = ctx.bet.id.split(':');
        const counts = kind === 'dozen' ? ctx.state.tally.round.dozens : kind === 'column' ? ctx.state.tally.round.columns : null;
        if (counts && counts[n - 1] > 0) ctx.addOddsMult(counts[n - 1]);
      },
    },
  },
  {
    id: 'wheel_of_fortune',
    name: 'Wheel of Fortune',
    rarity: 'rare',
    tags: ['active', 'inside'],
    text: 'Bell, twice a debt: if the next spin pays nothing, the ball is thrown again.',
    copyable: false,
    charges: { max: 2, refill: 'debt' },
    status: (data, state, inst) => (state.armed.rethrow?.by === inst.uid ? 'armed for the next spin' : null),
    bell: {
      usable: (ctx) => ctx.charges > 0 && !ctx.state.armed.rethrow,
      ring(ctx) {
        ctx.spendCharge();
        ctx.armRethrow();
      },
    },
  },
  {
    id: 'glass_eye',
    name: 'Glass Eye',
    rarity: 'rare',
    tags: ['active'],
    text: 'Bell, once a debt: see where the next ball lands.',
    copyable: false,
    charges: { max: 1, refill: 'debt' },
    status: (data, state, inst) => {
      const f = state.foreseen;
      if (!f || f.by !== inst.uid) return null;
      const p = state.wheel.pockets[f.pocketIndex];
      return `sees ${p.number} ${p.color}`;
    },
    bell: {
      usable: (ctx) => ctx.charges > 0 && !ctx.state.foreseen,
      ring(ctx) {
        ctx.spendCharge();
        ctx.foresee();
      },
    },
  },
  {
    id: 'piggy_bank',
    name: 'Piggy Bank',
    rarity: 'rare',
    tags: ['active', 'economy'],
    text: 'Gains 1 coin each spin. Ring the Bell at it to smash it for twice what it holds.',
    copyable: false,
    init: () => ({ value: 0 }),
    status: (data) => `holds ${format(data.value)}`,
    bell: {
      // Smashing cannot be undone, so a plain ring never reaches the pig.
      targetOnly: true,
      usable: (ctx) => gt(ctx.self.value, 0),
      ring(ctx) {
        ctx.gainCoins(mul(ctx.self.value, 2));
        ctx.destroySelf();
      },
    },
    hooks: {
      afterSpin(ctx) {
        ctx.setData('value', add(ctx.self.value, 1));
      },
    },
  },
  {
    id: 'twin_mirrors',
    name: 'Twin Mirrors',
    rarity: 'legendary',
    tags: ['combo'],
    text: 'Copies the talisman to its right (not Bell abilities).',
    copies: 'right',
  },
  {
    id: 'house_key',
    name: 'House Key',
    rarity: 'legendary',
    tags: ['zero', 'inside'],
    text: 'When zero hits, every chip on the table wins.',
    hooks: {
      covers(ctx) {
        if (ctx.hit.primary && greenZero(ctx.hit.pocket)) ctx.cover();
      },
    },
  },
];
