// Balance simulator: plays many runs headless with simple bots that drive the
// real act() and reports how far they get (design doc 9.8).
//
//   npm run sim                         every bot, 2000 runs each
//   npm run sim -- --runs 5000 --bot adaptive
//   npm run sim -- --bot solo:glass_eye  one talisman from the first spin
//   npm run sim -- --tempo               one short night per debt in debts 1–2
//   npm run sim -- --set nightTokens=0   override an ECONOMY number

import { TALISMANS, getTalisman } from '../src/core/content/index.js';
import { ECONOMY, priceOf } from '../src/core/economy.js';
import { add, format, gt, gte, lt, sub, toNumber } from '../src/core/num.js';
import { PHASE, act, canAfford, costOf, createRun, grantTalisman, isFinalNight, nextRestockCost, owed } from '../src/core/run.js';
import { bellView, cabinetView } from '../src/core/selectors.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? true : (all[i + 1] ?? true)]] : acc), []),
);
const RUNS = Number(args.runs ?? 2000);
const MAX_DEBT = Number(args['max-debt'] ?? 6);
const TEMPO = !!args.tempo;
for (const kv of [args.set].flat().filter((x) => typeof x === 'string')) {
  const [k, v] = kv.split('=');
  ECONOMY[k] = Number(v);
}

// Phase 2 targets for the best bot (doc 10): debt 1 ≥ 85%, debt 2 50–65%,
// debt 3 15–30%, debt 4 < 5%. Leans, Nudge (Phase 3) and chips and wheel work
// (Phase 5) carry the later debts.
const TARGETS = [
  [1, 0.85, 1],
  [2, 0.5, 0.65],
  [3, 0.15, 0.3],
  [4, 0, 0.05],
];

// --- Where chips go ---------------------------------------------------------

const STRAIGHTS = [32, 11, 9, 26, 5, 18]; // spread around the wheel, not the table
const CORNERS = ['corner:1-2-4-5', 'corner:17-18-20-21', 'corner:29-30-32-33'];
const LAYOUT = {
  red: () => 'red',
  outside: (i) => `dozen:${(i % 3) + 1}`,
  inside: (i) => `straight:${STRAIGHTS[i % STRAIGHTS.length]}`,
  corner: (i) => CORNERS[i % CORNERS.length],
  zero: (i) => `straight:${STRAIGHTS[i % STRAIGHTS.length]}`,
};

const owns = (s, id) => s.rail.some((t) => t.id === id);

/** Picks a chip layout from the rail: what the talismans reward. */
function layoutFor(s, fallback) {
  if (owns(s, 'brass_knuckles') && !owns(s, 'horseshoe') && !owns(s, 'croupiers_rake')) return 'corner';
  if (owns(s, 'horseshoe') || owns(s, 'croupiers_rake') || owns(s, 'house_key')) return 'inside';
  if (owns(s, 'abacus')) return 'outside';
  if (owns(s, 'red_ribbon')) return 'red';
  return fallback;
}

// --- Bots -------------------------------------------------------------------

const LISTS = {
  red: ['red_ribbon', 'matchbook', 'twin_mirrors', 'glass_eye', 'ledger', 'pawn_ticket', 'crumpled_receipt', 'piggy_bank', 'wheel_of_fortune', 'lucky_penny'],
  outside: ['abacus', 'matchbook', 'ledger', 'twin_mirrors', 'glass_eye', 'pawn_ticket', 'crumpled_receipt', 'piggy_bank', 'lucky_penny'],
  inside: ['croupiers_rake', 'horseshoe', 'house_key', 'twin_mirrors', 'glass_eye', 'lucky_penny', 'wheel_of_fortune', 'ledger', 'pawn_ticket', 'crumpled_receipt'],
};
const TIER = ['glass_eye', 'red_ribbon', 'matchbook', 'abacus', 'croupiers_rake', 'twin_mirrors', 'house_key', 'ledger', 'horseshoe', 'brass_knuckles', 'pawn_ticket', 'crumpled_receipt', 'piggy_bank', 'wheel_of_fortune', 'lucky_penny'];
const FAMILY_OF = { red_ribbon: 'red', matchbook: 'red', abacus: 'outside', croupiers_rake: 'inside', horseshoe: 'inside', house_key: 'inside', brass_knuckles: 'inside' };

const BOTS = {
  'no items': { layout: 'red', wants: () => [] },
  'red builder': { layout: 'red', wants: () => LISTS.red },
  'outside builder': { layout: 'outside', wants: () => LISTS.outside },
  'inside builder': { layout: 'inside', wants: () => LISTS.inside },
  adaptive: {
    layout: 'red',
    // The first purchase picks the family; after that, that family's list.
    wants: (s) => {
      const family = s.rail.map((t) => FAMILY_OF[t.id]).find(Boolean);
      return family ? LISTS[family] : TIER;
    },
  },
  'greedy buyer': { layout: 'red', greedy: true, wants: () => TALISMANS.map((d) => d.id) },
};

