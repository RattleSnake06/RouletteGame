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
//   npm run sim -- --chips bone          the run's starting chip set (decision 26; default normal)
//   npm run sim -- --tempo               one short night per debt in debts 1–2
//   npm run sim -- --set nightTokens=0   override an ECONOMY number
//   npm run sim -- --set luck.pityBase=3  override a LUCK (nudge.js) or devil.base number
//   npm run sim -- --set debt.2=240       override what a debt owes

import { MATERIALS, TALISMANS, contentName, getFortune, getMaterial, getRecord, getTalisman } from '../src/core/content/index.js';
import { DEVIL, devilLive } from '../src/core/devil.js';
import { DEBT_TABLE, ECONOMY, priceOf } from '../src/core/economy.js';
import { LUCK, nudgeFor, nudgeLandings } from '../src/core/nudge.js';
import { add, format, gt, gte, lt, sub, toNumber } from '../src/core/num.js';
import { evaluate } from '../src/core/payout.js';
import { PHASE, act, canAfford, costOf, createRun, grantTalisman, hooksFor, isFinalNight, nextRestockCost, owed } from '../src/core/run.js';
import { bellView, cabinetView, oracleView } from '../src/core/selectors.js';
import { EUROPEAN_ORDER } from '../src/core/wheel.js';
import { liveChances } from '../src/core/widths.js';

// --flag value pairs; a flag given more than once (--set) collects its values.
const args = {};
process.argv.slice(2).forEach((a, i, all) => {
  if (!a.startsWith('--')) return;
  const key = a.slice(2);
  const value = all[i + 1]?.startsWith('--') ? true : (all[i + 1] ?? true);
  args[key] = key in args ? [args[key]].flat().concat(value) : value;
});
const RUNS = Number(args.runs ?? 2000);
const MAX_DEBT = Number(args['max-debt'] ?? 6);
const TEMPO = !!args.tempo;
// --no-new: bots never buy the luck and Devil talismans (to measure the House's luck alone).
const LUCK_ITEMS = ['rabbits_foot', 'pocket_watch', 'salt_cellar', 'evil_eye', 'compass', 'lodestone', 'wind_up_key', 'hamsa', 'four_leaf_clover', 'dowsing_rod', 'weathervane', 'holy_water'];
const NO_NEW = !!args['no-new'];
const SKIP = typeof args.skip === 'string' ? args.skip.split(',') : [];
for (const id of SKIP) if (!getTalisman(id) && !getFortune(id) && !getRecord(id)) throw new Error(`--skip: no talisman, fortune or record ${id}`);
const NO_ORACLE = !!args['no-oracle'];
const CHIPS = typeof args.chips === 'string' ? args.chips : 'normal';
if (!MATERIALS.some((m) => m.id === CHIPS)) throw new Error(`--chips: no chip set ${CHIPS} (${MATERIALS.map((m) => m.id).join(', ')})`);
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

// Phase 4 targets for the best bot (doc 9.8, decision 25): debt 1 ≥ 90%, debt
// 2 65–80%, debt 3 30–45%, debt 4 10–20%. Chips and wheel work (Phase 5) carry
// the later debts.
const TARGETS = [
  [1, 0.9, 1],
  [2, 0.65, 0.8],
  [3, 0.3, 0.45],
  [4, 0.1, 0.2],
];

// --- Where chips go ---------------------------------------------------------

const STRAIGHTS = [32, 11, 9, 26, 5, 18]; // spread around the wheel, not the table
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
  spread: (i, k) => `straight:${EUROPEAN_ORDER[Math.floor((i * 37) / k + 4) % 37]}`,
  // Seesaw: the half the last spin did not land in.
  seesaw: (i, k, s) => {
    const n = lastNumber(s);
    return n >= 1 && n <= 18 ? 'high' : n >= 19 ? 'low' : 'red';
  },
  // Ouroboros: every chip on the number that just came up.
  chase: (i, k, s) => (lastNumber(s) === null ? LAYOUT.spread(i, k) : `straight:${lastNumber(s)}`),
  thirteen: () => 'straight:13',
};

const owns = (s, id) => s.rail.some((t) => t.id === id);

/** Picks a chip layout from the rail: what the talismans reward. */
function layoutFor(s, fallback) {
  if (owns(s, 'brass_knuckles') && !owns(s, 'horseshoe') && !owns(s, 'croupiers_rake')) return 'corner';
  if (owns(s, 'horseshoe') || owns(s, 'croupiers_rake') || owns(s, 'house_key')) return 'inside';
  if (owns(s, 'abacus')) return 'outside';
  if (owns(s, 'brass_scales') || owns(s, 'string_of_pearls')) return 'even';
  if (owns(s, 'red_ribbon')) return 'red';
  if (owns(s, 'black_cat')) return 'black';
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
  if (owns(s, 'black_cat')) out.push('black');
  if (owns(s, 'brass_scales') || owns(s, 'string_of_pearls')) out.push('even');
  return out;
}

