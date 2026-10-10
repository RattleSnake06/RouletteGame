import { BET_BY_ID } from './bets.js';
import { canAnswer, ringBell } from './bell.js';
import { TALISMAN_SLOTS, copyCabinet, emptyCabinet, restockSlots } from './cabinet.js';
import { getTalisman } from './content/index.js';
import { ECONOMY, PACKAGES, interestOn, owedFor, packageCost, priceOf, restockCost, sellValueOf, spinCostFor } from './economy.js';
import { interestRateFor, lifecycle } from './effects.js';
import { add, gt, gte, lte, max, mul, sub } from './num.js';
import { resolveSpin } from './resolve.js';
import { seedStreams } from './rng.js';
import { copyTally, emptyRoundTally, emptyTally } from './tally.js';
import { createEuropeanWheel } from './wheel.js';

// The run as a state machine (design doc 9.3). `act(state, action)` returns
// a new state plus an ordered list of events for the view to play back; it
// never mutates its input. Phases:
//
//   roundStart  choose a package (long night, short night, sit out)
//   betting     arrange chips and spin until the night's spins run out
//   nightOver   bank coins at the Cage, then end the night
//   gameOver    the Cage collected and the deposits fell short
//
// Chips, the Cage, the Curio Cabinet, the rail and the Bell can be used in
// any phase but gameOver.

export const PHASE = {
  ROUND_START: 'roundStart',
  BETTING: 'betting',
  NIGHT_OVER: 'nightOver',
  GAME_OVER: 'gameOver',
};

export const RUN_VERSION = 2;
const HISTORY_LENGTH = 40;

const noEvents = () => {};

export function createRun({ seed }) {
  const chips = [];
  for (let i = 0; i < ECONOMY.startChips; i++) chips.push({ id: `c${i + 1}`, value: 1, material: 'clay', roundValue: 0 });
  const s = {
    version: RUN_VERSION,
    seed,
    rng: seedStreams(seed),
    phase: PHASE.ROUND_START,
    debt: 1,
    round: 1,
    spinsLeft: 0,
    spinsTonight: 0, // the night's full allowance, for the HUD's tally
    satOut: 0,
    coins: ECONOMY.startCoins,
    deposited: 0,
    tokens: ECONOMY.startTokens,
    chips,
    nextChipId: chips.length + 1,
    placements: {},
    wheel: createEuropeanWheel(),
    railHooks: ECONOMY.startHooks,
    rail: [],
    nextUid: 1,
    cabinet: emptyCabinet(),
    foreseen: null,
    armed: { rethrow: null },
    tally: emptyTally(),
    history: [],
    lastSpin: null,
    stats: newStats(),
    outcome: null,
  };
  lifecycle(s, 'runStart', noEvents);
  beginDebt(s, noEvents);
  beginRound(s, noEvents);
  return s;
}

export function newStats() {
  return {
    spins: 0,
    wins: 0,
    misses: 0,
    bestSpin: 0,
    totalWon: 0,
    debtsPaid: 0,
    rethrows: 0,
    bellRings: 0,
    talismansBought: 0,
    talismansSold: 0,
    restocksPaid: 0,
    tokensEarned: 0,
    tokensSpent: 0,
  };
}

// --- Selectors --------------------------------------------------------------

export const owed = (state) => owedFor(state.debt);
export const spinCost = (state) => spinCostFor(state.debt);
export const costOf = (state, packageId) => packageCost(state.debt, packageId);
export const canAfford = (state, packageId) => gte(state.coins, costOf(state, packageId));
export const isFinalNight = (state) => state.round === ECONOMY.roundsPerDebt;
export const chipsOnTable = (state) => state.chips.filter((c) => state.placements[c.id]);
export const nextRestockCost = (state) => restockCost(state.debt, state.cabinet.paidRestocks);
export const interestRate = (state) => interestRateFor(state, ECONOMY.interestRate);

// --- Lifecycle --------------------------------------------------------------

/** A new debt: the debt's tally, restock prices and Bell charges start over. */
function beginDebt(s, emit) {
  s.tally = { ...s.tally, debt: { numbers: {} } };
  s.cabinet.paidRestocks = 0;
  const refilled = [];
  for (const inst of s.rail) {
    const def = getTalisman(inst.id);
    if (!def?.charges || def.charges.refill !== 'debt') continue;
    // A charge whose effect is still waiting (a foreseen landing, an armed
    // throw) is not refilled, so it cannot be carried into a second use; the
    // others are.
    const pending = s.foreseen?.by === inst.uid || s.armed.rethrow?.by === inst.uid;
    const cap = def.charges.max - (pending ? 1 : 0);
    if (inst.charges >= cap) continue;
    inst.charges = cap;
    refilled.push(inst.uid);
  }
  if (refilled.length) emit({ type: 'chargesRefilled', uids: refilled });
  lifecycle(s, 'debtStart', emit, { debt: s.debt });
}

