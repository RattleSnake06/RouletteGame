// House Edge levels (design doc 7.2): chosen on the chip select, each opened
// by reaching the goal at the level before it (decision 29). They stack:
// level 3 plays the rules of levels 1, 2 and 3. Read by core/house.js.

export const EDGE_LIST = [
  {
    level: 1,
    name: 'The House’s pocket',
    text: 'A green pocket with no number joins the wheel, across from the zero. Every bet loses there.',
  },
  { level: 2, name: 'The Devil wakes early', text: 'The Devil is live from debt 2.' },
  { level: 3, name: 'A thin purse', text: 'No token at the end of a night.' },
  { level: 4, name: 'Heavier debts', text: 'Every debt owes a quarter more.' },
  { level: 5, name: 'A cold House', text: 'Every Lean is 1 weaker (1 at least).' },
];
