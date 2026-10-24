// Balance simulator: plays many runs headless with simple bots that drive the
// real act() and reports how far they get (design doc 9.8).
//
//   npm run sim                         every bot, 2000 runs each
//   npm run sim -- --runs 5000 --bot adaptive
//   npm run sim -- --bot solo:glass_eye  one talisman from the first spin
//   npm run sim -- --bot solo:brass_scales,string_of_pearls  several, left to right
//   npm run sim -- --skip hamsa,mousetrap  bots never buy, take or play these (talismans,
//                                       fortunes or records), to measure what they add
//   npm run sim -- --no-oracle           bots never visit Madame Zero (no fortunes, no records)
//   npm run sim -- --no-wheel            bots never buy oddities (wheel work) nor stamp pockets
//   npm run sim -- --chips bone          the run's starting chip set (decision 26; default normal)
//   npm run sim -- --wheel american      the starting wheel (doc 7.2; default european)
//   npm run sim -- --edge 3              the House Edge level, 0–5 (doc 7.2)
//   npm run sim -- --locks 2             the Vault's open locks (the goal, the gramophone's second slot)
//   npm run sim -- --figures 6           figures standing in the dark (Danse Macabre)
//   npm run sim -- --pool start          a new player's pool: nothing the Vault or the feats open
//                                       (default full: everything open, decision 29)
//   npm run sim -- --tempo               one short night per debt in debts 1–2
//   npm run sim -- --set nightTokens=0   override an ECONOMY number
//   npm run sim -- --set luck.pityBase=3  override a LUCK (nudge.js) or devil.base number
//   npm run sim -- --set debt.2=240       override what a debt owes

import { FORTUNES, MATERIALS, MAX_EDGE, RECORDS, STARTING_WHEELS, TALISMANS, contentName, getEnhancement, getFortune, getMaterial, getOddity, getRecord, getStartingWheel, getTalisman } from '../src/core/content/index.js';
import { getBet } from '../src/core/bets.js';
import { cookieNumber } from '../src/core/content/talismans.js';
import { DEVIL, devilLive } from '../src/core/devil.js';
import { untouchable } from '../src/core/house.js';
import { DEBT_TABLE, ECONOMY, priceOf } from '../src/core/economy.js';
import { LUCK, nudgeFor, nudgeLandings } from '../src/core/nudge.js';
import { add, format, gt, gte, lt, sub, toNumber } from '../src/core/num.js';
import { evaluate } from '../src/core/payout.js';
import { PHASE, act, canAfford, copyRun, costOf, createRun, grantTalisman, hooksFor, isFinalNight, nextRestockCost, owed, spinCost } from '../src/core/run.js';
import { bellView, cabinetView, oracleView } from '../src/core/selectors.js';
import { defaultColor } from '../src/core/wheel.js';
import { doWork, workTargets } from '../src/core/wheelwork.js';
import { liveChances, liveWheel } from '../src/core/widths.js';

// --flag value pairs; a flag given more than once (--set) collects its values.
const args = {};
process.argv.slice(2).forEach((a, i, all) => {
  if (!a.startsWith('--')) return;
  const key = a.slice(2);
  const value = all[i + 1]?.startsWith('--') ? true : (all[i + 1] ?? true);
  args[key] = key in args ? [args[key]].flat().concat(value) : value;
});
const RUNS = Number(args.runs ?? 2000);
const MAX_DEBT = Number(args['max-debt'] ?? 8);
const TEMPO = !!args.tempo;
// --no-new: bots never buy the luck and Devil talismans (to measure the House's luck alone).
const LUCK_ITEMS = ['rabbits_foot', 'pocket_watch', 'salt_cellar', 'evil_eye', 'compass', 'lodestone', 'wind_up_key', 'hamsa', 'four_leaf_clover', 'dowsing_rod', 'weathervane', 'holy_water'];
const NO_NEW = !!args['no-new'];
const SKIP = typeof args.skip === 'string' ? args.skip.split(',') : [];
for (const id of SKIP) if (!getTalisman(id) && !getFortune(id) && !getRecord(id) && !getOddity(id)) throw new Error(`--skip: no talisman, fortune, record or oddity ${id}`);
const NO_ORACLE = !!args['no-oracle'];
const NO_WHEEL = !!args['no-wheel'];
// What a token is worth to a bot weighing wheel work (Bone pockets pay
// tokens), in spins' cost; and how much more than its price wheel work must
// promise over the spins ahead before a bot pays for it.
const TOKEN_SPINS = Number(args['token-spins'] ?? 2);
const WHEEL_MARGIN = Number(args['wheel-margin'] ?? 1.5);
const CHIPS = typeof args.chips === 'string' ? args.chips : 'normal';
if (!MATERIALS.some((m) => m.id === CHIPS)) throw new Error(`--chips: no chip set ${CHIPS} (${MATERIALS.map((m) => m.id).join(', ')})`);
const WHEEL = typeof args.wheel === 'string' ? args.wheel : 'european';
if (!STARTING_WHEELS.some((w) => w.id === WHEEL)) throw new Error(`--wheel: no starting wheel ${WHEEL} (${STARTING_WHEELS.map((w) => w.id).join(', ')})`);
const EDGE = Number(args.edge ?? 0);
if (!Number.isInteger(EDGE) || EDGE < 0 || EDGE > MAX_EDGE) throw new Error(`--edge: 0 to ${MAX_EDGE}`);
const LOCKS = Number(args.locks ?? 0);
const FIGURES = Number(args.figures ?? 0);
const POOL = typeof args.pool === 'string' ? args.pool : 'full';
if (!['start', 'full'].includes(POOL)) throw new Error('--pool: start or full');
const OPENED = POOL === 'full' ? [...TALISMANS, ...FORTUNES, ...RECORDS].filter((d) => d.unlock).map((d) => d.id) : [];
// --set overrides are checked, so a typo fails loudly instead of quietly
// running the drafted numbers.
const TABLES = { economy: ECONOMY, luck: LUCK, devil: DEVIL };
for (const kv of args.set === undefined ? [] : [args.set].flat()) {
  const fail = (why) => {
    throw new Error(`--set ${kv}: ${why}`);
  };
  if (typeof kv !== 'string' || !kv.includes('=')) fail('expected key=value');
  const k = kv.slice(0, kv.indexOf('='));
  const v = kv.slice(kv.indexOf('=') + 1);
  const [table, key] = k.includes('.') ? k.split('.') : ['economy', k];
  // --set debt.2=240 (or 1,332) changes what debt 2 owes.
  if (table === 'debt') {
    const i = Number(key) - 1;
    const owed = Number(v.replaceAll(',', ''));
    if (!Number.isInteger(i) || i < 0 || i >= DEBT_TABLE.length) fail(`debts 1-${DEBT_TABLE.length} can be set`);
    if (!Number.isFinite(owed) || owed <= 0) fail('not a positive number');
    DEBT_TABLE[i].owed = owed;
    continue;
  }
  const target = TABLES[table];
  if (!target) fail(`unknown table "${table}" (economy, luck, devil, debt)`);
  if (!(key in target)) fail(`${table} has no "${key}" (${Object.keys(target).join(', ')})`);
  if (Array.isArray(target[key])) {
    const list = v.split(',').map(Number);
    if (list.length !== target[key].length || !list.every(Number.isFinite)) fail(`expected ${target[key].length} numbers separated by commas`);
    target[key] = list;
  } else {
    const n = Number(v);
    if (!Number.isFinite(n)) fail('not a number');
    target[key] = n;
  }
}

