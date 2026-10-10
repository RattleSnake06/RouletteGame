import { tableCell } from './bets.js';

// What the House remembers between spins: which numbers came up this debt and
// how often each dozen and column hit tonight (doc 5.5, step 6). Ledger and
// Abacus read it; only final landings count, never a discarded throw.

export const emptyRoundTally = () => ({ dozens: [0, 0, 0], columns: [0, 0, 0] });
export const emptyTally = () => ({ debt: { numbers: {} }, round: emptyRoundTally() });

export function copyTally(t) {
  return {
    debt: { numbers: { ...t.debt.numbers } },
    round: { dozens: [...t.round.dozens], columns: [...t.round.columns] },
  };
}

/** Records one landing. Zero belongs to no dozen or column. */
export function recordLanding(tally, number) {
  tally.debt.numbers[number] = (tally.debt.numbers[number] ?? 0) + 1;
  if (number < 1 || number > 36) return;
  const { col, row } = tableCell(number);
  tally.round.dozens[Math.floor(col / 4)] += 1;
  tally.round.columns[row] += 1;
}
