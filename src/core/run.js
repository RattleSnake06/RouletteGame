import { BET_BY_ID, isSpecial } from './bets.js';
import { canAnswer, ringBell } from './bell.js';
import { TALISMAN_SLOTS, copyCabinet, emptyCabinet, restockSlots } from './cabinet.js';
import { MATERIALS, getEngraving, getFortune, getMaterial, getOddity, getRecord, getStartingWheel, getTalisman, playingRecords } from './content/index.js';
import { ECONOMY, PACKAGES, interestOn, owedFor, packageCost, priceOf, restockCost, spinCostFor } from './economy.js';
import { devilChanceFor } from './devil.js';
import { debtMultiplier, debtTokensFor, hasDoubleZero, nightTokensFor, startingWheel } from './house.js';
import { commitCtx, interestRateFor, lifecycle, openSpecials, saleValue, sources } from './effects.js';
import { add, ceil, gt, gte, lte, max, mul, sub } from './num.js';
import { nudgeFor, rollDebtLeans, rollNightLean } from './nudge.js';
import { canTake, dealCards, dealOf, fortuneCtx, rerollCost } from './oracle.js';
import { resolveSpin } from './resolve.js';
import { Rng, seedStreams } from './rng.js';
import { copyTally, emptyRoundTally, emptyTally } from './tally.js';
import { doWork, workRefusal } from './wheelwork.js';
import { DOUBLE_ZERO } from './wheel.js';

// The run as a state machine (design doc 9.3). `act(state, action)` returns
// a new state plus an ordered list of events for the view to play back; it
// never mutates its input. Phases:
//
//   roundStart  choose a package (long night, short night, sit out)
//   betting     arrange chips and spin until the night's spins run out
//   nightOver   bank coins at the Cage, then end the night
//   gameOver    the Cage collected and the deposits fell short, or the
//               player stepped out of the light past the goal
//
// Chips, the Cage, the Curio Cabinet, the rail, the Bell, Madame Zero and the
// gramophone can be used in any phase but gameOver; so can wheel work.

export const PHASE = {
  ROUND_START: 'roundStart',
  BETTING: 'betting',
  NIGHT_OVER: 'nightOver',
  GAME_OVER: 'gameOver',
};

export const RUN_VERSION = 9;

// The Vault (design doc 7.1): a run's goal is debt 4 + the locks open when it
// began. Lock k opens the first time debt 3 + k is paid with the locks before
// it open; with all four open, paying debt 8 or later opens the Vault.
export const VAULT = { baseGoal: 4, locks: 4 };
/** The debt whose payment opens lock `k`. */
export const lockDebt = (k) => VAULT.baseGoal - 1 + k;
const HISTORY_LENGTH = 40;

const noEvents = () => {};
const FIXED = 'Bone chips stay where they lie until the night ends.';

/**
 * A new run. `chipSet` is the material of the starting chips (decision 26);
 * `wheel` the starting wheel and `edge` the House Edge level (doc 7.2). From
 * the profile: `locks` the Vault's open locks (they set the goal and the
 * gramophone's slots), `vault` whether it is open already, and `figures` the
 * figures standing in the dark (Danse Macabre reads them). `opened` lists the
 * content the Vault's locks and the Almanac's feats have opened (Phase 7,
 * decision 29): until then the Cabinet, Madame Zero and the crate never
 * offer it. `endless` is a run with no goal (doc 7.1).
 */