// Phase 5 targets for the best bot (doc 9.8, decision 27), a step above
// Phase 4's: debt 1 ≥ 90%, debt 2 70–85%, debt 3 35–50%, debt 4 15–25%.
// Wheel work carries the later debts.
// Debts 1–4: decision 27's, for a new player's pool (what a first run
// meets). Debts 5–8: the gentle tail (decision 30), with everything open:
// only a run with a lock open has a goal past debt 4, and by then most of
// the pool is. Each debt is graded on its own pool; the other prints as
// a figure only.
const TARGETS = [
  [1, 0.9, 1, 'start'],
  [2, 0.7, 0.85, 'start'],
  [3, 0.35, 0.5, 'start'],
  [4, 0.15, 0.25, 'start'],
  [5, 0.08, 0.15, 'full'],
  [6, 0.04, 0.1, 'full'],
  [7, 0.02, 0.06, 'full'],
  [8, 0.01, 0.04, 'full'],
];

// --- Where chips go ---------------------------------------------------------

// Spread around the wheel, not the table: the run's own wheel (the Mirror's
// order is the felt's). The European six were chosen by hand.
const ORDER = getStartingWheel(WHEEL).order.filter((n) => n <= 36);
const STRAIGHTS = WHEEL === 'european' ? [32, 11, 9, 26, 5, 18] : Array.from({ length: 6 }, (_, i) => ORDER[(1 + 6 * i) % ORDER.length]);
const CORNERS = ['corner:1-2-4-5', 'corner:17-18-20-21', 'corner:29-30-32-33'];
/** The last spin's number, unless the Devil burned it. */
const lastNumber = (s) => {
  const h = s.history[s.history.length - 1];
  return h && !h.devil ? h.number : null;
};
const LAYOUT = {
  red: () => 'red',
  black: () => 'black',
  even: () => 'even',
  outside: (i) => `dozen:${(i % 3) + 1}`,
  inside: (i) => `straight:${STRAIGHTS[i % STRAIGHTS.length]}`,
  corner: (i) => CORNERS[i % CORNERS.length],
  zero: (i) => `straight:${STRAIGHTS[i % STRAIGHTS.length]}`,
  // Straight-ups evenly around the wheel, so any Nudge has something to reach.
  spread: (i, k) => `straight:${ORDER[Math.floor((i * ORDER.length) / k + 4) % ORDER.length]}`,
  // Seesaw: the half the last spin did not land in.
  seesaw: (i, k, s) => {
    const n = lastNumber(s);
    return n >= 1 && n <= 18 ? 'high' : n >= 19 ? 'low' : 'red';
  },
  // Ouroboros: every chip on the number that just came up.
  chase: (i, k, s) => (lastNumber(s) === null ? LAYOUT.spread(i, k) : `straight:${lastNumber(s)}`),
  thirteen: () => 'straight:13',
  // The racetrack (Phase 7): the sectors the Croupier's Glove opens, the Snake.
  sector: (i) => ['voisins', 'tiers', 'orphelins'][i % 3],
  snake: () => 'snake',
  // The Fortune Cookie: the first chip on the number it names, the rest spread.
  cookie: (i, k, s) => (i === 0 ? `straight:${cookieNumber(s)}` : LAYOUT.spread(i, k)),
};

const owns = (s, id) => s.rail.some((t) => t.id === id);

/** Picks a chip layout from the rail: what the talismans reward. */
function layoutFor(s, fallback) {
  if (owns(s, 'croupiers_glove')) return 'sector';
  if (owns(s, 'snakeskin')) return 'snake';
  if ((owns(s, 'brass_knuckles') || owns(s, 'surveyors_chain') || owns(s, 'table_map')) && !owns(s, 'horseshoe') && !owns(s, 'croupiers_rake')) return 'corner';
  if (owns(s, 'fortune_cookie') && !owns(s, 'horseshoe')) return 'cookie';
  if (owns(s, 'horseshoe') || owns(s, 'croupiers_rake') || owns(s, 'house_key')) return 'inside';
  if (owns(s, 'abacus')) return 'outside';
  if (owns(s, 'brass_scales') || owns(s, 'string_of_pearls')) return 'even';
  if (owns(s, 'red_ribbon')) return 'red';
  if (owns(s, 'black_cat') || owns(s, 'raven_feather')) return 'black';
  return fallback;
}

/** Layouts worth weighing against the usual one, from what is on the rail. */
function extraLayouts(s) {
  const out = [];
  // Several chips winning together (the Beckoning Cat, the Domino).
  if (owns(s, 'beckoning_cat') || owns(s, 'domino')) out.push('red');
  // The Mousetrap's Stake is worth most on a straight-up.
  if (owns(s, 'mousetrap')) out.push('spread');
  if (owns(s, 'ouroboros')) out.push('chase');
  if (owns(s, 'thirteen_ball')) out.push('thirteen');
  if (owns(s, 'seesaw')) out.push('seesaw');
  if (owns(s, 'black_cat') || owns(s, 'raven_feather')) out.push('black');
  if (owns(s, 'brass_scales') || owns(s, 'string_of_pearls')) out.push('even');
  return out;
}

// --- Bots -------------------------------------------------------------------

