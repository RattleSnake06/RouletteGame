// Records (design doc 5.10, 6.3): the gramophone plays one, and while it plays
// it changes the music and one rule. Records can be swapped at any time; only
// the one playing acts (two, once the Vault's second lock gives the gramophone
// a second slot). They come from Madame Zero's fortunes and the Cabinet.
//
//   rule       the rule as the record's label says it
//   tune       which synthesised loop plays (src/audio/records.js)
//   init       () => the record's own data (Boogie-Woogie's streak)
//   noLeans    true: the House never leans while it plays
//   extraHooks talisman hooks it adds while it plays
//   doublesDebt true: a debt it plays during owes twice as much
//   reverse    true: the wheel turns the other way (the view)
//   reach      pockets added to any Nudge a spin already has (nudge.js)
//   sellMult   talismans sold while it plays fetch this many times as much (Requiem)
//   hooks      effect hooks, as for talismans; a record acts before the rail

import { SPECIAL_KINDS, isSpecial } from '../bets.js';

// Tuned with the simulator (doc 9.8).
const RECORD = {
  boogieMax: 2, // drafted without a cap
  nocturne: 3, // drafted ×4
  twoStep: 0.6,
  // The builds pass (decision 32)
  stride: { stake: 1, straight: 0.5 },
  blues: { black: 2, red: 0.5 },
};
const INSIDE_LINES = ['split', 'street', 'corner', 'sixLine'];
/** A green pocket with a number (0 or 00), not the House's own (House Edge 1). */
const greenNumber = (pocket) => pocket.color === 'green' && pocket.number !== null;

const lastSpinOfNight = (state) => state.phase === 'betting' && state.spinsLeft === 1;

