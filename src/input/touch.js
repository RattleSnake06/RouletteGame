// Touch gestures on the room → game actions (design doc 9.10). A swipe across
// empty space turns between stations, like the edge tabs and A/D. Presses
// that land on an object in the room (the Interaction marks them consumed)
// or on the wheel (a fling spins it) are left alone.

// No time limit: on empty space a long, straight drag means nothing else, and
// a phone that drops frames delivers even a quick swipe's events late.
const MIN_DISTANCE = 48; // px, or 8% of the screen's width if that is more
const STRAIGHTNESS = 1.4; // horizontal travel over vertical

/** True on a phone or tablet: the main input is a finger. */
export const isTouchScreen = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

/**
 * dom: the canvas. ignore(ev): true for a press another handler owns.
 * onSwipe(dir): -1 for a swipe to the right (the station on the left comes
 * into view), +1 for a swipe to the left.
 */
export function createSwipe(dom, { ignore, onSwipe }) {
  let start = null;
  dom.addEventListener('pointerdown', (e) => {
    start = e.pointerType === 'mouse' || ignore(e) ? null : { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  const end = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (e.type === 'pointercancel') return;
    if (Math.abs(dx) < Math.max(MIN_DISTANCE, window.innerWidth * 0.08) || Math.abs(dx) < STRAIGHTNESS * Math.abs(dy)) return;
    onSwipe(dx > 0 ? -1 : 1);
  };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}