// Lists with the twenty newer talismans; --old-pool plays the Phase 3 pool
// (the Cabinet never deals the newer ones) to compare against.
const OLD_POOL = !!args['old-pool'];
const NEWER = ['tuning_fork', 'brass_scales', 'string_of_pearls', 'wind_up_key', 'hamsa', 'beckoning_cat', 'grandmothers_purse', 'lost_wallet', 'magpie', 'domino', 'four_leaf_clover', 'holy_water', 'dowsing_rod', 'mousetrap', 'weathervane', 'seesaw', 'ouroboros', 'thirteen_ball', 'black_cat', 'golden_ball'];
// Phase 7's talismans sit where each family would want them: the multi-ball
// ones and the Hourglass help any layout; the Glove and Snakeskin turn the
// outside builder to the racetrack.
const LISTS = {
  red: ['golden_ball', 'loaded_wheel', 'bag_of_marbles', 'red_ribbon', 'rose_brooch', 'gold_tooth', 'mousetrap', 'domino', 'pair_of_dice', 'ivory_ball', 'matchbook', 'twin_mirrors', 'tuning_fork', 'hot_coals', 'glass_eye', 'pocket_calendar', 'magpie', 'hourglass', 'beckoning_cat', 'rabbits_foot', 'saints_medal', 'ledger', 'savings_book', 'black_cat', 'raven_feather', 'jugglers_ball', 'usurers_seal', 'tally_stick', 'pawn_ticket', 'crumpled_receipt', 'grandmothers_purse', 'piggy_bank', 'wheel_of_fortune', 'hand_bell', 'pocket_watch', 'hamsa', 'marble', 'wishbone', 'chalk_stub', 'lucky_penny', 'lost_wallet'],
  even: ['golden_ball', 'bag_of_marbles', 'string_of_pearls', 'brass_scales', 'gold_tooth', 'tuning_fork', 'ivory_ball', 'mousetrap', 'domino', 'matchbook', 'twin_mirrors', 'hot_coals', 'magpie', 'pocket_calendar', 'hourglass', 'beckoning_cat', 'glass_eye', 'rabbits_foot', 'ledger', 'savings_book', 'jugglers_ball', 'usurers_seal', 'tally_stick', 'pawn_ticket', 'crumpled_receipt', 'grandmothers_purse', 'pocket_watch', 'hamsa', 'marble', 'wishbone', 'lucky_penny', 'lost_wallet'],
  outside: ['golden_ball', 'bag_of_marbles', 'number_punches', 'croupiers_glove', 'snakeskin', 'abacus', 'gold_tooth', 'seesaw', 'ivory_ball', 'matchbook', 'domino', 'hot_coals', 'ledger', 'twin_mirrors', 'tuning_fork', 'pocket_calendar', 'hourglass', 'glass_eye', 'rabbits_foot', 'savings_book', 'jugglers_ball', 'usurers_seal', 'tally_stick', 'pawn_ticket', 'crumpled_receipt', 'piggy_bank', 'pocket_watch', 'marble', 'wishbone', 'chalk_stub', 'lucky_penny', 'lost_wallet'],
  inside: ['ouroboros', 'golden_ball', 'bag_of_marbles', 'number_punches', 'surveyors_chain', 'metronome', 'croupiers_rake', 'horseshoe', 'lodestone', 'fortune_cookie', 'thirteen_ball', 'house_key', 'gold_tooth', 'ivory_ball', 'twin_mirrors', 'tuning_fork', 'mirror_shard', 'mousetrap', 'wind_up_key', 'glass_eye', 'rabbits_foot', 'compass', 'pocket_calendar', 'hourglass', 'dowsing_rod', 'weathervane', 'table_map', 'zeros_coin', 'lucky_penny', 'wheel_of_fortune', 'hand_bell', 'pocket_watch', 'hamsa', 'jugglers_ball', 'four_leaf_clover', 'ledger', 'pawn_ticket', 'crumpled_receipt', 'marble', 'lost_wallet'],
  luck: ['ouroboros', 'bag_of_marbles', 'number_punches', 'metronome', 'lodestone', 'horseshoe', 'rabbits_foot', 'compass', 'croupiers_rake', 'ivory_ball', 'mirror_shard', 'twin_mirrors', 'tuning_fork', 'dowsing_rod', 'wind_up_key', 'hourglass', 'pocket_watch', 'hamsa', 'four_leaf_clover', 'weathervane', 'mousetrap', 'glass_eye', 'wheel_of_fortune', 'jugglers_ball', 'house_key', 'ledger', 'lucky_penny', 'pawn_ticket', 'crumpled_receipt', 'marble', 'lost_wallet'],
};
// The Pyre (doc 6.8): the engine first, then Kindling to buy and burn.
LISTS.pyre = ['the_pyre', 'phoenix_feather', 'funeral_urn', ...LISTS.red.slice(0, 8), 'kindling', ...LISTS.red.slice(8)];
const OLD_LISTS = {
  red: ['red_ribbon', 'matchbook', 'twin_mirrors', 'glass_eye', 'rabbits_foot', 'ledger', 'pawn_ticket', 'crumpled_receipt', 'piggy_bank', 'wheel_of_fortune', 'pocket_watch', 'lucky_penny'],
  outside: ['abacus', 'matchbook', 'ledger', 'twin_mirrors', 'glass_eye', 'rabbits_foot', 'pawn_ticket', 'crumpled_receipt', 'piggy_bank', 'pocket_watch', 'lucky_penny'],
  inside: ['croupiers_rake', 'horseshoe', 'lodestone', 'house_key', 'twin_mirrors', 'glass_eye', 'rabbits_foot', 'compass', 'lucky_penny', 'wheel_of_fortune', 'pocket_watch', 'ledger', 'pawn_ticket', 'crumpled_receipt'],
  luck: ['lodestone', 'horseshoe', 'rabbits_foot', 'compass', 'croupiers_rake', 'twin_mirrors', 'pocket_watch', 'glass_eye', 'wheel_of_fortune', 'house_key', 'ledger', 'lucky_penny', 'pawn_ticket', 'crumpled_receipt'],
};
if (OLD_POOL) {
  Object.assign(LISTS, OLD_LISTS, { even: OLD_LISTS.red });
  // The Cabinet deals from this same array; getTalisman's lookup is unaffected.
  for (let i = TALISMANS.length - 1; i >= 0; i--) if (NEWER.includes(TALISMANS[i].id)) TALISMANS.splice(i, 1);
}
// The Pyre burns its Kindling at once; a full rail's trade-in burns too.
const FUEL = ['kindling'];
const TIER = OLD_POOL
  ? ['glass_eye', 'red_ribbon', 'matchbook', 'rabbits_foot', 'abacus', 'croupiers_rake', 'twin_mirrors', 'house_key', 'lodestone', 'ledger', 'horseshoe', 'compass', 'brass_knuckles', 'pocket_watch', 'pawn_ticket', 'crumpled_receipt', 'piggy_bank', 'wheel_of_fortune', 'lucky_penny']
  : ['ouroboros', 'golden_ball', 'bag_of_marbles', 'loaded_wheel', 'surveyors_chain', 'number_punches', 'ivory_ball', 'glass_eye', 'string_of_pearls', 'red_ribbon', 'matchbook', 'rabbits_foot', 'mousetrap', 'domino', 'abacus', 'croupiers_rake', 'twin_mirrors', 'house_key', 'lodestone', 'ledger', 'horseshoe', 'thirteen_ball', 'seesaw', 'weathervane', 'compass', 'brass_scales', 'black_cat', 'raven_feather', 'gold_tooth', 'the_pyre', 'pocket_calendar', 'pair_of_dice', 'brass_knuckles', 'pocket_watch', 'pawn_ticket', 'crumpled_receipt', 'piggy_bank', 'wheel_of_fortune', 'lucky_penny', 'lost_wallet'];
const FAMILY_OF = {
  red_ribbon: 'red',
  matchbook: 'red',
  domino: 'red',
  black_cat: 'red',
  raven_feather: 'red',
  pair_of_dice: 'red',
  the_pyre: 'pyre',
  brass_scales: 'even',
  string_of_pearls: 'even',
  abacus: 'outside',
  seesaw: 'outside',
  croupiers_rake: 'inside',
  horseshoe: 'inside',
  house_key: 'inside',
  brass_knuckles: 'inside',
  lodestone: 'inside',
  compass: 'inside',
  ouroboros: 'inside',
  thirteen_ball: 'inside',
  weathervane: 'inside',
  rose_brooch: 'red',
  loaded_wheel: 'red',
  surveyors_chain: 'inside',
  fortune_cookie: 'inside',
  metronome: 'inside',
  croupiers_glove: 'outside',
  snakeskin: 'outside',
};
// Once the Devil is live, safety comes first: these jump to the front of any list.
const SAFETY = OLD_POOL ? ['evil_eye', 'salt_cellar'] : ['holy_water', 'evil_eye', 'salt_cellar'];
const withSafety = (s, list) => (devilLive(s) ? [...SAFETY, ...list.filter((id) => !SAFETY.includes(id))] : list);

