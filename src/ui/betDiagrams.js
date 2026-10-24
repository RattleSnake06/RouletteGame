import { BET_KINDS, getBet, tableCell } from '../core/bets.js';
import { EUROPEAN_ORDER, RED_NUMBERS } from '../core/wheel.js';

// The Info book's bet diagrams (design doc 7.5): every bet drawn on a little
// felt or wheel, the numbers it covers lit and the rest dimmed, so a player
// who has never seen a roulette table can tell a split from a street. Drawn
// as inline SVG from the core's own bets (getBet), so they never drift from
// the rules. European wheel and felt.

const CELL = 20;
const ZERO_W = 18;
const COLS_X = ZERO_W + 12 * CELL;
const DOZEN_Y = 3 * CELL;
const EVEN_Y = DOZEN_Y + 16;
const FELT_W = COLS_X + 22;
const FELT_H = EVEN_Y + 16;
const FILL = { red: '#8e1219', black: '#1a1412', green: '#1d5a3a' };
const LIT = '#eba232';
const DIM = 0.32;

const colorOf = (n) => (n === 0 ? 'green' : RED_NUMBERS.has(n) ? 'red' : 'black');

/** Where a number's cell sits: rows run 3, 6, 9… along the top, 1, 4, 7… along the bottom. */
function cell(n) {
  if (n === 0) return { x: 0, y: 0, w: ZERO_W, h: 3 * CELL };
  const { col, row } = tableCell(n);
  return { x: ZERO_W + col * CELL, y: (2 - row) * CELL, w: CELL, h: CELL };
}
const mid = (n) => {
  const c = cell(n);
  return { x: c.x + c.w / 2, y: c.y + c.h / 2 };
};
const avg = (pts) => ({ x: pts.reduce((t, p) => t + p.x, 0) / pts.length, y: pts.reduce((t, p) => t + p.y, 0) / pts.length });

// The outside boxes: dozens under the numbers, the "2 to 1" boxes at the end
// of each row, and the even-money boxes along the bottom.
const OUTSIDE = [
  ...[1, 2, 3].map((k) => ({ id: `dozen:${k}`, x: ZERO_W + (k - 1) * 4 * CELL, y: DOZEN_Y, w: 4 * CELL, h: 16, label: ['1st 12', '2nd 12', '3rd 12'][k - 1] })),
  ...[1, 2, 3].map((k) => ({ id: `column:${k}`, x: COLS_X, y: (3 - k) * CELL, w: 22, h: CELL, label: '2:1' })),
  ...['low', 'even', 'red', 'black', 'odd', 'high'].map((id, i) => ({ id, x: ZERO_W + i * 2 * CELL, y: EVEN_Y, w: 2 * CELL, h: 16, label: { low: '1–18', even: 'EVEN', odd: 'ODD', high: '19–36' }[id] ?? '' })),
];

/** Where the chip sits on the felt for this bet; null for the racetrack's. */
function chipAt(bet) {
  const n = bet.numbers;
  switch (bet.kind) {
    case 'straight':
      return mid(n[0]);
    case 'split':
    case 'corner':
      return avg(n.map(mid));
    // A street's chip sits on the row's outer edge, a six-line's on the edge between two.
    case 'street':
      return { x: mid(n[0]).x, y: DOZEN_Y };
    case 'sixLine':
      return { x: (mid(n[0]).x + mid(n[5]).x) / 2, y: DOZEN_Y };
    case 'firstFour':
      return { x: ZERO_W, y: DOZEN_Y };
    default: {
      // At the box's right end, clear of its label (the narrow 2:1 box has no room).
      const box = OUTSIDE.find((b) => b.id === bet.id);
      if (!box) return null;
      return { x: box.w > 30 ? box.x + box.w - 7 : box.x + box.w / 2, y: box.y + box.h / 2 };
    }
  }
}

const chip = ({ x, y }) =>
  `<circle cx="${x}" cy="${y}" r="6.5" fill="#ede5d3" stroke="#050404" stroke-width="1.2"/>` +
  `<circle cx="${x}" cy="${y}" r="4.2" fill="none" stroke="#dc2a33" stroke-width="1.6" stroke-dasharray="2.2 1.1"/>`;

