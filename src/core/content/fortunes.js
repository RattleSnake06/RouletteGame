// Madame Zero's fortunes (design doc 5.9, 6.2). Once a debt she deals three
// cards and you take one: white cards as a rule, black cards when the Devil
// fired this debt before you first pulled her lever. Each card is data:
//
//   kind      white | black
//   rarity    common | uncommon | rare (the Cabinet's reroll weights)
//   text      her line, the card's face
//   effect    what it does, in plain words
//   lore      the scrawl on the card's back
//   maxPicks  how many times a run may take it (none: any number)
//   requires  (state) => false keeps it out of a deal (it could do nothing)
//   take      (ctx) => its one-off effect, through the oracle's ctx (oracle.js)
//   hooks     effects that last the rest of the run, as for talismans; a taken
//             card with hooks stays as a boon and acts before the rail
//   init      (state) => the boon's data when it is taken (its debt, its spins)
//
// Cards that need later systems (the Neighbours bet) wait for their phase
// (decision 22); "Ask the figures" sends one away since Phase 6. The two bet-level cards came with
// Phase 5's second half. The two chip cards ("Your stack grows heavy", "A new
// chip in your pocket") were left out at the owner's word (decision 28): a
// run starts with three chips of value 1, so either was a third more stake
// for the rest of the run, too strong even once a run; chips come from the
// Cabinet instead. Wheel work at random goes through ctx.workRandom
// (wheelwork.js), on the fortunes stream.

import { getTalisman } from './index.js';
import { WHEEL, workTargets } from '../wheelwork.js';

const red = (p) => p.color === 'red';
const black = (p) => p.color === 'black';
const hasBellTalisman = (state) => state.rail.some((t) => getTalisman(t.id)?.bell);
const freeHook = (state, hooks) => state.rail.length < hooks;
const owns = (state, id) => state.rail.some((t) => t.id === id);
const GILD = { op: 'gild', on: 'pocket' };
const CURSE = { op: 'enhance', on: 'pocket', enh: 'cursed' };
const REMOVE = { op: 'remove', on: 'pocket' };
const canWork = (state, work) => workTargets(state, work).length > 0;
const zeroPocket = (state) => state.wheel.pockets.find((p) => p.number === 0);
const OUTSIDE = ['dozen', 'column', 'red', 'black', 'odd', 'even', 'low', 'high'];
const INSIDE_LINES = ['split', 'street', 'corner', 'sixLine'];
const tonight = (state) => `${state.debt}.${state.round}`;
const STREAK_KEEPERS = ['hot_coals'];
const keepsStreaks = (state) => state.rail.some((t) => STREAK_KEEPERS.includes(t.id)) || state.records.includes('boogie_woogie');

// Tuned with the simulator (doc 9.8): a card a debt is worth a lot, because
// most of them last the run.
const FORTUNE = {
  tips: 2, // drafted 5
  discount: 1, // drafted 2
  widen: 0.15, // drafted 0.25
  gilds: 3,
  borrowedGilds: 4,
  borrowedCurses: 2,
  // Phase 7
  zeroWiden: 0.5,
  twinMult: 0.5,
  devilsHand: 0.01,
  breaks: 2,
  breakTokens: 4,
  // The builds pass (decision 32)
  spareBalls: 5,
  compound: 0.03,
};