export function createRun({ seed, chipSet = MATERIALS[0].id, wheel = 'european', edge = 0, locks = 0, vault = false, figures = 0, opened = [], endless = false }) {
  const material = getMaterial(chipSet);
  const chips = [];
  for (let i = 0; i < material.count; i++) chips.push({ id: `c${i + 1}`, value: 1, material: material.id, roundValue: 0 });
  const rng = seedStreams(seed);
  const pockets = new Rng(rng.pockets);
  const s = {
    version: RUN_VERSION,
    seed,
    chipSet: material.id,
    wheelId: getStartingWheel(wheel).id,
    // Neighbours bets follow the starting wheel (bets.js betOf); the House's own needs none.
    wheelOrder: getStartingWheel(wheel).id === 'european' ? null : [...getStartingWheel(wheel).order],
    opened: [...opened],
    endless,
    edge,
    locks,
    goal: endless ? null : VAULT.baseGoal + locks,
    vault,
    won: null, // the debt whose payment reached the goal
    figures,
    rng,
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
    fixed: [], // chips placed tonight that may not move until the night ends (Bone)
    chipTokens: 0, // tokens chips have earned tonight (Gold, capped a night)
    levels: {}, // each kind of bet's level, where something raised it (doc 5.3)
    wheel: startingWheel(wheel, edge, pockets),
    railHooks: ECONOMY.startHooks,
    rail: [],
    nextUid: 1,
    cabinet: emptyCabinet(),
    foreseen: null,
    armed: { rethrow: null },
    debtSpins: 0, // spins so far this debt (debt 1's Leans count them)
    leans: { debt: [], night: null }, // the House's Leans still to come (doc 5.6)
    missStreak: 0, // spins in a row that paid nothing (pity)
    luckyNudge: 0, // Nudge a Lucky pocket left for the next spin (doc 6.5)
    devil: { firedThisDebt: false, nightCurse: 0 }, // nightCurse: Cursed pockets landed in tonight
    // Phase 4: Madame Zero's deal this debt, fortunes taken (and the ones that
    // last), the record crate and what is playing.
    oracle: null,
    picks: {},
    boons: [],
    nextBoonUid: 1,
    records: [],
    playing: null,
    playing2: null, // the gramophone's second slot, from the Vault's second lock
    gramophoneSlots: locks >= 2 ? 2 : 1,
    recordData: {},
    overture: null, // the debt Overture of Excess played during (it owes double)
    tally: emptyTally(),
    history: [],
    lastSpin: null,
    stats: newStats(),
    outcome: null,
  };
  s.rng.pockets = pockets.state();
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
    talismansGone: 0, // used up: crumbled, wilted, shattered, smashed (the Pyre counts them)
    restocksPaid: 0,
    tokensEarned: 0,
    tokensSpent: 0,
    odditiesBought: 0,
    shattered: 0,
    leans: 0,
    hops: 0,
    devils: 0,
    wards: 0,
  };
}

// --- Selectors --------------------------------------------------------------

/**
 * What the Cage collects at the end of debt `debt` (this one by default): the
 * debt table's, more on the Gilded wheel and at House Edge 4, and twice as
 * much if Overture of Excess played during it.
 */
export function owed(state, debt = state.debt) {
  const x = debtMultiplier(state);
  const due = x === 1 ? owedFor(debt) : ceil(mul(owedFor(debt), x));
  return state.overture === debt ? mul(due, 2) : due;
}
export const spinCost = (state) => spinCostFor(state.debt);
/** A night's spins: the package's, and more from `nightSpins` hooks (the Hourglass) on a night that has any. */
export function spinsOf(state, packageId) {
  let spins = PACKAGES[packageId].spins;
  if (spins === 0) return 0;
  for (const src of sources(state)) {
    const fn = src.as.hooks?.nightSpins;
    if (fn) fn({ state, self: src.self, addSpins: (n) => (spins += n) });
  }
  return spins;
}

/** A night's price, with what plays on the gramophone (`packageCost` hooks). */
export function costOf(state, packageId) {
  let cost = packageCost(state.debt, packageId);
  for (const src of sources(state)) {
    const fn = src.as.hooks?.packageCost;
    if (fn) fn({ state, self: src.self, mulCost: (x) => (cost = ceil(mul(cost, x))) });
  }
  return cost;
}
/** Talisman hooks on the rail, with a record's (Static). */
export const hooksFor = (state) => state.railHooks + playingRecords(state).reduce((n, r) => n + (r.extraHooks || 0), 0);
/** What a Cabinet talisman costs now: nothing on a free buy, less with a discount. */
export const offerPrice = (state, def) => (state.cabinet.freeBuys > 0 ? 0 : Math.max(0, priceOf(def.rarity) - state.cabinet.discount));
/** A Restless talisman whose free restock this debt is unused, or null. */
export const freeRestockBy = (state) => state.rail.find((t) => getEngraving(t.engraving)?.freeRestock && t.data.restlessDebt !== state.debt) ?? null;
/** What an oddity costs, in coins: its spins at this debt's spin cost (decision 27). */
export const oddityPrice = (state, def) => mul(spinCostFor(state.debt), def.spins);
/** What the next restock costs: nothing while a Restless engraving has one to give. */
export const restockPrice = (state) => (freeRestockBy(state) ? 0 : restockCost(state.debt, state.cabinet.paidRestocks));
export const canAfford = (state, packageId) => gte(state.coins, costOf(state, packageId));
export const isFinalNight = (state) => state.round === ECONOMY.roundsPerDebt;
export const chipsOnTable = (state) => state.chips.filter((c) => state.placements[c.id]);
export const nextRestockCost = (state) => restockCost(state.debt, state.cabinet.paidRestocks);
export const interestRate = (state) => interestRateFor(state, ECONOMY.interestRate);
/** The next spin's Nudge: { total, lean, pity, charms, clockwise, straightOnly, kind }. */
export const nextNudge = (state) => nudgeFor(state);
/** The Devil's chance on the next throw (0 until debt 2 is paid). */
export const devilChance = (state) => devilChanceFor(state);
export const isCursed = (inst) => !!getTalisman(inst.id)?.cursed;
// --- Lifecycle --------------------------------------------------------------

