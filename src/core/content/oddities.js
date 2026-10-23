// Oddities (design doc 5.11, 6.7): the Curio Cabinet's fourth compartment.
// For now they are wheel work, a wheel-maker's odds and ends; chips, bet
// levels and records join them in the second half of Phase 5. Each is data:
//
//   name, text   as the Cabinet's tag and note say it
//   rarity       the Cabinet's reroll weights (economy.js)
//   price        tokens
//   picks        what you choose when you buy it, in order: each names the
//                work (core/wheelwork.js) and what it acts on. `pocket` work
//                picks one pocket; `number` work acts on every pocket with
//                that number.
//
// Bought, it does its work at once and is gone: nothing waits in a pocket.
// The array order is part of determinism: append, never reorder.

export const ODDITY_LIST = [
  {
    id: 'gold_leaf',
    name: 'Gold Leaf',
    rarity: 'uncommon',
    price: 4,
    text: 'Gild 2 pockets: chips that win there pay ×2. A pocket gilded twice turns platinum (×3).',
    picks: [{ op: 'gild' }, { op: 'gild' }],
  },
  {
    id: 'brass_shim',
    name: 'Brass Shim',
    rarity: 'common',
    price: 3,
    text: 'Widen a number: every pocket with it grows +0.5 wide.',
    picks: [{ op: 'widen', on: 'number' }],
  },
  {
    id: 'jewellers_file',
    name: 'Jeweller’s File',
    rarity: 'common',
    price: 2,
    text: 'Narrow a number: every pocket with it shrinks 0.5 (to 0.25 at least).',
    picks: [{ op: 'narrow', on: 'number' }],
  },
  {
    id: 'red_lacquer',
    name: 'Red Lacquer',
    rarity: 'common',
    price: 2,
    text: 'Paint a pocket red. Red and Black bets follow the paint.',
    picks: [{ op: 'paint', color: 'red' }],
  },
  {
    id: 'black_lacquer',
    name: 'Black Lacquer',
    rarity: 'common',
    price: 2,
    text: 'Paint a pocket black. Red and Black bets follow the paint.',
    picks: [{ op: 'paint', color: 'black' }],
  },
  {
    id: 'casting_mould',
    name: 'Casting Mould',
    rarity: 'uncommon',
    price: 4,
    text: 'Cast a second pocket with the same number and colour, beside the first.',
    picks: [{ op: 'duplicate' }],
  },
  {
    id: 'chisel',
    name: 'Chisel',
    rarity: 'common',
    price: 3,
    text: 'Chisel a pocket out of the wheel. No fewer than 18 stay.',
    picks: [{ op: 'remove' }],
  },
  {
    id: 'horseshoe_nail',
    name: 'Horseshoe Nail',
    rarity: 'uncommon',
    price: 3,
    text: 'Make a pocket Lucky: +2 Nudge on the spin after the ball lands there.',
    picks: [{ op: 'enhance', enh: 'lucky' }],
  },
  {
    id: 'glass_pane',
    name: 'Glass Pane',
    rarity: 'rare',
    price: 4,
    text: 'Make a pocket Glass: chips that win there pay ×4, but one landing in four shatters it into a blank.',
    picks: [{ op: 'enhance', enh: 'glass' }],
  },
  {
    id: 'bone_inlay',
    name: 'Bone Inlay',
    rarity: 'common',
    price: 2,
    text: 'Make a pocket Bone: +1 token whenever the ball lands there.',
    picks: [{ op: 'enhance', enh: 'bone' }],
  },
  {
    id: 'ember',
    name: 'Ember',
    rarity: 'rare',
    price: 5,
    text: 'Make a pocket Ember: a chip that wins there gains +1 value, for good.',
    picks: [{ op: 'enhance', enh: 'ember' }],
  },
];