// --- Bots -------------------------------------------------------------------

// Lists with the twenty newer talismans; --old-pool plays the Phase 3 pool
// (the Cabinet never deals the newer ones) to compare against.
const OLD_POOL = !!args['old-pool'];
const NEWER = ['tuning_fork', 'brass_scales', 'string_of_pearls', 'wind_up_key', 'hamsa', 'beckoning_cat', 'grandmothers_purse', 'lost_wallet', 'magpie', 'domino', 'four_leaf_clover', 'holy_water', 'dowsing_rod', 'mousetrap', 'weathervane', 'seesaw', 'ouroboros', 'thirteen_ball', 'black_cat', 'golden_ball'];
const LISTS = {
  red: ['golden_ball', 'red_ribbon', 'mousetrap', 'domino', 'matchbook', 'twin_mirrors', 'tuning_fork', 'glass_eye', 'magpie', 'beckoning_cat', 'rabbits_foot', 'ledger', 'black_cat', 'pawn_ticket', 'crumpled_receipt', 'grandmothers_purse', 'piggy_bank', 'wheel_of_fortune', 'pocket_watch', 'hamsa', 'lucky_penny', 'lost_wallet'],
  even: ['golden_ball', 'string_of_pearls', 'brass_scales', 'tuning_fork', 'mousetrap', 'domino', 'matchbook', 'twin_mirrors', 'magpie', 'beckoning_cat', 'glass_eye', 'rabbits_foot', 'ledger', 'pawn_ticket', 'crumpled_receipt', 'grandmothers_purse', 'pocket_watch', 'hamsa', 'lucky_penny', 'lost_wallet'],
  outside: ['golden_ball', 'abacus', 'seesaw', 'matchbook', 'domino', 'ledger', 'twin_mirrors', 'tuning_fork', 'glass_eye', 'rabbits_foot', 'pawn_ticket', 'crumpled_receipt', 'piggy_bank', 'pocket_watch', 'lucky_penny', 'lost_wallet'],
  inside: ['ouroboros', 'golden_ball', 'croupiers_rake', 'horseshoe', 'lodestone', 'thirteen_ball', 'house_key', 'twin_mirrors', 'tuning_fork', 'mousetrap', 'wind_up_key', 'glass_eye', 'rabbits_foot', 'compass', 'dowsing_rod', 'weathervane', 'lucky_penny', 'wheel_of_fortune', 'pocket_watch', 'hamsa', 'four_leaf_clover', 'ledger', 'pawn_ticket', 'crumpled_receipt', 'lost_wallet'],
  luck: ['ouroboros', 'lodestone', 'horseshoe', 'rabbits_foot', 'compass', 'croupiers_rake', 'twin_mirrors', 'tuning_fork', 'dowsing_rod', 'wind_up_key', 'pocket_watch', 'hamsa', 'four_leaf_clover', 'weathervane', 'mousetrap', 'glass_eye', 'wheel_of_fortune', 'house_key', 'ledger', 'lucky_penny', 'pawn_ticket', 'crumpled_receipt', 'lost_wallet'],
};
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
const TIER = OLD_POOL
  ? ['glass_eye', 'red_ribbon', 'matchbook', 'rabbits_foot', 'abacus', 'croupiers_rake', 'twin_mirrors', 'house_key', 'lodestone', 'ledger', 'horseshoe', 'compass', 'brass_knuckles', 'pocket_watch', 'pawn_ticket', 'crumpled_receipt', 'piggy_bank', 'wheel_of_fortune', 'lucky_penny']
  : ['ouroboros', 'golden_ball', 'glass_eye', 'string_of_pearls', 'red_ribbon', 'matchbook', 'rabbits_foot', 'mousetrap', 'domino', 'abacus', 'croupiers_rake', 'twin_mirrors', 'house_key', 'lodestone', 'ledger', 'horseshoe', 'thirteen_ball', 'seesaw', 'weathervane', 'compass', 'brass_scales', 'black_cat', 'brass_knuckles', 'pocket_watch', 'pawn_ticket', 'crumpled_receipt', 'piggy_bank', 'wheel_of_fortune', 'lucky_penny', 'lost_wallet'];
const FAMILY_OF = {
  red_ribbon: 'red',
  matchbook: 'red',
  domino: 'red',
  black_cat: 'red',
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
};
// Once the Devil is live, safety comes first: these jump to the front of any list.
const SAFETY = OLD_POOL ? ['evil_eye', 'salt_cellar'] : ['holy_water', 'evil_eye', 'salt_cellar'];
const withSafety = (s, list) => (devilLive(s) ? [...SAFETY, ...list.filter((id) => !SAFETY.includes(id))] : list);