/** A bet on a little felt: its numbers (and its box, for an outside bet) lit, a chip where it sits. */
export function feltDiagram(betId) {
  const bet = getBet(betId);
  const on = new Set(bet.numbers);
  const parts = [`<svg viewBox="-2 -2 ${FELT_W + 4} ${FELT_H + 4}" role="img" aria-label="${BET_KINDS[bet.kind].name} on the felt">`];
  parts.push(`<rect x="-2" y="-2" width="${FELT_W + 4}" height="${FELT_H + 4}" rx="4" fill="#0d3b26"/>`);
  for (let n = 0; n <= 36; n++) {
    const c = cell(n);
    const lit = on.has(n);
    parts.push(`<g opacity="${lit ? 1 : DIM}"><rect x="${c.x + 1}" y="${c.y + 1}" width="${c.w - 2}" height="${c.h - 2}" rx="2" fill="${FILL[colorOf(n)]}"${lit ? ` stroke="${LIT}" stroke-width="1.6"` : ''}/>`);
    parts.push(`<text x="${c.x + c.w / 2}" y="${c.y + c.h / 2 + 0.5}" font-size="8" fill="#ede5d3" text-anchor="middle" dominant-baseline="central">${n}</text></g>`);
  }
  for (const box of OUTSIDE) {
    const lit = box.id === bet.id;
    parts.push(`<g opacity="${lit ? 1 : DIM}"><rect x="${box.x + 1}" y="${box.y + 1}" width="${box.w - 2}" height="${box.h - 2}" rx="2" fill="${box.id === 'red' ? FILL.red : box.id === 'black' ? FILL.black : '#123d2a'}" stroke="${lit ? LIT : '#b3a993'}" stroke-width="${lit ? 1.6 : 0.6}"/>`);
    // A lit box's label steps left for the chip at its right end.
    const tx = lit && box.w > 30 ? box.x + (box.w - 13) / 2 : box.x + box.w / 2;
    if (box.label) parts.push(`<text x="${tx}" y="${box.y + box.h / 2 + 0.5}" font-size="7" fill="#ede5d3" text-anchor="middle" dominant-baseline="central">${box.label}</text>`);
    parts.push('</g>');
  }
  const at = chipAt(bet);
  if (at) parts.push(chip(at));
  parts.push('</svg>');
  return parts.join('');
}

/** A racetrack bet on a little wheel: its pockets lit, numbered round the outside, zero at the top. */
export function wheelDiagram(betId) {
  const bet = getBet(betId);
  const on = new Set(bet.numbers);
  const n = EUROPEAN_ORDER.length;
  const [cx, cy, r0, r1, rText] = [60, 60, 30, 46, 53];
  const pt = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  const parts = [`<svg viewBox="0 0 120 120" role="img" aria-label="${BET_KINDS[bet.kind].name} on the wheel">`];
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${r1 + 3}" fill="#2a1408"/>`);
  EUROPEAN_ORDER.forEach((num, i) => {
    const a0 = -Math.PI / 2 + ((i - 0.5) / n) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2) / n;
    const lit = on.has(num);
    parts.push(`<path d="M ${pt(r0, a0)} L ${pt(r1, a0)} A ${r1} ${r1} 0 0 1 ${pt(r1, a1)} L ${pt(r0, a1)} A ${r0} ${r0} 0 0 0 ${pt(r0, a0)} Z" fill="${FILL[colorOf(num)]}" opacity="${lit ? 1 : DIM}"${lit ? ` stroke="${LIT}" stroke-width="0.9"` : ''}/>`);
    if (lit || num === 0) {
      const a = (a0 + a1) / 2;
      parts.push(`<text x="${(cx + rText * Math.cos(a)).toFixed(2)}" y="${(cy + rText * Math.sin(a)).toFixed(2)}" font-size="5.2" fill="${lit ? '#ede5d3' : '#b3a993'}" text-anchor="middle" dominant-baseline="central">${num}</text>`);
    }
  });
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${r0 - 2}" fill="#3b1d0c" stroke="#c49a52" stroke-width="1"/>`);
  parts.push(`<text x="${cx}" y="${cy}" font-size="9" fill="#ede5d3" text-anchor="middle" dominant-baseline="central">${bet.numbers.length}</text>`);
  parts.push('</svg>');
  return parts.join('');
}

