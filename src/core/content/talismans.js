import { getBet } from '../bets.js';
import { devilLive } from '../devil.js';
import { ECONOMY, interestOn, owedFor } from '../economy.js';
import { interestRateFor, omen } from '../effects.js';
import { add, format, gt, mul, mulFloor } from '../num.js';
import { nudgeFor, upcomingLean } from '../nudge.js';
import { neighbourIndex } from '../wheel.js';

// The talismans (design doc 6.1): the first fifteen from Phase 2, the luck
// and Devil items of Phase 3, then twenty more for variety and combos. Each
// is data plus hooks; src/core/effects.js, payout.js, nudge.js, devil.js and
// widths.js decide when the hooks run.
//
//   rarity     common | uncommon | rare | legendary | cursed
//   cursed     true: never offered by the Cabinet, and it cannot be sold
//   inCabinet  false: never offered (cursed ones come from black cards, Phase 4)
//   tags       build families (the sim's bots and, later, the Almanac)
//   copyable   false: Twin Mirrors cannot copy it
//   echoable   false: a Tuning Fork beside it has nothing to repeat (its effect
//              cannot happen twice: a ward, a threshold, a Bell's arming)
//   copies     'right' for Twin Mirrors
//   echoes     true for the Tuning Fork: the talisman to its left acts again
//   instant    true: acts when bought and never takes a hook (Lost Wallet)
//   init       () => instance data
//   charges    { max, refill: 'debt' } for Bell actives
//   bell       { targetOnly?, usable(ctx), ring(ctx) }
//   status     (data, state) => short line for the talisman's note
//   hooks      effect hooks; see the table in effects.js
//
// The array order is the Cabinet's pool order and part of determinism: append
// new talismans, never reorder.

