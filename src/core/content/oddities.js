// Oddities (design doc 5.11, 6.7): the Curio Cabinet's fourth compartment.
// Wheel work (a wheel-maker's odds and ends), a bet level, chips and records.
// Each is data:
//
//   name, text   as the Cabinet's tag and note say it
//   rarity       the Cabinet's reroll weights (economy.js)
//   spins        the price, in coins: this many of the debt's spins (owner's
//                decision 27: wheel work is bought with the money the Cage
//                wants, so building the wheel is a bet against the debt)
//   picks        what you choose when you buy it, in order: each names the
//                work (core/wheelwork.js) and what it acts on. `pocket` work
//                picks one pocket; `number` work acts on every pocket with
//                that number; `bet` work picks a kind of bet.
//   gives        what it puts in your hands: { chip: material } a new chip
//                (six at most), or { record: true } the record the
//                compartment was stocked with (one not yet owned)
//
// Bought, it does its work at once and is gone: nothing waits in a pocket.
// The array order is part of determinism: append, never reorder.

export const ODDITY_LIST = [
  {
    id: 'gold_leaf',
    name: 'Gold Leaf',
    rarity: 'uncommon',
    spins: 40,
    text: 'Gild 2 pockets: chips that win there pay ×2. A pocket gilded twice turns platinum (×3).',
    picks: [{ op: 'gild' }, { op: 'gild' }],
  },
  {
    id: 'brass_shim',
    name: 'Brass Shim',
    rarity: 'common',
    spins: 20,
    text: 'Widen a number: every pocket with it grows +0.5 wide.',
    picks: [{ op: 'widen', on: 'number' }],
  },
  {
    id: 'jewellers_file',
    name: 'Jeweller’s File',
    rarity: 'common',
    spins: 10,
    text: 'Narrow a number: every pocket with it shrinks 0.5 (to 0.25 at least).',
    picks: [{ op: 'narrow', on: 'number' }],
  },
  {
    id: 'red_lacquer',
    name: 'Red Lacquer',
    rarity: 'common',
    spins: 20,
    text: 'Paint 3 pockets red. Red and Black bets follow the paint.',
    picks: [{ op: 'paint', color: 'red' }, { op: 'paint', color: 'red' }, { op: 'paint', color: 'red' }],
  },
  {
    id: 'black_lacquer',
    name: 'Black Lacquer',
    rarity: 'common',
    spins: 20,
    text: 'Paint 3 pockets black. Red and Black bets follow the paint.',
    picks: [{ op: 'paint', color: 'black' }, { op: 'paint', color: 'black' }, { op: 'paint', color: 'black' }],
  },
  {
    id: 'casting_mould',
    name: 'Casting Mould',
    rarity: 'uncommon',
    spins: 30,
    text: 'Cast a second pocket with the same number and colour, beside the first.',
    picks: [{ op: 'duplicate' }],
  },
  {
    id: 'chisel',
    name: 'Chisel',
    rarity: 'common',
    spins: 20,
    text: 'Chisel 2 pockets out of the wheel. No fewer than 18 stay.',
    picks: [{ op: 'remove' }, { op: 'remove' }],
  },
  {
    id: 'horseshoe_nail',
    name: 'Horseshoe Nail',
    rarity: 'uncommon',
    spins: 20,
    text: 'Make a pocket Lucky: +2 Nudge on the spin after the ball lands there.',
    picks: [{ op: 'enhance', enh: 'lucky' }],
  },
  {
    id: 'glass_pane',
    name: 'Glass Pane',
    rarity: 'rare',
    spins: 50,
    text: 'Make a pocket Glass: chips that win there pay ×4, but one landing in four shatters it into a blank.',
    picks: [{ op: 'enhance', enh: 'glass' }],
  },
  {
    id: 'bone_inlay',
    name: 'Bone Inlay',
    rarity: 'common',
    spins: 10,
    text: 'Make a pocket Bone: +1 token whenever the ball lands there.',
    picks: [{ op: 'enhance', enh: 'bone' }],
  },
  {
    id: 'ember',
    name: 'Ember',
    rarity: 'rare',
    spins: 40,
    text: 'Make a pocket Ember: a chip that wins there gains +1 value, for good.',
    picks: [{ op: 'enhance', enh: 'ember' }],
  },
  // Phase 5, second half: a bet level, chips and records.
  {
    id: 'odds_plate',
    name: 'Brass Odds Plate',
    rarity: 'rare',
    spins: 80,
    text: 'Raise a kind of bet a level: tap one on the felt. Every bet of that kind pays a quarter of its base odds more (a straight-up 36 → 45 → 54).',
    picks: [{ op: 'level', on: 'bet' }],
  },
  {
    id: 'house_chip',
    name: 'House Chip',
    rarity: 'uncommon',
    spins: 50,
    text: 'One more chip, the House’s own: value 1, no rule of its own.',
    picks: [],
    gives: { chip: 'normal' },
  },
  {
    id: 'clay_chip',
    name: 'Clay Chip',
    rarity: 'common',
    spins: 40,
    text: 'One more chip, of clay: value 1, pays ×0.75.',
    picks: [],
    gives: { chip: 'clay' },
  },
  {
    id: 'bone_chip',
    name: 'Bone Chip',
    rarity: 'uncommon',
    spins: 50,
    text: 'One more chip, of bone: value 1, pays ×1.15, and stays where it lies until the night ends.',
    picks: [],
    gives: { chip: 'bone' },
  },
  {
    id: 'glass_chip',
    name: 'Glass Chip',
    rarity: 'rare',
    spins: 60,
    text: 'One more chip, of glass: value 1, pays ×1.65.',
    picks: [],
    gives: { chip: 'glass' },
  },
  {
    id: 'gold_chip',
    name: 'Gold Chip',
    rarity: 'rare',
    spins: 50,
    text: 'One more chip, of gold: value 1, pays ×0.6, and +1 token when it wins (three a night from all your gold).',
    picks: [],
    gives: { chip: 'gold' },
  },
  {
    id: 'record_sleeve',
    name: 'A Record',
    rarity: 'rare',
    spins: 50,
    text: 'A record for the gramophone. It plays at once if nothing is playing.',
    picks: [],
    gives: { record: true },
  },
];