/** A new night: tonight's tally clears and the Cabinet restocks for free. */
function beginRound(s, emit) {
  s.tally = { ...s.tally, round: emptyRoundTally() };
  const slots = restockSlots(s);
  emit({ type: 'offersRestocked', paid: false, slots });
  lifecycle(s, 'roundStart', emit, { debt: s.debt, round: s.round });
}

// --- Actions ----------------------------------------------------------------

export function copyRun(state) {
  return {
    ...state,
    rng: { ...state.rng },
    chips: state.chips.map((c) => ({ ...c })),
    placements: { ...state.placements },
    wheel: { pockets: state.wheel.pockets.map((p) => ({ ...p })) },
    rail: state.rail.map((t) => ({ ...t, data: copyData(t.data) })),
    cabinet: copyCabinet(state.cabinet),
    armed: { ...state.armed },
    tally: copyTally(state.tally),
    history: [...state.history],
    stats: { ...state.stats },
  };
}

function copyData(data) {
  const out = { ...data };
  if (data.copy) out.copy = Object.fromEntries(Object.entries(data.copy).map(([k, v]) => [k, { ...v }]));
  return out;
}

function reject(state, reason, code) {
  return { state, events: [{ type: 'rejected', reason, code }] };
}

/** Applies one player action. Returns { state, events }. */
export function act(state, action) {
  if (state.phase === PHASE.GAME_OVER) return reject(state, 'The run is over.', 'wrongPhase');
  const handler = HANDLERS[action.type];
  if (!handler) throw new Error(`Unknown action: ${action.type}`);
  return handler(state, action);
}

/**
 * Puts a talisman on the rail without paying for it (tests, the sim, debug).
 * The rules still hold: it needs a free hook, and the Cabinet stops offering it.
 */
export function grantTalisman(state, id) {
  const def = getTalisman(id);
  if (!def) throw new Error(`Unknown talisman: ${id}`);
  if (state.rail.length >= state.railHooks) throw new Error('No free hook on the rail');
  const s = copyRun(state);
  hang(s, def, priceOf(def.rarity), noEvents);
  s.cabinet.slots = s.cabinet.slots.map((x) => (x.kind === 'talisman' && x.id === id ? { kind: 'talisman', id: null, sold: true } : x));
  return s;
}

function hang(s, def, price, emit) {
  const inst = {
    uid: `t${s.nextUid}`,
    id: def.id,
    price, // kept so a sale (or a save that outlives the talisman) can refund it
    data: def.init?.() ?? {},
    charges: def.charges?.max ?? null,
  };
  s.nextUid += 1;
  s.rail = [...s.rail, inst];
  lifecycle(s, 'purchased', emit, (src) => ({ item: inst, isSelf: src.inst === inst }));
  return inst;
}

function sellOne(s, uid, emit) {
  const inst = s.rail.find((t) => t.uid === uid);
  lifecycle(s, 'sold', emit, (src) => ({ item: inst, isSelf: src.inst === inst }));
  const refund = sellValueOf(inst.price);
  s.rail = s.rail.filter((t) => t !== inst);
  s.tokens += refund;
  s.stats.talismansSold += 1;
  emit({ type: 'sold', uid: inst.uid, id: inst.id, refund });
  return refund;
}