const BOTS = {
  'no items': { layout: 'red', noWheel: true, wants: () => [] },
  'red builder': { layout: 'red', leans: true, wants: (s) => withSafety(s, LISTS.red) },
  'outside builder': { layout: 'outside', leans: true, wants: (s) => withSafety(s, LISTS.outside) },
  'inside builder': { layout: 'inside', leans: true, wants: (s) => withSafety(s, LISTS.inside) },
  'luck builder': { layout: 'spread', leans: true, wants: (s) => withSafety(s, LISTS.luck) },
  'pyre builder': { layout: 'red', leans: true, burns: true, wants: (s) => withSafety(s, LISTS.pyre) },
  adaptive: {
    layout: 'red',
    leans: true,
    // The first purchase picks the family; after that, that family's list.
    wants: (s) => {
      const family = s.rail.map((t) => FAMILY_OF[t.id]).find(Boolean);
      return withSafety(s, family ? LISTS[family] : TIER);
    },
  },
  'greedy buyer': { layout: 'red', greedy: true, wants: () => TALISMANS.filter((d) => d.inCabinet).map((d) => d.id) },
};

function botFor(name) {
  if (name === 'solo:none') return { layout: 'red', leans: true, wants: () => [] };
  if (name.startsWith('solo:')) {
    // solo:a,b hangs several from the first spin, left to right.
    const ids = name.slice(5).split(',');
    for (const id of ids) if (!getTalisman(id)) throw new Error(`No talisman ${id}`);
    return { layout: 'red', leans: true, solo: ids, wants: () => [] };
  }
  return BOTS[name];
}

// --- Playing ----------------------------------------------------------------

function step(state, action, tally) {
  const r = act(state, action);
  const rejected = r.events.find((e) => e.type === 'rejected');
  if (rejected) throw new Error(`${action.type} rejected: ${rejected.reason}`);
  if (tally) tally(r.events);
  return r.state;
}

const placementsFor = (s, layout) => Object.fromEntries(s.chips.map((chip, i) => [chip.id, LAYOUT[layout](i, s.chips.length, s)]));

/** Exact expected payout of a layout over every landing (by live width), with this Nudge. */
function nudgedEv(s, layout, luck) {
  // A null layout keeps the chips where they are.
  const probe = layout ? { ...s, placements: placementsFor(s, layout) } : s;
  const chances = liveChances(probe);
  let total = 0;
  for (let i = 0; i < probe.wheel.pockets.length; i++) {
    const { landings } = nudgeLandings(probe, [{ ball: 0, pocketIndex: i }], luck);
    const plan = evaluate(probe, landings);
    total += chances[i] * toNumber(add(plan.chipTotal, plan.bonusCoins));
  }
  return total;
}

/**
 * The bot's layout for the next spin. A bot that plays the Lean compares its
 * usual layout with straight-ups spread around the wheel whenever the next
 * spin has real Nudge (a Lean, pity, a Pocket Watch), and with whatever its
 * talismans reward (the number that just came up for an Ouroboros, 13 for a
 * Thirteen Ball...), and takes the best by exact expected value.
 */
function chooseLayout(s, bot) {
  if (bot.layout === 'spread') return 'spread';
  const usual = layoutFor(s, bot.layout);
  if (!bot.leans) return usual;
  const luck = nudgeFor(s);
  const options = [...new Set([usual, ...extraLayouts(s), ...(luck.total >= 1 ? ['spread'] : [])])];
  if (options.length === 1) return usual;
  let best = usual;
  let bestEv = -1;
  for (const layout of options) {
    const ev = nudgedEv(s, layout, luck);
    if (ev > bestEv) [best, bestEv] = [layout, ev];
  }
  return best;
}

function placeChips(s, bot) {
  const want = placementsFor(s, chooseLayout(s, bot));
  for (const chip of s.chips) {
    // A Bone chip already down stays there until the night ends.
    if (s.fixed.includes(chip.id)) continue;
    if (s.placements[chip.id] !== want[chip.id]) s = step(s, { type: 'placeChip', chipId: chip.id, betId: want[chip.id] });
  }
  return s;
}

const rank = (list, id) => {
  const i = list.indexOf(id);
  return i < 0 ? Infinity : i;
};

/** Buys what the bot wants, trading in its weakest talisman when the rail is full. */
function shop(s, bot, log) {
  for (let guard = 0; guard < 6; guard++) {
    let list = NO_NEW ? bot.wants(s).filter((id) => !LUCK_ITEMS.includes(id)) : bot.wants(s);
    if (OLD_POOL) list = list.filter((id) => !NEWER.includes(id));
    if (SKIP.length) list = list.filter((id) => !SKIP.includes(id));
    if (NO_WHEEL) list = list.filter((id) => id !== 'number_punches');
    // The Hand Bell charges a Bell talisman, so it waits for one.
    if (!s.rail.some((t) => getTalisman(t.id).charges)) list = list.filter((id) => id !== 'hand_bell');
    if (!list.length) return s;
    const view = cabinetView(s);
    const offers = view.slots.filter((o) => o.kind === 'talisman' && o.id && list.includes(o.id));
    if (bot.greedy) offers.sort((a, b) => b.price - a.price);
    else offers.sort((a, b) => rank(list, a.id) - rank(list, b.id));
    let bought = false;
    for (const o of offers) {
      // An instant talisman (the Lost Wallet) never needs a hook.
      const full = !getTalisman(o.id).instant && s.rail.length >= hooksFor(s);
      let sellUid;
      if (full) {
        // A cursed talisman (from a black card) will not come off its hook.
        const worst = s.rail.filter((t) => !getTalisman(t.id).cursed).sort((a, b) => rank(list, b.id) - rank(list, a.id))[0];
        if (!worst || rank(list, worst.id) <= rank(list, o.id)) continue;
        sellUid = worst.uid;
      }
      const refund = sellUid ? s.rail.find((t) => t.uid === sellUid).price : 0;
      if (s.tokens + Math.floor(refund / 2) < o.price) continue;
      s = step(s, { type: 'buy', slot: o.slot, ...(sellUid ? { sellUid } : {}) }, log);
      bought = true;
      break;
    }
    if (bought) {
      if (bot.burns || owns(s, 'the_pyre')) for (const t of s.rail.filter((t) => FUEL.includes(t.id))) s = step(s, { type: 'sell', uid: t.uid }, log);
      s = arrangeMirrors(s, list);
      continue;
    }
    // Nothing wanted is on offer: turn the crank if it is cheap enough.
    const cheapest = Math.min(...list.filter((id) => !owns(s, id)).map((id) => priceOf(getTalisman(id).rarity)));
    const cost = nextRestockCost(s);
    const reserve = add(costOf(s, 'long'), cost);
    if (s.tokens >= cheapest && gte(s.coins, reserve) && s.phase !== PHASE.GAME_OVER) {
      s = step(s, { type: 'restock' }, log);
      continue;
    }
    return s;
  }
  return s;
}

