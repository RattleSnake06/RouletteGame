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
//
// Cards that need later systems (bet levels, gilded pockets, chip materials,
// the Neighbours bet, the figures in the dark) wait for their phase (decision 22).

import { getTalisman } from './index.js';

const red = (p) => p.color === 'red';
const black = (p) => p.color === 'black';
const zero = (p) => p.color === 'green';
const hasBellTalisman = (state) => state.rail.some((t) => getTalisman(t.id)?.bell);
const freeHook = (state, hooks) => state.rail.length < hooks;
const owns = (state, id) => state.rail.some((t) => t.id === id);

export const FORTUNE_LIST = [
  // --- White cards ---------------------------------------------------------
  {
    id: 'stranger_tips',
    kind: 'white',
    rarity: 'common',
    text: 'A stranger tips well.',
    effect: '+5 tokens.',
    lore: 'IT ALL ADDS UP TO 666',
    take(ctx) {
      ctx.gainTokens(5);
    },
  },
  {
    id: 'stack_grows',
    kind: 'white',
    rarity: 'common',
    text: 'Your stack grows heavy.',
    effect: 'Every chip +1 value, for good.',
    lore: 'ZERO IS NOT EMPTY',
    take(ctx) {
      ctx.addChipValue(1);
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
    effect: 'Talismans cost 2 tokens less until the next restock.',
    lore: 'EVERYTHING HAS A PRICE',
    take(ctx) {
      ctx.discount(2);
    },
  },
  {
    id: 'reds_run_warm',
    kind: 'white',
    rarity: 'common',
    text: 'The reds run warm tonight.',
    effect: 'Every red pocket +0.25 wide, for good.',
    lore: "DON'T TRUST THE LEAN",
    take(ctx) {
      ctx.widen(red, 0.25);
    },
  },
  {
    id: 'blacks_run_cold',
    kind: 'white',
    rarity: 'common',
    text: 'The blacks run cold and deep.',
    effect: 'Every black pocket +0.25 wide, for good.',
    lore: 'THE WHEEL REMEMBERS',
    take(ctx) {
      ctx.widen(black, 0.25);
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
    id: 'new_chip',
    kind: 'white',
    rarity: 'uncommon',
    text: 'A new chip in your pocket.',
    effect: 'Gain a chip.',
    lore: 'CLAY REMEMBERS EVERY HAND',
    take(ctx) {
      ctx.addChip();
    },
  },
  {
    id: 'record_left',
    kind: 'white',
    rarity: 'uncommon',
    text: 'Someone left a record.',
    effect: 'A record for the gramophone. It plays if nothing is playing.',
    lore: 'THE MUSIC NEVER STOPS',
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
    effect: "Zero's pocket twice as wide. Chips pay ×2 for the rest of the run.",
    lore: 'ZERO IS HUNGRY',
    maxPicks: 1,
    take(ctx) {
      ctx.widen(zero, 1);
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
    effect: '+1 Nudge on every spin, for the rest of the run.',
    lore: 'THEY ARE STILL WATCHING',
    hooks: {
      nudge(ctx) {
        ctx.addNudge(1);
      },
    },
  },
];
