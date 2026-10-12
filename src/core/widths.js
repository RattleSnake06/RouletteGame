import { sources, srcRef } from './effects.js';

// The wheel as the ball meets it (design doc 5.4). Each pocket's chance is its
// width over the total width. Most widths live on the wheel itself (Phase 5's
// wheel work); talismans can also lean on them while they hang (Brass Scales),
// through pure `widths` hooks applied in rail order. The view draws the wheel
// from these widths, so a widened pocket is wider on screen.

export const MIN_WIDTH = 0.25;

const round6 = (x) => Math.round(x * 1e6) / 1e6;

/**
 * The wheel with every talisman's widening applied. Returns the stored wheel
 * itself when nothing changes it. Pure; with `emit`, each talisman that
 * widens something emits a `trigger`.
 */
export function liveWheel(state, emit = null) {
  let pockets = null;
  for (const src of sources(state)) {
    const fn = src.as.hooks?.widths;
    if (!fn) continue;
    fn({
      state,
      self: src.self,
      widen(test, amount) {
        pockets ??= state.wheel.pockets.map((p) => ({ ...p }));
        let count = 0;
        for (const p of pockets) {
          if (!test(p)) continue;
          p.width = Math.max(MIN_WIDTH, round6(p.width + amount));
          count += 1;
        }
        if (count) emit?.({ type: 'trigger', src: srcRef(src), hook: 'widths', effect: 'widen', amount, count });
      },
    });
  }
  return pockets ? { ...state.wheel, pockets } : state.wheel;
}

/** Each pocket's chance on the live wheel, in wheel order. */
export function liveChances(state) {
  const { pockets } = liveWheel(state);
  let total = 0;
  for (const p of pockets) total += p.width;
  return pockets.map((p) => p.width / total);
}