/** Twin Mirrors hangs just left of the best talisman it can copy. */
function arrangeMirrors(s, list) {
  const mirror = s.rail.find((t) => t.id === 'twin_mirrors');
  if (!mirror) return s;
  const best = s.rail
    .filter((t) => t.id !== 'twin_mirrors' && getTalisman(t.id).copyable !== false)
    .sort((a, b) => rank(list, a.id) - rank(list, b.id))[0];
  if (!best) return s;
  const without = s.rail.filter((t) => t !== mirror);
  const to = without.indexOf(best);
  if (s.rail.indexOf(mirror) === to) return s;
  return step(s, { type: 'moveTalisman', uid: mirror.uid, to });
}

/**
 * Bell use: the Glass Eye on the final night's first spin; the Wheel of
 * Fortune held for a spin with real Nudge (a re-throw gets the Nudge again),
 * or near the end; the pig when it matters.
 */
function bell(s, bot, log, { finalNight, spinsLeft }) {
  for (const inst of s.rail) {
    if (inst.id === 'piggy_bank' && gt(inst.data.value, 0)) {
      const short = lt(add(s.deposited, s.coins), owed(s));
      const ripe = gte(inst.data.value, Math.max(1, toNumber(owed(s)) / 4));
      if ((finalNight && spinsLeft <= 1 && short) || ripe) s = step(s, { type: 'ringBell', uid: inst.uid }, log);
    }
  }
  if (bot.greedy) return bellView(s).head ? step(s, { type: 'ringBell' }, log) : s;
  // Each active is rung at its own tag, so one hung to the left never blocks another.
  const ready = (id) => s.rail.find((t) => t.id === id && bellView(s).queue.includes(t.uid));
  const eye = ready('glass_eye');
  if (eye && finalNight) s = step(s, { type: 'ringBell', uid: eye.uid }, log);
  const wheel = ready('wheel_of_fortune');
  if (wheel && spinsLeft > 0) {
    // Held for a spin with real Nudge, but only when this layout can still miss.
    const nudged = bot.leans && nudgeFor(s).total >= 3 && canMiss(s);
    if ((finalNight && spinsLeft <= 2) || nudged) s = step(s, { type: 'ringBell', uid: wheel.uid }, log);
  }
  // The Dowsing Rod is worth most on a quiet spin (+5 lets spread straight-ups
  // reach most of the wheel; on a Lean they reach much of it anyway), or it
  // spends itself on the debt's last night.
  const rod = ready('dowsing_rod');
  const quiet = () => {
    const l = nudgeFor(s);
    return l.lean === 0 && l.pity === 0;
  };
  if (rod && spinsLeft > 0 && ((finalNight && spinsLeft <= 2) || quiet())) s = step(s, { type: 'ringBell', uid: rod.uid }, log);
  // The Number Punches, as soon as they have a charge.
  const punches = !NO_WHEEL && s.rail.find((t) => t.id === 'number_punches' && t.charges > 0);
  if (punches) s = punch(s, bot, log, punches);
  return s;
}

/** Could the next spin pay nothing with the chips as they are, Nudge included? */
function canMiss(s) {
  const luck = nudgeFor(s);
  for (let i = 0; i < s.wheel.pockets.length; i++) {
    const { landings } = nudgeLandings(s, [{ ball: 0, pocketIndex: i }], luck);
    if (evaluate(s, landings).miss) return true;
  }
  return false;
}

// --- Wheel work (Phase 5) ----------------------------------------------------

/**
 * What the bot's chips pay on each pocket with no Nudge (coins, and tokens
 * at a bot's rate), with the live widths: { pay, w, total, ev }.
 */
function payVector(s, tokenCoins) {
  const { pockets } = liveWheel(s);
  const pay = s.wheel.pockets.map((_, i) => {
    const plan = evaluate(s, [{ ball: 0, pocketIndex: i }]);
    return toNumber(add(plan.chipTotal, plan.bonusCoins)) + plan.bonusTokens * tokenCoins;
  });
  const w = pockets.map((p) => p.width);
  const total = w.reduce((a, b) => a + b, 0);
  const ev = pay.reduce((t, x, i) => t + (x * w[i]) / total, 0);
  return { pay, w, total, ev };
}

/** Spins the bot expects to play with what it buys now: the rest of this debt, and the next. */
const spinsAhead = (s) => 7 * (4 - s.round) + 21;

const multOf = (enh) => getEnhancement(enh)?.mult ?? 1;
// A Glass pocket pays ×4 until it shatters; a bot counts it as less, for the
// number it may lose.
const GLASS_WORTH = 2.5;

/** Each pocket's gain in expected coins per spin if this work acted there; the best target, or null. */
function bestTarget(s, work, ctx) {
  const { pay, w, total, ev } = payVector(s, ctx.tokenCoins);
  const candidates = workTargets(s, work);
  let best = null;
  const consider = (target, gain) => {
    if (gain > 1e-9 && (!best || gain > best.gain)) best = { target, gain };
  };
  const evWith = (wNew, payNew = pay) => payNew.reduce((t, x, i) => t + x * wNew[i], 0) / wNew.reduce((a, b) => a + b, 0);
  // A level: only the kinds the bot's chips are on can gain.
  if (work.on === 'bet') {
    const kinds = new Set(Object.values(s.placements).map((id) => getBet(id).kind));
    for (const kind of kinds) {
      const up = { ...s, levels: { ...s.levels, [kind]: (s.levels?.[kind] ?? 1) + 1 } };
      consider(kind, payVector(up, ctx.tokenCoins).ev - ev);
    }
    return best;
  }
  if (work.on === 'number') {
    const step = work.op === 'widen' ? 0.5 : -0.5;
    for (const n of candidates) {
      const wNew = w.map((x, i) => (s.wheel.pockets[i].number === n ? Math.max(0.25, x + step) : x));
      consider(n, evWith(wNew) - ev);
    }
    return best;
  }
  const index = new Map(s.wheel.pockets.map((p, i) => [p.id, i]));
  let nudge2 = null;
  for (const id of candidates) {
    const i = index.get(id);
    const p = s.wheel.pockets[i];
    const chance = w[i] / total;
    if (work.op === 'gild') consider(id, chance * pay[i] * ((p.enh === 'gilded' ? 3 : 2) / multOf(p.enh) - 1));
    else if (work.op === 'enhance') {
      if (work.enh === 'glass') consider(id, chance * pay[i] * (GLASS_WORTH / multOf(p.enh) - 1));
      else if (work.enh === 'bone') consider(id, chance * ctx.tokenCoins - chance * pay[i] * (1 - 1 / multOf(p.enh)));
      else if (work.enh === 'lucky') {
        nudge2 ??= nudgedEv(s, null, { total: 2, clockwise: false, straightOnly: false, anchors: [] }) - ev;
        consider(id, chance * nudge2);
      } else if (work.enh === 'ember' && pay[i] > 0) {
        const plan = evaluate(s, [{ ball: 0, pocketIndex: i }]);
        const value = s.chips.filter((c) => s.placements[c.id]).reduce((t, c) => t + c.value, 0) || 1;
        consider(id, chance * plan.lines.length * (ev / value) * (ctx.horizon / 2));
      }
    } else if (work.op === 'paint') {
      const probe = { ...s, wheel: { ...s.wheel, pockets: s.wheel.pockets.map((q) => (q.id === id ? { ...q, color: work.color } : q)) } };
      const plan = evaluate(probe, [{ ball: 0, pocketIndex: i }]);
      consider(id, chance * (toNumber(add(plan.chipTotal, plan.bonusCoins)) + plan.bonusTokens * ctx.tokenCoins - pay[i]));
    } else if (work.op === 'duplicate') {
      consider(id, (pay.reduce((t, x, j) => t + x * w[j], 0) + pay[i] / multOf(p.enh)) / (total + 1) - ev);
    } else if (work.op === 'remove') {
      consider(id, (pay.reduce((t, x, j) => t + x * w[j], 0) - pay[i] * w[i]) / (total - w[i]) - ev);
    }
  }
  return best;
}

