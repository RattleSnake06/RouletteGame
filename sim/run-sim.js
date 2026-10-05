// Balance simulator: plays many runs headless with simple bots and reports how
// far they get. Usage: npm run sim [-- --runs 5000 --max-debt 9]

import { ECONOMY } from '../src/core/economy.js';
import { format, gte, sub, toNumber } from '../src/core/num.js';
import { PHASE, act, canAfford, costOf, isFinalNight } from '../src/core/run.js';
import { createRun } from '../src/core/run.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const RUNS = Number(args.runs ?? 5000);
const MAX_DEBT = Number(args['max-debt'] ?? 9);

// Where each bot keeps its chips. All base bets have the same expected value,
// so these differ only in variance.
const STRATEGIES = {
  'all on red': (chips) => chips.map(() => 'red'),
  'three dozens': (chips) => chips.map((_, i) => `dozen:${(i % 3) + 1}`),
  'spread straight-ups': (chips) => chips.map((_, i) => `straight:${[32, 11, 9, 26, 5, 18][i % 6]}`),
};

function step(state, action) {
  const r = act(state, action);
  if (r.events.some((e) => e.type === 'rejected')) throw new Error(`${action.type} rejected`);
  return r.state;
}

function playRun(seed, placeFor) {
  let s = createRun({ seed });
  placeFor(s.chips).forEach((betId, i) => {
    s = step(s, { type: 'placeChip', chipId: s.chips[i].id, betId });
  });
  while (s.phase !== PHASE.GAME_OVER && s.debt <= MAX_DEBT) {
    const pkg = canAfford(s, 'long') ? 'long' : canAfford(s, 'short') ? 'short' : 'sitout';
    s = step(s, { type: 'choosePackage', packageId: pkg });
    while (s.phase === PHASE.BETTING) s = step(s, { type: 'spin' });
    // Bank everything except the price of the next long night; on the final
    // night, bank it all.
    const keep = isFinalNight(s) ? 0 : costOf(s, 'long');
    if (gte(s.coins, keep)) {
      const amount = sub(s.coins, keep);
      if (toNumber(amount) > 0) s = step(s, { type: 'deposit', amount });
    }
    s = step(s, { type: 'endNight' });
  }
  return s;
}

const pct = (n) => `${((100 * n) / RUNS).toFixed(1)}%`.padStart(7);
console.log(`${RUNS} runs per bot, no items, Leans or Devil (Phase 1 rules)\n`);
const header = ['bot'.padEnd(22), ...Array.from({ length: MAX_DEBT }, (_, i) => `debt ${i + 1}`.padStart(7))];
console.log(header.join(' '));
for (const [name, placeFor] of Object.entries(STRATEGIES)) {
  const paid = new Array(MAX_DEBT + 1).fill(0);
  for (let i = 0; i < RUNS; i++) {
    const end = playRun(`SIM-${i}`, placeFor);
    for (let d = 1; d <= end.stats.debtsPaid && d <= MAX_DEBT; d++) paid[d] += 1;
  }
  console.log([name.padEnd(22), ...paid.slice(1).map(pct)].join(' '));
}
console.log(`\nShare of runs that paid each debt. Start: ${ECONOMY.startCoins} coins, ${ECONOMY.startChips} chips of value 1.`);
console.log(`Doc targets once items and Leans exist: debt 1 ≈ 95%, 2 ≈ 80%, 3 ≈ 60%, 4 ≈ 35%. (${format(12345)} formatting check)`);
