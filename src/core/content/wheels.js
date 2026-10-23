import { AMERICAN_ORDER, EUROPEAN_ORDER, MIRROR_ORDER } from '../wheel.js';

// Starting wheels (design doc 7.2): chosen with the chip set on the chip
// select, each opened by one of the Vault's locks (decision 29). Each is data,
// read when a run begins (core/house.js) and by the rules that differ:
//
//   order        the numbers round the rim, from the zero, clockwise
//   lock         the Vault lock that opens it (0: open from the start)
//   nightTokens  tokens added to the night's token at the Cage
//   debtTokens   tokens added to a paid debt's reward
//   gilded       this many pockets start gilded, drawn on the pockets stream
//   bone         this many black pockets start Bone, spread evenly round the rim
//   debtMult     every debt owes this much more
//   devilFrom    the debt the Devil is live from (doc 5.7: debt 3)
//
// The array order is the chip select's: append, never reorder.

export const WHEEL_LIST = [
  {
    id: 'european',
    name: 'European',
    lock: 0,
    order: EUROPEAN_ORDER,
    upside: 'One zero: 37 pockets, the House’s own wheel.',
    downside: 'Nothing else.',
  },
  {
    id: 'american',
    name: 'American',
    lock: 1,
    order: AMERICAN_ORDER,
    debtTokens: 1,
    upside: '+1 token each time a debt is paid.',
    downside: 'A 00 pocket across from the zero: 38 pockets, and 00 is in no outside bet.',
  },
  {
    id: 'gilded',
    name: 'Gilded',
    lock: 2,
    order: EUROPEAN_ORDER,
    gilded: 6,
    debtMult: 1.25,
    upside: '6 pockets start gilded: chips that win there pay ×2.',
    downside: 'Every debt owes a quarter more.',
  },
  {
    id: 'bone',
    name: 'Bone',
    lock: 3,
    order: EUROPEAN_ORDER,
    bone: 6,
    devilFrom: 1,
    upside: 'Every third black pocket is Bone: +1 token whenever the ball lands there.',
    downside: 'The Devil is live from debt 1.',
  },
  {
    id: 'mirror',
    name: 'Mirror',
    lock: 4,
    order: MIRROR_ORDER,
    upside: 'The numbers run 0 to 36 round the rim, as on the felt: Nudge carries the ball along streets and splits.',
    downside: 'Red and black no longer take turns, so Nudge seldom changes a colour.',
  },
];
