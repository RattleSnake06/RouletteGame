// The fuzzer: plays thousands of runs with random actions, the kind a
// restless player makes (tapping everything, in any order, at any time, with
// odd amounts), and checks after every step that the run still holds
// together. Unlike the sim's bots it plays badly on purpose.
//
//   node sim/fuzz.js [--runs 400] [--steps 2500] [--seed 1] [--deep] [--quiet]
//
// --deep starts every run rich and banks everything before the Cage
// collects, so runs live long enough to reach the later systems.
//
// Prints each distinct failure once, with the seed and the steps leading to it.

import { act, createRun, grantTalisman, hooksFor, PHASE } from '../src/core/run.js';
import { serializeRun, deserializeRun } from '../src/core/save.js';
import { BETS } from '../src/core/bets.js';
import { PACKAGES } from '../src/core/economy.js';
import { MATERIALS, STARTING_WHEELS, TALISMANS, getTalisman, MAX_EDGE } from '../src/core/content/index.js';
import { workTargets } from '../src/core/wheelwork.js';
import { canAnswer } from '../src/core/bell.js';
import { applyRun, newProfile } from '../src/core/meta.js';
import { gte, isBig, num, toNumber } from '../src/core/num.js';
import { WHEEL } from '../src/core/wheelwork.js';
import { hasDoubleZero } from '../src/core/house.js';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const RUNS = opt('runs', 400);
const STEPS = opt('steps', 2500);
const SEED = opt('seed', 1);
const QUIET = args.includes('--quiet');
const DEEP = args.includes('--deep');

