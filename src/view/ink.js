import { SCRAWL, TYPED } from '../ui/fonts.js';
import { INK, loopPath, rng, scratch, swipePath } from '../ui/marks.js';

// The HUD's marks painted onto canvas textures, so the cards and signs in the
// room are lettered in the same hand (design doc 8.4).

export { INK };

export const scrawlFont = (px) => `${px}px ${SCRAWL}`;
export const typedFont = (px) => `${px}px ${TYPED}`;

/** Scrawled words, thickened with a stroke of their own colour. */
export function scrawlText(ctx, text, x, y, px, color, { maxWidth } = {}) {
  ctx.save();
  ctx.font = scrawlFont(px);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = px * 0.09;
  ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y, maxWidth);
  ctx.fillText(text, x, y, maxWidth);
  ctx.restore();
}

/** A brush swipe at (x, y), with bristle streaks dragged out of it. */
export function paintSwipe(ctx, x, y, w, h, seed, color = INK.bloodDeep, opts) {
  const r = rng(seed + 1);
  const layer = document.createElement('canvas');
  layer.width = Math.ceil(w + 8);
  layer.height = Math.ceil(h * 1.6);
  const l = layer.getContext('2d');
  l.translate(4, h * 0.3);
  l.fillStyle = color;
  l.fill(new Path2D(swipePath(w, h, seed, opts)));
  // Dry bristles: thin streaks along the stroke, densest where the brush ran out.
  l.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < h * 0.9; i++) {
    const sy = -h * 0.1 + r() * h * 1.2;
    const sx = r() * w * 0.5 + w * 0.35 * r();
    const len = w * (0.2 + r() * 0.6);
    l.globalAlpha = 0.25 + r() * 0.6;
    l.fillRect(sx, sy, len, 0.6 + r() * 1.6);
  }
  ctx.drawImage(layer, x - 4, y - h * 0.3);
}

/** A single scratch from (x1, y1) to (x2, y2). */
export function paintScratch(ctx, x1, y1, x2, y2, width, seed, color = INK.bone, opts) {
  ctx.save();
  const p = new Path2D(scratch(x1, y1, x2, y2, width, rng(seed), opts));
  // The groove: a dark offset under the pale cut.
  ctx.translate(width * 0.35, width * 0.4);
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fill(p);
  ctx.translate(-width * 0.35, -width * 0.4);
  ctx.fillStyle = color;
  ctx.fill(p);
  ctx.restore();
}

/** A chalk loop around (cx, cy). */
export function paintLoop(ctx, cx, cy, rx, ry, seed, color = INK.blood, width = 3) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.stroke(new Path2D(loopPath(cx, cy, rx, ry, seed)));
  ctx.restore();
}
