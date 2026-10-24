// The first debt's teaching (design doc 8.4, Phase 8): a short tip the first
// time each thing matters, shown once per profile (profile.taught) and never
// in the way: it lets taps through and fades on its own. `toward` names the
// station a tip points to when it is not in view (its edge tab pulses).
// game.js decides when each one is due; the Info book says the rest.

export const TIPS = {
  lean: {
    title: 'The House leans',
    text: 'The LEAN lamp on the board is lit: the next spin gets free Nudge, so the ball may hop that many pockets toward your chips. Spread straight-ups round the wheel for it.',
  },
  bank: {
    title: 'Coins in hand',
    text: 'What chips win lands in hand. Bank it at the Cage: banked coins count toward the debt and earn 5% at the end of every night.',
    toward: 'cage',
  },
  pity: {
    title: 'The House takes pity',
    text: 'Five misses in a row: +1 Nudge on the next spin, and one more for every miss until something pays. The board shows it in cold blue.',
  },
  nightOver: {
    title: 'The night is over',
    text: 'Banked coins earn their interest now, and the Cage pays a token. When the third night ends, the Cage collects the debt from what you banked.',
    toward: 'cage',
  },
  cabinet: {
    title: 'The Curio Cabinet',
    text: 'Talismans change how your chips pay. They hang on the rail above the table and act left to right. Hold or hover on one to read it; the Cabinet restocks free every night.',
  },
  talisman: {
    title: 'Your first talisman',
    text: 'It acts on every spin from its hook. Drag charms along the rail to change their order; hold or hover on one to read it, or to sell it.',
  },
  bell: {
    title: 'It answers the Bell',
    text: 'Ring the brass bell on the table, or tap the charm’s tag, to use it. Its charges come back each debt.',
  },
  zero: {
    title: 'Madame Zero',
    text: 'Once each debt, pull her lever: she deals three fortune cards and you keep one. Her booth is past the Cage.',
    toward: 'oracle',
  },
  devil: {
    title: 'The Devil is awake',
    text: 'The 666 counter on the Cage is lit. Any spin may now wake the Devil: that spin pays nothing and every coin in hand is lost. Banked coins are safe.',
    toward: 'cage',
  },
  record: {
    title: 'A record',
    text: 'It plays on the gramophone beside Madame Zero and changes one rule while it plays. Swapping records is free.',
    toward: 'oracle',
  },
};