// A small seeded generator for the fuzzer's own choices.
function mulberry(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PACKAGE_IDS = Object.keys(PACKAGES);
const BET_IDS = BETS.map((b) => b.id);
const ACTIONS = [
  // [weight, type]: spins and bets dominate, as in play; the rest are pokes.
  [10, 'choosePackage'], [16, 'placeChip'], [5, 'removeChip'], [5, 'deposit'], [18, 'spin'], [5, 'endNight'],
  [5, 'buy'], [3, 'buyOddity'], [3, 'sell'], [3, 'moveTalisman'], [3, 'restock'], [3, 'pullLever'],
  [3, 'takeFortune'], [3, 'playRecord'], [1, 'leave'], [4, 'ringBell'],
];
const TOTAL = ACTIONS.reduce((s, [w]) => s + w, 0);

/** The odd amounts a player (or a broken text field) might hand the Cage. */
function oddAmount(state, r) {
  const coins = toNumber(state.coins);
  const picks = [0, -1, -1000, 0.5, 1, 7, coins, coins + 1, Math.floor(coins / 2), coins * 10, 1e30, Number.MAX_SAFE_INTEGER, NaN, Infinity, -Infinity, state.coins];
  return picks[Math.floor(r() * picks.length)];
}

function pick(arr, r) {
  return arr.length ? arr[Math.floor(r() * arr.length)] : undefined;
}

/** A random action shaped as the UI would send it, from what this state offers. */
function randomAction(state, r) {
  let x = r() * TOTAL;
  let type = ACTIONS[0][1];
  for (const [w, t] of ACTIONS) {
    if ((x -= w) < 0) {
      type = t;
      break;
    }
  }
  switch (type) {
    case 'choosePackage':
      return { type, packageId: pick(PACKAGE_IDS, r) };
    case 'placeChip': {
      const chip = pick(state.chips, r);
      if (!chip) return { type: 'spin' };
      // Mostly real bets, sometimes the racetrack's.
      return { type, chipId: chip.id, betId: pick(BET_IDS, r) };
    }
    case 'removeChip': {
      const chip = pick(state.chips, r);
      return chip ? { type, chipId: chip.id } : { type: 'spin' };
    }
    case 'deposit':
      return { type, amount: oddAmount(state, r) };
    case 'buy': {
      const slot = Math.floor(r() * state.cabinet.slots.length);
      const sellUid = r() < 0.3 ? pick(state.rail, r)?.uid : undefined;
      return { type, slot, ...(sellUid ? { sellUid } : {}) };
    }
    case 'buyOddity': {
      const slot = state.cabinet.slots.findIndex((x) => x.kind === 'oddity');
      if (slot < 0) return { type: 'restock' };
      const offer = state.cabinet.slots[slot];
      const def = offer.def ?? null;
      const picks = def?.picks ?? offer.picks ?? [];
      // Sometimes good targets, sometimes rubbish, sometimes too few.
      const targets = [];
      for (const p of picks) {
        const choices = workTargets(state, p);
        if (r() < 0.8 && choices.length) targets.push(pick(choices, r));
        else targets.push(pick(['nope', -3, 99, null, { number: 40 }, state.wheel.pockets[0]?.id], r));
      }
      if (r() < 0.1) targets.pop();
      return { type, slot, targets };
    }
    case 'sell': {
      const t = pick(state.rail, r);
      return t ? { type, uid: t.uid } : { type: 'restock' };
    }
    case 'moveTalisman': {
      const t = pick(state.rail, r);
      return t ? { type, uid: t.uid, to: Math.floor(r() * state.rail.length) } : { type: 'restock' };
    }
    case 'takeFortune': {
      const n = state.oracle?.cards?.length ?? 3;
      return { type, index: Math.floor(r() * n) };
    }
    case 'playRecord': {
      const id = r() < 0.2 ? null : (pick(state.records, r) ?? null);
      return { type, id, slot: r() < 0.7 ? 0 : 1 };
    }
    case 'ringBell': {
      const ringable = state.rail.filter((t) => getTalisman(t.id)?.bell && canAnswer(state, t));
      const inst = r() < 0.6 ? pick(ringable, r) : null;
      if (!inst) return { type };
      const work = getTalisman(inst.id).bell.work;
      if (!work) return { type, uid: inst.uid };
      const targets = [];
      const n = 1 + Math.floor(r() * work.picks);
      for (let i = 0; i < n; i++) {
        const p = pick(state.wheel.pockets, r);
        targets.push(r() < 0.85 ? { pocket: p.id, number: Math.floor(r() * 38) } : { pocket: 'x', number: -1 });
      }
      return { type, uid: inst.uid, targets };
    }
    default:
      return { type };
  }
}

// ---- What must always hold ---------------------------------------------------------------

function isNum(v) {
  return isBig(v) ? Number.isFinite(v.exponent) && Number.isFinite(v.mantissa) : typeof v === 'number' && Number.isFinite(v);
}

/** Every number anywhere in the state is finite (no NaN crept in). */
function findBadNumber(v, path = 'state', seen = new Set()) {
  if (typeof v === 'number') return Number.isFinite(v) ? null : `${path} = ${v}`;
  if (!v || typeof v !== 'object' || seen.has(v)) return null;
  if (isBig(v)) return isNum(v) ? null : `${path} = ${v}`;
  seen.add(v);
  for (const [k, x] of Object.entries(v)) {
    const bad = findBadNumber(x, `${path}.${k}`, seen);
    if (bad) return bad;
  }
  return null;
}

/** Where two plain values first differ, as a path and both values. */
function firstDifference(x, y, path = '') {
  if (JSON.stringify(x) === JSON.stringify(y)) return null;
  if (x && y && typeof x === 'object' && typeof y === 'object') {
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
      const d = firstDifference(x[k], y[k], `${path}.${k}`);
      if (d) return d;
    }
  }
  return `${path}: ${JSON.stringify(x)?.slice(0, 120)} → ${JSON.stringify(y)?.slice(0, 120)}`;
}