const BOTS = {
  'no items': { layout: 'red', wants: () => [] },
  'red builder': { layout: 'red', leans: true, wants: (s) => withSafety(s, LISTS.red) },
  'outside builder': { layout: 'outside', leans: true, wants: (s) => withSafety(s, LISTS.outside) },
  'inside builder': { layout: 'inside', leans: true, wants: (s) => withSafety(s, LISTS.inside) },
  'luck builder': { layout: 'spread', leans: true, wants: (s) => withSafety(s, LISTS.luck) },
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
  const probe = { ...s, placements: placementsFor(s, layout) };
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

// --- Madame Zero and the gramophone -------------------------------------------

// Which card a bot takes: the first in its colour's list that was dealt.
const WHITE_RANK = ['record_left', 'carved_in_brass', 'stranger_tips', 'reds_run_warm', 'blacks_run_cold', 'another_hook', 'cabinet_owes', 'bell_rings_twice'];
const BLACK_RANK = ['feed_zero', 'ask_figures', 'shiny_things', 'burn_ledger', 'roll_bones', 'bargain', 'give_it_back', 'candle'];
// Which record a bot plays, by the bets it makes. None plays Waltz in Green:
// nights at half again the price cost every bot more than its Nudge won back.
const RECORD_RANK = {
  red: ['red_light_tango', 'overture_of_excess', 'boogie_woogie', 'carousel', 'nocturne', 'static', 'funeral_march', 'lullaby_for_zero'],
  outside: ['overture_of_excess', 'boogie_woogie', 'carousel', 'nocturne', 'static', 'funeral_march', 'lullaby_for_zero', 'red_light_tango'],
  inside: ['carousel', 'overture_of_excess', 'nocturne', 'boogie_woogie', 'static', 'funeral_march', 'lullaby_for_zero', 'red_light_tango'],
};
const recordFamily = (s, bot) => {
  const layout = layoutFor(s, bot.layout);
  return layout === 'red' || layout === 'black' ? 'red' : layout === 'inside' || layout === 'spread' || layout === 'corner' ? 'inside' : 'outside';
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
    const order = recordFamily(s, bot) === 'red' && v.kind === 'white' ? ['reds_run_warm', ...list] : list;
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

/** The best record in the crate for the bot's bets. */
function chooseRecord(s, bot) {
  if (!s.records.length) return s;
  const best = RECORD_RANK[recordFamily(s, bot)].filter(notSkipped).find((id) => s.records.includes(id)) ?? null;
  if (best === s.playing) return s;
  const r = act(s, { type: 'playRecord', id: best });
  return r.events.some((e) => e.type === 'rejected') ? s : r.state;
}

function newMetrics() {
  return { spins: 0, paying: 0, payouts: [], triggerSpins: 0, dry: 0, maxDry: 0, jackpot: 0, bells: 0, restocks: 0, tokensIn: 0, tokensOut: 0, leans: 0, hops: 0, devils: 0, devilRuns: 0, lost: 0 };
}

function playRun(seed, bot, m, picks, firstPicks) {
  let s = createRun({ seed, chipSet: CHIPS });
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
    }
  };
  while (s.phase !== PHASE.GAME_OVER && s.debt <= MAX_DEBT) {
    s = visitOracle(s, bot, log);
    s = shop(s, bot, log);
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
      // Glass Eye: every chip goes on the foreseen number for one spin.
      const seen = s.foreseen;
      if (seen) {
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
console.log(`${RUNS} runs per bot · Phase 4 rules (talismans, Cabinet, Bell, Leans, pity, Nudge, the Devil, Madame Zero, records, engravings) · ${getMaterial(CHIPS).name} chips${TEMPO ? ' · tempo' : ''}\n`);
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
console.log('\nPhase 4 targets for the best bot at each debt:');
for (const [d, lo, hi] of TARGETS) {
  if (d > MAX_DEBT || !graded.length) continue;
  const best = graded.reduce((a, b) => (b.paid[d] > a.paid[d] ? b : a));
  const share = best.paid[d] / RUNS;
  const ok = share >= lo && share <= hi;
  console.log(`  debt ${d}: ${pct(best.paid[d]).padStart(6)}  target ${lo * 100}–${hi * 100}%  ${ok ? 'PASS' : 'MISS'}  (${best.name})`);
}

for (const r of results.filter((x) => Object.keys(x.picks).length)) {
  const total = Object.values(r.firstPicks).reduce((a, b) => a + b, 0) || 1;
  const top = Object.entries(r.firstPicks).sort((a, b) => b[1] - a[1])[0];
  console.log(`\n${r.name}: bought per 100 runs`);
  console.log(
    '  ' +
      Object.entries(r.picks)
        .sort((a, b) => b[1] - a[1])
        .filter(([id]) => !id.startsWith('fortune:'))
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
}
const set = getMaterial(CHIPS);
console.log(`\nStart: ${ECONOMY.startCoins} coins, ${ECONOMY.startTokens} tokens, ${set.count} ${set.name} chips of value 1. (${format(12345)} formatting check)`);