export const RECORD_LIST = [
  {
    id: 'waltz_in_green',
    name: 'Waltz in Green',
    rule: '+1 Nudge on every spin. Nights cost 50% more.',
    tune: 'waltz',
    hooks: {
      nudge(ctx) {
        ctx.addNudge(1);
      },
      packageCost(ctx) {
        ctx.mulCost(1.5);
      },
    },
  },
  {
    id: 'red_light_tango',
    name: 'Red Light Tango',
    rule: 'Chips pay ×2 when a red number lands, and half when a black one does.',
    tune: 'tango',
    hooks: {
      chipMult(ctx) {
        if (ctx.landing.color === 'red') ctx.mul(2);
        else if (ctx.landing.color === 'black') ctx.mul(0.5);
      },
    },
  },
  {
    id: 'lullaby_for_zero',
    name: 'Lullaby for Zero',
    rule: 'No Devil, and no Leans.',
    tune: 'lullaby',
    noLeans: true,
    hooks: {
      devilChance(ctx) {
        ctx.mulChance(0);
      },
    },
  },
  {
    id: 'overture_of_excess',
    name: 'Overture of Excess',
    rule: 'Chips pay ×3. Any debt it plays during costs twice as much.',
    tune: 'overture',
    doublesDebt: true,
    hooks: {
      chipMult(ctx) {
        ctx.mul(3);
      },
    },
  },
  {
    id: 'funeral_march',
    name: 'Funeral March',
    rule: '+2 tokens every night. Chips pay ×0.75.',
    tune: 'march',
    hooks: {
      chipMult(ctx) {
        ctx.mul(0.75);
      },
      roundEnd(ctx) {
        ctx.gainTokens(2);
      },
    },
  },
  {
    id: 'boogie_woogie',
    name: 'Boogie-Woogie',
    rule: `Each paying spin in a row gives +1 Stake (up to +${RECORD.boogieMax}). A spin that pays nothing resets it.`,
    tune: 'boogie',
    init: () => ({ streak: 0 }),
    hooks: {
      chipStake(ctx) {
        if (ctx.self.streak > 0) ctx.addStake(ctx.self.streak);
      },
      afterSpin(ctx) {
        // A miss "Hot hands." forgives keeps the streak as it was.
        const streak = ctx.result.miss ? (ctx.result.forgiven ? ctx.self.streak : 0) : Math.min(RECORD.boogieMax, ctx.self.streak + 1);
        if (streak !== ctx.self.streak) ctx.setData('streak', streak);
      },
    },
  },
  {
    id: 'nocturne',
    name: 'Nocturne',
    rule: `The night's last spin pays ×${RECORD.nocturne}.`,
    tune: 'nocturne',
    hooks: {
      chipMult(ctx) {
        if (lastSpinOfNight(ctx.state)) ctx.mul(RECORD.nocturne);
      },
    },
  },
  {
    id: 'static',
    name: 'Static',
    rule: 'No music. +1 talisman hook.',
    tune: 'static',
    extraHooks: 1,
  },
  {
    id: 'carousel',
    name: 'Carousel',
    rule: 'The wheel spins the other way. Any Nudge reaches 1 pocket further.',
    tune: 'carousel',
    reverse: true,
    // Only a spin that has Nudge already (a Lean, pity, a talisman) gets the
    // extra pocket, so nudge.js adds it after every other source.
    reach: 1,
  },
  // Phase 6: the figures in the dark (doc 7.3) stand in the profile; a run
  // counts the ones standing when it began (fewer if she sends one away).
  {
    id: 'danse_macabre',
    name: 'Danse Macabre',
    rule: '+1% interest for each figure standing in the dark.',
    tune: 'danse',
    hooks: {
      interestRate(ctx) {
        if (ctx.state.figures > 0) ctx.addRate(0.01 * ctx.state.figures);
      },
    },
  },
  // Phase 7: one opens with the Vault's first lock, one with its second.
  {
    id: 'habanera',
    name: 'Habanera',
    rule: 'The special bets on the racetrack are open while it plays. Their chips +1 Stake.',
    tune: 'habanera',
    unlock: { lock: 1 },
    opens: SPECIAL_KINDS,
    hooks: {
      chipStake(ctx) {
        if (isSpecial(ctx.bet.kind)) ctx.addStake(1);
      },
    },
  },
  {
    id: 'two_step',
    name: 'Two-Step',
    rule: `A second ball every spin. All payouts ×${RECORD.twoStep}.`,
    tune: 'twostep',
    unlock: { lock: 2 },
    hooks: {
      balls(ctx) {
        ctx.addBall();
      },
      chipMult(ctx) {
        ctx.mul(RECORD.twoStep);
      },
    },
  },
  // --- The builds pass (decision 32; doc 6.3, 6.8) -----------------------------
  {
    id: 'requiem',
    name: 'Requiem',
    rule: 'Selling a talisman while it plays gives twice as much.',
    tune: 'requiem',
    sellMult: 2,
    hooks: {},
  },
  {
    id: 'stride_piano',
    name: 'Stride Piano',
    rule: `Splits, streets, corners and six-lines +${RECORD.stride.stake} Stake. Straight-ups pay half.`,
    tune: 'stride',
    hooks: {
      chipStake(ctx) {
        if (INSIDE_LINES.includes(ctx.bet.kind)) ctx.addStake(RECORD.stride.stake);
      },
      chipMult(ctx) {
        if (ctx.bet.kind === 'straight') ctx.mul(RECORD.stride.straight);
      },
    },
  },
  {
    id: 'bolero',
    name: 'Bolero',
    rule: 'When a green zero lands, every chip on the table wins.',
    tune: 'bolero',
    hooks: {
      covers(ctx) {
        if (ctx.hit.primary && greenNumber(ctx.hit.pocket)) ctx.cover();
      },
    },
  },
  {
    id: 'midnight_blues',
    name: 'Midnight Blues',
    rule: `Chips pay ×${RECORD.blues.black} when a black number lands, and half when a red one does.`,
    tune: 'blues',
    hooks: {
      chipMult(ctx) {
        if (ctx.landing.color === 'black') ctx.mul(RECORD.blues.black);
        else if (ctx.landing.color === 'red') ctx.mul(RECORD.blues.red);
      },
    },
  },
];