/**
 * The oddity compartment (decision 27: priced in coins): the bot buys wheel
 * work when what it adds to the expected payout of its usual layout, over the
 * spins ahead, beats its price by half again, and it keeps the coins for the
 * next long night. Each pick takes the best target on the wheel the picks
 * before it left.
 */
function wheelShop(s, bot, log) {
  if (NO_WHEEL || bot.noWheel || s.phase === PHASE.GAME_OVER) return s;
  const offer = cabinetView(s).slots[3];
  if (!offer || offer.sold || !offer.workable || !offer.affordable || SKIP.includes(offer.id)) return s;
  const price = toNumber(offer.price);
  if (lt(sub(s.coins, offer.price), costOf(s, 'long'))) return s;
  const ctx = { tokenCoins: toNumber(spinCost(s)) * TOKEN_SPINS, horizon: spinsAhead(s) };
  const layout = layoutFor(s, bot.layout);
  let probe = { ...copyRun(s), placements: placementsFor(s, layout) };
  // A record: bought when it is one the bot would rather play than what it has.
  if (offer.record) {
    const rank = ranksFor(s, bot).filter(notSkipped);
    const best = rank.find((id) => s.records.includes(id));
    const at = rank.indexOf(offer.record.id);
    if (at < 0 || (best && rank.indexOf(best) <= at)) return s;
    return chooseRecord(step(s, { type: 'buyOddity', slot: 3, targets: [] }, log), bot);
  }
  // A chip: what one more chip of its material adds to the layout.
  if (offer.chip) {
    const ev0 = payVector(probe, ctx.tokenCoins).ev;
    const more = copyRun(s);
    more.chips = [...more.chips, { id: 'c-probe', value: 1, material: offer.chip, roundValue: 0 }];
    more.placements = placementsFor(more, layout);
    const gain = payVector(more, ctx.tokenCoins).ev - ev0;
    if (gain * ctx.horizon < price * WHEEL_MARGIN) return s;
    return step(s, { type: 'buyOddity', slot: 3, targets: [] }, log);
  }
  const targets = [];
  let gain = 0;
  for (const pick of offer.picks) {
    const best = bestTarget(probe, pick, ctx);
    if (!best) return s;
    targets.push(best.target);
    gain += best.gain;
    doWork(probe, pick, best.target, () => {}, null);
  }
  if (gain * ctx.horizon < price * WHEEL_MARGIN) return s;
  return step(s, { type: 'buyOddity', slot: 3, targets }, log);
}

/**
 * The Number Punches: up to three pockets the bot's chips miss, stamped with
 * whichever number pays it most there, the widest first.
 */
function punch(s, bot, log, inst) {
  const tokenCoins = toNumber(spinCost(s)) * TOKEN_SPINS;
  let probe = { ...copyRun(s), placements: placementsFor(s, layoutFor(s, bot.layout)) };
  const targets = [];
  for (let k = 0; k < 3; k++) {
    const { pay, w } = payVector(probe, tokenCoins);
    let best = null;
    probe.wheel.pockets.forEach((p, i) => {
      if (untouchable(p)) return;
      for (let n = 0; n <= 36; n++) {
        if (n === p.number) continue;
        const t = { pocket: p.id, number: n };
        // The stamp on this one pocket, as wheelwork.js does it (a blank takes the number's colour).
        const q = p.number === null ? { ...p, number: n, color: defaultColor(n), enh: null } : { ...p, number: n };
        const stamped = { ...probe, wheel: { ...probe.wheel, pockets: probe.wheel.pockets.map((x) => (x === p ? q : x)) } };
        const plan = evaluate(stamped, [{ ball: 0, pocketIndex: i }]);
        const gain = w[i] * (toNumber(add(plan.chipTotal, plan.bonusCoins)) + plan.bonusTokens * tokenCoins - pay[i]);
        if (gain > 1e-9 && (!best || gain > best.gain)) best = { t, gain };
      }
    });
    if (!best) break;
    targets.push(best.t);
    doWork(probe, { op: 'stamp', on: 'pocket' }, best.t, () => {}, null);
  }
  return targets.length ? step(s, { type: 'ringBell', uid: inst.uid, targets }, log) : s;
}

// --- Madame Zero and the gramophone -------------------------------------------

// Which card a bot takes: the first in its colour's list that was dealt.
const WHITE_RANK = ['twin_ball', 'record_left', 'carved_in_brass', 'gold_finds_gold', 'spare_ball', 'compound_interest', 'stranger_tips', 'night_is_young', 'reds_run_warm', 'blacks_run_cold', 'another_hook', 'cabinet_owes', 'hot_hands', 'zero_smiles', 'bell_rings_twice'];
const BLACK_RANK = ['feed_zero', 'borrowed_gold', 'devils_hand', 'ask_figures', 'shiny_things', 'burn_ledger', 'break_the_wheel', 'roll_bones', 'bargain', 'give_it_back', 'candle'];
// "Burn it all." is in no list: it sells the Pyre with the rest.
// Which record a bot plays, by the bets it makes. None plays Waltz in Green:
// nights at half again the price cost every bot more than its Nudge won back.
// Danse Macabre pays only with figures in the dark, so it comes last.
const RECORD_RANK = {
  red: ['red_light_tango', 'overture_of_excess', 'two_step', 'boogie_woogie', 'carousel', 'nocturne', 'bolero', 'static', 'funeral_march', 'lullaby_for_zero', 'habanera', 'danse_macabre'],
  black: ['midnight_blues', 'overture_of_excess', 'two_step', 'boogie_woogie', 'carousel', 'nocturne', 'bolero', 'static', 'funeral_march', 'lullaby_for_zero', 'habanera', 'danse_macabre'],
  outside: ['overture_of_excess', 'habanera', 'two_step', 'boogie_woogie', 'carousel', 'nocturne', 'bolero', 'static', 'funeral_march', 'lullaby_for_zero', 'red_light_tango', 'danse_macabre'],
  inside: ['carousel', 'overture_of_excess', 'two_step', 'nocturne', 'boogie_woogie', 'static', 'funeral_march', 'lullaby_for_zero', 'bolero', 'red_light_tango', 'habanera', 'danse_macabre'],
  lines: ['stride_piano', 'carousel', 'overture_of_excess', 'two_step', 'nocturne', 'boogie_woogie', 'static', 'funeral_march', 'lullaby_for_zero', 'bolero', 'red_light_tango', 'habanera', 'danse_macabre'],
};
// The Pyre plays Requiem first, for its sales.
const ranksFor = (s, bot) => {
  const list = RECORD_RANK[recordFamily(s, bot)];
  return bot.burns ? ['requiem', ...list] : list;
};
const recordFamily = (s, bot) => {
  const layout = layoutFor(s, bot.layout);
  if (layout === 'corner') return 'lines';
  return layout === 'red' || layout === 'black' ? layout : layout === 'inside' || layout === 'spread' ? 'inside' : 'outside';
};
const notSkipped = (id) => !SKIP.includes(id);
const ORACLE_REROLLS = 5;

