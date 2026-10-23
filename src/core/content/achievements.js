import { gte } from '../num.js';

// The Almanac's achievements (design doc 7.4). Each is data: a name, what it
// asks, and `check(state, events)`, read after every action with the run as
// it now stands and the events that action made. They unlock nothing yet:
// Phase 7's new talismans and records are what they will open (decision 29).
// The array order is the Almanac's: append, never reorder.

const happened = (events, type) => events.some((e) => e.type === type);

export const ACHIEVEMENT_LIST = [
  {
    id: 'same_again',
    name: 'Same Again',
    text: 'The same number comes up three times in one night.',
    check: (s) => Object.values(s.tally.round.numbers ?? {}).some((n) => n >= 3),
  },
  {
    id: 'out_of_the_red',
    name: 'Out of the Red',
    text: 'Pay debt 4.',
    check: (s) => s.stats.debtsPaid >= 4,
  },
  {
    id: 'step_out',
    name: 'Step Out of the Light',
    text: 'Reach your goal and walk away.',
    check: (s, events) => happened(events, 'left'),
  },
  {
    id: 'the_vault',
    name: 'The Vault',
    text: 'Open the Vault.',
    check: (s, events) => happened(events, 'vaultOpened'),
  },
  {
    id: 'paid_in_spite',
    name: 'Paid in Spite',
    text: 'Pay a debt in which the Devil fired.',
    check: (s, events) => events.some((e) => e.type === 'debtPaid' && e.devilFired),
  },
  {
    id: 'bare_hands',
    name: 'Bare Hands',
    text: 'Pay debt 3 with no talisman on the rail.',
    check: (s, events) => events.some((e) => e.type === 'debtPaid' && e.debt === 3) && s.rail.length === 0,
  },
  {
    id: 'a_full_rail',
    name: 'A Full Rail',
    text: 'Hang a talisman on every hook of the rail.',
    check: (s) => s.rail.length > 0 && s.rail.length >= s.railHooks,
  },
  {
    id: 'ride_the_lean',
    name: 'Ride the Lean',
    text: 'Win on a spin the House leaned +3 or more.',
    check: (s, events) => events.some((e) => e.type === 'spin' && !e.result.miss && (e.result.luck?.lean ?? 0) >= 3),
  },
  {
    id: 'a_thousand',
    name: 'A Thousand in a Breath',
    text: 'Win 1,000 coins in one spin.',
    check: (s, events) => events.some((e) => e.type === 'spin' && gte(e.result.total ?? 0, 1000)),
  },
  {
    id: 'platinum',
    name: 'Platinum',
    text: 'Turn a pocket platinum.',
    check: (s) => s.wheel.pockets.some((p) => p.enh === 'platinum'),
  },
  {
    id: 'a_wheel_of_your_own',
    name: 'A Wheel of Your Own',
    text: 'Play a wheel of 45 pockets or more.',
    check: (s) => s.wheel.pockets.length >= 45,
  },
  {
    id: 'the_house_at_its_worst',
    name: 'The House at Its Worst',
    text: 'Reach your goal at House Edge 5.',
    check: (s, events) => happened(events, 'goalReached') && s.edge >= 5,
  },
];
