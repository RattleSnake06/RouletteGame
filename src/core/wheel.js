// The wheel as data. Pockets are listed in wheel order (clockwise seen from
// above, starting at zero). Each pocket's chance is its width over the total
// width. Wheel work (wheelwork.js) widens, repaints, duplicates, removes and
// enhances pockets, so a pocket also has an id that stays with it while
// pockets come and go around it:
//
//   { id, number, color, width, enh }
//
// A blank pocket (a shattered Glass one) has no number and no colour: no bet
// covers it. The House's pocket (House Edge, doc 7.2) has no number either,
// but is green, and no wheel work touches it.

/** European single-zero order, clockwise seen from above. */
export const EUROPEAN_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14,
  31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

// The American wheel's 00 is number 37 in the rules (green, like 0, and in
// no dozen, column or even-money bet); everything the player reads says "00".
export const DOUBLE_ZERO = 37;

/** American double-zero order, clockwise seen from above (37 is 00). */
export const AMERICAN_ORDER = [
  0, 28, 9, 26, 30, 11, 7, 20, 32, 17, 5, 22, 34, 15, 3, 24, 36, 13, 1, 37, 27, 10, 25, 29, 12, 8, 19,
  31, 18, 6, 21, 33, 16, 4, 23, 35, 14, 2,
];

/** The Mirror wheel (doc 7.2): the numbers in the felt's order, 0 to 36 round the rim. */
export const MIRROR_ORDER = Array.from({ length: 37 }, (_, n) => n);

export const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export function defaultColor(n) {
  if (n === 0 || n === DOUBLE_ZERO) return 'green';
  return RED_NUMBERS.has(n) ? 'red' : 'black';
}

/** A number as the player reads it: 00 for the American wheel's second zero. */
export const numberLabel = (n) => (n === DOUBLE_ZERO ? '00' : String(n));

/** A plain wheel with one pocket per number, in this order. */
export function createWheel(order = EUROPEAN_ORDER) {
  return {
    pockets: order.map((number) => ({ id: `p${number}`, number, color: defaultColor(number), width: 1, enh: null })),
    nextId: Math.max(...order) + 1,
  };
}

export const createEuropeanWheel = () => createWheel(EUROPEAN_ORDER);

export const isBlank = (pocket) => pocket.number === null;
export const isHousePocket = (pocket) => pocket.enh === 'house';

/** Where the pocket with this id sits now, or -1. */
export const indexOfPocket = (wheel, id) => wheel.pockets.findIndex((p) => p.id === id);

export function totalWidth(wheel) {
  let t = 0;
  for (const p of wheel.pockets) t += p.width;
  return t;
}

export function pocketChance(wheel, index) {
  return wheel.pockets[index].width / totalWidth(wheel);
}

/** Index of the pocket the ball lands in, drawn by width. */
export function drawPocket(wheel, rng) {
  let x = rng.next() * totalWidth(wheel);
  for (let i = 0; i < wheel.pockets.length; i++) {
    x -= wheel.pockets[i].width;
    if (x < 0) return i;
  }
  return wheel.pockets.length - 1;
}

/** The pocket `steps` along the wheel from `index` (positive is clockwise). */
export function neighbourIndex(wheel, index, steps) {
  const n = wheel.pockets.length;
  return (((index + steps) % n) + n) % n;
}