function invariants(s, events) {
  const out = [];
  if (!Array.isArray(events)) out.push('events is not an array');
  else for (const e of events) if (!e || typeof e.type !== 'string') out.push(`an event without a type: ${JSON.stringify(e)}`);
  if (!Object.values(PHASE).includes(s.phase)) out.push(`unknown phase ${s.phase}`);
  const bad = findBadNumber(s);
  if (bad) out.push(`non-finite number: ${bad}`);
  if (!isNum(s.coins) || !gte(s.coins, 0)) out.push(`coins ${s.coins}`);
  if (!isNum(s.deposited) || !gte(s.deposited, 0)) out.push(`deposited ${s.deposited}`);
  if (!Number.isInteger(s.tokens) || s.tokens < 0) out.push(`tokens ${s.tokens}`);
  if (!Number.isInteger(s.spinsLeft) || s.spinsLeft < 0) out.push(`spinsLeft ${s.spinsLeft}`);
  if (s.spinsLeft > s.spinsTonight && s.phase === PHASE.BETTING) out.push(`spinsLeft ${s.spinsLeft} > spinsTonight ${s.spinsTonight}`);
  if (s.rail.length > hooksFor(s)) out.push(`rail ${s.rail.length} on ${hooksFor(s)} hooks`);
  const uids = new Set(s.rail.map((t) => t.uid));
  if (uids.size !== s.rail.length) out.push('two talismans share a uid');
  for (const t of s.rail) if (!getTalisman(t.id)) out.push(`unknown talisman on the rail: ${t.id}`);
  const chipIds = new Set(s.chips.map((c) => c.id));
  if (chipIds.size !== s.chips.length) out.push('two chips share an id');
  for (const [chip, bet] of Object.entries(s.placements)) {
    if (!chipIds.has(chip)) out.push(`placement for a missing chip ${chip}`);
    if (!BETS.some((b) => b.id === bet)) out.push(`placement on an unknown bet ${bet}`);
    else if (BETS.find((b) => b.id === bet).numbers.includes(37) && !hasDoubleZero(s)) out.push(`a bet on 00 without one: ${bet}`);
  }
  for (const c of s.fixed) if (!chipIds.has(c)) out.push(`fixed chip ${c} is gone`);
  const n = s.wheel.pockets.length;
  if (n < WHEEL.minPockets || n > WHEEL.maxPockets) out.push(`wheel of ${n} pockets`);
  const pids = new Set(s.wheel.pockets.map((p) => p.id));
  if (pids.size !== n) out.push('two pockets share an id');
  for (const p of s.wheel.pockets) if (!(p.width > 0)) out.push(`pocket ${p.id} width ${p.width}`);
  if (!(s.round >= 1 && s.round <= 3)) out.push(`round ${s.round}`);
  if (!(s.debt >= 1)) out.push(`debt ${s.debt}`);
  if (s.playing && s.playing === s.playing2) out.push(`the same record in both slots: ${s.playing}`);
  for (const id of [s.playing, s.playing2]) if (id && !s.records.includes(id)) out.push(`playing ${id}, not in the crate`);
  if (s.playing2 && s.gramophoneSlots < 2) out.push('a second record with one slot');
  return out;
}

// ---- The runs ------------------------------------------------------------------------------

const failures = new Map(); // message key → first report
let steps = 0;
let throwsByDesign = 0;
let gameOvers = 0;
const accepted = {}; // action type → times it went through
const reached = { debt: 0 };

function report(key, info) {
  if (failures.has(key)) {
    failures.get(key).count += 1;
    return;
  }
  failures.set(key, { ...info, count: 1 });
}

// The core throws on ids the UI can never send (unknown chip, compartment,
// talisman, card); those are not bugs. Anything else thrown is.
const BY_DESIGN = /^(Unknown (package|chip|bet|compartment|talisman)|No card \d+ in the deal|No record .* in the crate|No hook -?\d+ on the rail)/;

