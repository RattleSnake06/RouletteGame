import { BET_KINDS, levelOf } from './bets.js';
import { getEnhancement } from './content/index.js';
import { defaultColor, indexOfPocket, isBlank } from './wheel.js';
import { MIN_WIDTH } from './widths.js';

// Wheel work (design doc 5.4): what oddities, fortunes and the Number Punches
// do to the wheel itself. Each piece of work is { op, on, ... } and acts on a
// target: a pocket's id, or a number for work `on: 'number'` (every pocket
// with that number). Stamping takes { pocket, number }.
//
//   gild       gilded, or platinum when gilded already
//   enhance    puts `enh` on the pocket, replacing what it had
//   widen      +0.5 wide, every pocket with the number
//   narrow     -0.5 wide (to 0.25 at least), every pocket with the number
//   paint      repaints the pocket `color`
//   duplicate  a second pocket with the same number and colour, plain, beside it
//   remove     chisels the pocket out (no fewer than 18 stay)
//   stamp      the pocket reads `number` (a blank one takes that number's colour)
//
// One piece of work is done on the table, not the wheel: `level` (on: 'bet')
// raises a kind of bet a level (the Brass Odds Plate), so that an oddity's
// picks all go through here.
//
// Work never draws randomness; fortunes that work at random pick their
// pockets on the fortunes stream (oracle.js).

export const WHEEL = { minPockets: 18, maxPockets: 60, widen: 0.5, narrow: 0.5 };

const round6 = (x) => Math.round(x * 1e6) / 1e6;
const COLOR_NAME = { red: 'red', black: 'black' };

const pocketOf = (state, target) => {
  const id = typeof target === 'object' && target !== null ? target.pocket : target;
  return state.wheel.pockets.find((p) => p.id === id) ?? null;
};
const withNumber = (state, n) => state.wheel.pockets.filter((p) => p.number === n);
const isNumber = (n) => Number.isInteger(n) && n >= 0 && n <= 36;

/** Why this work cannot act on this target now, or null when it can. */
export function workRefusal(state, work, target) {
  if (work.on === 'bet') return BET_KINDS[target] ? null : 'Tap a bet.';
  if (work.on === 'number') {
    if (!isNumber(target)) return 'Choose a number.';
    const pockets = withNumber(state, target);
    if (!pockets.length) return `No pocket reads ${target}.`;
    if (work.op === 'narrow' && !pockets.some((p) => p.width > MIN_WIDTH)) return 'It is as narrow as it goes.';
    return null;
  }
  const pocket = pocketOf(state, target);
  if (!pocket) return 'Choose a pocket.';
  const count = state.wheel.pockets.length;
  switch (work.op) {
    case 'gild':
      if (isBlank(pocket)) return 'A blank pocket has nothing to gild.';
      return pocket.enh === 'platinum' ? 'It is platinum already.' : null;
    case 'enhance':
      if (isBlank(pocket)) return 'A blank pocket takes nothing.';
      return pocket.enh === work.enh ? `It is ${getEnhancement(work.enh).name.toLowerCase()} already.` : null;
    case 'paint':
      if (isBlank(pocket)) return 'A blank pocket takes no paint.';
      return pocket.color === work.color ? `It is ${COLOR_NAME[work.color]} already.` : null;
    case 'duplicate':
      if (isBlank(pocket)) return 'There is nothing there to cast.';
      return count >= WHEEL.maxPockets ? 'The wheel has no room for another pocket.' : null;
    case 'remove':
      if (count <= WHEEL.minPockets) return `No fewer than ${WHEEL.minPockets} pockets.`;
      return state.foreseen?.pocketId === pocket.id ? 'The Glass Eye is watching that pocket.' : null;
    case 'stamp':
      if (!isNumber(target?.number)) return 'Choose a number to stamp.';
      return pocket.number === target.number ? `It reads ${target.number} already.` : null;
    default:
      throw new Error(`Unknown wheel work: ${work.op}`);
  }
}

/** Every target this work could act on now: pocket ids, or numbers (not for stamping). */
export function workTargets(state, work) {
  if (work.on === 'bet') return Object.keys(BET_KINDS);
  if (work.on === 'number') return Array.from({ length: 37 }, (_, n) => n).filter((n) => !workRefusal(state, work, n));
  // Any pocket can take a stamp; only the number can be refused.
  if (work.op === 'stamp') return state.wheel.pockets.map((p) => p.id);
  return state.wheel.pockets.filter((p) => !workRefusal(state, work, p.id)).map((p) => p.id);
}

/**
 * Does the work on a draft (its wheel already copied by copyRun) and emits a
 * `wheelWork` event: { op, pockets: [{ id, index }], ..., by }. `by` names
 * what did it: { kind: 'oddity' | 'fortune' | 'talisman', id, uid? }.
 * The target must have passed workRefusal.
 */
export function doWork(draft, work, target, emit, by) {
  if (work.on === 'bet') {
    const level = levelOf(draft, target) + 1;
    draft.levels = { ...draft.levels, [target]: level };
    emit({ type: 'betLevel', kind: target, level, odds: BET_KINDS[target].odds * level, by });
    return;
  }
  const wheel = draft.wheel;
  const at = (p) => ({ id: p.id, index: wheel.pockets.indexOf(p) });
  if (work.on === 'number') {
    const pockets = wheel.pockets.filter((p) => p.number === target);
    const step = work.op === 'widen' ? WHEEL.widen : -WHEEL.narrow;
    for (const p of pockets) p.width = Math.max(MIN_WIDTH, round6(p.width + step));
    emit({ type: 'wheelWork', op: work.op, number: target, pockets: pockets.map(at), amount: step, by });
    return;
  }
  const pocket = pocketOf(draft, target);
  switch (work.op) {
    case 'gild':
      pocket.enh = pocket.enh === 'gilded' ? 'platinum' : 'gilded';
      break;
    case 'enhance':
      pocket.enh = work.enh;
      break;
    case 'paint':
      pocket.color = work.color;
      break;
    case 'stamp':
      if (isBlank(pocket)) {
        pocket.color = defaultColor(target.number);
        pocket.enh = null;
      }
      pocket.number = target.number;
      break;
    case 'duplicate': {
      const copy = { id: `p${wheel.nextId}`, number: pocket.number, color: pocket.color, width: 1, enh: null };
      wheel.nextId += 1;
      wheel.pockets.splice(wheel.pockets.indexOf(pocket) + 1, 0, copy);
      emit({ type: 'wheelWork', op: 'duplicate', number: pocket.number, pockets: [at(pocket)], made: at(copy), by });
      followForeseen(draft);
      return;
    }
    case 'remove': {
      const index = wheel.pockets.indexOf(pocket);
      wheel.pockets.splice(index, 1);
      emit({ type: 'wheelWork', op: 'remove', number: pocket.number, pockets: [{ id: pocket.id, index }], by });
      followForeseen(draft);
      return;
    }
    default:
      throw new Error(`Unknown wheel work: ${work.op}`);
  }
  emit({ type: 'wheelWork', op: work.op, number: pocket.number, color: pocket.color, enh: pocket.enh, pockets: [at(pocket)], by });
}

/** A landing the Glass Eye foresaw stays on its pocket while pockets come and go around it. */
function followForeseen(draft) {
  if (draft.foreseen) draft.foreseen = { ...draft.foreseen, pocketIndex: indexOfPocket(draft.wheel, draft.foreseen.pocketId) };
}