const HANDLERS = {
  choosePackage(state, { packageId }) {
    if (state.phase !== PHASE.ROUND_START) return reject(state, 'A night is already under way.', 'wrongPhase');
    const pkg = PACKAGES[packageId];
    if (!pkg) throw new Error(`Unknown package: ${packageId}`);
    const cost = costOf(state, packageId);
    if (!gte(state.coins, cost)) return reject(state, 'Not enough coins for that night.', 'noCoins');
    const s = copyRun(state);
    s.coins = sub(s.coins, cost);
    s.tokens += pkg.tokens;
    s.stats.tokensEarned += pkg.tokens;
    s.spinsLeft = pkg.spins;
    s.spinsTonight = pkg.spins;
    if (pkg.spins === 0) {
      s.satOut += 1;
      s.phase = PHASE.NIGHT_OVER;
    } else {
      s.phase = PHASE.BETTING;
    }
    return { state: s, events: [{ type: 'packageChosen', packageId, cost, tokens: pkg.tokens }] };
  },

  placeChip(state, { chipId, betId }) {
    if (!state.chips.some((c) => c.id === chipId)) throw new Error(`Unknown chip: ${chipId}`);
    if (!BET_BY_ID.has(betId)) throw new Error(`Unknown bet: ${betId}`);
    if (state.placements[chipId] === betId) return { state, events: [] };
    const s = copyRun(state);
    s.placements[chipId] = betId;
    return { state: s, events: [{ type: 'chipPlaced', chipId, betId }] };
  },

  removeChip(state, { chipId }) {
    if (!state.placements[chipId]) return { state, events: [] };
    const s = copyRun(state);
    delete s.placements[chipId];
    return { state: s, events: [{ type: 'chipRemoved', chipId }] };
  },

  deposit(state, { amount }) {
    if (!gt(amount, 0)) return reject(state, 'Nothing to deposit.', 'empty');
    if (!lte(amount, state.coins)) return reject(state, 'You do not have that many coins.', 'noCoins');
    const s = copyRun(state);
    s.coins = sub(s.coins, amount);
    s.deposited = add(s.deposited, amount);
    return { state: s, events: [{ type: 'deposited', amount }] };
  },

  spin(state) {
    if (state.phase !== PHASE.BETTING || state.spinsLeft <= 0) return reject(state, 'No spins left tonight.', 'wrongPhase');
    const s = copyRun(state);
    const coinsBefore = s.coins;
    const detail = [];
    const result = resolveSpin(s, (e) => detail.push(e));
    // The coins this spin added, bonuses and after-spin effects included.
    result.total = sub(s.coins, coinsBefore);

    s.spinsLeft -= 1;
    s.history.push({ number: result.number, color: result.color });
    if (s.history.length > HISTORY_LENGTH) s.history.shift();
    s.lastSpin = result;
    s.stats.spins += 1;
    if (result.miss) s.stats.misses += 1;
    else s.stats.wins += 1;
    s.stats.totalWon = add(s.stats.totalWon, result.total);
    s.stats.bestSpin = max(s.stats.bestSpin, result.total);

    const events = [{ type: 'spin', result }, ...detail];
    if (s.spinsLeft === 0) {
      s.phase = PHASE.NIGHT_OVER;
      events.push({ type: 'nightOver' });
    }
    return { state: s, events };
  },

  endNight(state) {
    if (state.phase !== PHASE.NIGHT_OVER) return reject(state, 'The night is not over yet.', 'wrongPhase');
    const s = copyRun(state);
    const events = [];
    const emit = (e) => events.push(e);

    const rate = interestRateFor(s, ECONOMY.interestRate, emit);
    const interest = interestOn(s.deposited, rate);
    s.deposited = add(s.deposited, interest);
    emit({ type: 'interest', amount: interest, deposited: s.deposited, rate });
    s.tokens += ECONOMY.nightTokens;
    s.stats.tokensEarned += ECONOMY.nightTokens;
    emit({ type: 'tokens', amount: ECONOMY.nightTokens, reason: 'night' });

    lifecycle(s, 'roundEnd', emit);
    // Values won tonight (Matchbook) burn out with the night.
    for (const chip of s.chips) {
      if (!chip.roundValue) continue;
      chip.roundValue = 0;
      emit({ type: 'chipValue', chipId: chip.id, roundValue: 0 });
    }

    if (s.round < ECONOMY.roundsPerDebt) {
      s.round += 1;
      s.phase = PHASE.ROUND_START;
      emit({ type: 'roundStart', debt: s.debt, round: s.round });
      beginRound(s, emit);
      return { state: s, events };
    }

    // The Cage collects.
    const due = owedFor(s.debt);
    if (!gte(s.deposited, due)) {
      s.phase = PHASE.GAME_OVER;
      s.outcome = { reason: 'collected', debt: s.debt, owed: due, deposited: s.deposited };
      emit({ type: 'collected', debt: s.debt, owed: due, deposited: s.deposited });
      return { state: s, events };
    }

    s.deposited = sub(s.deposited, due);
    const rewardTokens = ECONOMY.debtRewardTokens + ECONOMY.sitOutTokens * s.satOut;
    const rewardCoins = mul(spinCostFor(s.debt + 1), ECONOMY.rewardSpins);
    s.tokens += rewardTokens;
    s.stats.tokensEarned += rewardTokens;
    s.coins = add(s.coins, rewardCoins);
    s.stats.debtsPaid += 1;
    lifecycle(s, 'debtPaid', emit, { debt: s.debt });
    emit({
      type: 'debtPaid',
      debt: s.debt,
      owed: due,
      satOut: s.satOut,
      rewardTokens,
      rewardCoins,
      surplus: s.deposited,
    });

    s.debt += 1;
    s.round = 1;
    s.satOut = 0;
    s.phase = PHASE.ROUND_START;
    beginDebt(s, emit);
    emit({ type: 'roundStart', debt: s.debt, round: s.round });
    beginRound(s, emit);
    return { state: s, events };
  },

  // --- The Curio Cabinet and the rail -----------------------------------------

  /** Buys from a compartment; `sellUid` sells that talisman first, in one step. */
  buy(state, { slot, sellUid }) {
    const offer = state.cabinet.slots[slot];
    if (!offer) throw new Error(`Unknown compartment: ${slot}`);
    const def = offer.kind === 'talisman' && offer.id ? getTalisman(offer.id) : null;
    if (!def) return reject(state, 'That compartment is empty.', 'soldOut');
    const price = priceOf(def.rarity);
    const selling = sellUid ? state.rail.find((t) => t.uid === sellUid) : null;
    if (sellUid && !selling) throw new Error(`Unknown talisman: ${sellUid}`);
    const refund = selling ? sellValueOf(selling.price) : 0;
    if (state.tokens + refund < price) return reject(state, 'Not enough tokens.', 'noTokens');
    if (state.rail.length - (selling ? 1 : 0) >= state.railHooks) {
      return reject(state, 'No free hook. Sell a talisman first.', 'railFull');
    }

    const s = copyRun(state);
    const events = [];
    const emit = (e) => events.push(e);
    if (selling) sellOne(s, sellUid, emit);
    s.tokens -= price;
    s.stats.tokensSpent += price;
    s.stats.talismansBought += 1;
    s.cabinet.slots[slot] = { kind: 'talisman', id: null, sold: true };
    const before = events.length;
    const inst = hang(s, def, price, emit);
    events.splice(before, 0, { type: 'bought', slot, uid: inst.uid, id: def.id, price });
    return { state: s, events };
  },

  sell(state, { uid }) {
    if (!state.rail.some((t) => t.uid === uid)) throw new Error(`Unknown talisman: ${uid}`);
    const s = copyRun(state);
    const events = [];
    sellOne(s, uid, (e) => events.push(e));
    return { state: s, events };
  },

  /** Order matters (doc 5.8): talismans act left to right. */
  moveTalisman(state, { uid, to }) {
    const from = state.rail.findIndex((t) => t.uid === uid);
    if (from < 0) throw new Error(`Unknown talisman: ${uid}`);
    if (!Number.isInteger(to) || to < 0 || to >= state.rail.length) throw new Error(`No hook ${to} on the rail`);
    if (from === to) return { state, events: [] };
    const s = copyRun(state);
    const [inst] = s.rail.splice(from, 1);
    s.rail.splice(to, 0, inst);
    return { state: s, events: [{ type: 'talismanMoved', uid, from, to, order: s.rail.map((t) => t.uid) }] };
  },

  restock(state) {
    const cost = nextRestockCost(state);
    if (!gte(state.coins, cost)) return reject(state, 'Not enough coins to restock.', 'noCoins');
    const s = copyRun(state);
    s.coins = sub(s.coins, cost);
    s.cabinet.paidRestocks += 1;
    s.stats.restocksPaid += 1;
    const slots = restockSlots(s);
    return { state: s, events: [{ type: 'offersRestocked', paid: true, cost, slots }] };
  },

  /** Rings the Bell: the head of the queue, or the talisman `uid`. */
  ringBell(state, { uid } = {}) {
    if (uid) {
      const inst = state.rail.find((t) => t.uid === uid);
      if (!inst) throw new Error(`Unknown talisman: ${uid}`);
      if (!canAnswer(state, inst)) return reject(state, 'It does not answer.', 'notUsable');
    }
    const s = copyRun(state);
    const events = [];
    const answered = ringBell(s, uid, (e) => events.push(e));
    // Nothing answering is not a mistake: the bell just rings dull.
    return { state: answered ? s : state, events };
  },
};

export { TALISMAN_SLOTS };
