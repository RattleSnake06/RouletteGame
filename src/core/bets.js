// Bets on the European table. A bet is a set of numbers (or, for red/black,
// a pocket colour) with base odds of 36 ÷ numbers covered: every base bet has
// the same expected return (36/37 per unit of chip value on a fair wheel) and
// differs only in variance.
//
// Table geometry: numbers 1–36 sit in 12 columns of three, one "street" each.
// col = floor((n − 1) / 3) runs 0–11 away from zero; row = (n − 1) % 3, where
// row 0 holds 1, 4, 7… and row 2 holds 3, 6, 9….
//
// The American wheel's 00 (number 37, wheel.js) has its own straight-up and
// splits with 0, 2 and 3; on any other wheel no pocket reads it, and the felt
// shows none of them.

import { DOUBLE_ZERO, RED_NUMBERS } from './wheel.js';

export function tableCell(n) {
  return { col: Math.floor((n - 1) / 3), row: (n - 1) % 3 };
}

export const BET_KINDS = {
  straight: { name: 'Straight up', odds: 36 },
  split: { name: 'Split', odds: 18 },
  street: { name: 'Street', odds: 12 },
  corner: { name: 'Corner', odds: 9 },
  firstFour: { name: 'First Four', odds: 9 },
  sixLine: { name: 'Six Line', odds: 6 },
  dozen: { name: 'Dozen', odds: 3 },
  column: { name: 'Column', odds: 3 },
  red: { name: 'Red', odds: 2, color: 'red' },
  black: { name: 'Black', odds: 2, color: 'black' },
  odd: { name: 'Odd', odds: 2 },
  even: { name: 'Even', odds: 2 },
  low: { name: '1–18', odds: 2 },
  high: { name: '19–36', odds: 2 },
};

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const ORDINAL = ['1st', '2nd', '3rd'];

function make(kind, numbers, id, label) {
  const sorted = [...numbers].sort((a, b) => a - b);
  return {
    id: id ?? `${kind}:${sorted.join('-')}`,
    kind,
    numbers: sorted,
    numberSet: new Set(sorted),
    label: label ?? `${BET_KINDS[kind].name} ${sorted.join('–')}`,
  };
}

function buildBets() {
  const bets = [];
  for (let n = 0; n <= 36; n++) bets.push(make('straight', [n], undefined, `Straight up ${n}`));
  bets.push(make('straight', [DOUBLE_ZERO], undefined, 'Straight up 00'));

  // Splits: along a street (n, n+1), across streets (n, n+3), and with zero.
  for (let n = 1; n <= 36; n++) {
    if (n % 3 !== 0) bets.push(make('split', [n, n + 1]));
    if (n <= 33) bets.push(make('split', [n, n + 3]));
  }
  for (const n of [1, 2, 3]) bets.push(make('split', [0, n]));
  bets.push(make('split', [0, DOUBLE_ZERO], undefined, 'Split 0–00'));
  for (const n of [2, 3]) bets.push(make('split', [n, DOUBLE_ZERO], undefined, `Split ${n}–00`));

  for (let c = 0; c < 12; c++) bets.push(make('street', range(3 * c + 1, 3 * c + 3)));

  for (let n = 1; n <= 32; n++) {
    if (n % 3 !== 0) bets.push(make('corner', [n, n + 1, n + 3, n + 4]));
  }
  bets.push(make('firstFour', [0, 1, 2, 3], 'firstFour', 'First Four 0–1–2–3'));

  for (let c = 0; c < 11; c++) bets.push(make('sixLine', range(3 * c + 1, 3 * c + 6)));

  for (let d = 0; d < 3; d++) {
    bets.push(make('dozen', range(12 * d + 1, 12 * d + 12), `dozen:${d + 1}`, `${ORDINAL[d]} Dozen`));
  }
  for (let r = 0; r < 3; r++) {
    const nums = range(0, 11).map((c) => 3 * c + r + 1);
    bets.push(make('column', nums, `column:${r + 1}`, `Column ${r + 1}`));
  }

  // Red and black list their default numbers for display, but they are
  // settled by the colour of the pocket the ball lands in.
  const all = range(1, 36);
  bets.push(make('red', all.filter((n) => RED_NUMBERS.has(n)), 'red', 'Red'));
  bets.push(make('black', all.filter((n) => !RED_NUMBERS.has(n)), 'black', 'Black'));
  bets.push(make('odd', all.filter((n) => n % 2 === 1), 'odd', 'Odd'));
  bets.push(make('even', all.filter((n) => n % 2 === 0), 'even', 'Even'));
  bets.push(make('low', range(1, 18), 'low', '1–18'));
  bets.push(make('high', range(19, 36), 'high', '19–36'));
  return bets;
}

export const BETS = buildBets();
export const BET_BY_ID = new Map(BETS.map((b) => [b.id, b]));

export function getBet(id) {
  const bet = BET_BY_ID.get(id);
  if (!bet) throw new Error(`Unknown bet: ${id}`);
  return bet;
}

/** Does this bet win when the ball lands in this pocket? */
export function betCovers(bet, pocket) {
  const color = BET_KINDS[bet.kind].color;
  if (color) return pocket.color === color;
  return bet.numberSet.has(pocket.number);
}

// What each level above the first adds, as a share of the base odds (doc
// 5.3). Drafted as the whole base again (36 → 72 → 108); at the owner's word
// after the simulator, a quarter of it (36 → 45 → 54).
export const LEVEL_STEP = 0.25;

/** Current odds of a bet: its base odds, and a share more for each level above the first. */
export function betOdds(bet, level = 1) {
  return levelOdds(bet.kind, level);
}

/** A kind of bet's odds at this level. */
export const levelOdds = (kind, level) => BET_KINDS[kind].odds * (1 + LEVEL_STEP * (level - 1));

/** A bet kind's level in this run (1 until something raises it). */
export const levelOf = (state, kind) => state.levels?.[kind] ?? 1;