// What each bet is called and how it is played, in the felt's order, then
// the racetrack's (doc 5.3).
const FELT_BETS = [
  ['straight:17', 'Straight-up', 'One number. The chip sits on the number itself.'],
  ['split:17-20', 'Split', 'Two numbers that touch on the felt. The chip sits on the line between them.'],
  ['street:13-14-15', 'Street', 'Three numbers in a line across the felt, like 13, 14 and 15. The chip sits on the line’s outer edge.'],
  ['corner:17-18-20-21', 'Corner', 'Four numbers that meet at one point. The chip sits where their corners meet.'],
  ['firstFour', 'First Four', '0, 1, 2 and 3 together. The chip sits where zero meets 1.'],
  ['sixLine:25-26-27-28-29-30', 'Six-line', 'Two streets side by side: six numbers. The chip sits on the edge between them.'],
  ['dozen:2', 'Dozen', 'Twelve numbers: 1–12, 13–24 or 25–36. The chip sits in the dozen’s box.'],
  ['column:1', 'Column', 'Twelve numbers along one line of the felt, played in its “2:1” box at the end.'],
  ['red', 'Red or Black', 'Every red number, or every black one. Zero is neither.'],
  ['even', 'Odd or Even', 'Every even number, or every odd one. Zero is neither.'],
  ['low', '1–18 or 19–36', 'The low half of the numbers, or the high half. Zero is in neither.'],
];
const TRACK_BETS = [
  ['neighbours:17', 'Neighbours', 'A number and the two pockets either side of it on the wheel: five pockets in a row. You choose the number.', 'wheel'],
  ['voisins', 'Voisins du Zéro', '“Neighbours of zero”: the 17 pockets around zero, from 22 to 25.', 'wheel'],
  ['tiers', 'Tiers du Cylindre', '“A third of the wheel”: the 12 pockets facing zero, from 27 to 33.', 'wheel'],
  ['orphelins', 'Orphelins', '“The orphans”: the 8 pockets Voisins and Tiers leave over, in two pieces.', 'wheel'],
  ['jeuZero', 'Jeu Zéro', '“Zero game”: the 7 pockets closest to zero, from 12 to 15.', 'wheel'],
  ['snake', 'Snake', 'Twelve red numbers that zig-zag across the felt, from 1 to 34.', 'felt'],
  ['finale:7', 'Finale', 'Every number ending in one digit: Finale 7 is 7, 17 and 27. You choose the digit.', 'felt'],
];

function card(betId, name, text, shape) {
  const bet = getBet(betId);
  const fig = document.createElement('figure');
  fig.className = `bet-card typed ${shape}`;
  const covers = bet.numbers.length;
  fig.innerHTML = `${shape === 'wheel' ? wheelDiagram(betId) : feltDiagram(betId)}<figcaption><b>${name}</b> · ${covers} number${covers === 1 ? '' : 's'} · <span class="pays">pays ${BET_KINDS[bet.kind].odds}</span><br>${text}</figcaption>`;
  return fig;
}

/** The felt's bets, each with its diagram. */
export function feltBetsGlossary() {
  const grid = document.createElement('div');
  grid.className = 'bet-grid';
  for (const [id, name, text] of FELT_BETS) grid.append(card(id, name, text, 'felt'));
  return grid;
}

/** The racetrack's bets, each with its diagram. */
export function trackBetsGlossary() {
  const grid = document.createElement('div');
  grid.className = 'bet-grid';
  for (const [id, name, text, shape] of TRACK_BETS) grid.append(card(id, name, text, shape));
  return grid;
}