function botFor(name) {
  if (name.startsWith('solo:')) {
    const id = name.slice(5);
    if (!getTalisman(id)) throw new Error(`No talisman ${id}`);
    return { layout: 'red', solo: id, wants: () => [] };
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

function placeChips(s, layout) {
  const pick = LAYOUT[layoutFor(s, layout)];
  s.chips.forEach((chip, i) => {
    const betId = pick(i);
    if (s.placements[chip.id] !== betId) s = step(s, { type: 'placeChip', chipId: chip.id, betId });
  });
  return s;
}

const rank = (list, id) => {
  const i = list.indexOf(id);
  return i < 0 ? Infinity : i;
};

/** Buys what the bot wants, trading in its weakest talisman when the rail is full. */
function shop(s, bot, log) {
  for (let guard = 0; guard < 6; guard++) {
    const list = bot.wants(s);
    if (!list.length) return s;
    const view = cabinetView(s);
    const offers = view.slots.filter((o) => o.kind === 'talisman' && o.id && list.includes(o.id));
    if (bot.greedy) offers.sort((a, b) => b.price - a.price);
    else offers.sort((a, b) => rank(list, a.id) - rank(list, b.id));
    let bought = false;
    for (const o of offers) {
      const full = s.rail.length >= s.railHooks;
      let sellUid;
      if (full) {
        const worst = [...s.rail].sort((a, b) => rank(list, b.id) - rank(list, a.id))[0];
        if (rank(list, worst.id) <= rank(list, o.id)) continue;
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

/** Bell use: the Glass Eye on the final night's first spin, Wheel of Fortune near the end, the pig when it matters. */
function bell(s, bot, log, { finalNight, spinsLeft }) {
  for (const inst of s.rail) {
    if (inst.id === 'piggy_bank' && gt(inst.data.value, 0)) {
      const short = lt(add(s.deposited, s.coins), owed(s));
      const ripe = gte(inst.data.value, Math.max(1, toNumber(owed(s)) / 4));
      if ((finalNight && spinsLeft <= 1 && short) || ripe) s = step(s, { type: 'ringBell', uid: inst.uid }, log);
    }
  }
  const head = bellView(s).head;
  if (!head) return s;
  const inst = s.rail.find((t) => t.uid === head);
  if (bot.greedy || (inst.id === 'glass_eye' && finalNight) || (inst.id === 'wheel_of_fortune' && finalNight && spinsLeft <= 2)) {
    s = step(s, { type: 'ringBell' }, log);
  }
  return s;
}

function newMetrics() {
  return { spins: 0, paying: 0, payouts: [], triggerSpins: 0, dry: 0, maxDry: 0, jackpot: 0, bells: 0, restocks: 0, tokensIn: 0, tokensOut: 0 };
}

function playRun(seed, bot, m, picks, firstPicks) {
  let s = createRun({ seed });
  if (bot.solo) s = grantTalisman(s, bot.solo);
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
    }
  };
  while (s.phase !== PHASE.GAME_OVER && s.debt <= MAX_DEBT) {
    s = shop(s, bot, log);
    const tempo = TEMPO && s.debt <= 2 && s.round === 1;
    const pkg = !tempo && canAfford(s, 'long') ? 'long' : canAfford(s, 'short') ? 'short' : 'sitout';
    s = step(s, { type: 'choosePackage', packageId: pkg }, log);
    const finalNight = isFinalNight(s);
    while (s.phase === PHASE.BETTING) {
      s = placeChips(s, bot.layout);
      s = bell(s, bot, log, { finalNight, spinsLeft: s.spinsLeft });
      // Glass Eye: every chip goes on the foreseen number for one spin.
      const seen = s.foreseen;
      if (seen) {
        const n = s.wheel.pockets[seen.pocketIndex].number;
        for (const chip of s.chips) s = step(s, { type: 'placeChip', chipId: chip.id, betId: `straight:${n}` });
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
      log(r.events);
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
console.log(`${RUNS} runs per bot · Phase 2 rules (talismans, Cabinet, Bell; no Leans, Nudge or Devil)${TEMPO ? ' · tempo' : ''}\n`);
const header = ['bot'.padEnd(18), ...Array.from({ length: MAX_DEBT }, (_, i) => `debt ${i + 1}`.padStart(8)), '  items', ' pay%', ' juice', ' dry', ' bells', ' restock'];
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
    ].join(' '),
  );
}

const best = results.find((r) => r.name === 'adaptive') ?? results[0];
console.log(`\nPhase 2 targets for "${best.name}":`);
for (const [d, lo, hi] of TARGETS) {
  if (d > MAX_DEBT) continue;
  const share = best.paid[d] / RUNS;
  const ok = share >= lo && share <= hi;
  console.log(`  debt ${d}: ${pct(best.paid[d]).padStart(6)}  target ${lo * 100}–${hi * 100}%  ${ok ? 'PASS' : 'MISS'}`);
}

for (const r of results.filter((x) => Object.keys(x.picks).length)) {
  const total = Object.values(r.firstPicks).reduce((a, b) => a + b, 0) || 1;
  const top = Object.entries(r.firstPicks).sort((a, b) => b[1] - a[1])[0];
  console.log(`\n${r.name}: bought per 100 runs`);
  console.log(
    '  ' +
      Object.entries(r.picks)
        .sort((a, b) => b[1] - a[1])
        .map(([id, n]) => `${getTalisman(id).name} ${((100 * n) / RUNS).toFixed(0)}`)
        .join(' · '),
  );
  console.log(`  first purchase: ${getTalisman(top[0]).name} ${pct(top[1], total)} of runs · median paying spin ${median(r.m.payouts)} · biggest spin ${(r.m.jackpot * 100).toFixed(0)}% of the debt`);
  console.log(`  tokens earned ${(r.m.tokensIn / RUNS).toFixed(1)}, spent ${(r.m.tokensOut / RUNS).toFixed(1)} per run`);
}
console.log(`\nStart: ${ECONOMY.startCoins} coins, ${ECONOMY.startTokens} tokens, ${ECONOMY.startChips} chips of value 1. (${format(12345)} formatting check)`);