for (let run = 0; run < RUNS; run++) {
  const r = mulberry(SEED * 100003 + run);
  const seed = `FUZZ-${SEED}-${run}`;
  const setup = {
    seed,
    chipSet: pick(MATERIALS, r).id,
    wheel: pick(STARTING_WHEELS, r).id,
    edge: Math.floor(r() * (MAX_EDGE + 1)),
    locks: Math.floor(r() * 5),
    vault: r() < 0.3,
    figures: Math.floor(r() * 13),
    endless: r() < 0.15,
  };
  let state = createRun(setup);
  let profile = newProfile();
  // Some runs start rich, with talismans hung, to reach the later systems.
  if (DEEP || r() < 0.5) {
    state = { ...state, coins: num(10 ** Math.floor((DEEP ? 3 : 0) + r() * 25)), tokens: Math.floor(r() * 60) };
    for (let k = 0; k < 6; k++) {
      const def = pick(TALISMANS, r);
      try {
        state = grantTalisman(state, def.id);
      } catch {
        // A full rail: fine.
      }
    }
  }
  const trail = [];
  for (let i = 0; i < STEPS && state.phase !== PHASE.GAME_OVER; i++) {
    let action = randomAction(state, r);
    // Deep runs bank it all before the Cage collects, most of the time.
    if (DEEP && state.phase === PHASE.NIGHT_OVER && state.round === 3 && r() < 0.9 && gte(state.coins, 1)) action = { type: 'deposit', amount: state.coins };
    trail.push(action);
    if (trail.length > 12) trail.shift();
    const before = i % 25 === 0 ? serializeRun(state) : null;
    let res;
    try {
      res = act(state, action);
    } catch (e) {
      if (BY_DESIGN.test(e.message)) {
        throwsByDesign += 1;
        continue;
      }
      report(`throw: ${e.message}`, { seed, setup, step: i, action, trail: [...trail], stack: e.stack?.split('\n').slice(0, 4).join('\n') });
      break;
    }
    steps += 1;
    if (!res.events.some((e) => e.type === 'rejected')) accepted[action.type] = (accepted[action.type] ?? 0) + 1;
    if (before !== null && serializeRun(state) !== before) report(`act mutated its input (${action.type})`, { seed, setup, step: i, action, trail: [...trail] });
    const broken = invariants(res.state, res.events);
    for (const b of broken) report(`invariant: ${b.replace(/[\d.e+-]{4,}/g, 'N')}`, { seed, setup, step: i, action, detail: b, trail: [...trail] });
    if (broken.length) break;
    // Save and load now and then: the run must come back the same.
    if (i % 40 === 0) {
      const json = serializeRun(res.state);
      const back = deserializeRun(json);
      if (!back) report('a save would not load', { seed, setup, step: i, action });
      else if (serializeRun(back) !== json) report('a save changed on reload', { seed, setup, step: i, action, detail: firstDifference(JSON.parse(json), JSON.parse(serializeRun(back))) });
    }
    // The meta profile follows the run, as game.js does.
    try {
      profile = applyRun(profile, res.state, res.events).profile;
    } catch (e) {
      report(`profile throw: ${e.message}`, { seed, setup, step: i, action, stack: e.stack?.split('\n').slice(0, 4).join('\n') });
      break;
    }
    state = res.state;
  }
  if (state.phase === PHASE.GAME_OVER) gameOvers += 1;
  reached.debt = Math.max(reached.debt, state.debt);
}

console.log(`${RUNS} runs, ${steps} steps, ${gameOvers} ended, deepest debt ${reached.debt}, ${throwsByDesign} rejected ids (by design)`);
console.log('accepted:', Object.entries(accepted).map(([k, v]) => `${k} ${v}`).join(', '));
if (!failures.size) console.log('No failures.');
for (const [key, f] of failures) {
  console.log(`\n✗ ${key}  (×${f.count})`);
  if (QUIET) continue;
  console.log(`  seed ${f.seed}, step ${f.step}, setup ${JSON.stringify(f.setup)}`);
  console.log(`  action ${JSON.stringify(f.action)}`);
  if (f.detail) console.log(`  ${f.detail}`);
  if (f.stack) console.log(`  ${f.stack.replace(/\n/g, '\n  ')}`);
  if (f.trail) console.log(`  last steps: ${f.trail.map((a) => a.type).join(' → ')}`);
}
process.exitCode = failures.size ? 1 : 0;
