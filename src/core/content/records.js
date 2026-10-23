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
//   hooks      effect hooks, as for talismans; a record acts before the rail

// Tuned with the simulator (doc 9.8).
const RECORD = {
  boogieMax: 2, // drafted without a cap
  nocturne: 3, // drafted ×4
};

const lastSpinOfNight = (state) => state.phase === 'betting' && state.spinsLeft === 1;

export const RECORD_LIST = [
  {
    id: 'waltz_in_green',
    name: 'Waltz in Green',
    rule: '+1 Nudge on every spin. Nights cost half again as much.',
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
    rule: 'Chips pay ×3. A debt it plays during owes twice as much.',
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
    rule: `Each paying spin: +1 Stake (up to +${RECORD.boogieMax}), until a spin pays nothing.`,
    tune: 'boogie',
    init: () => ({ streak: 0 }),
    hooks: {
      chipStake(ctx) {
        if (ctx.self.streak > 0) ctx.addStake(ctx.self.streak);
      },
      afterSpin(ctx) {
        const streak = ctx.result.miss ? 0 : Math.min(RECORD.boogieMax, ctx.self.streak + 1);
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
    rule: 'The wheel turns backwards. Any Nudge reaches 1 pocket further.',
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
];