/**
 * A visit to Madame Zero, once a debt. Before the Devil is live, on the first
 * night; once he is, after he fires (for black cards), or on the last night at
 * the latest. The bot takes the best card for it, rerolling while the deal
 * is poor and a night's coins are spare. Rerolls are cheap (the debt's number
 * and up), but past three or so they stop finding anything better.
 */
function visitOracle(s, bot, log) {
  if (NO_ORACLE || bot.noOracle) return s;
  const view = oracleView(s);
  if (view.taken !== null) return s;
  if (!view.dealt && devilLive(s) && !s.devil.firedThisDebt && !isFinalNight(s)) return s;
  if (!view.dealt) s = step(s, { type: 'pullLever' }, log);
  const rank = (v) => {
    const list = (v.kind === 'black' ? BLACK_RANK : WHITE_RANK).filter(notSkipped);
    // Each family's own card first: levels for the bets it makes, paint for red.
    const family = recordFamily(s, bot);
    const own = { red: ['outside_safe', 'reds_run_warm'], black: ['outside_safe', 'blacks_run_cold'], outside: ['outside_safe'], inside: ['fortune_bold'], lines: ['table_remembers'] }[family];
    const order = v.kind === 'white' ? [...own.filter(notSkipped), ...list.filter((id) => !own.includes(id))] : list;
    return v.cards.filter((c) => c.takeable && order.includes(c.id)).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))[0] ?? null;
  };
  let pick = rank(oracleView(s));
  const poor = (p) => !p || (oracleView(s).kind === 'white' && WHITE_RANK.indexOf(p.id) > 1);
  for (let n = 0; n < ORACLE_REROLLS && poor(pick) && oracleView(s).canReroll && gte(sub(s.coins, oracleView(s).rerollCost), costOf(s, 'long')); n++) {
    s = step(s, { type: 'pullLever' }, log);
    pick = rank(oracleView(s));
  }
  if (pick) s = step(s, { type: 'takeFortune', index: pick.index }, log);
  return chooseRecord(s, bot);
}

/** The best records in the crate for the bot's bets: one, or two once the gramophone has a second slot. */
function chooseRecord(s, bot) {
  if (!s.records.length) return s;
  const [best = null, next = null] = ranksFor(s, bot).filter(notSkipped).filter((id) => s.records.includes(id));
  const want = s.gramophoneSlots > 1 ? [best, next] : [best];
  if (want.every((id, slot) => id === [s.playing, s.playing2][slot])) return s;
  // Lift both needles first, so no record is asked to play in two slots at once.
  for (const slot of want.map((_, i) => i).reverse()) {
    const r = act(s, { type: 'playRecord', id: null, slot });
    if (!r.events.some((e) => e.type === 'rejected')) s = r.state;
  }
  want.forEach((id, slot) => {
    const r = act(s, { type: 'playRecord', id, slot });
    if (!r.events.some((e) => e.type === 'rejected')) s = r.state;
  });
  return s;
}

function newMetrics() {
  return { spins: 0, paying: 0, payouts: [], triggerSpins: 0, dry: 0, maxDry: 0, jackpot: 0, bells: 0, restocks: 0, tokensIn: 0, tokensOut: 0, leans: 0, hops: 0, devils: 0, devilRuns: 0, lost: 0 };
}

function playRun(seed, bot, m, picks, firstPicks) {
  let s = createRun({ seed, chipSet: CHIPS, wheel: WHEEL, edge: EDGE, locks: LOCKS, figures: FIGURES, opened: OPENED });
  for (const id of bot.solo ?? []) s = grantTalisman(s, id);
  m.dry = 0; // a miss streak never carries over from the last run
  let first = true;
  const log = (events) => {
    for (const e of events) {
      if (e.type === 'bought') {
        picks[e.id] = (picks[e.id] ?? 0) + 1;
        if (first) firstPicks[e.id] = (firstPicks[e.id] ?? 0) + 1;
        first = false;
      }
      if (e.type === 'bellRung' && e.uid) m.bells += 1;
      if (e.type === 'offersRestocked' && e.paid) m.restocks += 1;
      if (e.type === 'fortuneTaken') picks[`fortune:${e.id}`] = (picks[`fortune:${e.id}`] ?? 0) + 1;
      if (e.type === 'oddityBought') picks[`oddity:${e.id}`] = (picks[`oddity:${e.id}`] ?? 0) + 1;
      if (e.type === 'pocketShattered') picks['shattered'] = (picks['shattered'] ?? 0) + 1;
    }
  };
  while (s.phase !== PHASE.GAME_OVER && s.debt <= MAX_DEBT) {
    s = visitOracle(s, bot, log);
    s = shop(s, bot, log);
    s = wheelShop(s, bot, log);
    const tempo = TEMPO && s.debt <= 2 && s.round === 1;
    const pkg = !tempo && canAfford(s, 'long') ? 'long' : canAfford(s, 'short') ? 'short' : 'sitout';
    s = step(s, { type: 'choosePackage', packageId: pkg }, log);
    const finalNight = isFinalNight(s);
    while (s.phase === PHASE.BETTING) {
      s = placeChips(s, bot);
      const beforeBell = s;
      s = bell(s, bot, log, { finalNight, spinsLeft: s.spinsLeft });
      // A ring can change the spin's Nudge (the Dowsing Rod): weigh the layouts again.
      if (s !== beforeBell) s = placeChips(s, bot);
      // Glass Eye: every chip goes on the foreseen number for one spin (a blank pocket has none).
      const seen = s.foreseen;
      if (seen && s.wheel.pockets[seen.pocketIndex].number !== null) {
        const n = s.wheel.pockets[seen.pocketIndex].number;
        for (const chip of s.chips) if (!s.fixed.includes(chip.id)) s = step(s, { type: 'placeChip', chipId: chip.id, betId: `straight:${n}` });
      }
      const r = act(s, { type: 'spin' });
      s = r.state;
      const res = s.lastSpin;
      m.spins += 1;
      if (!res.miss) {
        m.paying += 1;
        m.payouts.push(toNumber(res.total));
        m.dry = 0;
      } else m.maxDry = Math.max(m.maxDry, ++m.dry);
      if (r.events.some((e) => e.type === 'trigger')) m.triggerSpins += 1;
      m.jackpot = Math.max(m.jackpot, toNumber(res.total) / toNumber(owed(s)));
      if (res.devil) m.lost += toNumber(res.lost);
      log(r.events);
      // With the Devil live, coins in hand are at risk: bank all but the next night.
      if (devilLive(s) && s.spinsLeft > 0) {
        const keep = finalNight ? 0 : costOf(s, 'long');
        if (gt(s.coins, keep)) s = step(s, { type: 'deposit', amount: sub(s.coins, keep) });
      }
    }
    s = bell(s, bot, log, { finalNight, spinsLeft: 0 });
    s = shop(s, bot, log);
    s = wheelShop(s, bot, log);
    // Bank all but the next long night; on the final night, bank it all.
    const keep = finalNight ? 0 : costOf(s, 'long');
    if (gt(s.coins, keep)) s = step(s, { type: 'deposit', amount: sub(s.coins, keep) });
    s = step(s, { type: 'endNight' }, log);
  }
  m.tokensIn += s.stats.tokensEarned;
  m.tokensOut += s.stats.tokensSpent;
  m.leans += s.stats.leans;
  m.hops += s.stats.hops;
  m.devils += s.stats.devils;
  if (s.stats.devils) m.devilRuns += 1;
  return s;
}

