import { describe, expect, it } from 'vitest';
import { BETS, BET_KINDS, betCovers, getBet, tableCell } from '../../src/core/bets.js';

const byKind = (kind) => BETS.filter((b) => b.kind === kind);
const containing = (kind, n) => byKind(kind).filter((b) => b.numberSet.has(n));

// Adjacency on the felt, with zero touching 1, 2 and 3.
function adjacent(a, b) {
  if (a === 0 || b === 0) return [1, 2, 3].includes(a + b);
  const ca = tableCell(a);
  const cb = tableCell(b);
  return Math.abs(ca.col - cb.col) + Math.abs(ca.row - cb.row) === 1;
}

describe('European table bets', () => {
  it('has the standard number of each bet', () => {
    expect(byKind('straight')).toHaveLength(37);
    expect(byKind('split')).toHaveLength(60);
    expect(byKind('street')).toHaveLength(12);
    expect(byKind('corner')).toHaveLength(22);
    expect(byKind('firstFour')).toHaveLength(1);
    expect(byKind('sixLine')).toHaveLength(11);
    expect(byKind('dozen')).toHaveLength(3);
    expect(byKind('column')).toHaveLength(3);
    for (const k of ['red', 'black', 'odd', 'even', 'low', 'high']) expect(byKind(k)).toHaveLength(1);
  });

  it('gives every bet a unique id', () => {
    expect(new Set(BETS.map((b) => b.id)).size).toBe(BETS.length);
  });

  it('only splits numbers that touch on the felt', () => {
    for (const b of byKind('split')) expect(adjacent(b.numbers[0], b.numbers[1])).toBe(true);
  });

  it('builds corners from 2×2 blocks, streets from one column, six lines from two', () => {
    for (const b of byKind('corner')) {
      const cells = b.numbers.map(tableCell);
      const cols = new Set(cells.map((c) => c.col));
      const rows = new Set(cells.map((c) => c.row));
      expect(cols.size).toBe(2);
      expect(rows.size).toBe(2);
      expect(Math.abs([...cols][0] - [...cols][1])).toBe(1);
      expect(Math.abs([...rows][0] - [...rows][1])).toBe(1);
    }
    for (const b of byKind('street')) expect(new Set(b.numbers.map((n) => tableCell(n).col)).size).toBe(1);
    for (const b of byKind('sixLine')) expect(new Set(b.numbers.map((n) => tableCell(n).col)).size).toBe(2);
  });

  it('covers a middle number and an edge number the way a real table does', () => {
    expect(containing('split', 17).map((b) => b.id).sort()).toEqual(
      ['split:14-17', 'split:16-17', 'split:17-18', 'split:17-20'].sort(),
    );
    expect(containing('corner', 17)).toHaveLength(4);
    expect(containing('street', 17)).toHaveLength(1);
    expect(containing('sixLine', 17)).toHaveLength(2);
    expect(containing('split', 1).map((b) => b.id).sort()).toEqual(['split:0-1', 'split:1-2', 'split:1-4']);
    expect(containing('corner', 1).map((b) => b.id)).toEqual(['corner:1-2-4-5']);
  });

  it('lays out dozens and columns correctly', () => {
    expect(getBet('dozen:2').numbers).toEqual([13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
    expect(getBet('column:1').numbers).toEqual([1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34]);
    expect(getBet('column:3').numbers.at(-1)).toBe(36);
  });

  it('prices every base bet at 36 ÷ numbers covered', () => {
    for (const b of BETS) expect(BET_KINDS[b.kind].odds * b.numbers.length).toBe(36);
  });

  it('settles red and black by pocket colour, and loses everything outside on zero', () => {
    const zero = { number: 0, color: 'green' };
    for (const id of ['red', 'black', 'odd', 'even', 'low', 'high', 'dozen:1', 'column:1']) {
      expect(betCovers(getBet(id), zero)).toBe(false);
    }
    expect(betCovers(getBet('firstFour'), zero)).toBe(true);
    // A black-numbered pocket repainted red pays red bets.
    expect(betCovers(getBet('red'), { number: 2, color: 'red' })).toBe(true);
    expect(betCovers(getBet('black'), { number: 2, color: 'red' })).toBe(false);
  });
});