const greenZero = (pocket) => pocket.color === 'green';
const asleep = (state) => (devilLive(state) ? null : 'The Devil is not here yet.');
const hasStraight = (state) => state.chips.some((c) => state.placements[c.id] && getBet(state.placements[c.id]).kind === 'straight');
const isEven = (pocket) => Number.isInteger(pocket.number) && pocket.number !== 0 && pocket.number % 2 === 0;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** The last spin, unless the Devil took it (a burned number counts for nothing). */
const lastSpin = (state) => {
  const h = state.history[state.history.length - 1];
  return h && !h.devil ? h : null;
};
const half = (n) => (n >= 1 && n <= 18 ? 'low' : n >= 19 ? 'high' : null);
/** Names the night under way, so state kept for one night goes stale at dawn by itself. */
const tonight = (state) => `${state.debt}.${state.round}`;
const CAT = { winners: 3, nights: 3 };
/** What the Beckoning Cat would pay: three nights' interest on the Cage, at tonight's rate. */
const catPay = (state) => mul(interestOn(state.deposited, interestRateFor(state, ECONOMY.interestRate)), CAT.nights);
const MOUSETRAP_MAX = 2;
const ROD = { charges: 2, nudge: 4 };
const WEATHERVANE = 2;
const WIND_UP_KEY = 3; // pity after this many misses in a row
const HAMSA = 2;
const mousetrap = (state) => Math.min(MOUSETRAP_MAX, state.missStreak);
/** Pearls strung tonight (a string from an earlier night has broken). */
const pearls = (data, state) => (data.strung?.night === tonight(state) ? data.strung.n : 0);
const CLOVER = { chance: 0.25, nudge: 2, blooms: 6 };
const inBloom = (state) => omen(state, 'four_leaf_clover') < CLOVER.chance;
/** The Black Cat crosses your path on every 13th spin of the run. */
const catCrosses = (state) => (state.stats.spins + 1) % 13 === 0;

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
    echoable: false,
    hooks: {
      covers(ctx) {
        if (ctx.hit.primary && greenZero(ctx.hit.pocket)) ctx.cover();
      },
    },
  },
  // --- Phase 3: luck and the Devil (append only) ------------------------------
  {
    id: 'rabbits_foot',
    name: "Rabbit's Foot",
    rarity: 'uncommon',
    tags: ['luck'],
    text: '+1 Nudge on every spin.',
    hooks: {
      nudge(ctx) {
        ctx.addNudge(1);
      },
    },
  },
  {
    id: 'pocket_watch',
    name: 'Pocket Watch',
    rarity: 'common',
    tags: ['luck', 'timing'],
    text: 'The first spin of each night: +3 Nudge.',
    hooks: {
      nudge(ctx) {
        if (ctx.spin.ofNight === 1) ctx.addNudge(3);
      },
    },
  },
  {
    id: 'salt_cellar',
    name: 'Salt Cellar',
    rarity: 'common',
    tags: ['safety'],
    text: "The Devil's chance −0.5%.",
    status: (data, state) => asleep(state),
    hooks: {
      devilChance(ctx) {
        ctx.addChance(-0.005);
      },
    },
  },
  {
    id: 'evil_eye',
    name: 'Evil Eye',
    rarity: 'uncommon',
    tags: ['safety'],
    text: "Halves the Devil's chance.",
    status: (data, state) => asleep(state),
    hooks: {
      devilChance(ctx) {
        ctx.mulChance(0.5);
      },
    },
  },
  {
    id: 'compass',
    name: 'Compass',
    rarity: 'rare',
    tags: ['luck', 'wheel'],
    text: '+3 Nudge, but the ball only hops clockwise.',
    hooks: {
      nudge(ctx) {
        ctx.addNudge(3);
        ctx.clockwiseOnly();
      },
    },
  },
  {
    id: 'lodestone',
    name: 'Lodestone',
    rarity: 'common',
    tags: ['luck', 'inside'],
    text: '+1 Nudge, but the ball only hops onto straight-up chips.',
    status: (data, state) => (hasStraight(state) ? null : 'No straight-up chip to pull toward.'),
    hooks: {
      nudge(ctx) {
        ctx.addNudge(1);
        ctx.straightOnly();
      },
    },
  },
  {
    id: 'bone_dice',
    name: 'Bone Dice',
    rarity: 'cursed',
    cursed: true,
    inCabinet: false,
    tags: ['devil'],
    text: "Winning chips +4 Stake. The Devil's chance +2%.",
    hooks: {
      chipStake(ctx) {
        ctx.addStake(4);
      },
      devilChance(ctx) {
        ctx.addChance(0.02);
      },
    },
  },
  {
    id: 'black_candle',
    name: 'Black Candle',
    rarity: 'cursed',
    cursed: true,
    inCabinet: false,
    tags: ['devil', 'luck', 'timing'],
    text: 'Leans are twice as strong. No pity.',
    hooks: {
      nudge(ctx) {
        if (ctx.lean > 0) ctx.addNudge(ctx.lean);
        ctx.noPity();
      },
    },
  },

  // --- More talismans: variety and combos (append only) -----------------------
  {
    id: 'tuning_fork',
    name: 'Tuning Fork',
    rarity: 'rare',
    tags: ['combo'],
    text: 'Triggers the talisman to its left again (not Bell abilities or one-time effects).',
    echoes: true,
    copyable: false,
  },
  {
    id: 'brass_scales',
    name: 'Brass Scales',
    rarity: 'common',
    tags: ['even', 'wheel'],
    text: 'Even pockets are twice as wide, so even numbers land more often.',
    hooks: {
      widths(ctx) {
        ctx.widen(isEven, 1);
      },
    },
  },
  {
    id: 'string_of_pearls',
    name: 'String of Pearls',
    rarity: 'uncommon',
    tags: ['even', 'scaling'],
    text: 'Chips on Even: odds +1, and +1 more for every even number that lands tonight.',
    // The string breaks at dawn, like a Matchbook's flame: it is kept with the
    // night it was strung, so a copy that sat out the dawn breaks too.
    init: () => ({ strung: null }),
    status: (data, state) => `${plural(pearls(data, state), 'pearl')} strung tonight: Even odds +${1 + pearls(data, state)}`,
    hooks: {
      chipOdds(ctx) {
        if (ctx.bet.kind === 'even') ctx.addOdds(1 + pearls(ctx.self, ctx.state));
      },
      afterSpin(ctx) {
        const n = ctx.result.devil ? 0 : ctx.result.balls.filter(isEven).length;
        if (n) ctx.setData('strung', { night: tonight(ctx.state), n: pearls(ctx.self, ctx.state) + n });
      },
    },
  },
  {
    id: 'wind_up_key',
    name: 'Wind-Up Key',
    rarity: 'common',
    tags: ['luck', 'inside'],
    text: `Pity starts after ${WIND_UP_KEY} misses in a row, not 5.`,
    echoable: false,
    hooks: {
      nudge(ctx) {
        ctx.pityAfter(WIND_UP_KEY);
      },
    },
  },
  {
    id: 'hamsa',
    name: 'Hamsa',
    rarity: 'common',
    tags: ['luck', 'timing'],
    text: `The night's last spin: +${HAMSA} Nudge.`,
    hooks: {
      nudge(ctx) {
        if (ctx.spin.last) ctx.addNudge(HAMSA);
      },
    },
  },
  {
    id: 'beckoning_cat',
    name: 'Beckoning Cat',
    rarity: 'uncommon',
    tags: ['economy', 'outside'],
    text: "Once a night, when 3 or more chips win on one spin: coins worth 3 nights' interest on the Cage.",
    init: () => ({ paid: null }),
    status: (data, state) => {
      if (data.paid === tonight(state)) return 'Paid tonight. It beckons again tomorrow.';
      return gt(catPay(state), 0) ? `would pay ${format(catPay(state))}` : 'Nothing in the Cage to earn on.';
    },
    hooks: {
      // A payout hook, so Nudge counts its coins when it picks a pocket.
      spinPaid(ctx) {
        if (ctx.winners < CAT.winners || ctx.self.paid === tonight(ctx.state)) return;
        const coins = catPay(ctx.state);
        if (!gt(coins, 0)) return;
        ctx.bonusCoins(coins);
        ctx.setData('paid', tonight(ctx.state));
      },
    },
  },
  {
    id: 'grandmothers_purse',
    name: "Grandmother's Purse",
    rarity: 'common',
    tags: ['economy'],
    text: 'The Cage pays 12% more interest, 2% less each night. It crumbles when empty.',
    init: () => ({ rate: 0.12 }),
    status: (data) => `+${Math.round(data.rate * 100)}% tonight`,
    hooks: {
      interestRate(ctx) {
        if (ctx.self.rate > 0) ctx.addRate(ctx.self.rate);
      },
      roundEnd(ctx) {
        const rate = Math.round((ctx.self.rate - 0.02) * 1e6) / 1e6;
        if (rate <= 0) ctx.destroySelf('crumbled');
        else ctx.setData('rate', rate);
      },
    },
  },
  {
    id: 'lost_wallet',
    name: 'Lost Wallet',
    rarity: 'common',
    tags: ['economy'],
    text: 'Needs no hook. When bought, it holds coins worth a tenth of this debt.',
    instant: true,
    copyable: false,
    hooks: {
      purchased(ctx) {
        if (ctx.isSelf) ctx.gainCoins(mulFloor(owedFor(ctx.state.debt), 0.1));
      },
    },
  },
  {
    id: 'magpie',
    name: 'Magpie',
    rarity: 'uncommon',
    tags: ['tokens', 'scaling'],
    text: 'Winning chips: +1 Stake for every 8 tokens you hold.',
    status: (data, state) => `+${Math.floor(state.tokens / 8)} Stake with ${plural(state.tokens, 'token')}`,
    hooks: {
      chipStake(ctx) {
        const n = Math.floor(ctx.state.tokens / 8);
        if (n > 0) ctx.addStake(n);
      },
    },
  },
  {
    id: 'domino',
    name: 'Domino',
    rarity: 'uncommon',
    tags: ['outside', 'colour'],
    text: 'Each winning chip: +1 Stake for every chip that paid before it this spin.',
    hooks: {
      chipStake(ctx) {
        if (ctx.paidBefore > 0) ctx.addStake(ctx.paidBefore);
      },
    },
  },
  {
    id: 'four_leaf_clover',
    name: 'Four-Leaf Clover',
    rarity: 'common',
    tags: ['luck'],
    text: `Blooms on about 1 spin in 4, shown before you bet: +${CLOVER.nudge} Nudge. Wilts after ${CLOVER.blooms} blooms.`,
    init: () => ({ blooms: 0 }),
    status: (data, state) => `${inBloom(state) ? 'In bloom for the next spin. ' : ''}${plural(CLOVER.blooms - data.blooms, 'bloom')} left`,
    hooks: {
      nudge(ctx) {
        if (inBloom(ctx.state)) ctx.addNudge(CLOVER.nudge);
      },
      afterSpin(ctx) {
        if (!inBloom(ctx.state)) return;
        const blooms = ctx.self.blooms + 1;
        if (blooms >= CLOVER.blooms) ctx.destroySelf('wilted');
        else ctx.setData('blooms', blooms);
      },
    },
  },
  {
    id: 'holy_water',
    name: 'Holy Water',
    rarity: 'uncommon',
    tags: ['safety'],
    text: 'The first time the Devil fires, he is turned away. The vial shatters.',
    echoable: false,
    status: (data, state) => asleep(state),
    hooks: {
      ward(ctx) {
        ctx.destroySelf('shattered');
      },
    },
  },
  {
    id: 'dowsing_rod',
    name: 'Dowsing Rod',
    rarity: 'uncommon',
    tags: ['active', 'luck'],
    text: `Bell, ${['', 'once', 'twice', 'three times'][ROD.charges]} a debt: +${ROD.nudge} Nudge on the next spin.`,
    copyable: false,
    echoable: false,
    charges: { max: ROD.charges, refill: 'debt' },
    init: () => ({ armed: false }),
    status: (data, state) => {
      if (!data.armed) return nudgeFor(state).blocked ? 'still: the Black Cat crosses your path on the next spin' : null;
      return nudgeFor(state).blocked ? `twitching: +${ROD.nudge} Nudge once the Black Cat has crossed` : `twitching: +${ROD.nudge} Nudge on the next spin`;
    },
    bell: {
      // Not on a spin with no Nudge at all: the twitch would be lost.
      usable: (ctx) => ctx.charges > 0 && !ctx.self.armed && !nudgeFor(ctx.state).blocked,
      ring(ctx) {
        ctx.spendCharge();
        ctx.setData('armed', true);
      },
    },
    hooks: {
      nudge(ctx) {
        if (ctx.self.armed) ctx.addNudge(ROD.nudge);
      },
      // A Black Cat crossing cancels every Nudge: the twitch waits for the next spin.
      afterSpin(ctx) {
        if (ctx.self.armed && !ctx.result.luck.blocked) ctx.setData('armed', false);
      },
    },
  },
  {
    id: 'mousetrap',
    name: 'Mousetrap',
    rarity: 'uncommon',
    tags: ['inside', 'streaks'],
    text: `Winning chips: +1 Stake for each miss in a row before the win, up to +${MOUSETRAP_MAX}.`,
    status: (data, state) => (mousetrap(state) ? `set: +${mousetrap(state)} Stake` : 'not set yet'),
    hooks: {
      chipStake(ctx) {
        if (mousetrap(ctx.state) > 0) ctx.addStake(mousetrap(ctx.state));
      },
    },
  },
  {
    id: 'weathervane',
    name: 'Weathervane',
    rarity: 'uncommon',
    tags: ['timing', 'luck'],
    text: `On a Lean's spin, chips pay ×${WEATHERVANE}.`,
    status: (data, state) => (upcomingLean(state) > 0 ? 'turning: the next spin is a Lean' : null),
    hooks: {
      chipMult(ctx) {
        if (upcomingLean(ctx.state) > 0) ctx.mul(WEATHERVANE);
      },
    },
  },
  {
    id: 'seesaw',
    name: 'Seesaw',
    rarity: 'uncommon',
    tags: ['outside'],
    text: 'Chips on 1–18 or 19–36 pay ×3 if the last spin landed in the other half.',
    status: (data, state) => {
      const side = lastSpin(state) && half(lastSpin(state).number);
      return side ? `tips toward ${side === 'low' ? '19–36' : '1–18'}` : 'level';
    },
    hooks: {
      chipMult(ctx) {
        const was = lastSpin(ctx.state) && half(lastSpin(ctx.state).number);
        if (was && (ctx.bet.kind === 'low' || ctx.bet.kind === 'high') && ctx.bet.kind !== was) ctx.mul(3);
      },
    },
  },
  {
    id: 'ouroboros',
    name: 'Ouroboros',
    rarity: 'legendary',
    tags: ['jackpot', 'inside', 'streaks'],
    text: 'The same number twice in a row: chips pay ×2.',
    status: (data, state) => (lastSpin(state) ? `waits for ${lastSpin(state).number}` : 'waits for a first number'),
    hooks: {
      chipMult(ctx) {
        if (lastSpin(ctx.state)?.number === ctx.landing.number) ctx.mul(2);
      },
    },
  },
  {
    id: 'thirteen_ball',
    name: 'Thirteen Ball',
    rarity: 'rare',
    tags: ['jackpot', 'inside'],
    text: 'When 13 lands, chips pay ×2, and Nudge never moves the ball off 13.',
    hooks: {
      nudge(ctx) {
        ctx.anchor(13);
      },
      chipMult(ctx) {
        if (ctx.landing.number === 13) ctx.mul(2);
      },
    },
  },
  {
    id: 'black_cat',
    name: 'Black Cat',
    rarity: 'common',
    tags: ['colour'],
    text: 'Chips on Black pay ×2. Every 13th spin it crosses your path: no Nudge at all.',
    status: (data, state) => {
      const k = 13 - (state.stats.spins % 13);
      return k === 1 ? 'crosses your path on the next spin' : `crosses your path in ${k} spins`;
    },
    hooks: {
      chipMult(ctx) {
        if (ctx.bet.kind === 'black') ctx.mul(2);
      },
      nudge(ctx) {
        if (catCrosses(ctx.state)) ctx.noNudge();
      },
    },
  },
  {
    id: 'golden_ball',
    name: 'Golden Ball',
    rarity: 'legendary',
    tags: ['risk'],
    text: "Chips pay ×3. The Devil's chance +3%.",
    hooks: {
      chipMult(ctx) {
        ctx.mul(3);
      },
      devilChance(ctx) {
        ctx.addChance(0.03);
      },
    },
  },
  {
    id: 'number_punches',
    name: 'Number Punches',
    rarity: 'legendary',
    tags: ['active', 'wheel'],
    text: 'Bell, once a debt: re-stamp up to 3 pockets with any numbers you like.',
    charges: { max: 1, refill: 'debt' },
    bell: {
      // You choose what it stamps, so only a ring at its own tag wakes it.
      targetOnly: true,
      work: { op: 'stamp', on: 'pocket', picks: 3 },
      usable: (ctx) => ctx.charges > 0,
      ring(ctx) {
        ctx.spendCharge();
        for (const t of ctx.targets) ctx.work(t);
      },
    },
  },
];
