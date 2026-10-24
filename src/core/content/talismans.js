import { SPECIAL_KINDS, getBet, isSpecial, tableCell } from '../bets.js';
import { devilLive } from '../devil.js';
import { ECONOMY, interestOn, owedFor, spinCostFor } from '../economy.js';
import { interestRateFor, omen } from '../effects.js';
import { add, format, gt, mul, mulFloor } from '../num.js';
import { nextSpin, nudgeFor, upcomingLean } from '../nudge.js';
import { hashSeed } from '../rng.js';
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
// Plain words for a share of the pay and a widening (the text follows the tuning).
const share = (x) => (x === 0.5 ? 'half' : x === 0.25 ? 'a quarter' : `×${x}`);
const grows = (x) => (x === 0.5 ? 'grows half a pocket wider' : x === 1 ? 'grows a whole pocket wider' : `grows wider by ${Math.round(x * 100)}% of a pocket`);
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

// Phase 7 (doc 6.1): the drafts not yet built, and what each build family
// lacked at some rarity. Some wait for a lock of the Vault or a feat in the
// Almanac (`unlock`, decision 29).
const P7 = {
  chalk: 2, // spins' worth of coins for a ball on an odd number
  wishbone: 3, // spins a night that pay nothing and give their cost back
  hourglass: 2, // spins added to every night
  tally: 2, // Tally Stick: Stake on a bet that won last spin
  cookie: 3, // Fortune Cookie: straight-ups on the named number ×
  shard: 0.5, // Mirror Shard: the pocket opposite pays at ×
  tableMap: 0.5, // Table Map: a split or corner beside the number pays at ×
  ivory: 0.5, // Ivory Ball: its ball's lines ×
  bag: { balls: 2, mult: 0.5 }, // Bag of Marbles: balls, each paying ×
  coals: { step: 0.5, max: 4 }, // Hot Coals: + per win in a row, up to ×
  chain: 3, // Surveyor's Chain: inside bets ×
  thread: 2, // Green Thread: Stake on bets that cover zero
  zero: { tokens: 3, spins: 3 }, // Zero's Coin, on a green pocket
  rose: 2, // Rose Brooch: a colour that came up last spin ×
  brimstone: { mult: 2, devil: 0.01 },
  metronome: { every: 4, nudge: 2 },
  loaded: 0.5, // Loaded Wheel: every red pocket + this wide
  glove: 1.5, // Croupier's Glove: sector chips ×
  snake: 2, // Snakeskin: Snake chips + Stake
};// The builds pass (decision 32): the Pyre, and what each build lacked.
const P8 = {
  kindling: 2, // tokens when sold
  urnMax: 4, // Funeral Urn: +1 Stake per talisman sold, up to
  pyre: 0.5, // The Pyre: +× per talisman sold or used up
  tooth: 20, // Gold Tooth: chips ×(1 + tokens ÷ this)
  savings: { step: 0.01, max: 5 }, // Savings Book: +1% per debt paid, up to 5
  calendar: 3, // Pocket Calendar: the marked spin pays ×
  handBell: 1, // charges for the leftmost Bell talisman each debt
  dice: 2, // Pair of Dice: two balls on one colour, chips ×
};
// The weak builds' multipliers (decision 33, doc 6.8).
const P9 = { carillon: 1, jar: 0.5, clock: 0.5 };
const carillonMult = (state) => 1 + P9.carillon * (state.debtRings ?? 0);
/** How many different racetrack bets have chips on them (the Tote Board). */
export const racetrackBets = (state) => new Set(Object.values(state.placements ?? {}).filter((id) => id && isSpecial(getBet(id).kind))).size;
const jarMult = (wait) => 1 + P9.jar * wait;
const playedTonight = (self, state) => (self.clock?.night === tonight(state) ? self.clock.played : 0);
const clockMult = (played) => 1 + P9.clock * played;
const burned = (state) => (state.stats.talismansSold ?? 0) + (state.stats.talismansGone ?? 0);
const pyreMult = (state) => 1 + P8.pyre * burned(state);
const toothMult = (state) => 1 + state.tokens / P8.tooth;
/** The spin of tonight the Pocket Calendar marks (from 1), once the night's spins are known. */
export function calendarSpin(state) {
  const n = state.spinsTonight ?? 0;
  if (!n) return null;
  return 1 + Math.floor((hashSeed(`${state.seed}|${state.debt}|${state.round}|pocket_calendar`)[0] / 4294967296) * n);
}
/** Two balls this spin on the same colour (red or black). */
const sameColour = (pockets) => ['red', 'black'].some((c) => pockets.filter((p) => p.color === c).length >= 2);

