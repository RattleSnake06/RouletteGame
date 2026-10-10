// The wheel as data. Pockets are listed in wheel order (clockwise seen from
// above, starting at zero). Each pocket's chance is its width over the total
// width; later phases widen, repaint, duplicate and enhance pockets.

/** European single-zero order, clockwise seen from above. */
export const EUROPEAN_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14,
  31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

export const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export function defaultColor(n) {
  if (n === 0) return 'green';
  return RED_NUMBERS.has(n) ? 'red' : 'black';
}

export function createEuropeanWheel() {
  return {
    pockets: EUROPEAN_ORDER.map((number) => ({ number, color: defaultColor(number), width: 1 })),
  };
}

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