/** A new debt: the debt's tally, restock prices and Bell charges start over. */
function beginDebt(s, emit) {
  s.tally = { ...s.tally, debt: { numbers: {} } };
  s.cabinet.paidRestocks = 0;
  s.debtSpins = 0;
  // Bell rings a talisman answered this debt (the Carillon).
  s.debtRings = 0;
  s.leans = { debt: rollDebtLeans(s), night: null };
  s.devil = { ...s.devil, firedThisDebt: false };
  // A debt that begins to Overture of Excess owes double, as one it starts during would.
  if (playingRecords(s).some((r) => r.doublesDebt)) s.overture = s.debt;
  const refilled = [];
  for (const inst of s.rail) {
    const def = getTalisman(inst.id);
    if (!def?.charges || def.charges.refill !== 'debt') continue;
    // A charge whose effect is still waiting (a foreseen landing, an armed
    // throw, a twitching rod) is not refilled, so it cannot be carried into a
    // second use; the others are.
    const pending = s.foreseen?.by === inst.uid || s.armed.rethrow?.by === inst.uid || !!inst.data?.armed;
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
  // A new night: Bone chips may move again, Gold earns afresh, and the
  // night's curses lift.
  s.fixed = [];
  s.chipTokens = 0;
  s.devil = { ...s.devil, nightCurse: 0 };
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
    fixed: [...(state.fixed ?? [])],
    levels: { ...state.levels },
    wheel: { ...state.wheel, pockets: state.wheel.pockets.map((p) => ({ ...p })) },
    rail: state.rail.map((t) => ({ ...t, data: copyData(t.data) })),
    cabinet: copyCabinet(state.cabinet),
    armed: { ...state.armed },
    leans: { debt: state.leans.debt.map((l) => ({ ...l })), night: state.leans.night && { ...state.leans.night } },
    devil: { ...state.devil },
    oracle: state.oracle && { ...state.oracle, cards: [...state.oracle.cards] },
    picks: { ...state.picks },
    boons: state.boons.map((b) => ({ ...b, data: { ...b.data } })),
    records: [...state.records],
    recordData: Object.fromEntries(Object.entries(state.recordData).map(([k, v]) => [k, { ...v }])),
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
  if (!def.instant && state.rail.length >= hooksFor(state)) throw new Error('No free hook on the rail');
  const s = copyRun(state);
  if (def.instant) openInstant(s, def, priceOf(def.rarity), noEvents);
  else hang(s, def, def.cursed ? 0 : priceOf(def.rarity), noEvents);
  s.cabinet.slots = s.cabinet.slots.map((x) => (x.kind === 'talisman' && x.id === id ? { kind: 'talisman', id: null, sold: true } : x));
  return s;
}

function hang(s, def, price, emit, engraving = null) {
  const inst = {
    uid: `t${s.nextUid}`,
    id: def.id,
    price, // kept so a sale (or a save that outlives the talisman) can refund it
    data: def.init?.() ?? {},
    charges: def.charges?.max ?? null,
    engraving,
  };
  s.nextUid += 1;
  s.rail = [...s.rail, inst];
  lifecycle(s, 'purchased', emit, (src) => ({ item: inst, isSelf: src.inst === inst }));
  return inst;
}

/**
 * An instant talisman (the Lost Wallet) acts the moment it is bought and
 * never takes a hook: its `purchased` hook runs on an instance that is never
 * hung.
 */
function openInstant(s, def, price, emit) {
  const inst = { uid: `t${s.nextUid}`, id: def.id, price, data: def.init?.() ?? {}, charges: null };
  s.nextUid += 1;
  const src = { index: -1, inst, def, as: def, self: inst.data, by: null };
  def.hooks.purchased?.(commitCtx(s, src, emit, 'purchased', { item: inst, isSelf: true }));
  return inst;
}

/** A new chip in hand, value 1, of this material (six at most: the caller checks). */
function addChip(s, material, emit) {
  const chip = { id: `c${s.nextChipId}`, value: 1, material, roundValue: 0 };
  s.nextChipId += 1;
  s.chips = [...s.chips, chip];
  emit({ type: 'chipGained', chipId: chip.id, material });
  return chip;
}

/** A record into the crate; it plays at once if a slot of the gramophone is free. */
function giveRecord(s, id, emit) {
  s.records = [...s.records, id];
  emit({ type: 'recordGained', record: id });
  const slot = freeSlot(s);
  if (slot !== null) playOn(s, id, emit, slot);
}

const SLOT_KEY = ['playing', 'playing2'];
/** The gramophone's first empty slot, or null. */
const freeSlot = (s) => (!s.playing ? 0 : s.gramophoneSlots > 1 && !s.playing2 ? 1 : null);

/** Slot `slot` of the gramophone plays `id` (or nothing). A record keeps its own data between plays. */
function playOn(s, id, emit, slot = 0) {
  const key = SLOT_KEY[slot];
  const was = s[key];
  s[key] = id;
  const def = id ? getRecord(id) : null;
  if (def) {
    s.recordData = { ...s.recordData, [id]: s.recordData[id] ?? def.init?.() ?? {} };
    if (def.doublesDebt) s.overture = s.debt;
  }
  emit({ type: 'recordPlayed', id, was, slot });
}

function sellOne(s, uid, emit, { full = false } = {}) {
  const inst = s.rail.find((t) => t.uid === uid);
  lifecycle(s, 'sold', emit, (src) => ({ item: inst, isSelf: src.inst === inst }));
  const refund = saleValue(s, inst, { full });
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
    const spins = spinsOf(state, packageId);
    s.spinsLeft = spins;
    s.spinsTonight = spins;
    delete s.spinsTonightGuessed;
    s.leans = { ...s.leans, night: rollNightLean(s, spins) };
    if (spins === 0) {
      s.satOut += 1;
      s.phase = PHASE.NIGHT_OVER;
    } else {
      s.phase = PHASE.BETTING;
    }
    return { state: s, events: [{ type: 'packageChosen', packageId, cost, tokens: pkg.tokens, spins }] };
  },

  placeChip(state, { chipId, betId }) {
    const chip = state.chips.find((c) => c.id === chipId);
    if (!chip) throw new Error(`Unknown chip: ${chipId}`);
    if (!BET_BY_ID.has(betId)) throw new Error(`Unknown bet: ${betId}`);
    if (state.placements[chipId] === betId) return { state, events: [] };
    if (state.fixed.includes(chipId)) return reject(state, FIXED, 'fixed');
    const kind = BET_BY_ID.get(betId).kind;
    if (isSpecial(kind) && !openSpecials(state).has(kind)) return reject(state, 'That bet is closed: something in the run must open it.', 'closed');
    // A bet on the 00 needs a wheel that has one (the felt shows it only then).
    if (BET_BY_ID.get(betId).numbers.includes(DOUBLE_ZERO) && !hasDoubleZero(state)) return reject(state, 'This wheel has no 00.', 'closed');
    const s = copyRun(state);
    s.placements[chipId] = betId;
    if (getMaterial(chip.material).fixed) s.fixed.push(chipId);
    return { state: s, events: [{ type: 'chipPlaced', chipId, betId }] };
  },

  removeChip(state, { chipId }) {
    if (!state.placements[chipId]) return { state, events: [] };
    if (state.fixed.includes(chipId)) return reject(state, FIXED, 'fixed');
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
    s.debtSpins += 1;
    s.history.push(result.devil ? { number: result.number, color: result.color, devil: true } : { number: result.number, color: result.color });
    if (s.history.length > HISTORY_LENGTH) s.history.shift();
    s.lastSpin = result;
    s.stats.spins += 1;
    if (result.miss) s.stats.misses += 1;
    else s.stats.wins += 1;
    // What the spins won: a Devil's spin loses the hand, and that is not a negative win.
    s.stats.totalWon = add(s.stats.totalWon, max(result.total, 0));
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
    const nightTokens = nightTokensFor(s);
    s.tokens += nightTokens;
    s.stats.tokensEarned += nightTokens;
    emit({ type: 'tokens', amount: nightTokens, reason: 'night' });

    lifecycle(s, 'roundEnd', emit);
    s.leans = { ...s.leans, night: null };
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
    const due = owed(s);
    if (!gte(s.deposited, due)) {
      s.phase = PHASE.GAME_OVER;
      s.outcome = { reason: 'collected', debt: s.debt, owed: due, deposited: s.deposited };
      emit({ type: 'collected', debt: s.debt, owed: due, deposited: s.deposited });
      return { state: s, events };
    }

    s.deposited = sub(s.deposited, due);
    const rewardTokens = ECONOMY.debtRewardTokens + debtTokensFor(s) + ECONOMY.sitOutTokens * s.satOut;
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
      devilFired: !!s.devil.firedThisDebt,
    });
    // The Vault (doc 7.1): a lock, the goal, the Vault itself.
    if (s.locks < VAULT.locks && s.debt === lockDebt(s.locks + 1)) {
      s.locks += 1;
      emit({ type: 'lockOpened', lock: s.locks });
    }
    if (s.goal && s.debt === s.goal) {
      s.won = s.debt;
      emit({ type: 'goalReached', debt: s.debt, edge: s.edge });
    }
    if (!s.vault && s.locks === VAULT.locks && s.debt >= VAULT.baseGoal + VAULT.locks) {
      s.vault = true;
      emit({ type: 'vaultOpened', debt: s.debt });
    }

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
    const price = offerPrice(state, def);
    if (def.instant && sellUid) return reject(state, 'It needs no hook.', 'noHookNeeded');
    const selling = sellUid ? state.rail.find((t) => t.uid === sellUid) : null;
    if (sellUid && !selling) throw new Error(`Unknown talisman: ${sellUid}`);
    if (selling && isCursed(selling)) return reject(state, 'It will not come off the hook.', 'cursed');
    const refund = selling ? saleValue(state, selling) : 0;
    if (state.tokens + refund < price) return reject(state, 'Not enough tokens.', 'noTokens');
    if (!def.instant && state.rail.length - (selling ? 1 : 0) >= hooksFor(state)) {
      return reject(state, 'No free hook. Sell a talisman first.', 'railFull');
    }

    const s = copyRun(state);
    const events = [];
    const emit = (e) => events.push(e);
    if (selling) sellOne(s, sellUid, emit);
    s.tokens -= price;
    s.stats.tokensSpent += price;
    s.stats.talismansBought += 1;
    if (s.cabinet.freeBuys > 0) s.cabinet.freeBuys -= 1;
    s.cabinet.slots[slot] = { kind: 'talisman', id: null, sold: true };
    const before = events.length;
    const inst = def.instant ? openInstant(s, def, price, emit) : hang(s, def, price, emit, offer.engraving ?? null);
    events.splice(before, 0, { type: 'bought', slot, uid: inst.uid, id: def.id, price, instant: def.instant });
    return { state: s, events };
  },

  /**
   * Buys the oddity and does its work at once (doc 5.11): `targets` holds one
   * target for each of its picks (wheelwork.js), each checked on the wheel as
   * the picks before it left it. Nothing changes unless every pick can act.
   */
  buyOddity(state, { slot, targets = [] }) {
    const offer = state.cabinet.slots[slot];
    if (!offer) throw new Error(`Unknown compartment: ${slot}`);
    const def = offer.kind === 'oddity' && !offer.sold ? getOddity(offer.id) : null;
    if (!def) return reject(state, 'That compartment is empty.', 'soldOut');
    const price = oddityPrice(state, def);
    if (!gte(state.coins, price)) return reject(state, 'Not enough coins.', 'noCoins');
    if (def.gives?.chip && state.chips.length >= ECONOMY.maxChips) return reject(state, `Your pockets are full: ${ECONOMY.maxChips} chips at most.`, 'full');
    if (def.gives?.record && (!offer.record || state.records.includes(offer.record))) return reject(state, 'You own that record already.', 'owned');
    if (targets.length !== def.picks.length) return reject(state, def.picks.length === 1 ? 'Choose where it goes.' : `Choose ${def.picks.length} places for it.`, 'targets');
    const s = copyRun(state);
    const events = [{ type: 'oddityBought', slot, id: def.id, price, targets }];
    const by = { kind: 'oddity', id: def.id };
    for (let i = 0; i < def.picks.length; i++) {
      const why = workRefusal(s, def.picks[i], targets[i]);
      if (why) return reject(state, why, 'badTarget');
      doWork(s, def.picks[i], targets[i], (e) => events.push(e), by);
    }
    if (def.gives?.chip) addChip(s, def.gives.chip, (e) => events.push(e));
    if (def.gives?.record) giveRecord(s, offer.record, (e) => events.push(e));
    s.coins = sub(s.coins, price);
    s.stats.odditiesBought += 1;
    s.cabinet.slots[slot] = { kind: 'oddity', id: null, sold: true };
    return { state: s, events };
  },

  sell(state, { uid }) {
    const inst = state.rail.find((t) => t.uid === uid);
    if (!inst) throw new Error(`Unknown talisman: ${uid}`);
    // Cursed talismans keep their hook for the rest of the run (doc 5.8).
    if (isCursed(inst)) return reject(state, 'It will not come off the hook.', 'cursed');
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
    const restless = freeRestockBy(state);
    const cost = restless ? 0 : nextRestockCost(state);
    if (!gte(state.coins, cost)) return reject(state, 'Not enough coins to restock.', 'noCoins');
    const s = copyRun(state);
    const events = [];
    if (restless) {
      // A Restless engraving's restock: free, and the price does not climb.
      const inst = s.rail.find((t) => t.uid === restless.uid);
      inst.data.restlessDebt = s.debt;
      events.push({ type: 'trigger', src: { uid: inst.uid, id: 'restless', as: 'restless' }, hook: 'restock', effect: 'freeRestock' });
    } else {
      s.coins = sub(s.coins, cost);
      s.cabinet.paidRestocks += 1;
      s.stats.restocksPaid += 1;
    }
    const slots = restockSlots(s);
    events.unshift({ type: 'offersRestocked', paid: true, cost, slots });
    return { state: s, events };
  },

  // --- Madame Zero and the gramophone (doc 5.9, 5.10) -------------------------

  /** Her lever: the debt's first pull deals three cards for free; later pulls reroll them for coins. */
  pullLever(state) {
    const deal = dealOf(state);
    if (deal && deal.taken !== null) return reject(state, 'She has nothing more for you this debt.', 'used');
    const cost = deal ? rerollCost(state) : 0;
    if (!gte(state.coins, cost)) return reject(state, 'Not enough coins to deal again.', 'noCoins');
    const s = copyRun(state);
    s.coins = sub(s.coins, cost);
    // The colour is fixed by the first pull: black if the Devil has fired this debt.
    const kind = deal?.kind ?? (s.devil.firedThisDebt ? 'black' : 'white');
    const rng = new Rng(s.rng.fortunes);
    const cards = dealCards(s, kind, rng, hooksFor(s));
    s.rng.fortunes = rng.state();
    s.oracle = { debt: s.debt, kind, cards, rerolls: deal ? deal.rerolls + 1 : 0, taken: null };
    return { state: s, events: [{ type: 'fortunesDealt', kind, cards, cost, rerolls: s.oracle.rerolls }] };
  },

  /** Takes one of the dealt cards: its effect happens now, and the visit is over for this debt. */
  takeFortune(state, { index }) {
    const deal = dealOf(state);
    if (!deal) return reject(state, 'Pull her lever first.', 'empty');
    if (deal.taken !== null) return reject(state, 'She has nothing more for you this debt.', 'used');
    const id = deal.cards[index];
    const def = getFortune(id);
    if (!def) throw new Error(`No card ${index} in the deal`);
    // The run may have changed since the deal (a full rail): a card that could do nothing waits.
    if (!canTake(state, def, hooksFor(state))) return reject(state, 'That fortune cannot come true now.', 'notUsable');
    const s = copyRun(state);
    const events = [{ type: 'fortuneTaken', id, kind: deal.kind, index }];
    const emit = (e) => events.push(e);
    const rng = new Rng(s.rng.fortunes);
    def.take?.(
      fortuneCtx(s, def, emit, rng, {
        hang: (talisman) => hang(s, talisman, 0, emit),
        // "Burn it all.": every talisman that can come off is sold, at its full price.
        sellAll: () => {
          for (const inst of [...s.rail]) if (!isCursed(inst)) sellOne(s, inst.uid, emit, { full: true });
        },
        // A record she gives plays at once if a slot of the gramophone is free.
        play: (record) => {
          const slot = freeSlot(s);
          if (slot !== null) playOn(s, record, emit, slot);
        },
      }),
    );
    s.rng.fortunes = rng.state();
    if (Object.keys(def.hooks).length || def.opens) {
      s.boons = [...s.boons, { uid: `b${s.nextBoonUid}`, id, data: def.init?.(s) ?? {} }];
      s.nextBoonUid += 1;
    }
    s.picks[id] = (s.picks[id] ?? 0) + 1;
    s.oracle.taken = index;
    return { state: s, events };
  },

  /**
   * Puts a record from the crate on slot `slot` of the gramophone (null lifts
   * that needle). The second slot opens with the Vault's second lock.
   */
  playRecord(state, { id, slot = 0 }) {
    if (slot !== 0 && !(slot === 1 && state.gramophoneSlots > 1)) return reject(state, 'The gramophone has one slot.', 'noSlot');
    const key = SLOT_KEY[slot];
    if (id === state[key]) return { state, events: [] };
    if (id !== null && !state.records.includes(id)) throw new Error(`No record ${id} in the crate`);
    if (id !== null && id === state[SLOT_KEY[1 - slot]]) return reject(state, 'It is playing already.', 'playing');
    // A record's extra hook (Static) cannot go while a talisman hangs on it.
    const other = getRecord(state[SLOT_KEY[1 - slot]]);
    const hooks = state.railHooks + ((id && getRecord(id)?.extraHooks) || 0) + (other?.extraHooks || 0);
    if (state.rail.length > hooks) return reject(state, 'Every hook is in use: sell a talisman first.', 'railFull');
    const s = copyRun(state);
    const events = [];
    playOn(s, id, (e) => events.push(e), slot);
    return { state: s, events };
  },

  /** Past the goal, the player steps out of the light: the run is won, and ends (doc 7.1). */
  leave(state) {
    if (!state.won) return reject(state, 'The Cage lets no one go before the goal.', 'notWon');
    const s = copyRun(state);
    s.phase = PHASE.GAME_OVER;
    s.outcome = { reason: 'left', debt: s.debt, debtsPaid: s.stats.debtsPaid };
    return { state: s, events: [{ type: 'left', debtsPaid: s.stats.debtsPaid }] };
  },

  /**
   * Rings the Bell: the head of the queue, or the talisman `uid`. A talisman
   * that works on the wheel (the Number Punches) rings only at its tag, with
   * its `targets`, each checked on the wheel as the ones before it left it.
   */
  ringBell(state, { uid, targets } = {}) {
    if (uid) {
      const inst = state.rail.find((t) => t.uid === uid);
      if (!inst) throw new Error(`Unknown talisman: ${uid}`);
      if (!canAnswer(state, inst)) return reject(state, 'It does not answer.', 'notUsable');
      const work = getTalisman(inst.id).bell.work;
      if (work) {
        if (!targets?.length || targets.length > work.picks) return reject(state, `Choose up to ${work.picks} pockets.`, 'targets');
        const probe = copyRun(state);
        for (const t of targets) {
          const why = workRefusal(probe, work, t);
          if (why) return reject(state, why, 'badTarget');
          doWork(probe, work, t, noEvents, null);
        }
      }
    }
    const s = copyRun(state);
    const events = [];
    const answered = ringBell(s, uid, (e) => events.push(e), { targets });
    // Nothing answering is not a mistake: the bell just rings dull.
    return { state: answered ? s : state, events };
  },
};

export { TALISMAN_SLOTS };