const SECTOR_KINDS = ['voisins', 'tiers', 'orphelins', 'jeuZero', 'finale'];
const INSIDE_LINES = ['split', 'street', 'corner', 'sixLine'];
const isGreenNumber = (pocket) => pocket.color === 'green' && pocket.number !== null;
const isOdd = (n) => Number.isInteger(n) && n >= 1 && n <= 36 && n % 2 === 1;
/** Two numbers whose cells share an edge on the table. */
function touchOnTable(a, b) {
  if (!(a >= 1 && a <= 36 && b >= 1 && b <= 36)) return false;
  const ca = tableCell(a);
  const cb = tableCell(b);
  return Math.abs(ca.col - cb.col) + Math.abs(ca.row - cb.row) === 1;
}
/** The Fortune Cookie's number for the next spin: fixed before you bet. */
export const cookieNumber = (state) => Math.floor(omen(state, 'fortune_cookie') * 37);
const coalsMult = (streak) => Math.min(P7.coals.max, 1 + P7.coals.step * streak);

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
    text: 'Straight-up chips pay 12 more (48 instead of 36).',
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
    text: 'Each time a chip wins, it gains +1 value until the night ends.',
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
    text: 'Each chip that loses gives back 1 coin.',
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
    text: 'Straight-up chips on the two pockets next to where the ball lands also win, at a quarter of the pay.',
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
    text: 'When the ball lands on a number that already came up this debt, chips pay ×2.',
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
    text: 'Dozen and column chips get +1 Odds for each time that dozen or column has already won tonight.',
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
    text: 'Ring the Bell (twice a debt): if the next spin pays nothing, the ball is thrown again.',
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
    text: 'Ring the Bell (once a debt): see where the next ball will land before you bet.',
    copyable: false,
    charges: { max: 1, refill: 'debt' },
    status: (data, state, inst) => {
      const f = state.foreseen;
      if (!f || f.by !== inst.uid) return null;
      const p = state.wheel.pockets[f.pocketIndex];
      return p.number === null ? 'sees a blank pocket' : `sees ${p.number} ${p.color}`;
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
    text: 'Saves 1 coin every spin. Ring the Bell on it to break it open for twice what it holds.',
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
    text: 'Copies the talisman to its right (but not Bell abilities).',
    copies: 'right',
  },
  {
    id: 'house_key',
    name: 'House Key',
    rarity: 'legendary',
    tags: ['zero', 'inside'],
    text: 'When the ball lands on zero, every chip on the table wins.',
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
    text: 'Lowers the Devil’s chance by 0.5%.',
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
    text: 'Cuts the Devil’s chance in half.',
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
    text: '+3 Nudge, but the ball can only hop clockwise.',
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
    text: '+1 Nudge, but the ball can only hop onto pockets that have a straight-up chip.',
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
    text: 'Winning chips get +4 Stake. Raises the Devil’s chance by 2%.',
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
    text: 'Leans give twice the Nudge. You never get pity.',
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
    text: 'The talisman to its left works twice (but not Bell abilities or one-time effects).',
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
    text: 'Chips on Even pay 1 more, plus 1 more for every even number that has landed tonight.',
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
    text: `Pity starts after ${WIND_UP_KEY} misses in a row instead of 5.`,
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
    text: 'Once a night, when 3 or more chips win on the same spin: coins equal to 3 nights of interest on what you have banked.',
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
    text: 'The Cage pays 12% more interest, 2% less each night. At 0% the purse is used up.',
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
    text: 'Needs no hook. When bought, it gives you coins equal to a tenth of this debt.',
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
    text: 'Winning chips get +1 Stake for every 8 tokens you hold.',
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
    text: 'Each winning chip gets +1 Stake for every chip that already paid this spin.',
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
    text: `On about 1 spin in 4 it blooms (you see it before you bet): +${CLOVER.nudge} Nudge on that spin. Used up after ${CLOVER.blooms} blooms.`,
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
    text: 'Turns the Devil away the first time he fires, then breaks.',
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
    text: `Ring the Bell (${['', 'once', 'twice', 'three times'][ROD.charges]} a debt): +${ROD.nudge} Nudge on the next spin.`,
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
    text: `Winning chips get +1 Stake for each spin in a row that paid nothing before the win (up to +${MOUSETRAP_MAX}).`,
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
    text: `On a Lean spin, chips pay ×${WEATHERVANE}.`,
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
    text: 'When the same number comes up twice in a row, chips pay ×2.',
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
    text: 'Chips pay ×3. Raises the Devil’s chance by 3%.',
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
    text: 'Ring the Bell (once a debt): change the numbers on up to 3 pockets to any numbers you like.',
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
  },  // --- Phase 7 (doc 6.1): the drafts, and every family at every rarity ------
  {
    id: 'chalk_stub',
    name: 'Chalk Stub',
    rarity: 'common',
    tags: ['economy'],
    text: `Whenever a ball lands on an odd number, you get coins equal to the cost of ${P7.chalk} spins.`,
    hooks: {
      ballLanded(ctx) {
        if (isOdd(ctx.landing.number)) ctx.bonusCoins(mul(spinCostFor(ctx.state.debt), P7.chalk));
      },
    },
  },
  {
    id: 'wishbone',
    name: 'Wishbone',
    rarity: 'common',
    tags: ['economy', 'safety'],
    text: `The first ${P7.wishbone} spins each night that pay nothing give back what the spin cost.`,
    status: (data, state) => {
      const left = P7.wishbone - (data.night === tonight(state) ? data.snaps ?? 0 : 0);
      return left ? `${left} left tonight.` : 'Snapped tonight.';
    },
    hooks: {
      spinPaid(ctx) {
        if (ctx.winners) return;
        const snaps = ctx.self.night === tonight(ctx.state) ? ctx.self.snaps ?? 0 : 0;
        if (snaps >= P7.wishbone) return;
        ctx.bonusCoins(spinCostFor(ctx.state.debt));
        ctx.setData('night', tonight(ctx.state));
        ctx.setData('snaps', snaps + 1);
      },
    },
  },
  {
    id: 'mirror_shard',
    name: 'Mirror Shard',
    rarity: 'uncommon',
    tags: ['wheel'],
    text: `The pocket directly across the wheel from where the ball lands also wins, at ${share(P7.shard)} pay.`,
    hooks: {
      hits(ctx) {
        const n = ctx.state.wheel.pockets.length;
        ctx.addHit({ pocketIndex: neighbourIndex(ctx.state.wheel, ctx.landing.pocketIndex, Math.floor(n / 2)), mult: P7.shard });
      },
    },
  },
  {
    id: 'hourglass',
    name: 'Hourglass',
    rarity: 'uncommon',
    tags: ['tempo', 'economy'],
    text: `+${P7.hourglass} spins every night you play.`,
    hooks: {
      nightSpins(ctx) {
        ctx.addSpins(P7.hourglass);
      },
    },
  },
  {
    id: 'saints_medal',
    name: 'Saint’s Medal',
    rarity: 'uncommon',
    tags: ['zero', 'colour'],
    text: 'Chips on Red and Black get +1 Stake, and a green zero counts as both red and black.',
    hooks: {
      chipStake(ctx) {
        if (ctx.bet.kind === 'red' || ctx.bet.kind === 'black') ctx.addStake(1);
      },
      covers(ctx) {
        if ((ctx.bet.kind === 'red' || ctx.bet.kind === 'black') && isGreenNumber(ctx.hit.pocket)) ctx.cover();
      },
    },
  },
  {
    id: 'fortune_cookie',
    name: 'Fortune Cookie',
    rarity: 'uncommon',
    tags: ['inside', 'luck'],
    text: `Each spin it names a number (you see it before you bet): straight-up chips on it pay ×${P7.cookie}.`,
    status: (data, state) => `The next spin’s number: ${cookieNumber(state)}.`,
    hooks: {
      chipMult(ctx) {
        if (ctx.bet.kind === 'straight' && ctx.bet.numbers[0] === cookieNumber(ctx.state)) ctx.mul(P7.cookie);
      },
    },
  },
  {
    id: 'ivory_ball',
    name: 'Ivory Ball',
    rarity: 'rare',
    tags: ['multi'],
    text: `Throws a second ball every spin. It pays ${share(P7.ivory)}.`,
    hooks: {
      balls(ctx) {
        ctx.addBall({ mult: P7.ivory });
      },
    },
  },
  {
    id: 'gilders_knife',
    name: 'Gold Brush',
    rarity: 'rare',
    tags: ['wheel'],
    unlock: { feat: 'platinum' },
    text: 'Once a night, paints the pocket the ball lands in gold: chips that win there pay ×2. Painted gold again, a pocket turns platinum (×3).',
    status: (data, state) => (data.night === tonight(state) ? 'Used tonight.' : 'Ready tonight.'),
    hooks: {
      afterSpin(ctx) {
        if (ctx.self.night === tonight(ctx.state) || ctx.result.devil) return;
        if (ctx.work({ op: 'gild' }, ctx.result.balls[0].pocketId)) ctx.setData('night', tonight(ctx.state));
      },
    },
  },
  {
    id: 'snakeskin',
    name: 'Snakeskin',
    rarity: 'rare',
    tags: ['special', 'outside'],
    unlock: { lock: 1 },
    opens: ['snake'],
    text: `Opens the Snake bet on the racetrack. Snake chips get +${P7.snake} Stake.`,
    hooks: {
      chipStake(ctx) {
        if (ctx.bet.kind === 'snake') ctx.addStake(P7.snake);
      },
    },
  },
  {
    id: 'croupiers_glove',
    name: 'Croupier’s Glove',
    rarity: 'rare',
    tags: ['special', 'wheel'],
    unlock: { lock: 1 },
    opens: SECTOR_KINDS,
    text: `Opens the racetrack's sector bets (Voisins, Tiers, Orphelins, Jeu Zéro) and the Finales. Their chips pay ×${P7.glove}.`,
    hooks: {
      chipMult(ctx) {
        if (SECTOR_KINDS.includes(ctx.bet.kind)) ctx.mul(P7.glove);
      },
    },
  },
  {
    id: 'table_map',
    name: 'Table Map',
    rarity: 'rare',
    tags: ['inside'],
    unlock: { feat: 'a_wheel_of_your_own' },
    text: `Splits and corners also win, at ${share(P7.tableMap)} pay, when the ball lands on a number next to them on the felt.`,
    hooks: {
      covers(ctx) {
        if (ctx.bet.kind !== 'split' && ctx.bet.kind !== 'corner') return;
        const n = ctx.hit.pocket.number;
        if (ctx.bet.numbers.some((m) => touchOnTable(m, n))) ctx.cover(P7.tableMap);
      },
    },
  },
  {
    id: 'metronome',
    name: 'Metronome',
    rarity: 'legendary',
    tags: ['luck', 'timing'],
    unlock: { feat: 'step_out' },
    text: `Every ${P7.metronome.every}th spin of a night: +${P7.metronome.nudge} Nudge.`,
    hooks: {
      nudge(ctx) {
        if (ctx.spin.ofNight && ctx.spin.ofNight % P7.metronome.every === 0) ctx.addNudge(P7.metronome.nudge);
      },
    },
  },
  {
    id: 'loaded_wheel',
    name: 'Loaded Wheel',
    rarity: 'legendary',
    tags: ['colour', 'wheel'],
    unlock: { feat: 'out_of_the_red' },
    text: `When bought, every red pocket ${grows(P7.loaded)} for the rest of the run, so red lands more often.`,
    hooks: {
      purchased(ctx) {
        if (ctx.isSelf) ctx.widenPockets((p) => p.color === 'red', P7.loaded);
      },
    },
  },
  {
    id: 'rose_brooch',
    name: 'Rose Brooch',
    rarity: 'rare',
    tags: ['colour', 'streaks'],
    unlock: { feat: 'a_thousand' },
    text: `Chips on Red or Black pay ×${P7.rose} when their colour came up last spin.`,
    hooks: {
      chipMult(ctx) {
        const k = ctx.bet.kind;
        if ((k === 'red' || k === 'black') && lastSpin(ctx.state)?.color === k) ctx.mul(P7.rose);
      },
    },
  },
  {
    id: 'surveyors_chain',
    name: 'Surveyor’s Chain',
    rarity: 'legendary',
    tags: ['inside'],
    unlock: { feat: 'bare_hands' },
    text: `Split, street, corner and six-line chips pay ×${P7.chain}.`,
    hooks: {
      chipMult(ctx) {
        if (INSIDE_LINES.includes(ctx.bet.kind)) ctx.mul(P7.chain);
      },
    },
  },
  {
    id: 'tally_stick',
    name: 'Tally Stick',
    rarity: 'common',
    tags: ['streaks'],
    text: `A chip on a bet that won last spin gets +${P7.tally} Stake.`,
    hooks: {
      chipStake(ctx) {
        if (ctx.state.lastSpin?.wins?.some((w) => w.betId === ctx.bet.id)) ctx.addStake(P7.tally);
      },
    },
  },
  {
    id: 'hot_coals',
    name: 'Hot Coals',
    rarity: 'rare',
    tags: ['streaks'],
    unlock: { feat: 'same_again' },
    text: `Every paying spin in a row adds ×${P7.coals.step} to what chips pay, up to ×${P7.coals.max}. A spin that pays nothing resets it.`,
    init: () => ({ streak: 0 }),
    status: (data) => (data.streak ? `Glowing: ×${coalsMult(data.streak)} on the next paying spin.` : 'Cold.'),
    hooks: {
      chipMult(ctx) {
        if (ctx.self.streak) ctx.mul(coalsMult(ctx.self.streak));
      },
      afterSpin(ctx) {
        // A miss "Hot hands." forgives neither builds nor breaks the streak.
        const next = ctx.result.miss ? (ctx.result.forgiven ? ctx.self.streak : 0) : ctx.self.streak + 1;
        if (next !== ctx.self.streak) ctx.setData('streak', next);
      },
    },
  },
  {
    id: 'green_thread',
    name: 'Green Thread',
    rarity: 'common',
    tags: ['zero'],
    text: `Chips on a bet that covers zero get +${P7.thread} Stake.`,
    hooks: {
      chipStake(ctx) {
        if (ctx.bet.numberSet.has(0) || ctx.bet.numberSet.has(37)) ctx.addStake(P7.thread);
      },
    },
  },
  {
    id: 'zeros_coin',
    name: 'Zero’s Coin',
    rarity: 'rare',
    tags: ['zero', 'tokens'],
    unlock: { feat: 'ride_the_lean' },
    text: `When a ball lands on a green zero: +${P7.zero.tokens} tokens, and coins equal to the cost of ${P7.zero.spins} spins.`,
    hooks: {
      ballLanded(ctx) {
        if (!isGreenNumber(ctx.landing.pocket)) return;
        ctx.bonusTokens(P7.zero.tokens);
        ctx.bonusCoins(mul(spinCostFor(ctx.state.debt), P7.zero.spins));
      },
    },
  },
  {
    id: 'marble',
    name: 'Marble',
    rarity: 'common',
    tags: ['multi'],
    text: 'The first and last spins of each night throw a second ball.',
    hooks: {
      balls(ctx) {
        if (ctx.spin.last || ctx.spin.ofNight === 1) ctx.addBall();
      },
    },
  },
  {
    id: 'jugglers_ball',
    name: 'Juggler’s Ball',
    rarity: 'uncommon',
    tags: ['multi'],
    text: 'Every third spin of a night throws a second ball.',
    hooks: {
      balls(ctx) {
        if (ctx.spin.ofNight && ctx.spin.ofNight % 3 === 0) ctx.addBall();
      },
    },
  },
  {
    id: 'bag_of_marbles',
    name: 'Bag of Marbles',
    rarity: 'legendary',
    tags: ['multi'],
    unlock: { feat: 'the_vault' },
    text: `Throws ${P7.bag.balls} extra balls every spin. Each pays ${share(P7.bag.mult)}.`,
    hooks: {
      balls(ctx) {
        for (let i = 0; i < P7.bag.balls; i++) ctx.addBall({ mult: P7.bag.mult });
      },
    },
  },
  {
    id: 'usurers_seal',
    name: 'Moneylender’s Seal',
    rarity: 'legendary',
    tags: ['economy'],
    unlock: { feat: 'a_full_rail' },
    text: 'Doubles your interest, including the interest from talismans to its left.',
    hooks: {
      interestRate(ctx) {
        ctx.addRate(ctx.rate);
      },
    },
  },
  {
    id: 'brimstone',
    name: 'Brimstone',
    rarity: 'rare',
    tags: ['devil', 'risk'],
    unlock: { feat: 'paid_in_spite' },
    text: `Once the Devil has fired this debt, chips pay ×${P7.brimstone.mult}. Raises the Devil's chance by 1%.`,
    status: (data, state) => (state.devil?.firedThisDebt ? 'Burning: the Devil has fired this debt.' : asleep(state) ?? 'Waiting for the Devil.'),
    hooks: {
      chipMult(ctx) {
        if (ctx.state.devil?.firedThisDebt) ctx.mul(P7.brimstone.mult);
      },
      devilChance(ctx) {
        ctx.addChance(P7.brimstone.devil);
      },
    },
  },
  // --- The builds pass (decision 32; doc 6.1, 6.8): the Pyre, then what each build lacked
  {
    id: 'kindling',
    name: 'Kindling',
    rarity: 'common',
    tags: ['pyre', 'tokens'],
    text: `When sold: +${P8.kindling} tokens.`,
    hooks: {
      sold(ctx) {
        if (ctx.isSelf) ctx.gainTokens(P8.kindling);
      },
    },
  },
  {
    id: 'funeral_urn',
    name: 'Funeral Urn',
    rarity: 'uncommon',
    tags: ['pyre'],
    text: `Winning chips get +1 Stake for every talisman you have sold this run (up to +${P8.urnMax}).`,
    status: (data, state) => `+${Math.min(P8.urnMax, state.stats.talismansSold ?? 0)} Stake now.`,
    hooks: {
      chipStake(ctx) {
        const n = Math.min(P8.urnMax, ctx.state.stats.talismansSold ?? 0);
        if (n) ctx.addStake(n);
      },
    },
  },
  {
    id: 'phoenix_feather',
    name: 'Phoenix Feather',
    rarity: 'rare',
    tags: ['pyre'],
    text: 'The first talisman used up each debt comes back, as good as new.',
    revives: true,
    copyable: false,
    echoable: false,
    status: (data, state) => (data.debt === state.debt ? 'Spent this debt.' : 'Ready.'),
    hooks: {},
  },
  {
    id: 'the_pyre',
    name: 'The Pyre',
    rarity: 'legendary',
    tags: ['pyre'],
    text: `Chips pay ×${P8.pyre} more for every talisman sold or used up this run (4 gone: ×${1 + 4 * P8.pyre}).`,
    status: (data, state) => `×${pyreMult(state)} now (${plural(burned(state), 'talisman')} burned).`,
    hooks: {
      chipMult(ctx) {
        if (burned(ctx.state)) ctx.mul(pyreMult(ctx.state));
      },
    },
  },
  {
    id: 'pair_of_dice',
    name: 'Pair of Dice',
    rarity: 'uncommon',
    tags: ['multi', 'colour'],
    text: `When two balls land on the same colour, chips pay ×${P8.dice}.`,
    hooks: {
      chipMult(ctx) {
        if (sameColour(ctx.landed)) ctx.mul(P8.dice);
      },
    },
  },
  {
    id: 'savings_book',
    name: 'Savings Book',
    rarity: 'uncommon',
    tags: ['economy'],
    text: `The Cage pays 1% more interest for every debt paid this run, up to +${P8.savings.max}%.`,
    status: (data, state) => `+${Math.min(P8.savings.max, state.stats.debtsPaid)}% now.`,
    hooks: {
      interestRate(ctx) {
        const n = Math.min(P8.savings.max, ctx.state.stats.debtsPaid);
        if (n) ctx.addRate(n * P8.savings.step);
      },
    },
  },
  {
    id: 'gold_tooth',
    name: 'Gold Tooth',
    rarity: 'legendary',
    tags: ['tokens', 'scaling'],
    text: `Chips pay more the more tokens you hold: ×2 at ${P8.tooth} tokens, ×3 at ${2 * P8.tooth}.`,
    status: (data, state) => `×${Math.round(toothMult(state) * 100) / 100} now.`,
    hooks: {
      chipMult(ctx) {
        if (ctx.state.tokens > 0) ctx.mul(toothMult(ctx.state));
      },
    },
  },
  {
    id: 'pocket_calendar',
    name: 'Pocket Calendar',
    rarity: 'rare',
    tags: ['timing'],
    text: `Each night it marks one spin (you see which once the night begins): chips pay ×${P8.calendar} on that spin.`,
    status: (data, state) => (calendarSpin(state) ? `Marks spin ${calendarSpin(state)} tonight.` : 'Marks a spin once the night is chosen.'),
    hooks: {
      chipMult(ctx) {
        const mark = calendarSpin(ctx.state);
        if (mark && nextSpin(ctx.state).ofNight === mark) ctx.mul(P8.calendar);
      },
    },
  },
  {
    id: 'hand_bell',
    name: 'Hand Bell',
    rarity: 'common',
    tags: ['active'],
    text: `Each debt, the leftmost Bell talisman gets ${P8.handBell} extra charge.`,
    hooks: {
      debtStart(ctx) {
        ctx.chargeBell(P8.handBell);
      },
    },
  },
  {
    id: 'racing_form',
    name: 'Racing Form',
    rarity: 'uncommon',
    tags: ['special', 'wheel'],
    unlock: { lock: 1 },
    text: 'Opens the Neighbours on the racetrack: a number and the two pockets either side of it.',
    opens: ['neighbours'],
    hooks: {},
  },
  {
    id: 'raven_feather',
    name: 'Raven Feather',
    rarity: 'uncommon',
    tags: ['colour'],
    text: 'Chips on Black: +1 Stake.',
    hooks: {
      chipStake(ctx) {
        if (ctx.bet.kind === 'black') ctx.addStake(1);
      },
    },
  },
  // ---- The weak builds' multipliers (decision 33): one a lock ----
  {
    id: 'tote_board',
    name: 'The Tote Board',
    rarity: 'legendary',
    tags: ['special', 'wheel'],
    unlock: { lock: 1 },
    text: 'Racetrack chips pay ×2 when you have chips on 2 different racetrack bets, ×3 on 3, and so on.',
    status: (data, state) => {
      const n = racetrackBets(state);
      return n ? `×${n} now (${plural(n, 'racetrack bet')} with chips).` : 'No chips on the racetrack.';
    },
    hooks: {
      chipMult(ctx) {
        if (!isSpecial(ctx.bet.kind)) return;
        const n = racetrackBets(ctx.state);
        if (n > 1) ctx.mul(n);
      },
    },
  },
  {
    id: 'carillon',
    name: 'The Carillon',
    rarity: 'legendary',
    tags: ['active'],
    unlock: { lock: 2 },
    text: `Each time you ring the Bell and a talisman answers, chips pay ×${P9.carillon} more for the rest of the debt (3 rings: ×${1 + 3 * P9.carillon}).`,
    status: (data, state) => `×${carillonMult(state)} now (${plural(state.debtRings ?? 0, 'ring')} this debt).`,
    hooks: {
      chipMult(ctx) {
        if (ctx.state.debtRings) ctx.mul(carillonMult(ctx.state));
      },
    },
  },
  {
    id: 'patience_jar',
    name: 'Patience Jar',
    rarity: 'legendary',
    tags: ['zero'],
    unlock: { lock: 3 },
    text: `Every spin without a green zero adds ×${P9.jar}. When a ball lands on a green zero, chips pay that much and the jar empties (10 spins: ×${1 + 10 * P9.jar}).`,
    init: () => ({ wait: 0 }),
    status: (data) => `×${jarMult(data.wait ?? 0)} on the next green zero (${plural(data.wait ?? 0, 'spin')} without one).`,
    hooks: {
      chipMult(ctx) {
        if (ctx.self.wait && isGreenNumber(ctx.landing.pocket)) ctx.mul(jarMult(ctx.self.wait));
      },
      afterSpin(ctx) {
        // Emptied by any zero, even one the Devil burned.
        const zero = ctx.result.balls.some((b) => b.color === 'green' && b.number !== null);
        ctx.setData('wait', zero ? 0 : (ctx.self.wait ?? 0) + 1);
      },
    },
  },
  {
    id: 'grandfather_clock',
    name: 'Grandfather Clock',
    rarity: 'legendary',
    tags: ['timing'],
    unlock: { lock: 4 },
    text: `Chips pay more as the night goes on: ×1 on the first spin, then ×${P9.clock} more each spin (×${1 + 6 * P9.clock} on the seventh).`,
    init: () => ({ clock: null }),
    status: (data, state) => `×${clockMult(playedTonight(data, state))} on the next spin.`,
    hooks: {
      chipMult(ctx) {
        const n = playedTonight(ctx.self, ctx.state);
        if (n) ctx.mul(clockMult(n));
      },
      afterSpin(ctx) {
        ctx.setData('clock', { night: tonight(ctx.state), played: playedTonight(ctx.self, ctx.state) + 1 });
      },
    },
  },
];
