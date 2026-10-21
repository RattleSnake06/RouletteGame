// Engravings (design doc 6.4): random marks on talismans. The Cabinet engraves
// an offer from the second debt; some fortunes engrave too. An engraving acts
// straight after its talisman, on the talisman's own hook, and goes where the
// talisman goes. Twin Mirrors and Tuning Forks repeat the talisman, not its
// engraving.
//
//   chance   per Cabinet offer, from debt 2
//   hooks    effect hooks, as for talismans (src/core/effects.js)

export const ENGRAVING_LIST = [
  {
    id: 'gilt',
    name: 'Gilt',
    text: '+2 tokens when a debt is paid.',
    chance: 0.02,
    hooks: {
      debtPaid(ctx) {
        ctx.gainTokens(2);
      },
    },
  },
  {
    id: 'keen',
    name: 'Keen',
    text: 'Winning chips: +1 Stake.',
    chance: 0.015,
    hooks: {
      chipStake(ctx) {
        ctx.addStake(1);
      },
    },
  },
  {
    id: 'sharp',
    name: 'Sharp',
    text: 'Winning chips: +1 Odds.',
    chance: 0.01,
    hooks: {
      chipOdds(ctx) {
        ctx.addOddsMult(1);
      },
    },
  },
  {
    id: 'echo',
    name: 'Echo',
    text: "The spin's last payout pays again.",
    chance: 0.01,
    hooks: {
      spinPaid(ctx) {
        const last = ctx.lines[ctx.lines.length - 1];
        if (last) ctx.bonusCoins(last.amount);
      },
    },
  },
  {
    id: 'restless',
    name: 'Restless',
    text: 'One free restock each debt.',
    chance: 0.02,
    // run.js reads it: the first restock of a debt is free while it hangs.
    freeRestock: true,
  },
  {
    id: 'thrifty',
    name: 'Thrifty',
    text: 'The Cage pays 3% more interest.',
    chance: 0.015,
    hooks: {
      interestRate(ctx) {
        ctx.addRate(0.03);
      },
    },
  },
  {
    id: 'cursed',
    name: 'Cursed',
    text: "The Devil's chance +0.6% (once he is live).",
    chance: 0.015,
    cursed: true,
    hooks: {
      devilChance(ctx) {
        ctx.addChance(0.006);
      },
    },
  },
];
