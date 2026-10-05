import { BET_BY_ID } from './bets.js';
import { ECONOMY, PACKAGES, interestOn, owedFor, packageCost, spinCostFor } from './economy.js';
import { add, gt, gte, lte, max, mul, sub } from './num.js';
import { resolveSpin } from './resolve.js';
import { Rng, seedStreams } from './rng.js';
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
// Chips can be arranged and coins deposited in any phase but gameOver.

export const PHASE = {
  ROUND_START: 'roundStart',
  BETTING: 'betting',
  NIGHT_OVER: 'nightOver',
  GAME_OVER: 'gameOver',
};

const HISTORY_LENGTH = 40;

export function createRun({ seed }) {
  const chips = [];
  for (let i = 0; i < ECONOMY.startChips; i++) chips.push({ id: `c${i + 1}`, value: 1, material: 'clay' });
  return {
    version: 1,
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
    history: [],
    lastSpin: null,
    stats: { spins: 0, wins: 0, misses: 0, bestSpin: 0, totalWon: 0, debtsPaid: 0 },
    outcome: null,
  };
}

// --- Selectors --------------------------------------------------------------

export const owed = (state) => owedFor(state.debt);
export const spinCost = (state) => spinCostFor(state.debt);
export const costOf = (state, packageId) => packageCost(state.debt, packageId);
export const canAfford = (state, packageId) => gte(state.coins, costOf(state, packageId));
export const isFinalNight = (state) => state.round === ECONOMY.roundsPerDebt;
export const chipsOnTable = (state) => state.chips.filter((c) => state.placements[c.id]);

// --- Actions ----------------------------------------------------------------

function copy(state) {
  return {
    ...state,
    rng: { ...state.rng },
    chips: state.chips.map((c) => ({ ...c })),
    placements: { ...state.placements },
    wheel: { pockets: state.wheel.pockets.map((p) => ({ ...p })) },
    history: [...state.history],
    stats: { ...state.stats },
  };
}

function reject(state, reason) {
  return { state, events: [{ type: 'rejected', reason }] };
}

/** Applies one player action. Returns { state, events }. */
export function act(state, action) {
  if (state.phase === PHASE.GAME_OVER) return reject(state, 'The run is over.');
  const handler = HANDLERS[action.type];
  if (!handler) throw new Error(`Unknown action: ${action.type}`);
  return handler(state, action);
}

const HANDLERS = {
  choosePackage(state, { packageId }) {
    if (state.phase !== PHASE.ROUND_START) return reject(state, 'A night is already under way.');
    const pkg = PACKAGES[packageId];
    if (!pkg) throw new Error(`Unknown package: ${packageId}`);
    const cost = costOf(state, packageId);
    if (!gte(state.coins, cost)) return reject(state, 'Not enough coins for that night.');
    const s = copy(state);
    s.coins = sub(s.coins, cost);
    s.tokens += pkg.tokens;
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
    const s = copy(state);
    s.placements[chipId] = betId;
    return { state: s, events: [{ type: 'chipPlaced', chipId, betId }] };
  },

  removeChip(state, { chipId }) {
    if (!state.placements[chipId]) return { state, events: [] };
    const s = copy(state);
    delete s.placements[chipId];
    return { state: s, events: [{ type: 'chipRemoved', chipId }] };
  },

  deposit(state, { amount }) {
    if (!gt(amount, 0)) return reject(state, 'Nothing to deposit.');
    if (!lte(amount, state.coins)) return reject(state, 'You do not have that many coins.');
    const s = copy(state);
    s.coins = sub(s.coins, amount);
    s.deposited = add(s.deposited, amount);
    return { state: s, events: [{ type: 'deposited', amount }] };
  },

  spin(state) {
    if (state.phase !== PHASE.BETTING || state.spinsLeft <= 0) return reject(state, 'No spins left tonight.');
    const s = copy(state);
    const rng = new Rng(s.rng.wheel);
    const result = resolveSpin(s, rng);
    s.rng.wheel = rng.state();

    s.coins = add(s.coins, result.total);
    s.spinsLeft -= 1;
    s.history.push({ number: result.number, color: result.color });
    if (s.history.length > HISTORY_LENGTH) s.history.shift();
    s.lastSpin = result;
    s.stats.spins += 1;
    if (result.miss) s.stats.misses += 1;
    else s.stats.wins += 1;
    s.stats.totalWon = add(s.stats.totalWon, result.total);
    s.stats.bestSpin = max(s.stats.bestSpin, result.total);

    const events = [{ type: 'spin', result }];
    if (s.spinsLeft === 0) {
      s.phase = PHASE.NIGHT_OVER;
      events.push({ type: 'nightOver' });
    }
    return { state: s, events };
  },

  endNight(state) {
    if (state.phase !== PHASE.NIGHT_OVER) return reject(state, 'The night is not over yet.');
    const s = copy(state);
    const events = [];

    const interest = interestOn(s.deposited);
    s.deposited = add(s.deposited, interest);
    events.push({ type: 'interest', amount: interest, deposited: s.deposited });

    if (s.round < ECONOMY.roundsPerDebt) {
      s.round += 1;
      s.phase = PHASE.ROUND_START;
      events.push({ type: 'roundStart', debt: s.debt, round: s.round });
      return { state: s, events };
    }

    // The Cage collects.
    const due = owedFor(s.debt);
    if (!gte(s.deposited, due)) {
      s.phase = PHASE.GAME_OVER;
      s.outcome = { reason: 'collected', debt: s.debt, owed: due, deposited: s.deposited };
      events.push({ type: 'collected', debt: s.debt, owed: due, deposited: s.deposited });
      return { state: s, events };
    }

    s.deposited = sub(s.deposited, due);
    const rewardTokens = ECONOMY.debtRewardTokens + ECONOMY.sitOutTokens * s.satOut;
    const rewardCoins = mul(spinCostFor(s.debt + 1), ECONOMY.rewardSpins);
    s.tokens += rewardTokens;
    s.coins = add(s.coins, rewardCoins);
    s.stats.debtsPaid += 1;
    events.push({
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
    events.push({ type: 'roundStart', debt: s.debt, round: s.round });
    return { state: s, events };
  },
};