export const FORTUNE_LIST = [
  // --- White cards ---------------------------------------------------------
  {
    id: 'stranger_tips',
    kind: 'white',
    rarity: 'common',
    text: 'A stranger tips well.',
    effect: `+${FORTUNE.tips} tokens.`,
    lore: 'IT ALL ADDS UP TO 666',
    take(ctx) {
      ctx.gainTokens(FORTUNE.tips);
    },
  },
  {
    id: 'bell_rings_twice',
    kind: 'white',
    rarity: 'common',
    text: 'The bell rings twice.',
    effect: 'Every Bell talisman is recharged.',
    lore: 'SHE HEARS EVERY RING',
    requires: hasBellTalisman,
    take(ctx) {
      ctx.rechargeBell();
    },
  },
  {
    id: 'cabinet_owes',
    kind: 'white',
    rarity: 'common',
    text: 'The cabinet owes you.',
    effect: `Talismans cost ${FORTUNE.discount} token${FORTUNE.discount === 1 ? '' : 's'} less until the next restock.`,
    lore: 'EVERYTHING HAS A PRICE',
    take(ctx) {
      ctx.discount(FORTUNE.discount);
    },
  },
  {
    id: 'reds_run_warm',
    kind: 'white',
    rarity: 'common',
    text: 'The reds run warm tonight.',
    effect: `Every red pocket +${FORTUNE.widen} wide, for good.`,
    lore: "DON'T TRUST THE LEAN",
    take(ctx) {
      ctx.widen(red, FORTUNE.widen);
    },
  },
  {
    id: 'blacks_run_cold',
    kind: 'white',
    rarity: 'common',
    text: 'The blacks run cold and deep.',
    effect: `Every black pocket +${FORTUNE.widen} wide, for good.`,
    lore: 'THE WHEEL REMEMBERS',
    take(ctx) {
      ctx.widen(black, FORTUNE.widen);
    },
  },
  {
    id: 'another_hook',
    kind: 'white',
    rarity: 'uncommon',
    text: 'Another hook on the wall.',
    effect: '+1 talisman hook.',
    lore: 'SHE WAS A PLAYER ONCE',
    maxPicks: 1,
    take(ctx) {
      ctx.addHook();
    },
  },
  {
    id: 'record_left',
    kind: 'white',
    rarity: 'legendary', // records come "occasionally" from fortunes (5.10)
    text: 'Someone left a record.',
    effect: 'A record for the gramophone. It plays if nothing is playing.',
    lore: 'THE MUSIC NEVER STOPS',
    maxPicks: 1,
    requires: (state, { recordsLeft }) => recordsLeft > 0,
    take(ctx) {
      ctx.giveRecord();
    },
  },
  {
    id: 'carved_in_brass',
    kind: 'white',
    rarity: 'rare',
    text: 'Something carved in brass.',
    effect: 'A random engraving on one of your talismans (never Cursed).',
    lore: 'BRASS HOLDS A GRUDGE',
    requires: (state) => state.rail.some((t) => !t.engraving),
    take(ctx) {
      ctx.engraveTalisman({ cursed: false });
    },
  },

  {
    id: 'gold_finds_gold',
    kind: 'white',
    rarity: 'rare',
    text: 'Gold finds gold.',
    effect: `Gild ${FORTUNE.gilds} pockets at random: chips that win there pay ×2 (a gilded one turns platinum, ×3).`,
    lore: 'THE WHEEL WAS GOLD ONCE',
    requires: (state) => canWork(state, GILD),
    take(ctx) {
      ctx.workRandom(GILD, FORTUNE.gilds);
    },
  },

  {
    id: 'outside_safe',
    kind: 'white',
    rarity: 'legendary', // drafted uncommon, any number of times
    maxPicks: 1,
    text: 'Outside bets are safe bets.',
    effect: 'Dozens, columns and even-money bets go up a level: each pays a quarter of its base odds more, for the rest of the run.',
    lore: 'SAFE IS A WORD FOR THE LIVING',
    take(ctx) {
      ctx.levelUp(OUTSIDE);
    },
  },
  {
    id: 'fortune_bold',
    kind: 'white',
    rarity: 'legendary', // drafted uncommon, any number of times
    maxPicks: 1,
    text: 'Fortune favours the bold.',
    effect: 'Straight-ups go up a level: they pay a quarter more, for the rest of the run (36 → 45).',
    lore: 'ONE NUMBER. ONE CHANCE.',
    take(ctx) {
      ctx.levelUp(['straight']);
    },
  },

  // --- Black cards ---------------------------------------------------------
  {
    id: 'burn_ledger',
    kind: 'black',
    rarity: 'common',
    text: 'Burn the ledger.',
    effect: 'Double your tokens. Coins in hand go to 0.',
    lore: 'THE HOUSE KEEPS NO BOOKS',
    take(ctx) {
      ctx.setTokens(ctx.state.tokens * 2);
      ctx.setCoins(0);
    },
  },
  {
    id: 'give_it_back',
    kind: 'black',
    rarity: 'common',
    text: 'Give it all back.',
    effect: 'Double your coins in hand. Tokens go to 0.',
    lore: 'WHAT YOU HOLD HOLDS YOU',
    take(ctx) {
      ctx.doubleCoins();
      ctx.setTokens(0);
    },
  },
  {
    id: 'bargain',
    kind: 'black',
    rarity: 'common',
    text: 'Bargain at the cabinet.',
    effect: 'Your next two talismans are free. Tokens go to 0.',
    lore: 'NOTHING IS FREE',
    take(ctx) {
      ctx.freeBuys(2);
      ctx.setTokens(0);
    },
  },
  {
    id: 'feed_zero',
    kind: 'black',
    rarity: 'uncommon',
    text: 'Feed the zero.',
    effect: 'A second zero pocket beside the first. Chips pay ×2 for the rest of the run.',
    lore: 'ZERO IS HUNGRY',
    maxPicks: 1,
    requires: (state) => !!zeroPocket(state) && state.wheel.pockets.length < WHEEL.maxPockets,
    take(ctx) {
      ctx.work({ op: 'duplicate', on: 'pocket' }, zeroPocket(ctx.state).id);
    },
    hooks: {
      chipMult(ctx) {
        ctx.mul(2);
      },
    },
  },
  {
    id: 'roll_bones',
    kind: 'black',
    rarity: 'uncommon',
    text: 'Roll the bones.',
    effect: 'The Bone Dice hang on your rail, for good.',
    lore: 'THE DICE ARE OLDER THAN THE WHEEL',
    requires: (state, { hooks }) => freeHook(state, hooks) && !owns(state, 'bone_dice'),
    take(ctx) {
      ctx.hang('bone_dice');
    },
  },
  {
    id: 'candle',
    kind: 'black',
    rarity: 'uncommon',
    text: 'A candle for the dark.',
    effect: 'The Black Candle hangs on your rail, for good.',
    lore: 'SOMETHING MOVES WHEN IT GUTTERS',
    requires: (state, { hooks }) => freeHook(state, hooks) && !owns(state, 'black_candle'),
    take(ctx) {
      ctx.hang('black_candle');
    },
  },
  {
    id: 'shiny_things',
    kind: 'black',
    rarity: 'rare',
    text: 'Shiny things.',
    effect: 'Every talisman in the Cabinet is engraved. One of yours is engraved Cursed.',
    lore: 'LOOK CLOSER. CLOSER.',
    take(ctx) {
      ctx.engraveOffers();
      ctx.engraveTalisman({ only: 'cursed' });
    },
  },
  {
    id: 'ask_figures',
    kind: 'black',
    rarity: 'rare',
    text: 'Ask the figures.',
    effect: 'The oldest figure in the dark goes. +1 Nudge on every spin, for the rest of the run.',
    lore: 'THEY ARE STILL WATCHING',
    take(ctx) {
      ctx.sendFigureAway();
    },
    hooks: {
      nudge(ctx) {
        ctx.addNudge(1);
      },
    },
  },
  {
    id: 'borrowed_gold',
    kind: 'black',
    rarity: 'uncommon',
    text: 'Borrowed gold.',
    effect: `Gild ${FORTUNE.borrowedGilds} pockets at random. ${FORTUNE.borrowedCurses} others are cursed: a landing there raises the Devil's chance by 1% for the night.`,
    lore: 'IT WILL BE COLLECTED',
    requires: (state) => canWork(state, GILD),
    take(ctx) {
      ctx.workRandom(GILD, FORTUNE.borrowedGilds);
      ctx.workRandom(CURSE, FORTUNE.borrowedCurses, { plain: true });
    },
  },
  // --- Phase 7: five more; some wait for a lock of the Vault or a feat -------
  {
    id: 'neighbours_talk',
    kind: 'white',
    rarity: 'rare',
    maxPicks: 1,
    unlock: { lock: 1 },
    opens: ['neighbours'],
    text: 'Neighbours talk.',
    effect: 'The Neighbours bet opens on the racetrack, for the rest of the run: a number and the two pockets either side of it.',
    lore: 'THEY HEAR EVERYTHING',
  },
  {
    id: 'zero_smiles',
    kind: 'white',
    rarity: 'common',
    text: 'Zero smiles on you.',
    effect: `Every green zero +${FORTUNE.zeroWiden} wide, for good.`,
    lore: 'ZERO IS NOT EMPTY',
    take(ctx) {
      ctx.widen((p) => p.color === 'green' && p.number !== null, FORTUNE.zeroWiden);
    },
  },
  {
    id: 'twin_ball',
    kind: 'white',
    rarity: 'rare',
    maxPicks: 1,
    unlock: { lock: 4 },
    text: 'The ball has a twin.',
    effect: `A second ball on every spin, for the rest of the run. It pays ×${FORTUNE.twinMult}.`,
    lore: 'TWO OF EVERYTHING',
    hooks: {
      balls(ctx) {
        ctx.addBall({ mult: FORTUNE.twinMult });
      },
    },
  },
  {
    id: 'devils_hand',
    kind: 'black',
    rarity: 'uncommon',
    unlock: { feat: 'the_house_at_its_worst' },
    text: 'Shake the Devil’s hand.',
    effect: `Winning chips +1 Stake, for the rest of the run. The Devil's chance +${FORTUNE.devilsHand * 100}%.`,
    lore: 'HE KEEPS HIS WORD',
    hooks: {
      chipStake(ctx) {
        ctx.addStake(1);
      },
      devilChance(ctx) {
        ctx.addChance(FORTUNE.devilsHand);
      },
    },
  },
  {
    id: 'break_the_wheel',
    kind: 'black',
    rarity: 'common',
    unlock: { lock: 3 },
    text: 'Break the wheel.',
    effect: `${FORTUNE.breaks} pockets are chiselled out at random. +${FORTUNE.breakTokens} tokens.`,
    lore: 'IT WAS NEVER FAIR',
    requires: (state) => canWork(state, REMOVE),
    take(ctx) {
      ctx.workRandom(REMOVE, FORTUNE.breaks);
      ctx.gainTokens(FORTUNE.breakTokens);
    },
  },
  // --- The builds pass (decision 32; doc 6.2, 6.8) -----------------------------
  {
    id: 'burn_it_all',
    kind: 'black',
    rarity: 'rare',
    text: 'Burn it all.',
    effect: 'Every talisman that can come off your rail is sold, for all it cost.',
    lore: 'ASHES PAY THEIR WAY',
    requires: (state) => state.rail.some((t) => !getTalisman(t.id)?.cursed),
    take(ctx) {
      ctx.sellAll();
    },
  },
  {
    id: 'table_remembers',
    kind: 'white',
    rarity: 'legendary',
    maxPicks: 1,
    text: 'The table remembers.',
    effect: 'Splits, streets, corners and six-lines go up a level: each pays a quarter of its base odds more, for the rest of the run.',
    lore: 'EVERY LINE A NAME',
    take(ctx) {
      ctx.levelUp(INSIDE_LINES);
    },
  },
  {
    id: 'hot_hands',
    kind: 'white',
    rarity: 'uncommon',
    maxPicks: 1,
    text: 'Hot hands.',
    effect: 'For the rest of the run, the first spin each night that pays nothing does not break a streak (Hot Coals, Boogie-Woogie).',
    lore: 'THE HEAT DOES NOT FORGET',
    requires: keepsStreaks,
    hooks: {
      forgiveMiss(ctx) {
        if (ctx.self.night === tonight(ctx.state)) return;
        ctx.forgive();
        ctx.setData('night', tonight(ctx.state));
      },
    },
  },
  {
    id: 'spare_ball',
    kind: 'white',
    rarity: 'common',
    text: 'A spare ball.',
    effect: `A second ball on each of your next ${FORTUNE.spareBalls} spins.`,
    lore: 'SHE KEEPS ONE IN HER SLEEVE',
    init: () => ({ left: FORTUNE.spareBalls }),
    hooks: {
      balls(ctx) {
        if (ctx.self.left > 0) ctx.addBall();
      },
      afterSpin(ctx) {
        if (ctx.self.left > 0) ctx.setData('left', ctx.self.left - 1);
      },
    },
  },
  {
    id: 'compound_interest',
    kind: 'white',
    rarity: 'uncommon',
    maxPicks: 2,
    text: 'Compound interest.',
    effect: `The Cage pays ${Math.round(FORTUNE.compound * 100)}% more interest, for the rest of the run.`,
    lore: 'MONEY BREEDS IN THE DARK',
    hooks: {
      interestRate(ctx) {
        ctx.addRate(FORTUNE.compound);
      },
    },
  },
  {
    id: 'night_is_young',
    kind: 'white',
    rarity: 'uncommon',
    text: 'The night is young.',
    effect: '+1 spin on every night of this debt that has spins.',
    lore: 'DAWN CAN WAIT',
    init: (state) => ({ debt: state.debt }),
    hooks: {
      nightSpins(ctx) {
        if (ctx.self.debt === ctx.state.debt) ctx.addSpins(1);
      },
    },
  },
];