const pct = (n, d = RUNS) => `${((100 * n) / d).toFixed(1)}%`;
const median = (xs) => {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
};

function runBot(name) {
  const bot = botFor(name);
  const paid = new Array(MAX_DEBT + 1).fill(0);
  const m = newMetrics();
  const picks = {};
  const firstPicks = {};
  let owned = 0;
  for (let i = 0; i < RUNS; i++) {
    const end = playRun(`SIM-${i}`, bot, m, picks, firstPicks);
    for (let d = 1; d <= end.stats.debtsPaid && d <= MAX_DEBT; d++) paid[d] += 1;
    owned += end.rail.length;
  }
  return { name, paid, m, picks, firstPicks, owned: owned / RUNS };
}

// --- Report -----------------------------------------------------------------

const names = args.bot && args.bot !== true ? [args.bot] : Object.keys(BOTS);
const setup = [`${getMaterial(CHIPS).name} chips`, `${getStartingWheel(WHEEL).name} wheel`, POOL === 'start' ? 'a new player\'s pool' : null, EDGE ? `House Edge ${EDGE}` : null, LOCKS ? `${LOCKS} locks` : null, FIGURES ? `${FIGURES} figures` : null].filter(Boolean).join(' · ');
console.log(`${RUNS} runs per bot · Phase 7 rules (talismans, Cabinet, Bell, Leans, pity, Nudge, the Devil, Madame Zero, records, engravings, wheel work) · ${setup}${TEMPO ? ' · tempo' : ''}${NO_WHEEL ? ' · no wheel work' : ''}\n`);
const header = ['bot'.padEnd(18), ...Array.from({ length: MAX_DEBT }, (_, i) => `debt ${i + 1}`.padStart(8)), '  items', ' pay%', ' juice', ' dry', ' bells', ' restock', ' leans', ' hops', ' devil'];
console.log(header.join(' '));
const results = names.map(runBot);
for (const r of results) {
  const { m } = r;
  console.log(
    [
      r.name.padEnd(18),
      ...r.paid.slice(1).map((n) => pct(n).padStart(8)),
      r.owned.toFixed(1).padStart(7),
      pct(m.paying, m.spins).padStart(5),
      pct(m.triggerSpins, m.spins).padStart(6),
      String(m.maxDry).padStart(4),
      (m.bells / RUNS).toFixed(1).padStart(6),
      (m.restocks / RUNS).toFixed(1).padStart(8),
      (m.leans / RUNS).toFixed(1).padStart(6),
      (m.hops / RUNS).toFixed(0).padStart(5),
      pct(m.devilRuns).padStart(6),
    ].join(' '),
  );
}

// The targets are for the best bot (doc 9.8): at each debt, the best of the
// bots that play the House's luck, whichever that is.
const graded = results.filter((r) => botFor(r.name).leans);
console.log(`\nTargets for the best bot at each debt (decisions 27 and 30; ${POOL === 'full' ? 'everything open' : 'a new player\'s pool'}):`);
for (const [d, lo, hi, pool] of TARGETS) {
  if (d > MAX_DEBT || !graded.length) continue;
  const best = graded.reduce((a, b) => (b.paid[d] > a.paid[d] ? b : a));
  const share = best.paid[d] / RUNS;
  const ok = share >= lo && share <= hi;
  const grade = pool === POOL ? (ok ? 'PASS' : 'MISS') : `(graded with --pool ${pool})`;
  console.log(`  debt ${d}: ${pct(best.paid[d]).padStart(6)}  target ${lo * 100}–${hi * 100}%  ${grade}  (${best.name})`);
}

for (const r of results.filter((x) => Object.keys(x.picks).length)) {
  const total = Object.values(r.firstPicks).reduce((a, b) => a + b, 0) || 1;
  const top = Object.entries(r.firstPicks).sort((a, b) => b[1] - a[1])[0];
  console.log(`\n${r.name}: bought per 100 runs`);
  console.log(
    '  ' +
      Object.entries(r.picks)
        .sort((a, b) => b[1] - a[1])
        .filter(([id]) => getTalisman(id))
        .map(([id, n]) => `${getTalisman(id).name} ${((100 * n) / RUNS).toFixed(0)}`)
        .join(' · '),
  );
  if (top) console.log(`  first purchase: ${getTalisman(top[0]).name} ${pct(top[1], total)} of runs · median paying spin ${median(r.m.payouts)} · biggest spin ${(r.m.jackpot * 100).toFixed(0)}% of the debt`);
  console.log(`  tokens earned ${(r.m.tokensIn / RUNS).toFixed(1)}, spent ${(r.m.tokensOut / RUNS).toFixed(1)} per run`);
  const fortunes = Object.entries(r.picks).filter(([id]) => id.startsWith('fortune:'));
  if (fortunes.length) {
    const text = fortunes
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => `${contentName(id.slice(8))} ${((100 * n) / RUNS).toFixed(0)}`)
      .join(' · ');
    console.log(`  fortunes taken per 100 runs: ${text}`);
  }
  const oddities = Object.entries(r.picks).filter(([id]) => id.startsWith('oddity:'));
  if (oddities.length) {
    const text = oddities
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => `${getOddity(id.slice(7)).name} ${((100 * n) / RUNS).toFixed(0)}`)
      .join(' · ');
    console.log(`  oddities bought per 100 runs: ${text}${r.picks.shattered ? ` · glass shattered ${((100 * r.picks.shattered) / RUNS).toFixed(0)}` : ''}`);
  }
}
const set = getMaterial(CHIPS);
console.log(`\nStart: ${ECONOMY.startCoins} coins, ${ECONOMY.startTokens} tokens, ${set.count} ${set.name} chips of value 1. (${format(12345)} formatting check)`);
