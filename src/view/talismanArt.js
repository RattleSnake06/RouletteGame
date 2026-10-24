import * as THREE from 'three';
import { getTalisman } from '../core/content/index.js';
import { rng, seedOf } from '../ui/marks.js';
import { INK, paintScratch, scrawlText, typedFont } from './ink.js';

// What the talismans look like (design doc 5.8, 8.5). Every talisman is a
// charm: a brass-rimmed enamel disc with its curio painted on the face in the
// HUD's ink, hanging from a ring. One builder serves the rail and the Curio
// Cabinet, so a talisman looks the same in the shop and on the hook.
//
// Faces are painted on canvas (no image files). A charm's face is only 30-40
// px across at the table (16 in a small window), so each curio is one big
// silhouette in bone, brass or red that fills the enamel, inside a soot
// keyline; the fine detail is for the Cabinet's close look. Twin Mirrors'
// copies sit on silvered glass instead of enamel, so a copy never passes for
// the real thing. Green belongs to the House: only the cursed charms carry it,
// on blackened iron with green-black enamel.

/** Charm size in metres: the disc's outer radius and its thickness. */
export const CHARM = { radius: 0.032, depth: 0.008 };

const TAU = Math.PI * 2;
const FACE_PX = 512;

// The palette beyond the HUD's ink: mahogany, brass, ivory, oxblood, copper.
const C = {
  ...INK,
  paper: '#ece3cf',
  paperShade: '#b4a68a',
  manilaDeep: '#8f6e3a',
  ivory: '#e9dcbf',
  brassLight: '#f0d494',
  brassDeep: '#6a4a1f',
  copper: '#de8748',
  copperLight: '#ffc995',
  copperDeep: '#7a3818',
  ironDeep: '#3f3934',
  woodDeep: '#4e2611',
  amber: '#eba232',
  amberDeep: '#7c3a0c',
  ink: '#1d1310',
  porcelainShade: '#9c8b6e',
};

// ---- Drawing helpers (unit space: the face is a disc of radius 100) ----------

function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
}

function ellipse(ctx, x, y, rx, ry, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
}

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function fill(ctx, color, edge, edgeW = 2.5) {
  ctx.fillStyle = color;
  ctx.fill();
  if (edge) {
    ctx.strokeStyle = edge;
    ctx.lineWidth = edgeW;
    ctx.stroke();
  }
}

function line(ctx, pts, color, width, cap = 'round') {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = cap;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/** One straight stroke. */
function seg(ctx, x1, y1, x2, y2, color, width) {
  line(ctx, [[x1, y1], [x2, y2]], color, width);
}

/** A strip of ribbon from a to b, its end cut in a swallowtail. */
function band(ctx, ax, ay, bx, by, w, notch) {
  const len = Math.hypot(bx - ax, by - ay);
  const ux = (bx - ax) / len;
  const uy = (by - ay) / len;
  const nx = -uy * (w / 2);
  const ny = ux * (w / 2);
  ctx.beginPath();
  ctx.moveTo(ax + nx, ay + ny);
  ctx.lineTo(bx + nx, by + ny);
  ctx.lineTo(bx - ux * notch, by - uy * notch);
  ctx.lineTo(bx - nx, by - ny);
  ctx.lineTo(ax - nx, ay - ny);
  ctx.closePath();
}

/** Punch a hole through the paint, so the enamel shows through. */
function punch(ctx, draw) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  draw();
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();
}

function linear(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(([t, c]) => g.addColorStop(t, c));
  return g;
}

function radial(ctx, x0, y0, r0, x1, y1, r1, stops) {
  const g = ctx.createRadialGradient(x0, y0, r0, x1, y1, r1);
  stops.forEach(([t, c]) => g.addColorStop(t, c));
  return g;
}

const brassFill = (ctx, y0, y1) =>
  linear(ctx, 0, y0, 0, y1, [
    [0, C.brassLight],
    [0.45, C.brass],
    [1, '#8a6630'],
  ]);

// ---- The curios ------------------------------------------------------------------
// Each painter draws one curio centred on (0, 0), filling a radius of about 80
// (the bone ring sits at 90). At the table a face is 30-40 px across, so every
// curio is one big silhouette with a few thick strokes; anything thinner than
// about 4 units vanishes there and is only for the Cabinet's close look.
// `r` is a seeded random stream, so a face always comes out the same.

const PAINTERS = {
  red_ribbon(ctx) {
    // Tails first, so the bow sits over them.
    ctx.save();
    ctx.translate(0, -4);
    for (const [bx, by, color] of [
      [-42, 74, C.bloodDeep],
      [40, 76, C.blood],
    ]) {
      band(ctx, bx * 0.08, -2, bx, by, 25, 11);
      fill(ctx, color, '#4a080c', 3);
    }
    for (const s of [-1, 1]) {
      const loop = new Path2D();
      loop.moveTo(0, -8);
      loop.bezierCurveTo(s * -32, -72, s * -88, -58, s * -74, -14);
      loop.bezierCurveTo(s * -64, 18, s * -26, 10, 0, -8);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#4a080c';
      ctx.lineWidth = 25;
      ctx.stroke(loop);
      ctx.strokeStyle = C.bloodDeep;
      ctx.lineWidth = 20;
      ctx.stroke(loop);
      ctx.save();
      ctx.translate(s * 1.5, -2.5);
      ctx.strokeStyle = C.blood;
      ctx.lineWidth = 14;
      ctx.stroke(loop);
      ctx.restore();
      // Light catching the outer edge of each loop.
      ctx.beginPath();
      ctx.moveTo(s * -14, -40);
      ctx.bezierCurveTo(s * -36, -68, s * -80, -60, s * -80, -26);
      ctx.strokeStyle = 'rgba(255, 214, 200, 0.75)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    rrect(ctx, -15, -26, 30, 34, 8);
    fill(ctx, C.blood, '#4a080c', 3.5);
    seg(ctx, -7, -19, -5, 0, 'rgba(255, 214, 200, 0.7)', 3);
    ctx.restore();
  },

  horseshoe(ctx) {
    // Open end up, so the luck stays in.
    const cy = -2;
    const rx = 50;
    const ry = 57;
    const a0 = -Math.PI * 0.32;
    const a1 = Math.PI * 1.32;
    const arc = (dr = 0, t0 = a0, t1 = a1) => {
      ctx.beginPath();
      ctx.ellipse(0, cy, rx + dr, ry + dr, 0, t0, t1);
    };
    ctx.lineCap = 'butt';
    arc();
    ctx.strokeStyle = C.ironDeep;
    ctx.lineWidth = 39;
    ctx.stroke();
    arc();
    ctx.strokeStyle = linear(ctx, -60, -60, 50, 70, [
      [0, '#f2ece0'],
      [0.5, '#bdb5a9'],
      [1, '#6e665d'],
    ]);
    ctx.lineWidth = 33;
    ctx.stroke();
    // The fuller: the groove the nails sit in.
    arc(0, a0 + 0.2, a1 - 0.2);
    ctx.strokeStyle = '#5d554c';
    ctx.lineWidth = 6;
    ctx.stroke();
    for (const deg of [-22, 16, 54, 126, 164, 202]) {
      const a = (deg * Math.PI) / 180;
      ctx.save();
      ctx.translate(Math.cos(a) * rx, cy + Math.sin(a) * ry);
      ctx.rotate(a);
      rrect(ctx, -7, -4.5, 14, 9, 2);
      fill(ctx, C.soot);
      ctx.restore();
    }
    // Calkins: the heels at the two tips.
    for (const a of [a0, a1]) {
      ctx.save();
      ctx.translate(Math.cos(a) * rx, cy + Math.sin(a) * ry);
      ctx.rotate(a + Math.PI / 2);
      rrect(ctx, -20, -5.5, 40, 12, 2.5);
      fill(ctx, '#8d857a', C.ironDeep, 3);
      ctx.restore();
    }
    arc(12, Math.PI * 0.8, Math.PI * 1.26);
    ctx.strokeStyle = 'rgba(255, 250, 240, 0.85)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.stroke();
  },

  matchbook(ctx) {
    // An open book of matches with its cover folded back, and one match torn
    // out and struck. The card behind the comb keeps it from reading as candles.
    ctx.save();
    ctx.scale(1.14, 1.14);
    ctx.translate(5, 2);
    ctx.save();
    ctx.translate(-12, 8);
    ctx.rotate(-0.08);
    rrect(ctx, -44, -50, 80, 70, 4);
    fill(ctx, linear(ctx, 0, -50, 0, 20, [
      [0, '#ddd0b4'],
      [1, '#a3967b'],
    ]), '#3a2e22', 3);
    ctx.strokeStyle = C.blood;
    ctx.lineWidth = 3;
    ctx.strokeRect(-38, -44, 68, 58);
    rrect(ctx, -40, -2, 72, 16, 2);
    fill(ctx, '#8f8166');
    for (let i = 0; i < 5; i++) {
      const x = -30 + i * 14;
      if (i === 3) continue; // the one that was torn out
      rrect(ctx, x - 3.5, -22, 7, 26, 1.2);
      fill(ctx, '#ece0c0', '#5a4a36', 1.6);
      ellipse(ctx, x, -25, 6.5, 8.2);
      fill(ctx, C.blood, '#4a080c', 2);
    }
    rrect(ctx, -46, 12, 84, 44, 4);
    fill(ctx, linear(ctx, 0, 12, 0, 56, [
      [0, '#ea3a42'],
      [1, '#a3151c'],
    ]), '#4a080c', 3.5);
    // The striker strip along the bottom.
    rrect(ctx, -46, 42, 84, 12, 2);
    fill(ctx, '#2c0e0c');
    ctx.fillStyle = 'rgba(179, 169, 147, 0.55)';
    for (let i = 0; i < 30; i++) ctx.fillRect(-43 + ((i * 37) % 78), 45 + ((i * 7) % 7), 2, 2);
    seg(ctx, -38, 22, 30, 22, 'rgba(237, 229, 211, 0.9)', 3.4);
    ctx.restore();
    // The struck match, held across the book.
    ctx.save();
    ctx.translate(30, -22);
    ctx.rotate(0.5);
    rrect(ctx, -4.5, 0, 9, 70, 2);
    fill(ctx, '#f0e4c4', '#3a2e22', 2);
    ellipse(ctx, 0, -2, 7.5, 9.5);
    fill(ctx, '#2a1210', C.soot, 2);
    ctx.restore();
    const flame = (s) => {
      ctx.beginPath();
      ctx.moveTo(28, -22);
      ctx.bezierCurveTo(28 - 24 * s, -32, 26 - 9 * s, -58, 36, -72 + (1 - s) * 16);
      ctx.bezierCurveTo(36 + 11 * s, -56, 30 + 26 * s, -36, 28, -22);
      ctx.closePath();
    };
    flame(1);
    fill(ctx, C.blood);
    flame(0.72);
    fill(ctx, C.amber);
    flame(0.38);
    fill(ctx, '#fff4d6');
    ctx.restore();
  },

  lucky_penny(ctx) {
    // A copper cash coin on a red cord, tipped toward the light. The thick
    // milled edge makes it a coin rather than a ring, and the cord through the
    // square hole makes it a lucky one.
    ctx.save();
    ctx.rotate(-0.2);
    ctx.translate(0, -2);
    const rx = 70;
    const ry = 58;
    ellipse(ctx, 0, 13, rx, ry);
    fill(ctx, C.copperDeep, '#2e1408', 3.5);
    ctx.strokeStyle = 'rgba(40, 16, 6, 0.75)';
    ctx.lineWidth = 2.6;
    for (let i = 1; i < 14; i++) {
      const a = Math.PI * (i / 14);
      const x = Math.cos(a) * rx;
      const y = Math.sin(a) * ry;
      ctx.beginPath();
      ctx.moveTo(x, y + 2);
      ctx.lineTo(x, y + 11);
      ctx.stroke();
    }
    ellipse(ctx, 0, 0, rx, ry);
    fill(ctx, linear(ctx, -50, -50, 50, 50, [
      [0, C.copperLight],
      [0.5, C.copper],
      [1, '#9a4c22'],
    ]), '#3a1a0a', 3);
    // The raised rim.
    ellipse(ctx, 0, 0, rx - 10, ry - 9);
    ctx.strokeStyle = 'rgba(80, 34, 12, 0.9)';
    ctx.lineWidth = 4.5;
    ctx.stroke();
    ctx.save();
    ctx.scale(1, ry / rx);
    ctx.lineCap = 'round';
    // Four characters struck in relief round the hole, like old cash: lit
    // above, shadowed below, so they sink into the copper when small.
    for (const [dx, dy, color] of [
      [1.6, 1.6, 'rgba(90, 38, 14, 0.75)'],
      [-0.8, -0.8, 'rgba(255, 222, 186, 0.8)'],
    ]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 4.5;
      for (let i = 0; i < 4; i++) {
        ctx.save();
        ctx.rotate((i * TAU) / 4);
        ctx.translate(dx, dy);
        ctx.beginPath();
        ctx.moveTo(-8, -46);
        ctx.lineTo(8, -46);
        ctx.moveTo(0, -53);
        ctx.lineTo(0, -39);
        ctx.stroke();
        ctx.restore();
      }
    }
    rrect(ctx, -27, -27, 54, 54, 3);
    ctx.strokeStyle = 'rgba(90, 38, 14, 0.92)';
    ctx.lineWidth = 5.5;
    ctx.stroke();
    punch(ctx, () => rrect(ctx, -20, -20, 40, 40, 2));
    // The far wall of the hole, catching the light.
    ctx.fillStyle = C.copperDeep;
    ctx.fillRect(-20, -20, 40, 8);
    ctx.restore();
    ctx.beginPath();
    ctx.ellipse(0, 0, rx - 3.5, ry - 3.5, 0, Math.PI * 1.08, Math.PI * 1.42);
    ctx.strokeStyle = 'rgba(255, 240, 220, 0.9)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.stroke();
    // The cord: round the top bar of the hole, up over the rim, tied in a
    // loop above. It leaves the hole itself clear.
    const cord = new Path2D();
    cord.moveTo(0, -15);
    cord.lineTo(0, -ry + 2);
    cord.bezierCurveTo(-22, -ry - 30, 22, -ry - 30, 0, -ry + 2);
    ctx.lineJoin = 'round';
    for (const [color, w] of [
      ['#3a0609', 11],
      [C.bloodDeep, 8],
      [C.blood, 5],
    ]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.stroke(cord);
    }
    // The twist of the cord.
    for (let y = -18; y > -ry; y -= 7) seg(ctx, -3, y, 3, y - 4, 'rgba(58, 6, 9, 0.8)', 1.6);
    circle(ctx, 0, -ry + 2, 7.5);
    fill(ctx, C.blood, '#3a0609', 2.5);
    ctx.restore();
  },

  crumpled_receipt(ctx, r) {
    // A till slip balled up and smoothed out again: torn ends, creases, a few
    // typed lines and the total ringed in red, the way you mark what you owe.
    ctx.save();
    ctx.rotate(-0.16);
    const top = -70;
    const bot = 68;
    const half = 38;
    const tooth = 9.5;
    const pts = [];
    for (let i = 0; i <= 8; i++) pts.push([-half + i * tooth, top + (i & 1 ? 8 : 0)]);
    for (let y = top + 14; y < bot - 6; y += 16) pts.push([half + (r() - 0.5) * 8 - (y > 0 && y < 24 ? 6 : 0), y]);
    for (let i = 0; i <= 8; i++) pts.push([half - i * tooth, bot - (i & 1 ? 8 : 0)]);
    for (let y = bot - 14; y > top + 6; y -= 16) pts.push([-half + (r() - 0.5) * 8 + (y < -16 && y > -44 ? 6 : 0), y]);
    const outline = new Path2D();
    pts.forEach(([x, y], i) => (i ? outline.lineTo(x, y) : outline.moveTo(x, y)));
    outline.closePath();
    ctx.fillStyle = C.paper;
    ctx.fill(outline);
    ctx.save();
    ctx.clip(outline);
    // Crumple facets: shaded planes between the creases.
    for (const [quad, color] of [
      [[[-50, -30], [50, -54], [50, -12], [-50, 8]], 'rgba(110, 92, 62, 0.34)'],
      [[[-50, 8], [50, -12], [50, 24], [-50, 40]], 'rgba(255, 252, 240, 0.45)'],
      [[[-50, 40], [50, 24], [50, 80], [-50, 80]], 'rgba(110, 92, 62, 0.26)'],
    ]) {
      ctx.beginPath();
      quad.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.fillStyle = color;
      ctx.fill();
    }
    for (const crease of [
      [[-44, -30], [44, -52]],
      [[-44, 8], [44, -12]],
      [[-44, 40], [44, 24]],
      [[-8, -76], [6, 76]],
    ]) {
      line(ctx, crease, 'rgba(110, 90, 62, 0.7)', 2);
    }
    // Typed lines: words and prices.
    ctx.fillStyle = 'rgba(30, 20, 16, 0.88)';
    [-54, -40, -26].forEach((y, i) => {
      ctx.fillRect(-28, y, 20 + ((i * 11) % 14), 6.5);
      ctx.fillRect(10, y - 1, 17, 6.5);
    });
    ctx.setLineDash([5, 4]);
    line(ctx, [[-28, -8], [28, -12]], 'rgba(30, 20, 16, 0.8)', 3, 'butt');
    ctx.setLineDash([]);
    ctx.fillRect(-28, 10, 20, 8);
    ctx.fillStyle = C.bloodDeep;
    ctx.fillRect(5, 7, 22, 11);
    ctx.fillStyle = 'rgba(30, 20, 16, 0.45)';
    ctx.fillRect(-22, 40, 44, 5);
    ctx.fillRect(-14, 52, 28, 5);
    ctx.restore();
    ctx.strokeStyle = 'rgba(80, 64, 44, 0.95)';
    ctx.lineWidth = 2.6;
    ctx.stroke(outline);
    ctx.beginPath();
    ctx.ellipse(16, 12.5, 26, 15, -0.12, 0.3, TAU + 0.55);
    ctx.strokeStyle = C.blood;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  },

  pawn_ticket(ctx) {
    ctx.save();
    ctx.scale(1.1, 1.1);
    ctx.translate(2, 6);
    ctx.rotate(0.16);
    // The string, out through the punched hole.
    ctx.beginPath();
    ctx.moveTo(-52, 0);
    ctx.bezierCurveTo(-74, -6, -82, -30, -66, -44);
    ctx.bezierCurveTo(-56, -52, -40, -48, -38, -60);
    ctx.strokeStyle = C.boneDim;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.stroke();
    const k = 9;
    ctx.beginPath();
    ctx.moveTo(-66 + k, -36);
    ctx.lineTo(66 - k, -36);
    ctx.lineTo(66, -36 + k);
    ctx.lineTo(66, 36 - k);
    ctx.lineTo(66 - k, 36);
    ctx.lineTo(-66 + k, 36);
    ctx.lineTo(-66, 36 - k);
    ctx.lineTo(-66, -36 + k);
    ctx.closePath();
    fill(ctx, linear(ctx, 0, -36, 0, 36, [
      [0, '#ead19b'],
      [1, '#c19b5c'],
    ]), C.manilaDeep, 3);
    ctx.strokeStyle = C.bloodDeep;
    ctx.lineWidth = 2.2;
    ctx.strokeRect(-28, -28, 86, 56);
    ctx.fillStyle = C.ink;
    ctx.font = typedFont(15);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('No.', -24, -16);
    ctx.textAlign = 'center';
    scrawlText(ctx, '13', 22, 6, 50, C.blood, { maxWidth: 72 });
    for (let y = -32; y <= 32; y += 6.4) punch(ctx, () => circle(ctx, -36, y, 1.8));
    circle(ctx, -52, 0, 11);
    ctx.strokeStyle = C.manilaDeep;
    ctx.lineWidth = 3.5;
    ctx.stroke();
    punch(ctx, () => circle(ctx, -52, 0, 7));
    // The string, back over the card and through the hole.
    ctx.beginPath();
    ctx.moveTo(-52, 4);
    ctx.quadraticCurveTo(-60, 2, -62, -6);
    ctx.strokeStyle = C.boneDim;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();
  },

  brass_knuckles(ctx) {
    ctx.save();
    ctx.scale(1.18, 1.18);
    ctx.translate(0, -5);
    ctx.rotate(-0.08);
    const xs = [-45, -15, 15, 45];
    const yR = -14;
    const shape = (extra) => {
      ctx.lineWidth = 19 + extra;
      ctx.lineCap = 'round';
      for (const x of xs) {
        circle(ctx, x, yR, 18.5 + extra / 2);
        ctx.fill();
      }
      rrect(ctx, -60 - extra / 2, yR - 4 - extra / 2, 120 + extra, 22 + extra, 8);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-52, 2);
      ctx.bezierCurveTo(-48, 52, 48, 52, 52, 2);
      ctx.stroke();
    };
    ctx.fillStyle = ctx.strokeStyle = C.brassDeep;
    shape(6);
    ctx.fillStyle = ctx.strokeStyle = linear(ctx, 0, -34, 0, 46, [
      [0, '#f6dea2'],
      [0.45, '#d2aa62'],
      [1, '#8a6630'],
    ]);
    shape(0);
    for (const x of xs) {
      circle(ctx, x, yR, 12);
      ctx.strokeStyle = C.brassDeep;
      ctx.lineWidth = 3.5;
      ctx.stroke();
      punch(ctx, () => circle(ctx, x, yR, 10.5));
      ctx.beginPath();
      ctx.arc(x, yR, 15.5, Math.PI * 1.1, Math.PI * 1.7);
      ctx.strokeStyle = 'rgba(255, 244, 214, 0.85)';
      ctx.lineWidth = 2.8;
      ctx.stroke();
    }
    ctx.restore();
  },

  croupiers_rake(ctx) {
    // The croupier's long stick, its flat blade drawing two stacks of chips
    // in. A long blade and the chips keep it from reading as a hammer.
    const stick = [[0, 0], [-52, -64]];
    ctx.lineCap = 'round';
    line(ctx, stick, C.woodDeep, 15);
    line(ctx, stick, linear(ctx, 0, 0, -52, -64, [
      [0, '#c07438'],
      [1, '#eab074'],
    ]), 10);
    seg(ctx, -4, -8, -48, -62, 'rgba(255, 226, 190, 0.55)', 2.2);
    ctx.save();
    ctx.translate(4, 4);
    ctx.rotate(-0.07);
    // The ferrule where the stick meets the blade.
    ctx.save();
    ctx.rotate(Math.atan2(-64, -52) + Math.PI / 2);
    rrect(ctx, -7.5, 2, 15, 15, 3);
    fill(ctx, brassFill(ctx, 2, 17), C.brassDeep, 2.5);
    ctx.restore();
    rrect(ctx, -60, -6, 120, 13, 4);
    fill(ctx, linear(ctx, 0, -6, 0, 7, [
      [0, '#f6eedb'],
      [1, '#b5a484'],
    ]), '#3a2a1c', 3);
    seg(ctx, -54, -2.5, 54, -2.5, 'rgba(255, 255, 250, 0.8)', 2.2);
    ctx.restore();
    const chip = (x, y, face, side, rim) => {
      ellipse(ctx, x, y + 8, 21, 9);
      fill(ctx, side, '#1c0606', 2.5);
      ctx.fillStyle = side;
      ctx.fillRect(x - 21, y, 42, 8);
      seg(ctx, x - 21, y, x - 21, y + 8, '#1c0606', 2.5);
      seg(ctx, x + 21, y, x + 21, y + 8, '#1c0606', 2.5);
      ellipse(ctx, x, y, 21, 9);
      fill(ctx, face, '#1c0606', 2.5);
      ctx.setLineDash([4.5, 4]);
      ellipse(ctx, x, y, 14, 5.6);
      ctx.strokeStyle = rim;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.setLineDash([]);
    };
    const red = [C.blood, '#7a0e14', C.bone];
    const ivory = [C.ivory, '#9c8b6e', C.bloodDeep];
    for (const [x, y, kind] of [
      [-26, 48, red],
      [-26, 39, ivory],
      [-26, 30, red],
      [28, 48, ivory],
      [28, 39, red],
    ]) {
      chip(x, y, ...kind);
    }
  },

  ledger(ctx) {
    ctx.save();
    ctx.translate(0, -6);
    ctx.beginPath();
    ctx.moveTo(-74, -32);
    ctx.lineTo(0, -38);
    ctx.lineTo(74, -32);
    ctx.lineTo(76, 54);
    ctx.lineTo(0, 60);
    ctx.lineTo(-76, 54);
    ctx.closePath();
    fill(ctx, C.bloodDeep, '#3a0609', 3.5);
    for (const s of [-1, 1]) {
      // A few page edges under the open leaves.
      for (let i = 2; i >= 0; i--) {
        ctx.beginPath();
        ctx.moveTo(s * 2, -36 + i * 2);
        ctx.quadraticCurveTo(s * 34, -46 + i * 2, s * 68, -34 + i * 2);
        ctx.lineTo(s * 68, 46 + i * 2.5);
        ctx.quadraticCurveTo(s * 34, 38 + i * 2.5, s * 2, 50 + i * 2.5);
        ctx.closePath();
        fill(ctx, i ? C.paperShade : C.paper, i ? null : '#6e5f48', 2);
      }
    }
    ctx.fillStyle = linear(ctx, -14, 0, 14, 0, [
      [0, 'rgba(60, 40, 20, 0)'],
      [0.5, 'rgba(60, 40, 20, 0.5)'],
      [1, 'rgba(60, 40, 20, 0)'],
    ]);
    ctx.fillRect(-14, -44, 28, 96);
    // Left leaf: gates of tallies, the way you count repeats.
    const inkC = '#24160f';
    for (const [x0, y0] of [
      [-58, -22],
      [-32, -22],
      [-58, 10],
    ]) {
      for (let i = 0; i < 4; i++) {
        seg(ctx, x0 + i * 6, y0, x0 + i * 6 - 1, y0 + 22, inkC, 4.2);
      }
      seg(ctx, x0 - 4, y0 + 18, x0 + 23, y0 + 4, inkC, 4.2);
    }
    seg(ctx, -32, 12, -32, 32, inkC, 4.2);
    seg(ctx, -25, 12, -26, 32, inkC, 4.2);
    // Right leaf: ruled lines of figures, one entry underlined in red.
    ctx.fillStyle = 'rgba(36, 22, 15, 0.85)';
    for (let i = 0; i < 4; i++) {
      const y = -22 + i * 15;
      ctx.fillRect(12, y, 12 + ((i * 13) % 16), 4.5);
      ctx.fillRect(44, y, 14, 4.5);
    }
    seg(ctx, 40, 40, 62, 39, C.blood, 5);
    band(ctx, 3, 52, 9, 78, 10, 5);
    fill(ctx, C.blood, '#4a080c', 2);
    ctx.restore();
  },

  abacus(ctx) {
    // Three rods, the beads pushed apart: a count in progress.
    rrect(ctx, -60, -47, 120, 94, 6);
    ctx.strokeStyle = C.woodDeep;
    ctx.lineWidth = 17;
    ctx.stroke();
    ctx.strokeStyle = linear(ctx, 0, -56, 0, 56, [
      [0, '#cf8648'],
      [1, '#7a3e1c'],
    ]);
    ctx.lineWidth = 11;
    ctx.stroke();
    for (const [x, y] of [
      [-60, -47],
      [60, -47],
      [-60, 47],
      [60, 47],
    ]) {
      rrect(ctx, x - 7.5, y - 7.5, 15, 15, 3);
      fill(ctx, brassFill(ctx, y - 7.5, y + 7.5), C.brassDeep, 2.5);
    }
    const pitch = 17;
    const rows = [
      { y: -24, color: C.bone, left: 3, right: 2 },
      { y: 0, color: C.blood, left: 2, right: 3 },
      { y: 24, color: C.bone, left: 4, right: 1 },
    ];
    for (const { y, color, left, right } of rows) {
      ctx.fillStyle = C.boneDim;
      ctx.fillRect(-53, y - 1.8, 106, 3.6);
      const xs = [
        ...Array.from({ length: left }, (_, i) => -44 + i * pitch),
        ...Array.from({ length: right }, (_, i) => 44 - i * pitch),
      ];
      for (const x of xs) {
        ellipse(ctx, x, y, 8.2, 10.5);
        fill(ctx, color, color === C.bone ? '#4a3c2a' : '#3a0609', 2.4);
        ellipse(ctx, x - 2.5, y - 3.5, 2.2, 3);
        fill(ctx, 'rgba(255, 250, 240, 0.7)');
      }
    }
  },

  wheel_of_fortune(ctx) {
    // A carnival wheel with its pointer. Eight wide segments: twelve thin
    // ones blur to pink at the table.
    const cy = 9;
    const R = 62;
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(0, cy);
      ctx.arc(0, cy, R, a, a + TAU / n);
      ctx.closePath();
      fill(ctx, i % 2 ? '#e4d8bd' : C.blood);
    }
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU - Math.PI / 2;
      seg(ctx, 0, cy, Math.cos(a) * R, cy + Math.sin(a) * R, C.brassDeep, 3.2);
    }
    circle(ctx, 0, cy, R);
    ctx.strokeStyle = C.brassDeep;
    ctx.lineWidth = 14;
    ctx.stroke();
    ctx.strokeStyle = brassFill(ctx, cy - R, cy + R);
    ctx.lineWidth = 9;
    ctx.stroke();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU - Math.PI / 2;
      circle(ctx, Math.cos(a) * R, cy + Math.sin(a) * R, 3.8);
      fill(ctx, C.bone, C.brassDeep, 1.5);
    }
    circle(ctx, 0, cy, 15);
    fill(ctx, brassFill(ctx, cy - 15, cy + 15), C.brassDeep, 3);
    circle(ctx, 0, cy, 5);
    fill(ctx, C.soot);
    // The pointer, at twelve o'clock.
    ctx.beginPath();
    ctx.moveTo(-14, cy - R - 21);
    ctx.lineTo(14, cy - R - 21);
    ctx.lineTo(0, cy - R + 13);
    ctx.closePath();
    fill(ctx, brassFill(ctx, cy - R - 21, cy - R + 13), C.brassDeep, 3);
  },

  glass_eye(ctx, r) {
    const R = 70;
    circle(ctx, 0, 0, R);
    fill(ctx, radial(ctx, -24, -26, 4, 0, 0, R + 4, [
      [0, '#fffaf0'],
      [0.45, '#ebe0c9'],
      [0.82, '#a99a80'],
      [1, '#54473a'],
    ]));
    // Veins, from the back of the eye toward the iris.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.5 + r() * 0.3;
      let x = Math.cos(a) * (R - 2);
      let y = Math.sin(a) * (R - 2);
      const pts = [[x, y]];
      for (let j = 0; j < 4; j++) {
        x += -Math.cos(a) * 6.5 + (r() - 0.5) * 8;
        y += -Math.sin(a) * 6.5 + (r() - 0.5) * 8;
        pts.push([x, y]);
      }
      line(ctx, pts, i % 2 ? C.blood : C.bloodDeep, 2.6);
    }
    const ix = 8;
    const iy = 6;
    const ir = 32;
    circle(ctx, ix, iy, ir);
    fill(ctx, radial(ctx, ix, iy, 4, ix, iy, ir, [
      [0, '#ffd77a'],
      [0.55, C.amber],
      [1, C.amberDeep],
    ]));
    ctx.strokeStyle = 'rgba(110, 50, 10, 0.55)';
    ctx.lineWidth = 1.8;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      ctx.beginPath();
      ctx.moveTo(ix + Math.cos(a) * 15, iy + Math.sin(a) * 15);
      ctx.lineTo(ix + Math.cos(a) * 29, iy + Math.sin(a) * 29);
      ctx.stroke();
    }
    circle(ctx, ix, iy, ir);
    ctx.strokeStyle = '#2e1404';
    ctx.lineWidth = 4.5;
    ctx.stroke();
    circle(ctx, ix, iy, 14);
    fill(ctx, C.soot);
    ellipse(ctx, ix - 11, iy - 12, 8, 5.5, -0.6);
    fill(ctx, '#fffbf2');
    ctx.beginPath();
    ctx.arc(0, 0, R - 9, Math.PI * 1.08, Math.PI * 1.36);
    ctx.strokeStyle = 'rgba(255, 255, 250, 0.75)';
    ctx.lineWidth = 3.6;
    ctx.lineCap = 'round';
    ctx.stroke();
  },

  piggy_bank(ctx) {
    ctx.save();
    ctx.scale(1.13, 1.13);
    ctx.translate(-2, 1);
    const body = linear(ctx, 0, -40, 0, 48, [
      [0, '#f8efdc'],
      [0.55, '#dccdad'],
      [1, C.porcelainShade],
    ]);
    const edge = '#43382a';
    for (const x of [-30, 14]) {
      rrect(ctx, x, 24, 12, 26, 4);
      fill(ctx, '#9a8a6c', edge, 2.4);
    }
    ctx.beginPath();
    ctx.moveTo(-50, -2);
    ctx.bezierCurveTo(-64, -12, -72, 4, -62, 8);
    ctx.bezierCurveTo(-54, 10, -56, -6, -66, -6);
    ctx.strokeStyle = edge;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.strokeStyle = '#d8c8a8';
    ctx.lineWidth = 3.6;
    ctx.stroke();
    // Body and head drawn as one shape, so the outline runs round both.
    const pig = new Path2D();
    pig.ellipse(-6, 4, 50, 36, 0, 0, TAU);
    pig.moveTo(60, -4);
    pig.arc(34, -4, 26, 0, TAU);
    pig.moveTo(22, -22);
    pig.lineTo(34, -46);
    pig.lineTo(46, -22);
    pig.closePath();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 6;
    ctx.stroke(pig);
    ctx.fillStyle = body;
    ctx.fill(pig);
    ctx.beginPath();
    ctx.moveTo(28, -26);
    ctx.lineTo(34, -40);
    ctx.lineTo(40, -26);
    ctx.closePath();
    fill(ctx, '#b49c7a');
    for (const x of [-22, 20]) {
      rrect(ctx, x, 26, 13, 28, 4);
      fill(ctx, body, edge, 2.4);
      ctx.fillStyle = '#6b5c46';
      ctx.fillRect(x + 1, 49, 11, 4);
    }
    ellipse(ctx, 59, -2, 10, 14);
    fill(ctx, '#e6d6b8', edge, 3);
    for (const y of [-7, 3]) {
      ellipse(ctx, 61, y, 2.2, 3.2);
      fill(ctx, C.soot);
    }
    circle(ctx, 40, -11, 4);
    fill(ctx, C.soot);
    // A coin half into the slot.
    ctx.save();
    ctx.beginPath();
    ctx.rect(-40, -90, 60, 58);
    ctx.clip();
    circle(ctx, -10, -43, 16);
    fill(ctx, brassFill(ctx, -59, -27), C.brassDeep, 3);
    circle(ctx, -10, -43, 10);
    ctx.strokeStyle = 'rgba(106, 74, 31, 0.85)';
    ctx.lineWidth = 2.6;
    ctx.stroke();
    ctx.restore();
    rrect(ctx, -29, -35, 38, 7, 3);
    fill(ctx, '#140c08');
    ctx.beginPath();
    ctx.ellipse(-6, 4, 44, 30, 0, Math.PI * 1.1, Math.PI * 1.45);
    ctx.strokeStyle = 'rgba(255, 252, 244, 0.85)';
    ctx.lineWidth = 3.4;
    ctx.stroke();
    ctx.restore();
  },

  twin_mirrors(ctx) {
    ctx.save();
    ctx.scale(1.16, 1.16);
    ctx.translate(0, -6);
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(s * 25, -16);
      ctx.rotate(s * -0.34);
      rrect(ctx, -6, 28, 12, 44, 4);
      fill(ctx, brassFill(ctx, 28, 72), C.brassDeep, 2.8);
      circle(ctx, 0, 74, 7);
      fill(ctx, brassFill(ctx, 67, 81), C.brassDeep, 2.8);
      rrect(ctx, -9, 25, 18, 9, 3);
      fill(ctx, '#8a6630', C.brassDeep, 2.2);
      ellipse(ctx, 0, 0, 26, 33);
      fill(ctx, brassFill(ctx, -33, 33), C.brassDeep, 3.5);
      ellipse(ctx, 0, 0, 19, 26);
      fill(ctx, linear(ctx, -18 * s, -26, 18 * s, 26, [
        [0, '#ece8df'],
        [0.5, '#aca8a0'],
        [1, '#58554f'],
      ]), '#3a2c18', 2.4);
      ctx.save();
      ellipse(ctx, 0, 0, 19, 26);
      ctx.clip();
      seg(ctx, -16 * s, 14, 8 * s, -24, 'rgba(255, 255, 255, 0.85)', 6);
      seg(ctx, -5 * s, 21, 15 * s, -11, 'rgba(255, 255, 255, 0.5)', 2.6);
      ctx.restore();
      ctx.restore();
    }
    ctx.restore();
  },

  house_key(ctx) {
    ctx.save();
    ctx.rotate(Math.PI / 4);
    ctx.scale(1.18, 1.18);
    ctx.translate(8, 0);
    const shape = (extra) => {
      const e = extra / 2;
      for (const [x, y, rad] of [
        [-50, -13, 13],
        [-50, 13, 13],
        [-64, 0, 13],
        [-48, 0, 17],
      ]) {
        circle(ctx, x, y, rad + e);
        ctx.fill();
      }
      rrect(ctx, -33 - e, -10 - e, 7 + extra, 20 + extra, 2);
      ctx.fill();
      rrect(ctx, -32 - e, -6 - e, 92 + extra, 12 + extra, 4);
      ctx.fill();
      rrect(ctx, -24 - e, -8.5 - e, 6 + extra, 17 + extra, 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(34 - e, 3);
      ctx.lineTo(58 + e, 3);
      ctx.lineTo(58 + e, 29 + e);
      ctx.lineTo(51 - e, 29 + e);
      ctx.lineTo(51 - e, 20 - e);
      ctx.lineTo(45 + e, 20 - e);
      ctx.lineTo(45 + e, 29 + e);
      ctx.lineTo(34 - e, 29 + e);
      ctx.closePath();
      ctx.fill();
    };
    ctx.fillStyle = C.brassDeep;
    shape(6);
    ctx.fillStyle = linear(ctx, 0, -30, 0, 30, [
      [0, '#f6dea2'],
      [0.45, '#d2aa62'],
      [1, '#8a6630'],
    ]);
    shape(0);
    punch(ctx, () => circle(ctx, -50, 0, 8.5));
    for (const [x, y] of [
      [-52, -18],
      [-52, 18],
      [-70, 0],
    ]) {
      punch(ctx, () => circle(ctx, x, y, 3.8));
    }
    circle(ctx, -50, 0, 11);
    ctx.strokeStyle = C.brassDeep;
    ctx.lineWidth = 3;
    ctx.stroke();
    seg(ctx, -18, -3, 56, -3, 'rgba(255, 244, 214, 0.85)', 2.4);
    ctx.beginPath();
    ctx.arc(-48, 0, 15, Math.PI * 1.05, Math.PI * 1.55);
    ctx.strokeStyle = 'rgba(255, 244, 214, 0.85)';
    ctx.lineWidth = 2.8;
    ctx.stroke();
    ctx.restore();
  },

  // ---- Phase 3: luck and the Devil ----

  rabbits_foot(ctx) {
    // A furry foot on a brass keychain cap, toes down.
    ctx.save();
    ctx.rotate(-0.32);
    const fur = new Path2D();
    fur.moveTo(-17, -40);
    fur.bezierCurveTo(-30, -6, -40, 34, -26, 62);
    fur.bezierCurveTo(-14, 80, 18, 82, 28, 62);
    fur.bezierCurveTo(40, 36, 30, -6, 17, -40);
    fur.closePath();
    ctx.strokeStyle = '#43382a';
    ctx.lineWidth = 6;
    ctx.stroke(fur);
    ctx.fillStyle = linear(ctx, -36, 0, 36, 0, [
      [0, '#cdbd9c'],
      [0.45, '#f1e7d2'],
      [1, '#9c8b6e'],
    ]);
    ctx.fill(fur);
    // Tufts of fur along the sides and the toes.
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      const y = -24 + t * 84;
      const w = 24 + Math.sin(t * Math.PI) * 10;
      seg(ctx, -w * 0.7, y, -w * 0.25, y + 9, 'rgba(110, 92, 66, 0.7)', 2.4);
      seg(ctx, w * 0.7, y, w * 0.25, y + 9, 'rgba(110, 92, 66, 0.7)', 2.4);
    }
    for (const x of [-14, 0, 14]) seg(ctx, x, 66, x * 1.1, 78, '#43382a', 3.4);
    // The cap and its ring.
    rrect(ctx, -21, -56, 42, 22, 5);
    fill(ctx, brassFill(ctx, -56, -34), C.brassDeep, 3);
    for (const y of [-49, -42]) seg(ctx, -17, y, 17, y, 'rgba(106, 74, 31, 0.8)', 2);
    circle(ctx, 0, -68, 11);
    ctx.strokeStyle = C.brassDeep;
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.strokeStyle = C.brass;
    ctx.lineWidth = 4.5;
    ctx.stroke();
    seg(ctx, -12, -18, -18, 30, 'rgba(255, 252, 244, 0.7)', 3.2);
    ctx.restore();
  },

  pocket_watch(ctx) {
    const R = 60;
    // Bow and crown on top.
    circle(ctx, 0, -R - 20, 12);
    ctx.strokeStyle = C.brassDeep;
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.strokeStyle = C.brass;
    ctx.lineWidth = 4.5;
    ctx.stroke();
    rrect(ctx, -9, -R - 12, 18, 16, 3);
    fill(ctx, brassFill(ctx, -R - 12, -R + 4), C.brassDeep, 2.6);
    circle(ctx, 0, 4, R + 8);
    fill(ctx, brassFill(ctx, -R, R + 12), C.brassDeep, 4);
    circle(ctx, 0, 4, R - 2);
    fill(ctx, radial(ctx, -16, -14, 4, 0, 4, R, [
      [0, '#fbf5e8'],
      [0.7, '#e3d6ba'],
      [1, '#a99a80'],
    ]), '#5a4630', 2.4);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const long = i % 3 === 0;
      const r0 = long ? R - 18 : R - 12;
      seg(ctx, Math.cos(a) * r0, 4 + Math.sin(a) * r0, Math.cos(a) * (R - 7), 4 + Math.sin(a) * (R - 7), C.ink, long ? 4.5 : 2.6);
    }
    // Hands at a minute to midnight.
    seg(ctx, 0, 4, -4, 4 - 40, C.ink, 5);
    seg(ctx, 0, 4, -10, 4 - 28, C.blood, 6);
    circle(ctx, 0, 4, 5.5);
    fill(ctx, C.ink);
    ctx.beginPath();
    ctx.arc(0, 4, R + 3, Math.PI * 1.1, Math.PI * 1.4);
    ctx.strokeStyle = 'rgba(255, 244, 214, 0.8)';
    ctx.lineWidth = 3.4;
    ctx.lineCap = 'round';
    ctx.stroke();
  },

  salt_cellar(ctx) {
    // An open porcelain cellar heaped with salt, a pinch spilled beside it.
    const edge = '#43382a';
    const bowl = new Path2D();
    bowl.moveTo(-58, -4);
    bowl.bezierCurveTo(-54, 34, -30, 44, 0, 44);
    bowl.bezierCurveTo(30, 44, 54, 34, 58, -4);
    bowl.closePath();
    // Foot.
    rrect(ctx, -26, 40, 52, 16, 6);
    fill(ctx, '#bcae90', edge, 3);
    ctx.strokeStyle = edge;
    ctx.lineWidth = 6;
    ctx.stroke(bowl);
    ctx.fillStyle = linear(ctx, -58, 0, 58, 0, [
      [0, '#a99a80'],
      [0.4, '#f6efe0'],
      [1, '#8f8068'],
    ]);
    ctx.fill(bowl);
    // A blood band round the rim, as on old cellars.
    ctx.save();
    ctx.clip(bowl);
    ctx.fillStyle = C.bloodDeep;
    ctx.fillRect(-60, 6, 120, 8);
    ctx.restore();
    // The heap.
    ctx.beginPath();
    ctx.moveTo(-54, -4);
    ctx.bezierCurveTo(-36, -44, 30, -50, 54, -4);
    ctx.closePath();
    fill(ctx, '#fbf8f0', '#7a6e5c', 3);
    ellipse(ctx, 0, -4, 58, 9);
    ctx.strokeStyle = edge;
    ctx.lineWidth = 4;
    ctx.stroke();
    // Grains: on the heap and spilled at the left.
    const grains = [
      [-20, -22], [6, -30], [22, -18], [-6, -16], [12, -38], [-30, -12],
      [-66, 50], [-56, 58], [-74, 60], [-62, 66], [-48, 64],
    ];
    for (const [x, y] of grains) {
      rrect(ctx, x - 2.5, y - 2.5, 5, 5, 1);
      fill(ctx, '#fffdf6', '#6e6252', 1.2);
    }
    seg(ctx, -40, 4, -34, 24, 'rgba(255, 255, 250, 0.8)', 3.4);
  },

  evil_eye(ctx) {
    // A nazar: rings of glass round a dark pupil, strung on a brass loop.
    const R = 66;
    circle(ctx, 0, 0, R + 6);
    fill(ctx, brassFill(ctx, -R - 6, R + 6), C.brassDeep, 3);
    circle(ctx, 0, 0, R);
    fill(ctx, radial(ctx, -18, -20, 6, 0, 0, R, [
      [0, '#3d63ad'],
      [0.75, '#1f3b78'],
      [1, '#101f42'],
    ]));
    circle(ctx, 0, 0, R * 0.62);
    fill(ctx, '#f4efe2', '#0f1a33', 2.6);
    circle(ctx, 0, 0, R * 0.42);
    fill(ctx, radial(ctx, -6, -6, 2, 0, 0, R * 0.42, [
      [0, '#a9c6ec'],
      [1, '#5d86c4'],
    ]));
    circle(ctx, 0, 0, R * 0.2);
    fill(ctx, C.soot);
    ellipse(ctx, -9, -10, 6, 4, -0.6);
    fill(ctx, 'rgba(255, 255, 255, 0.9)');
    ctx.beginPath();
    ctx.arc(0, 0, R - 8, Math.PI * 1.08, Math.PI * 1.42);
    ctx.strokeStyle = 'rgba(220, 235, 255, 0.7)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.stroke();
  },

  compass(ctx) {
    const R = 66;
    circle(ctx, 0, 0, R + 8);
    fill(ctx, brassFill(ctx, -R - 8, R + 8), C.brassDeep, 4);
    circle(ctx, 0, 0, R - 1);
    fill(ctx, radial(ctx, -14, -16, 4, 0, 0, R, [
      [0, '#f8f1e0'],
      [1, '#b9aa8c'],
    ]), '#5a4630', 2.4);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      const r0 = i % 4 === 0 ? R - 18 : R - 10;
      seg(ctx, Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * (R - 5), Math.sin(a) * (R - 5), C.ink, i % 4 === 0 ? 4 : 2);
    }
    // An arrow round the rim: it only turns one way.
    ctx.beginPath();
    ctx.arc(0, 0, R - 26, -Math.PI * 0.15, Math.PI * 0.55);
    ctx.strokeStyle = 'rgba(122, 56, 24, 0.75)';
    ctx.lineWidth = 4;
    ctx.stroke();
    const ea = Math.PI * 0.55;
    const ex = Math.cos(ea) * (R - 26);
    const ey = Math.sin(ea) * (R - 26);
    ctx.beginPath();
    ctx.moveTo(ex - 9, ey - 4);
    ctx.lineTo(ex + 2, ey + 9);
    ctx.lineTo(ex + 8, ey - 7);
    ctx.closePath();
    fill(ctx, 'rgba(122, 56, 24, 0.85)');
    // The needle: blood to the north, bone to the south.
    ctx.save();
    ctx.rotate(0.5);
    ctx.beginPath();
    ctx.moveTo(0, -R + 12);
    ctx.lineTo(11, 0);
    ctx.lineTo(-11, 0);
    ctx.closePath();
    fill(ctx, C.blood, '#4a080c', 2.6);
    ctx.beginPath();
    ctx.moveTo(0, R - 12);
    ctx.lineTo(11, 0);
    ctx.lineTo(-11, 0);
    ctx.closePath();
    fill(ctx, '#e9dcbf', '#43382a', 2.6);
    ctx.restore();
    circle(ctx, 0, 0, 6);
    fill(ctx, brassFill(ctx, -6, 6), C.brassDeep, 2);
  },

  lodestone(ctx, r) {
    // A black magnetic stone, iron filings bristling where they cling.
    const pts = [];
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * TAU;
      const d = 50 + r() * 14;
      pts.push([Math.cos(a) * d * 1.08, 6 + Math.sin(a) * d * 0.86]);
    }
    const stone = new Path2D();
    stone.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i <= pts.length; i++) {
      const [x, y] = pts[i % pts.length];
      const [px, py] = pts[i - 1];
      stone.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
    }
    stone.closePath();
    // Filings first, standing off the stone like hair.
    for (let i = 0; i < 46; i++) {
      const a = r() * TAU;
      const d0 = 50 + r() * 8;
      const len = 10 + r() * 16;
      const x0 = Math.cos(a) * d0 * 1.05;
      const y0 = 6 + Math.sin(a) * d0 * 0.84;
      seg(ctx, x0, y0, x0 + Math.cos(a) * len, y0 + Math.sin(a) * len, i % 3 ? '#b4aca2' : '#6f6860', 2.2);
    }
    ctx.strokeStyle = '#0a0807';
    ctx.lineWidth = 6;
    ctx.stroke(stone);
    ctx.fillStyle = radial(ctx, -20, -14, 4, 0, 6, 70, [
      [0, '#5c5650'],
      [0.6, '#2b2724'],
      [1, '#121010'],
    ]);
    ctx.fill(stone);
    // Glints of iron in the stone.
    for (let i = 0; i < 9; i++) {
      const x = (r() - 0.5) * 70;
      const y = 6 + (r() - 0.5) * 56;
      rrect(ctx, x, y, 4 + r() * 5, 2.5, 1);
      fill(ctx, 'rgba(210, 204, 196, 0.6)');
    }
    // A brass pin stuck fast to it.
    ctx.save();
    ctx.rotate(-0.7);
    rrect(ctx, -3, -86, 6, 46, 2);
    fill(ctx, brassFill(ctx, -86, -40), C.brassDeep, 2);
    circle(ctx, 0, -88, 6);
    fill(ctx, C.blood, '#4a080c', 2);
    ctx.restore();
  },

  bone_dice(ctx) {
    // Two old bone dice, cracked, the pips gone green.
    const die = (x, y, rot, size, pips) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      rrect(ctx, -size / 2, -size / 2, size, size, size * 0.18);
      fill(ctx, linear(ctx, -size / 2, -size / 2, size / 2, size / 2, [
        [0, '#f3ead3'],
        [0.6, '#d8c9a5'],
        [1, '#8f7f60'],
      ]), '#3a2f22', 4);
      const q = size * 0.27;
      for (const [px, py] of pips) {
        circle(ctx, px * q, py * q, size * 0.09);
        fill(ctx, '#0d1a12');
        circle(ctx, px * q - 1, py * q - 1, size * 0.045);
        fill(ctx, 'rgba(69, 194, 122, 0.85)');
      }
      ctx.restore();
    };
    die(-26, 18, -0.28, 66, [[-1, -1], [0, 0], [1, 1]]);
    die(30, -20, 0.36, 60, [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]]);
    // A crack through the nearer die.
    line(ctx, [[-50, -4], [-38, 8], [-30, 4], [-20, 22], [-10, 26]], '#3a2f22', 2.6);
  },

  black_candle(ctx) {
    // A stub of black wax with a green flame.
    const W = 30;
    ctx.fillStyle = radial(ctx, 0, -50, 2, 0, -50, 44, [
      [0, 'rgba(69, 194, 122, 0.55)'],
      [1, 'rgba(69, 194, 122, 0)'],
    ]);
    circle(ctx, 0, -50, 44);
    ctx.fill();
    // The holder.
    ellipse(ctx, 0, 62, 50, 13);
    fill(ctx, brassFill(ctx, 49, 75), C.brassDeep, 3);
    rrect(ctx, -W, -26, W * 2, 88, 6);
    fill(ctx, linear(ctx, -W, 0, W, 0, [
      [0, '#2a2622'],
      [0.35, '#4a443e'],
      [1, '#0c0a09'],
    ]), '#000', 3);
    // Drips down the side.
    for (const [x, len] of [[-18, 30], [-2, 18], [14, 40]]) {
      rrect(ctx, x, -28, 9, len, 4.5);
      fill(ctx, '#3a3530');
      circle(ctx, x + 4.5, -28 + len, 5.5);
      fill(ctx, '#3a3530');
    }
    ellipse(ctx, 0, -26, W, 8);
    fill(ctx, '#55504a', '#000', 2);
    seg(ctx, 0, -28, 1, -40, C.soot, 3.5);
    // The flame.
    ctx.beginPath();
    ctx.moveTo(1, -38);
    ctx.bezierCurveTo(-16, -50, -6, -72, 3, -86);
    ctx.bezierCurveTo(12, -70, 18, -50, 1, -38);
    fill(ctx, linear(ctx, 0, -86, 0, -38, [
      [0, '#c8ffd9'],
      [0.5, '#45c27a'],
      [1, '#1c6a3e'],
    ]), '#0d3a20', 2);
    seg(ctx, -22, -10, -22, 40, 'rgba(255, 255, 255, 0.25)', 3);
  },

  // ---- More talismans: variety and combos -----------------------------------

  tuning_fork(ctx) {
    // A steel fork, struck: its tines ring with arcs of sound.
    for (const [r, a] of [[52, 0.75], [66, 0.5]]) {
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(0, -30, r, side < 0 ? Math.PI - 0.5 : -0.55, side < 0 ? Math.PI + 0.55 : 0.5);
        ctx.strokeStyle = `rgba(237, 229, 211, ${a})`;
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
    }
    const steel = linear(ctx, -30, 0, 30, 0, [
      [0, '#8f8a80'],
      [0.45, '#f1ece2'],
      [1, '#6e6a62'],
    ]);
    const fork = new Path2D();
    fork.moveTo(-28, -76);
    fork.lineTo(-28, -6);
    fork.bezierCurveTo(-28, 20, 28, 20, 28, -6);
    fork.lineTo(28, -76);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = C.soot;
    ctx.lineWidth = 19;
    ctx.stroke(fork);
    ctx.strokeStyle = steel;
    ctx.lineWidth = 12;
    ctx.stroke(fork);
    seg(ctx, 0, 14, 0, 70, C.soot, 17);
    seg(ctx, 0, 14, 0, 70, steel, 10);
    circle(ctx, 0, 74, 11);
    fill(ctx, brassFill(ctx, 63, 85), C.brassDeep, 3);
    seg(ctx, -31, -70, -31, -14, 'rgba(255, 255, 250, 0.7)', 2.6);
  },

  brass_scales(ctx) {
    // A balance, tipped: one pan heavy, as if the even side weighed more.
    const tilt = 0.2;
    rrect(ctx, -34, 64, 68, 12, 4);
    fill(ctx, brassFill(ctx, 64, 76), C.brassDeep, 3);
    seg(ctx, 0, 66, 0, -46, C.brassDeep, 12);
    seg(ctx, 0, 66, 0, -46, C.brass, 7);
    circle(ctx, 0, -54, 9);
    fill(ctx, brassFill(ctx, -63, -45), C.brassDeep, 3);
    ctx.save();
    ctx.translate(0, -46);
    ctx.rotate(tilt);
    seg(ctx, -64, 0, 64, 0, C.brassDeep, 10);
    seg(ctx, -64, 0, 64, 0, C.brassLight, 5);
    ctx.restore();
    const pan = (x, y) => {
      seg(ctx, x, y - 52, x - 22, y, 'rgba(240, 212, 148, 0.85)', 2.4);
      seg(ctx, x, y - 52, x + 22, y, 'rgba(240, 212, 148, 0.85)', 2.4);
      ctx.beginPath();
      ctx.moveTo(x - 28, y);
      ctx.quadraticCurveTo(x, y + 26, x + 28, y);
      ctx.closePath();
      fill(ctx, brassFill(ctx, y, y + 16), C.brassDeep, 3);
    };
    const ex = Math.cos(tilt) * 64;
    const ey = Math.sin(tilt) * 64;
    pan(-ex, -46 - ey + 52);
    pan(ex, -46 + ey + 52);
    // The heavier pan carries two ivory weights: an even number.
    for (const dx of [-8, 8]) {
      circle(ctx, ex + dx, -46 + ey + 50, 7);
      fill(ctx, C.ivory, C.soot, 2.4);
    }
  },

  string_of_pearls(ctx) {
    // A loop of pearls closed by a brass clasp, the newest pearls the brightest.
    const n = 15;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + 0.32 + (i / (n - 1)) * (TAU - 0.64);
      const x = Math.cos(a) * 58;
      const y = 8 + Math.sin(a) * 62;
      circle(ctx, x, y, 11.5);
      fill(ctx, radial(ctx, x - 4, y - 4, 1, x, y, 12, [
        [0, '#fffaf0'],
        [0.6, '#e6dcc6'],
        [1, '#9c8f78'],
      ]), C.soot, 2.6);
    }
    rrect(ctx, -14, -66, 28, 18, 5);
    fill(ctx, brassFill(ctx, -66, -48), C.brassDeep, 3);
    circle(ctx, 0, -57, 4);
    fill(ctx, C.blood);
  },

  wind_up_key(ctx) {
    // A clockwork key: two loops of the bow, a shaft, a squared bit.
    ctx.save();
    ctx.rotate(-0.5);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * 30, -40, 28, 22, side * 0.2, 0, TAU);
      ctx.strokeStyle = C.brassDeep;
      ctx.lineWidth = 16;
      ctx.stroke();
      ctx.strokeStyle = brassFill(ctx, -62, -18);
      ctx.lineWidth = 9;
      ctx.stroke();
    }
    rrect(ctx, -10, -36, 20, 24, 4);
    fill(ctx, brassFill(ctx, -36, -12), C.brassDeep, 3);
    seg(ctx, 0, -14, 0, 58, C.brassDeep, 15);
    seg(ctx, 0, -14, 0, 58, C.brass, 9);
    rrect(ctx, -13, 52, 26, 22, 3);
    fill(ctx, brassFill(ctx, 52, 74), C.brassDeep, 3);
    seg(ctx, -5, -6, -5, 50, 'rgba(255, 244, 214, 0.75)', 2.6);
    ctx.restore();
  },

  hamsa(ctx) {
    // The hand of Fatima, palm out, an eye in its palm.
    const hand = new Path2D();
    hand.moveTo(-46, 66);
    hand.bezierCurveTo(-60, 40, -62, 10, -58, -6);
    hand.bezierCurveTo(-56, -18, -44, -18, -42, -6);
    hand.lineTo(-40, 6);
    hand.lineTo(-38, -52);
    hand.bezierCurveTo(-37, -66, -21, -66, -20, -52);
    hand.lineTo(-18, -12);
    hand.lineTo(-10, -70);
    hand.bezierCurveTo(-8, -84, 8, -84, 10, -70);
    hand.lineTo(18, -12);
    hand.lineTo(20, -52);
    hand.bezierCurveTo(21, -66, 37, -66, 38, -52);
    hand.lineTo(40, 6);
    hand.lineTo(42, -6);
    hand.bezierCurveTo(44, -18, 56, -18, 58, -6);
    hand.bezierCurveTo(62, 10, 60, 40, 46, 66);
    hand.closePath();
    ctx.strokeStyle = C.soot;
    ctx.lineWidth = 7;
    ctx.stroke(hand);
    ctx.fillStyle = linear(ctx, -60, 0, 60, 0, [
      [0, '#a99a80'],
      [0.45, '#efe6d2'],
      [1, '#9c8b6e'],
    ]);
    ctx.fill(hand);
    ellipse(ctx, 0, 30, 22, 13);
    fill(ctx, C.bone, C.soot, 3);
    circle(ctx, 0, 30, 9);
    fill(ctx, C.blood, C.soot, 2);
    circle(ctx, 0, 30, 3.5);
    fill(ctx, C.soot);
  },

  beckoning_cat(ctx) {
    // A maneki-neko, one paw raised, a brass bell on its red collar.
    const edge = C.soot;
    ellipse(ctx, 0, 40, 46, 38);
    fill(ctx, C.ivory, edge, 5);
    circle(ctx, 0, -22, 38);
    fill(ctx, C.ivory, edge, 5);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * 34, -38);
      ctx.lineTo(side * 30, -70);
      ctx.lineTo(side * 10, -54);
      ctx.closePath();
      fill(ctx, C.ivory, edge, 4);
    }
    // The raised paw.
    rrect(ctx, 36, -48, 22, 50, 10);
    fill(ctx, C.ivory, edge, 4);
    for (const side of [-1, 1]) {
      ellipse(ctx, side * 14, -26, 5, 3.5);
      fill(ctx, C.ink);
    }
    seg(ctx, -6, -12, 6, -12, C.ink, 3);
    // Collar and bell.
    ctx.beginPath();
    ctx.moveTo(-32, 4);
    ctx.quadraticCurveTo(0, 18, 32, 4);
    ctx.strokeStyle = C.blood;
    ctx.lineWidth = 8;
    ctx.stroke();
    circle(ctx, 0, 18, 10);
    fill(ctx, brassFill(ctx, 8, 28), C.brassDeep, 3);
    // A coin held to the chest.
    ellipse(ctx, -16, 50, 14, 20);
    fill(ctx, brassFill(ctx, 30, 70), C.brassDeep, 3);
  },

  grandmothers_purse(ctx) {
    // A kiss-lock purse in faded oxblood, its brass clasp shut.
    const bag = new Path2D();
    bag.moveTo(-52, -20);
    bag.bezierCurveTo(-74, 20, -66, 66, -40, 70);
    bag.lineTo(40, 70);
    bag.bezierCurveTo(66, 66, 74, 20, 52, -20);
    bag.closePath();
    ctx.strokeStyle = C.soot;
    ctx.lineWidth = 6;
    ctx.stroke(bag);
    ctx.fillStyle = linear(ctx, -70, 0, 70, 0, [
      [0, C.bloodDeep],
      [0.45, '#b2333a'],
      [1, '#5e0c11'],
    ]);
    ctx.fill(bag);
    // Quilted stitching.
    ctx.save();
    ctx.clip(bag);
    for (let x = -80; x < 80; x += 22) {
      seg(ctx, x, -24, x + 60, 80, 'rgba(0, 0, 0, 0.25)', 2);
      seg(ctx, x + 60, -24, x, 80, 'rgba(0, 0, 0, 0.25)', 2);
    }
    ctx.restore();
    // The frame and its two kissing balls.
    ctx.beginPath();
    ctx.moveTo(-54, -18);
    ctx.quadraticCurveTo(0, -44, 54, -18);
    ctx.strokeStyle = C.brassDeep;
    ctx.lineWidth = 12;
    ctx.stroke();
    ctx.strokeStyle = C.brass;
    ctx.lineWidth = 6;
    ctx.stroke();
    for (const x of [-9, 9]) {
      circle(ctx, x, -38, 9);
      fill(ctx, brassFill(ctx, -47, -29), C.brassDeep, 3);
    }
    seg(ctx, -44, 0, -50, 40, 'rgba(255, 220, 210, 0.35)', 3);
  },

  lost_wallet(ctx) {
    // A worn leather wallet, a banknote showing at its fold.
    ctx.save();
    ctx.rotate(-0.12);
    rrect(ctx, -46, -46, 70, 38, 3);
    fill(ctx, linear(ctx, 0, -46, 0, -8, [
      [0, '#e8dfc8'],
      [1, '#b4a68a'],
    ]), C.soot, 3);
    ctx.textAlign = 'center';
    scrawlText(ctx, '20', -12, -27, 22, C.bloodDeep);
    rrect(ctx, -64, -20, 128, 84, 10);
    fill(ctx, linear(ctx, 0, -20, 0, 64, [
      [0, '#a8632f'],
      [0.6, C.copperDeep],
      [1, '#4a1f0c'],
    ]), C.soot, 5);
    // The fold and its stitching.
    seg(ctx, -64, 6, 64, 6, 'rgba(0, 0, 0, 0.45)', 4);
    ctx.setLineDash([5, 6]);
    rrect(ctx, -56, -12, 112, 68, 7);
    ctx.strokeStyle = 'rgba(237, 229, 211, 0.55)';
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.setLineDash([]);
    seg(ctx, -52, 20, -48, 50, 'rgba(255, 220, 190, 0.35)', 3);
    ctx.restore();
  },

  magpie(ctx) {
    // A magpie in black and white with a stolen coin in its beak.
    ctx.save();
    ctx.translate(-6, 4);
    ctx.scale(1.12, 1.12);
    const body = new Path2D();
    body.moveTo(-60, 34);
    body.lineTo(-30, 12);
    body.bezierCurveTo(-20, -30, 20, -50, 40, -40);
    body.bezierCurveTo(56, -34, 58, -14, 46, -4);
    body.bezierCurveTo(40, 30, 10, 48, -24, 34);
    body.closePath();
    ctx.strokeStyle = C.bone;
    ctx.lineWidth = 9;
    ctx.stroke(body);
    ctx.fillStyle = '#16120f';
    ctx.fill(body);
    // White belly and wing bar.
    ctx.beginPath();
    ctx.moveTo(-14, 30);
    ctx.bezierCurveTo(8, 34, 30, 22, 40, 2);
    ctx.bezierCurveTo(24, 6, 2, 12, -14, 30);
    fill(ctx, C.bone);
    // Tail.
    ctx.beginPath();
    // Kept inside the face, clear of the bezel.
    ctx.moveTo(-30, 14);
    ctx.lineTo(-56, 44);
    ctx.lineTo(-46, 50);
    ctx.lineTo(-22, 30);
    fill(ctx, '#16120f', C.bone, 3);
    circle(ctx, 38, -26, 4.5);
    fill(ctx, C.bone);
    // The beak and the coin.
    ctx.beginPath();
    ctx.moveTo(52, -24);
    ctx.lineTo(72, -14);
    ctx.lineTo(52, -12);
    fill(ctx, '#16120f', C.bone, 2.4);
    circle(ctx, 72, 2, 15);
    fill(ctx, brassFill(ctx, -13, 17), C.brassDeep, 3);
    circle(ctx, 72, 2, 8);
    ctx.strokeStyle = C.brassDeep;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  },

  domino(ctx) {
    // An ivory domino, double-four, standing on its corner.
    ctx.save();
    ctx.rotate(0.38);
    rrect(ctx, -34, -70, 68, 140, 12);
    fill(ctx, linear(ctx, -34, 0, 34, 0, [
      [0, '#cdbd9c'],
      [0.4, '#f6efe0'],
      [1, '#9c8b6e'],
    ]), C.soot, 6);
    seg(ctx, -26, 0, 26, 0, C.soot, 4);
    const pips = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (const cy of [-35, 35]) {
      for (const [px, py] of pips) {
        circle(ctx, px * 15, cy + py * 15, 7);
        fill(ctx, cy < 0 ? C.blood : C.soot);
      }
    }
    seg(ctx, -26, -60, -26, 60, 'rgba(255, 255, 250, 0.6)', 3);
    ctx.restore();
  },

  four_leaf_clover(ctx) {
    // A clover pressed in brass (green is the House's colour, not ours).
    seg(ctx, 4, 12, 26, 78, C.brassDeep, 12);
    seg(ctx, 4, 12, 26, 78, C.brass, 6);
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.rotate(i * (Math.PI / 2) + Math.PI / 4);
      const leaf = new Path2D();
      leaf.moveTo(0, 0);
      leaf.bezierCurveTo(-30, -14, -40, -52, -16, -58);
      leaf.bezierCurveTo(-6, -60, -1, -52, 0, -44);
      leaf.bezierCurveTo(1, -52, 6, -60, 16, -58);
      leaf.bezierCurveTo(40, -52, 30, -14, 0, 0);
      ctx.strokeStyle = C.brassDeep;
      ctx.lineWidth = 6;
      ctx.stroke(leaf);
      ctx.fillStyle = brassFill(ctx, -60, 0);
      ctx.fill(leaf);
      seg(ctx, 0, -6, 0, -40, 'rgba(106, 74, 31, 0.8)', 2.4);
      ctx.restore();
    }
    circle(ctx, 0, 0, 7);
    fill(ctx, C.brassLight, C.brassDeep, 2);
  },

  holy_water(ctx) {
    // A glass vial with a brass stopper, a cross etched in it.
    ctx.fillStyle = radial(ctx, 0, 20, 4, 0, 20, 70, [
      [0, 'rgba(210, 228, 255, 0.28)'],
      [1, 'rgba(210, 228, 255, 0)'],
    ]);
    circle(ctx, 0, 20, 70);
    ctx.fill();
    const vial = new Path2D();
    vial.moveTo(-14, -52);
    vial.lineTo(-14, -30);
    vial.bezierCurveTo(-50, -18, -54, 62, 0, 70);
    vial.bezierCurveTo(54, 62, 50, -18, 14, -30);
    vial.lineTo(14, -52);
    vial.closePath();
    ctx.strokeStyle = C.soot;
    ctx.lineWidth = 6;
    ctx.stroke(vial);
    ctx.fillStyle = linear(ctx, -50, 0, 50, 0, [
      [0, 'rgba(150, 170, 200, 0.85)'],
      [0.4, 'rgba(232, 240, 252, 0.95)'],
      [1, 'rgba(110, 125, 150, 0.85)'],
    ]);
    ctx.fill(vial);
    // The water inside.
    ctx.save();
    ctx.clip(vial);
    ctx.fillStyle = 'rgba(160, 196, 240, 0.55)';
    ctx.fillRect(-60, 10, 120, 70);
    ctx.restore();
    seg(ctx, 0, 4, 0, 52, C.bone, 6);
    seg(ctx, -14, 20, 14, 20, C.bone, 6);
    rrect(ctx, -18, -72, 36, 22, 5);
    fill(ctx, brassFill(ctx, -72, -50), C.brassDeep, 3);
    seg(ctx, -30, 0, -26, 44, 'rgba(255, 255, 255, 0.8)', 3.4);
  },

  dowsing_rod(ctx) {
    // A forked hazel twig, its point dipping toward something below.
    const wood = linear(ctx, -60, 0, 60, 0, [
      [0, '#6e3a18'],
      [0.5, '#b27a44'],
      [1, '#5a2c10'],
    ]);
    const twig = (pts, w) => {
      line(ctx, pts, C.soot, w + 7);
      line(ctx, pts, wood, w);
    };
    // The prong tips stay inside the face, clear of the bezel.
    twig([[-56, -60], [-36, -28], [-8, 14]], 12);
    twig([[56, -60], [36, -28], [-8, 14]], 12);
    twig([[-8, 14], [-14, 46], [-24, 76]], 14);
    // Knots and a brass ferrule at the point.
    for (const [x, y] of [[-40, -34], [40, -34]]) {
      circle(ctx, x, y, 4);
      fill(ctx, '#3a1c08');
    }
    rrect(ctx, -32, 62, 18, 16, 3);
    fill(ctx, brassFill(ctx, 62, 78), C.brassDeep, 3);
    // It twitches.
    for (const r of [14, 24]) {
      ctx.beginPath();
      ctx.arc(-23, 84, r, Math.PI * 1.15, Math.PI * 1.85);
      ctx.strokeStyle = 'rgba(237, 229, 211, 0.6)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  },

  mousetrap(ctx) {
    // A sprung-wire mousetrap on its board, a wedge of cheese as bait.
    ctx.save();
    ctx.rotate(-0.18);
    rrect(ctx, -70, -24, 140, 66, 6);
    fill(ctx, linear(ctx, 0, -24, 0, 42, [
      [0, '#c78a52'],
      [1, '#6e3a18'],
    ]), C.soot, 5);
    for (const y of [-6, 10, 26]) seg(ctx, -62, y, 62, y + 2, 'rgba(60, 28, 8, 0.4)', 2);
    // The spring and its striker bar, set.
    circle(ctx, -10, 8, 12);
    ctx.strokeStyle = '#cfcac0';
    ctx.lineWidth = 5;
    ctx.stroke();
    line(ctx, [[-10, -4], [-10, -66], [52, -66], [52, -4]], C.soot, 11);
    line(ctx, [[-10, -4], [-10, -66], [52, -66], [52, -4]], '#d9d4ca', 5);
    // The cheese.
    ctx.beginPath();
    ctx.moveTo(18, 30);
    ctx.lineTo(60, 30);
    ctx.lineTo(60, 6);
    ctx.closePath();
    fill(ctx, C.amber, C.amberDeep, 3);
    for (const [x, y] of [[48, 22], [55, 14]]) {
      circle(ctx, x, y, 3);
      fill(ctx, C.amberDeep);
    }
    ctx.restore();
  },

  weathervane(ctx) {
    // A brass cockerel on an arrow, over the four winds.
    seg(ctx, 0, -10, 0, 80, C.soot, 10);
    seg(ctx, 0, -10, 0, 80, C.brass, 5);
    seg(ctx, -44, 56, 44, 56, C.soot, 8);
    seg(ctx, -44, 56, 44, 56, C.brassDeep, 4);
    // The arrow.
    line(ctx, [[-70, 0], [64, 0]], C.soot, 10);
    line(ctx, [[-70, 0], [64, 0]], C.brass, 5);
    ctx.beginPath();
    ctx.moveTo(78, 0);
    ctx.lineTo(56, -14);
    ctx.lineTo(56, 14);
    ctx.closePath();
    fill(ctx, brassFill(ctx, -14, 14), C.brassDeep, 3);
    ctx.beginPath();
    ctx.moveTo(-58, 0);
    ctx.lineTo(-78, -16);
    ctx.lineTo(-70, 0);
    ctx.lineTo(-78, 16);
    ctx.closePath();
    fill(ctx, brassFill(ctx, -16, 16), C.brassDeep, 3);
    // The cockerel.
    const bird = new Path2D();
    bird.moveTo(-34, -8);
    bird.bezierCurveTo(-50, -40, -40, -66, -24, -60);
    bird.bezierCurveTo(-10, -56, -6, -40, 4, -40);
    bird.bezierCurveTo(10, -60, 30, -70, 34, -52);
    bird.lineTo(44, -50);
    bird.lineTo(36, -42);
    bird.bezierCurveTo(36, -24, 20, -8, 4, -8);
    bird.closePath();
    ctx.strokeStyle = C.brassDeep;
    ctx.lineWidth = 6;
    ctx.stroke(bird);
    ctx.fillStyle = brassFill(ctx, -70, -8);
    ctx.fill(bird);
    circle(ctx, 28, -54, 3);
    fill(ctx, C.soot);
    ctx.beginPath();
    ctx.moveTo(26, -66);
    ctx.lineTo(30, -76);
    ctx.lineTo(34, -66);
    fill(ctx, C.blood);
  },

  seesaw(ctx) {
    // A plank over a fulcrum, tipped: the ball rolls to the other side.
    ctx.beginPath();
    ctx.moveTo(0, 6);
    ctx.lineTo(-30, 64);
    ctx.lineTo(30, 64);
    ctx.closePath();
    fill(ctx, brassFill(ctx, 6, 64), C.brassDeep, 4);
    ctx.save();
    ctx.translate(0, 2);
    ctx.rotate(-0.3);
    rrect(ctx, -82, -9, 164, 18, 5);
    fill(ctx, linear(ctx, 0, -9, 0, 9, [
      [0, '#c78a52'],
      [1, '#6e3a18'],
    ]), C.soot, 4);
    // A red end and a black end, the two halves.
    rrect(ctx, -82, -9, 34, 18, 5);
    fill(ctx, C.blood, C.soot, 3);
    rrect(ctx, 48, -9, 34, 18, 5);
    fill(ctx, '#16120f', C.bone, 3);
    ctx.restore();
    circle(ctx, -46, -28, 15);
    fill(ctx, radial(ctx, -51, -33, 2, -46, -28, 16, [
      [0, '#ffffff'],
      [1, '#a8a294'],
    ]), C.soot, 3);
  },

  ouroboros(ctx) {
    // A brass serpent swallowing its own tail.
    ctx.beginPath();
    ctx.arc(0, 0, 58, -Math.PI / 2 + 0.42, Math.PI * 1.5 - 0.1);
    ctx.strokeStyle = C.soot;
    ctx.lineWidth = 30;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.strokeStyle = linear(ctx, -60, -60, 60, 60, [
      [0, C.brassLight],
      [0.5, C.brass],
      [1, '#7a5a26'],
    ]);
    ctx.lineWidth = 22;
    ctx.stroke();
    // Scales.
    for (let i = 0; i < 22; i++) {
      const a = -Math.PI / 2 + 0.55 + (i / 22) * (TAU - 0.8);
      const x = Math.cos(a) * 58;
      const y = Math.sin(a) * 58;
      ctx.beginPath();
      ctx.arc(x, y, 6, a + Math.PI * 0.6, a + Math.PI * 1.4);
      ctx.strokeStyle = 'rgba(106, 74, 31, 0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    // The head, jaws round the tail.
    ctx.save();
    ctx.translate(18, -56);
    ctx.rotate(0.35);
    ellipse(ctx, 0, 0, 24, 17);
    fill(ctx, brassFill(ctx, -17, 17), C.soot, 4);
    circle(ctx, 4, -6, 4);
    fill(ctx, C.blood);
    ctx.restore();
  },

  thirteen_ball(ctx) {
    // An ivory ball with an oxblood band and a 13 on its spot.
    circle(ctx, 0, 0, 70);
    fill(ctx, radial(ctx, -24, -26, 4, 0, 0, 72, [
      [0, '#fffaf0'],
      [0.6, '#e6dcc6'],
      [1, '#8f8068'],
    ]), C.soot, 5);
    ctx.save();
    circle(ctx, 0, 0, 68);
    ctx.clip();
    ctx.fillStyle = C.bloodDeep;
    ctx.fillRect(-80, -30, 160, 60);
    ctx.restore();
    circle(ctx, 0, 0, 28);
    fill(ctx, C.bone, C.soot, 3);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = typedFont(34);
    ctx.fillStyle = C.ink;
    ctx.fillText('13', 0, 2);
    ellipse(ctx, -30, -40, 14, 8, -0.6);
    fill(ctx, 'rgba(255, 255, 255, 0.6)');
  },

  black_cat(ctx) {
    // A black cat, back arched, edged in bone so it shows on the dark.
    const cat = new Path2D();
    cat.moveTo(-70, 66);
    cat.bezierCurveTo(-66, 30, -60, -10, -30, -24);
    cat.bezierCurveTo(-6, -36, 20, -30, 34, -10);
    cat.lineTo(40, -34);
    cat.lineTo(46, -22);
    cat.lineTo(56, -40);
    cat.lineTo(60, -16);
    cat.bezierCurveTo(70, 0, 62, 20, 48, 22);
    cat.lineTo(52, 66);
    cat.lineTo(38, 66);
    cat.lineTo(34, 30);
    cat.bezierCurveTo(10, 20, -20, 24, -36, 40);
    cat.lineTo(-40, 66);
    cat.closePath();
    // The tail, curling up.
    ctx.beginPath();
    ctx.moveTo(-60, 30);
    ctx.bezierCurveTo(-96, 10, -80, -50, -54, -56);
    ctx.strokeStyle = C.bone;
    ctx.lineWidth = 15;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.strokeStyle = '#100c0a';
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.strokeStyle = C.bone;
    ctx.lineWidth = 6;
    ctx.stroke(cat);
    ctx.fillStyle = '#100c0a';
    ctx.fill(cat);
    for (const x of [44, 56]) {
      ellipse(ctx, x, -6, 4, 5.5);
      fill(ctx, C.amber);
      seg(ctx, x, -10, x, -2, C.soot, 1.6);
    }
  },

  golden_ball(ctx) {
    // A roulette ball of solid gold, throwing light.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + 0.13;
      seg(ctx, Math.cos(a) * 64, Math.sin(a) * 64, Math.cos(a) * 82, Math.sin(a) * 82, 'rgba(240, 212, 148, 0.7)', 4);
    }
    circle(ctx, 0, 0, 56);
    fill(ctx, radial(ctx, -20, -22, 4, 0, 0, 58, [
      [0, '#fff6d6'],
      [0.35, C.brassLight],
      [0.75, C.brass],
      [1, C.brassDeep],
    ]), C.soot, 5);
    ellipse(ctx, -20, -24, 16, 10, -0.6);
    fill(ctx, 'rgba(255, 255, 255, 0.75)');
  },

  number_punches(ctx) {
    // A steel number punch, its head spread by the hammer, over the 17 it struck.
    const steel = linear(ctx, -50, 0, -10, 0, [
      [0, '#5d554c'],
      [0.35, '#f2ece0'],
      [0.65, '#bdb5a9'],
      [1, '#4c453e'],
    ]);
    rrect(ctx, -46, -66, 32, 86, 4);
    fill(ctx, steel, C.ironDeep, 3.5);
    ellipse(ctx, -30, -70, 24, 10);
    fill(ctx, '#d6cfc3', C.ironDeep, 3.5);
    ctx.beginPath();
    ctx.moveTo(-46, 20);
    ctx.lineTo(-14, 20);
    ctx.lineTo(-21, 42);
    ctx.lineTo(-39, 42);
    ctx.closePath();
    fill(ctx, '#8d857a', C.ironDeep, 3.5);
    seg(ctx, -38, -56, -38, 12, 'rgba(255, 252, 244, 0.7)', 3);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = typedFont(64);
    ctx.lineWidth = 6;
    ctx.strokeStyle = C.soot;
    ctx.strokeText('17', 34, 52);
    ctx.fillStyle = C.bone;
    ctx.fillText('17', 34, 52);
    for (const [a, b, c, d] of [[2, 16, 14, 26], [24, 0, 30, 14], [52, 4, 46, 16]]) seg(ctx, a, b, c, d, C.brassLight, 4);
  },

  chalk_stub(ctx) {
    // A worn stub of chalk, and the odd numbers it scrawled.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    scrawlText(ctx, '1 3 5', -2, -46, 46, C.boneDim);
    ctx.save();
    ctx.translate(4, 28);
    ctx.rotate(-0.4);
    ctx.beginPath();
    ctx.moveTo(-56, -19);
    ctx.lineTo(40, -19);
    ctx.lineTo(56, 19);
    ctx.lineTo(-56, 19);
    ctx.closePath();
    fill(ctx, linear(ctx, 0, -19, 0, 19, [
      [0, '#fffaf0'],
      [0.6, C.bone],
      [1, '#a89f8c'],
    ]), C.soot, 4);
    // The worn face, dusty.
    ellipse(ctx, -56, 0, 8, 19);
    fill(ctx, '#d8d0bf', C.soot, 3);
    seg(ctx, -44, -11, 34, -11, 'rgba(255, 255, 255, 0.8)', 3);
    ctx.restore();
  },

  wishbone(ctx) {
    // A wishbone, not yet pulled.
    const bone = new Path2D();
    bone.moveTo(-56, 70);
    bone.bezierCurveTo(-52, 20, -26, -30, 0, -50);
    bone.bezierCurveTo(26, -30, 52, 20, 56, 70);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = C.soot;
    ctx.lineWidth = 28;
    ctx.stroke(bone);
    ctx.strokeStyle = C.ivory;
    ctx.lineWidth = 21;
    ctx.stroke(bone);
    ellipse(ctx, 0, -56, 18, 13);
    fill(ctx, C.ivory, C.soot, 4);
    for (const s of [-1, 1]) {
      ellipse(ctx, s * 57, 72, 13, 9, s * 0.3);
      fill(ctx, C.ivory, C.soot, 4);
    }
    ctx.beginPath();
    ctx.moveTo(-44, 50);
    ctx.bezierCurveTo(-40, 14, -22, -22, -4, -38);
    ctx.strokeStyle = 'rgba(255, 252, 240, 0.85)';
    ctx.lineWidth = 4;
    ctx.stroke();
  },

  mirror_shard(ctx) {
    // A jagged shard of mirror, a red pocket caught in it.
    const shard = new Path2D();
    shard.moveTo(-12, -84);
    shard.lineTo(48, -30);
    shard.lineTo(30, 4);
    shard.lineTo(40, 76);
    shard.lineTo(-6, 46);
    shard.lineTo(-46, 62);
    shard.lineTo(-30, -6);
    shard.lineTo(-48, -30);
    shard.closePath();
    ctx.fillStyle = linear(ctx, -40, -80, 40, 80, [
      [0, '#f4f1ea'],
      [0.45, '#a7a299'],
      [1, '#4c4842'],
    ]);
    ctx.fill(shard);
    ctx.save();
    ctx.clip(shard);
    ctx.beginPath();
    ctx.moveTo(-40, 30);
    ctx.lineTo(10, 10);
    ctx.lineTo(20, 60);
    ctx.lineTo(-30, 80);
    ctx.closePath();
    fill(ctx, C.bloodDeep);
    seg(ctx, -30, -40, 30, -70, 'rgba(255, 255, 255, 0.85)', 7);
    seg(ctx, -36, -20, 40, -56, 'rgba(255, 255, 255, 0.5)', 3);
    ctx.restore();
    ctx.lineJoin = 'miter';
    ctx.strokeStyle = C.bone;
    ctx.lineWidth = 3.5;
    ctx.stroke(shard);
  },

  hourglass(ctx) {
    // Brass and glass, the sand half run.
    const glass = new Path2D();
    glass.moveTo(-34, -64);
    glass.lineTo(34, -64);
    glass.bezierCurveTo(36, -28, 10, -12, 6, 0);
    glass.bezierCurveTo(10, 12, 36, 28, 34, 64);
    glass.lineTo(-34, 64);
    glass.bezierCurveTo(-36, 28, -10, 12, -6, 0);
    glass.bezierCurveTo(-10, -12, -36, -28, -34, -64);
    glass.closePath();
    for (const x of [-44, 44]) {
      rrect(ctx, x - 5, -70, 10, 140, 3);
      fill(ctx, C.woodDeep, C.soot, 2.5);
    }
    ctx.fillStyle = 'rgba(236, 227, 207, 0.22)';
    ctx.fill(glass);
    ctx.save();
    ctx.clip(glass);
    ctx.fillStyle = linear(ctx, 0, -40, 0, 64, [
      [0, '#f6c35a'],
      [1, C.amberDeep],
    ]);
    ctx.fillRect(-40, -26, 80, 26);
    ctx.beginPath();
    ctx.moveTo(-36, 64);
    ctx.lineTo(0, 30);
    ctx.lineTo(36, 64);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    seg(ctx, 0, 0, 0, 34, C.amber, 3);
    ctx.strokeStyle = C.bone;
    ctx.lineWidth = 3.5;
    ctx.stroke(glass);
    seg(ctx, -22, -54, -12, -24, 'rgba(255, 255, 255, 0.7)', 3);
    for (const y of [-80, 66]) {
      rrect(ctx, -54, y, 108, 14, 4);
      fill(ctx, brassFill(ctx, y, y + 14), C.brassDeep, 3);
    }
  },

  saints_medal(ctx) {
    // An oval brass medal on a red ribbon, a haloed saint in relief.
    for (const s of [-1, 1]) {
      band(ctx, s * 6, -86, s * 22, -40, 24, 0);
      fill(ctx, s < 0 ? C.bloodDeep : C.blood, '#4a080c', 3);
    }
    circle(ctx, 0, -46, 9);
    ctx.strokeStyle = C.brass;
    ctx.lineWidth = 5;
    ctx.stroke();
    ellipse(ctx, 0, 12, 52, 62);
    fill(ctx, radial(ctx, -18, -10, 4, 0, 12, 64, [
      [0, C.brassLight],
      [0.6, C.brass],
      [1, C.brassDeep],
    ]), C.brassDeep, 4);
    ellipse(ctx, 0, 12, 43, 53);
    ctx.strokeStyle = C.brassDeep;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // The halo, the head, the shoulders.
    circle(ctx, 0, -10, 20);
    ctx.strokeStyle = C.brassLight;
    ctx.lineWidth = 4;
    ctx.stroke();
    circle(ctx, 0, -8, 12);
    fill(ctx, C.brassDeep);
    ctx.beginPath();
    ctx.moveTo(-30, 54);
    ctx.bezierCurveTo(-28, 16, 28, 16, 30, 54);
    ctx.closePath();
    fill(ctx, C.brassDeep);
  },

  fortune_cookie(ctx) {
    // A folded cookie, its slip poking out with tonight's number.
    ctx.save();
    ctx.translate(8, 30);
    ctx.rotate(0.28);
    rrect(ctx, -10, -15, 70, 30, 3);
    fill(ctx, C.paper, C.paperShade, 2.5);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = typedFont(26);
    ctx.fillStyle = C.bloodDeep;
    ctx.fillText('23', 38, 1);
    ctx.restore();
    const cookie = new Path2D();
    cookie.moveTo(-74, 8);
    cookie.bezierCurveTo(-66, -60, 52, -64, 66, -2);
    cookie.bezierCurveTo(44, 24, 16, 8, 4, 34);
    cookie.bezierCurveTo(-12, 8, -46, 30, -74, 8);
    cookie.closePath();
    ctx.fillStyle = linear(ctx, 0, -60, 0, 34, [
      [0, '#f6c35a'],
      [0.6, C.amber],
      [1, C.amberDeep],
    ]);
    ctx.fill(cookie);
    ctx.strokeStyle = C.amberDeep;
    ctx.lineWidth = 3.5;
    ctx.stroke(cookie);
    // The fold's crease.
    ctx.beginPath();
    ctx.moveTo(4, 34);
    ctx.bezierCurveTo(0, 0, -4, -20, -10, -46);
    ctx.strokeStyle = C.amberDeep;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-54, -14);
    ctx.bezierCurveTo(-44, -40, -20, -48, 0, -48);
    ctx.strokeStyle = 'rgba(255, 240, 200, 0.7)';
    ctx.lineWidth = 4;
    ctx.stroke();
  },

  ivory_ball(ctx) {
    // Two ivory balls, the second a little behind the first.
    const ball = (x, y, rad, dim) => {
      circle(ctx, x, y, rad);
      fill(ctx, radial(ctx, x - rad * 0.4, y - rad * 0.45, 3, x, y, rad, [
        [0, dim ? '#d8ceb8' : '#fffaf0'],
        [0.6, dim ? '#b4a88f' : '#e6dcc6'],
        [1, dim ? '#6b5f4c' : '#8f8068'],
      ]), C.soot, 4);
      ellipse(ctx, x - rad * 0.38, y - rad * 0.45, rad * 0.28, rad * 0.16, -0.6);
      fill(ctx, `rgba(255, 255, 255, ${dim ? 0.4 : 0.75})`);
    };
    ctx.beginPath();
    ctx.arc(-14, 18, 74, -2.4, -1.1);
    ctx.strokeStyle = 'rgba(237, 229, 211, 0.45)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.stroke();
    ball(30, -24, 38, true);
    ball(-16, 20, 52, false);
  },

  gilders_knife(ctx) {
    // A gilder's knife, gold leaf lifting off its blade.
    ctx.save();
    ctx.rotate(-0.72);
    rrect(ctx, -86, -13, 62, 26, 9);
    fill(ctx, linear(ctx, 0, -13, 0, 13, [
      [0, '#9a5a2e'],
      [1, C.woodDeep],
    ]), C.soot, 3.5);
    rrect(ctx, -28, -11, 14, 22, 3);
    fill(ctx, brassFill(ctx, -11, 11), C.brassDeep, 2.5);
    ctx.beginPath();
    ctx.moveTo(-14, -6);
    ctx.lineTo(64, -12);
    ctx.quadraticCurveTo(90, 0, 64, 12);
    ctx.lineTo(-14, 6);
    ctx.closePath();
    fill(ctx, linear(ctx, 0, -12, 0, 12, [
      [0, '#f2ece0'],
      [0.5, '#bdb5a9'],
      [1, '#6e665d'],
    ]), C.ironDeep, 3);
    ctx.restore();
    // Leaves of gold.
    for (const [x, y, rot, w] of [[22, -64, 0.3, 30], [-6, -30, -0.5, 24], [44, -26, 0.9, 20]]) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.moveTo(-w / 2, -w / 2.6);
      ctx.lineTo(w / 2, -w / 3);
      ctx.lineTo(w / 2.2, w / 2.4);
      ctx.lineTo(-w / 2.4, w / 2.8);
      ctx.closePath();
      fill(ctx, brassFill(ctx, -w / 2, w / 2), C.brassDeep, 2);
      ctx.restore();
    }
  },

  snakeskin(ctx) {
    // A shed skin in an S, scaled in brass.
    const skin = new Path2D();
    skin.moveTo(-62, -58);
    skin.bezierCurveTo(30, -94, 76, -16, 2, -2);
    skin.bezierCurveTo(-72, 10, -40, 88, 56, 62);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = C.soot;
    ctx.lineWidth = 36;
    ctx.stroke(skin);
    ctx.strokeStyle = '#d9c99c';
    ctx.lineWidth = 29;
    ctx.stroke(skin);
    ctx.save();
    ctx.setLineDash([7, 7]);
    ctx.lineCap = 'butt';
    ctx.strokeStyle = C.brassDeep;
    ctx.lineWidth = 20;
    ctx.stroke(skin);
    ctx.lineDashOffset = 7;
    ctx.strokeStyle = C.brass;
    ctx.lineWidth = 9;
    ctx.stroke(skin);
    ctx.restore();
    ellipse(ctx, 62, 60, 19, 13, -0.3);
    fill(ctx, '#d9c99c', C.soot, 4);
    circle(ctx, 68, 55, 3.5);
    fill(ctx, C.blood);
  },

  croupiers_glove(ctx) {
    // A croupier's white glove, fingers together, with a red cuff.
    const parts = [
      () => rrect(ctx, -36, -14, 72, 64, 20),
      ...[-34, -16, 2, 20].map((x, i) => () => rrect(ctx, x, -70 + Math.abs(i - 1.5) * 8, 16, 66, 8)),
      () => {
        ctx.save();
        ctx.translate(-34, 18);
        ctx.rotate(-0.7);
        rrect(ctx, -9, -44, 18, 48, 9);
        ctx.restore();
      },
    ];
    for (const p of parts) {
      p();
      ctx.strokeStyle = C.soot;
      ctx.lineWidth = 8;
      ctx.stroke();
    }
    for (const p of parts) {
      p();
      ctx.fillStyle = C.bone;
      ctx.fill();
    }
    for (const x of [-18, 0, 18]) seg(ctx, x, -6, x * 0.8, 30, C.boneDim, 2.5);
    for (const x of [-17, 1, 19]) seg(ctx, x + 0.5, -54, x + 0.5, -8, 'rgba(179, 169, 147, 0.6)', 2);
    rrect(ctx, -40, 44, 80, 28, 6);
    fill(ctx, C.bloodDeep, C.soot, 4);
    ctx.setLineDash([5, 5]);
    seg(ctx, -32, 58, 32, 58, C.bone, 2);
    ctx.setLineDash([]);
  },

  table_map(ctx) {
    // A folded paper map of the table, a route pencilled in red.
    const panels = [-66, -22, 22];
    panels.forEach((x, i) => {
      ctx.beginPath();
      const skew = i % 2 ? 6 : -6;
      ctx.moveTo(x, -50 + skew);
      ctx.lineTo(x + 44, -50 - skew);
      ctx.lineTo(x + 44, 50 - skew);
      ctx.lineTo(x, 50 + skew);
      ctx.closePath();
      fill(ctx, i % 2 ? C.paperShade : C.paper, C.soot, 3.5);
    });
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 6; col++) {
        const n = col * 3 + (3 - row);
        rrect(ctx, -58 + col * 20, -34 + row * 22, 16, 18, 2);
        fill(ctx, [1, 3, 5, 7, 9, 12, 14, 16, 18].includes(n) ? C.bloodDeep : '#2a211c');
      }
    }
    ctx.setLineDash([6, 5]);
    line(ctx, [[-50, 30], [-22, 8], [6, 20], [44, -24]], C.blood, 4);
    ctx.setLineDash([]);
    circle(ctx, 44, -24, 7);
    ctx.strokeStyle = C.blood;
    ctx.lineWidth = 4;
    ctx.stroke();
  },

  metronome(ctx) {
    // A wooden metronome, its brass arm mid-swing.
    ctx.beginPath();
    ctx.moveTo(-48, 72);
    ctx.lineTo(48, 72);
    ctx.lineTo(18, -74);
    ctx.lineTo(-18, -74);
    ctx.closePath();
    fill(ctx, linear(ctx, -48, 0, 48, 0, [
      [0, C.woodDeep],
      [0.4, '#9a5a2e'],
      [1, '#3a1c0c'],
    ]), C.soot, 4);
    ctx.beginPath();
    ctx.moveTo(-26, 50);
    ctx.lineTo(26, 50);
    ctx.lineTo(10, -56);
    ctx.lineTo(-10, -56);
    ctx.closePath();
    fill(ctx, C.paper, C.paperShade, 2);
    for (let i = 0; i < 7; i++) seg(ctx, -4, -44 + i * 13, 4, -44 + i * 13, C.ink, 2);
    seg(ctx, 0, 56, 36, -78, C.soot, 10);
    seg(ctx, 0, 56, 36, -78, C.brassLight, 5);
    rrect(ctx, 14, -40, 18, 16, 3);
    fill(ctx, brassFill(ctx, -40, -24), C.brassDeep, 3);
    circle(ctx, 0, 56, 7);
    fill(ctx, C.brass, C.brassDeep, 2.5);
  },

  loaded_wheel(ctx) {
    // A little wheel whose red pockets have swollen wide.
    const n = 10;
    const redShare = 0.68;
    let a = -Math.PI / 2;
    for (let i = 0; i < n; i++) {
      const w = ((i % 2 ? 1 - redShare : redShare) * TAU) / (n / 2);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 66, a, a + w);
      ctx.closePath();
      fill(ctx, i % 2 ? '#1a1310' : C.blood, C.soot, 2);
      a += w;
    }
    circle(ctx, 0, 0, 66);
    ctx.strokeStyle = C.brass;
    ctx.lineWidth = 10;
    ctx.stroke();
    circle(ctx, 0, 0, 22);
    fill(ctx, brassFill(ctx, -22, 22), C.brassDeep, 3);
    seg(ctx, -14, 0, 14, 0, C.brassDeep, 4);
    seg(ctx, 0, -14, 0, 14, C.brassDeep, 4);
    // A lead weight sunk in the rim.
    circle(ctx, 0, 66, 11);
    fill(ctx, '#5a5650', C.soot, 3);
  },

  rose_brooch(ctx) {
    // A red rose set in a beaded brass brooch.
    circle(ctx, 0, 0, 66);
    fill(ctx, brassFill(ctx, -66, 66), C.brassDeep, 3);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      circle(ctx, Math.cos(a) * 60, Math.sin(a) * 60, 4.5);
      fill(ctx, C.brassLight, C.brassDeep, 1.5);
    }
    circle(ctx, 0, 0, 48);
    fill(ctx, radial(ctx, -10, -12, 2, 0, 0, 50, [
      [0, C.blood],
      [1, '#4a080c'],
    ]), C.soot, 3);
    ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const r0 = 40 - i * 8;
      ctx.beginPath();
      ctx.arc(i * 1.5, i * 1.2, r0, 0.4 + i * 1.3, 0.4 + i * 1.3 + 3.6);
      ctx.strokeStyle = i % 2 ? '#ff6b6b' : '#4a080c';
      ctx.lineWidth = 4.5;
      ctx.stroke();
    }
  },

  surveyors_chain(ctx) {
    // A surveyor's chain: brass links, a handle and a tally tag.
    const links = 7;
    for (let i = 0; i < links; i++) {
      const t = i / (links - 1);
      const x = -62 + t * 124;
      const y = Math.sin(t * Math.PI * 1.4 + 0.6) * 34;
      const next = Math.sin((t + 0.05) * Math.PI * 1.4 + 0.6) * 34;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(next - y, 6.2));
      rrect(ctx, -14, i % 2 ? -5 : -9, 28, i % 2 ? 10 : 18, 8);
      ctx.strokeStyle = C.soot;
      ctx.lineWidth = 10;
      ctx.stroke();
      ctx.strokeStyle = i % 2 ? C.brass : C.brassLight;
      ctx.lineWidth = 5.5;
      ctx.stroke();
      ctx.restore();
    }
    // The handle at one end.
    ellipse(ctx, -74, -30, 16, 24, 0.4);
    ctx.strokeStyle = C.soot;
    ctx.lineWidth = 12;
    ctx.stroke();
    ctx.strokeStyle = C.brass;
    ctx.lineWidth = 7;
    ctx.stroke();
    // A tally tag.
    ctx.beginPath();
    ctx.moveTo(-2, 30);
    ctx.lineTo(18, 30);
    ctx.lineTo(8, 64);
    ctx.closePath();
    fill(ctx, brassFill(ctx, 30, 64), C.brassDeep, 3);
  },

  tally_stick(ctx) {
    // A split tally stick, notched in fives.
    ctx.save();
    ctx.rotate(-0.55);
    rrect(ctx, -84, -16, 168, 32, 7);
    fill(ctx, linear(ctx, 0, -16, 0, 16, [
      [0, '#c08a55'],
      [0.5, '#8a5a2e'],
      [1, C.woodDeep],
    ]), C.soot, 4);
    seg(ctx, -76, 6, 76, 6, 'rgba(40, 18, 8, 0.5)', 2);
    for (let i = 0; i < 9; i++) {
      const x = -66 + i * 15 + Math.floor(i / 5) * 8;
      ctx.beginPath();
      ctx.moveTo(x - 5, -16);
      ctx.lineTo(x, -2);
      ctx.lineTo(x + 5, -16);
      ctx.closePath();
      fill(ctx, '#2a140a');
    }
    seg(ctx, -72, -6, -6, -18, C.bone, 3);
    ctx.restore();
  },

  hot_coals(ctx) {
    // A heap of coals, cracked through with fire.
    ctx.fillStyle = radial(ctx, 0, 30, 4, 0, 30, 90, [
      [0, 'rgba(235, 162, 50, 0.5)'],
      [1, 'rgba(235, 162, 50, 0)'],
    ]);
    ctx.fillRect(-100, -60, 200, 160);
    for (const [x, y, s] of [[0, -40, 1], [-26, -52, 0.7], [24, -48, 0.8]]) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(s, s);
      ctx.beginPath();
      ctx.moveTo(-14, 30);
      ctx.bezierCurveTo(-26, 0, 0, -10, 2, -36);
      ctx.bezierCurveTo(16, -10, 26, 6, 14, 30);
      ctx.closePath();
      fill(ctx, C.blood);
      ctx.restore();
    }
    const lumps = [[-40, 40, 30], [6, 48, 32], [44, 36, 26], [-14, 12, 28], [26, 6, 24]];
    for (const [x, y, rad] of lumps) {
      ctx.beginPath();
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TAU;
        const d = rad * (0.82 + ((i * 37 + x) % 5) * 0.05);
        ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * d, y + Math.sin(a) * d * 0.8);
      }
      ctx.closePath();
      fill(ctx, '#1d1411', C.soot, 3);
      line(ctx, [[x - rad * 0.5, y - 2], [x - 4, y + 4], [x + rad * 0.2, y - 8], [x + rad * 0.55, y]], C.amber, 4);
    }
  },

  green_thread(ctx) {
    // A wooden spool wound with baize-green thread, a needle through it.
    rrect(ctx, -34, -44, 68, 88, 4);
    fill(ctx, '#2d5a38', C.soot, 4);
    for (let y = -40; y < 44; y += 6) seg(ctx, -32, y, 32, y + 3, 'rgba(120, 170, 120, 0.55)', 2);
    for (const y of [-56, 56]) {
      ellipse(ctx, 0, y, 52, 13);
      fill(ctx, linear(ctx, 0, y - 13, 0, y + 13, [
        [0, '#c08a55'],
        [1, C.woodDeep],
      ]), C.soot, 3.5);
    }
    ellipse(ctx, 0, -56, 9, 3);
    fill(ctx, C.soot);
    ctx.beginPath();
    ctx.moveTo(32, 10);
    ctx.bezierCurveTo(60, 20, 76, -10, 62, -40);
    ctx.strokeStyle = '#2d5a38';
    ctx.lineWidth = 4;
    ctx.stroke();
    seg(ctx, 40, -76, 78, 26, C.soot, 8);
    seg(ctx, 40, -76, 78, 26, '#d6cfc3', 4);
    ellipse(ctx, 44, -66, 2.5, 6, -0.36);
    fill(ctx, C.soot);
  },

  zeros_coin(ctx) {
    // A worn brass coin struck with a zero.
    circle(ctx, 0, 0, 64);
    fill(ctx, radial(ctx, -20, -24, 4, 0, 0, 66, [
      [0, C.brassLight],
      [0.6, C.brass],
      [1, C.brassDeep],
    ]), C.soot, 5);
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU;
      seg(ctx, Math.cos(a) * 58, Math.sin(a) * 58, Math.cos(a) * 63, Math.sin(a) * 63, C.brassDeep, 2);
    }
    circle(ctx, 0, 0, 50);
    ctx.strokeStyle = C.brassDeep;
    ctx.lineWidth = 3;
    ctx.stroke();
    ellipse(ctx, 0, 4, 22, 32);
    ctx.strokeStyle = C.brassDeep;
    ctx.lineWidth = 14;
    ctx.stroke();
    ellipse(ctx, -2, 2, 22, 32);
    ctx.strokeStyle = C.brassLight;
    ctx.lineWidth = 7;
    ctx.stroke();
  },

  marble(ctx) {
    // A glass marble with a red twist at its heart.
    circle(ctx, 0, 0, 62);
    fill(ctx, radial(ctx, -22, -24, 4, 0, 0, 64, [
      [0, 'rgba(250, 246, 236, 0.95)'],
      [0.6, 'rgba(190, 182, 166, 0.92)'],
      [1, 'rgba(90, 84, 74, 0.95)'],
    ]), C.soot, 5);
    ctx.save();
    ctx.rotate(0.5);
    for (const [c, w] of [[C.bloodDeep, 64], [C.blood, 40]]) {
      ctx.beginPath();
      ctx.moveTo(-54, 0);
      ctx.bezierCurveTo(-20, -w, 20, w, 54, 0);
      ctx.bezierCurveTo(20, -w * 0.2, -20, w * 0.2, -54, 0);
      ctx.closePath();
      fill(ctx, c);
    }
    ctx.restore();
    ellipse(ctx, -24, -28, 16, 9, -0.6);
    fill(ctx, 'rgba(255, 255, 255, 0.85)');
  },

  jugglers_ball(ctx) {
    // A juggler's ball in red and bone panels, tossed up.
    ctx.setLineDash([4, 8]);
    ctx.beginPath();
    ctx.arc(0, 40, 80, -2.6, -0.5);
    ctx.strokeStyle = 'rgba(237, 229, 211, 0.5)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.setLineDash([]);
    circle(ctx, 0, 6, 56);
    fill(ctx, C.blood, C.soot, 5);
    ctx.save();
    circle(ctx, 0, 6, 54);
    ctx.clip();
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * 8, -56);
      ctx.bezierCurveTo(s * 50, -20, s * 50, 30, s * 8, 66);
      ctx.bezierCurveTo(s * 30, 30, s * 30, -20, s * 8, -56);
      ctx.closePath();
      fill(ctx, C.bone, C.soot, 3);
    }
    ctx.restore();
    ellipse(ctx, -22, -18, 12, 7, -0.6);
    fill(ctx, 'rgba(255, 230, 220, 0.6)');
  },

  bag_of_marbles(ctx) {
    // A drawstring bag, marbles spilling from it.
    ctx.beginPath();
    ctx.moveTo(-20, -48);
    ctx.bezierCurveTo(-74, -20, -70, 52, -20, 56);
    ctx.lineTo(30, 56);
    ctx.bezierCurveTo(70, 50, 66, -20, 20, -48);
    ctx.closePath();
    fill(ctx, linear(ctx, -60, 0, 60, 0, [
      [0, '#6a4a2a'],
      [0.45, '#a07a4a'],
      [1, '#4a3018'],
    ]), C.soot, 4);
    for (let i = 0; i < 6; i++) seg(ctx, -40 + i * 14, -20, -46 + i * 16, 50, 'rgba(40, 24, 10, 0.35)', 2);
    ctx.beginPath();
    ctx.moveTo(-20, -48);
    ctx.lineTo(-30, -74);
    ctx.lineTo(30, -74);
    ctx.lineTo(20, -48);
    ctx.closePath();
    fill(ctx, '#8a643a', C.soot, 3.5);
    seg(ctx, -24, -50, 24, -50, C.brass, 6);
    for (const [x, y, c] of [[46, 64, C.blood], [70, 44, C.ivory], [26, 76, C.brass]]) {
      circle(ctx, x, y, 13);
      fill(ctx, c, C.soot, 3);
      circle(ctx, x - 4, y - 5, 3.5);
      fill(ctx, 'rgba(255, 255, 255, 0.75)');
    }
  },

  usurers_seal(ctx) {
    // A blob of oxblood wax stamped with the usurer's per cent.
    band(ctx, -10, 30, -40, 84, 20, 8);
    fill(ctx, C.ironDeep, C.soot, 3);
    band(ctx, 10, 30, 36, 86, 20, 8);
    fill(ctx, '#5d554c', C.soot, 3);
    ctx.beginPath();
    for (let i = 0; i <= 18; i++) {
      const a = (i / 18) * TAU;
      const d = 58 + (i % 3 === 0 ? 7 : i % 2 ? -2 : 3);
      ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * d, -6 + Math.sin(a) * d);
    }
    ctx.closePath();
    fill(ctx, radial(ctx, -16, -24, 4, 0, -6, 64, [
      [0, C.blood],
      [0.6, C.bloodDeep],
      [1, '#4a080c'],
    ]), '#2a0406', 4);
    circle(ctx, 0, -6, 40);
    ctx.strokeStyle = '#4a080c';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = typedFont(52);
    ctx.fillStyle = '#4a080c';
    ctx.fillText('%', 2, -2);
    ctx.fillStyle = 'rgba(255, 120, 110, 0.5)';
    ctx.fillText('%', 0, -5);
  },

  brimstone(ctx) {
    // A jagged lump of sulphur, the Devil's own fire licking off it.
    for (const [x, s] of [[-18, 0.8], [8, 1.1], [32, 0.7]]) {
      ctx.save();
      ctx.translate(x, -24);
      ctx.scale(s, s);
      ctx.beginPath();
      ctx.moveTo(-16, 30);
      ctx.bezierCurveTo(-28, 0, -2, -14, 0, -46);
      ctx.bezierCurveTo(18, -14, 28, 4, 16, 30);
      ctx.closePath();
      fill(ctx, C.blood);
      ctx.beginPath();
      ctx.moveTo(-8, 30);
      ctx.bezierCurveTo(-12, 10, 0, 0, 0, -20);
      ctx.bezierCurveTo(10, 0, 14, 14, 8, 30);
      ctx.closePath();
      fill(ctx, C.amber);
      ctx.restore();
    }
    ctx.beginPath();
    const pts = [[-62, 30], [-40, -2], [-10, 6], [18, -10], [56, 8], [66, 44], [30, 70], [-30, 68]];
    pts.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](x, y));
    ctx.closePath();
    fill(ctx, linear(ctx, 0, -10, 0, 70, [
      [0, '#f2df6a'],
      [0.55, '#c9a42a'],
      [1, '#6e5410'],
    ]), C.soot, 4);
    line(ctx, [[-40, -2], [-18, 40], [-30, 68]], '#8a6a14', 3);
    line(ctx, [[18, -10], [8, 34], [30, 70]], '#8a6a14', 3);
    line(ctx, [[8, 34], [66, 44]], '#8a6a14', 3);
  },

  // ---- The builds pass (doc 6.8) ----

  kindling(ctx) {
    // A bundle of split sticks, tied with twine, a small flame at the top.
    flame(ctx, 0, -18, 0.8);
    for (const [x, a] of [[-26, -0.5], [0, 0], [26, 0.5], [-12, -0.22], [12, 0.22]]) {
      ctx.save();
      ctx.translate(x * 0.7, 30);
      ctx.rotate(a * 0.45);
      rrect(ctx, -9, -56, 18, 98, 6);
      fill(ctx, linear(ctx, -9, 0, 9, 0, [
        [0, C.woodDeep],
        [0.5, '#a8683a'],
        [1, '#3a1c0c'],
      ]), C.soot, 4);
      ctx.restore();
    }
    rrect(ctx, -40, 34, 80, 12, 4);
    fill(ctx, C.paperShade, C.soot, 3);
  },

  funeral_urn(ctx) {
    // A brass urn with two handles and a lid.
    ctx.beginPath();
    ctx.moveTo(-24, -44);
    ctx.bezierCurveTo(-64, -20, -60, 40, -26, 58);
    ctx.lineTo(26, 58);
    ctx.bezierCurveTo(60, 40, 64, -20, 24, -44);
    ctx.closePath();
    fill(ctx, brassFill(ctx, -44, 58), C.soot, 5);
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(sx * 50, -16, 16, sx > 0 ? -1.6 : 1.6 - Math.PI, sx > 0 ? 1.2 : Math.PI - 1.2, sx < 0);
      ctx.strokeStyle = C.soot;
      ctx.lineWidth = 11;
      ctx.stroke();
      ctx.strokeStyle = C.brass;
      ctx.lineWidth = 5;
      ctx.stroke();
    }
    rrect(ctx, -30, 58, 60, 14, 4);
    fill(ctx, C.brassDeep, C.soot, 4);
    rrect(ctx, -28, -58, 56, 16, 6);
    fill(ctx, C.brass, C.soot, 4);
    circle(ctx, 0, -66, 8);
    fill(ctx, C.brassLight, C.soot, 3);
    seg(ctx, -44, 8, 44, 8, C.brassDeep, 4);
  },

  phoenix_feather(ctx) {
    // A long flame-coloured feather, its tip burning.
    ctx.save();
    ctx.rotate(0.55);
    ctx.beginPath();
    ctx.moveTo(0, 74);
    ctx.bezierCurveTo(-36, 30, -34, -40, 0, -80);
    ctx.bezierCurveTo(34, -40, 36, 30, 0, 74);
    ctx.closePath();
    fill(ctx, linear(ctx, 0, 74, 0, -80, [
      [0, C.bloodDeep],
      [0.45, C.blood],
      [0.8, C.amber],
      [1, '#ffe08a'],
    ]), C.soot, 4);
    for (let i = 0; i < 6; i++) {
      const y = 50 - i * 20;
      seg(ctx, 0, y, -26 + i * 2, y - 14, 'rgba(5, 4, 4, 0.45)', 2.5);
      seg(ctx, 0, y, 26 - i * 2, y - 14, 'rgba(5, 4, 4, 0.45)', 2.5);
    }
    seg(ctx, 0, 92, 0, -70, C.soot, 7);
    seg(ctx, 0, 92, 0, -70, C.bone, 3);
    ctx.restore();
  },

  the_pyre(ctx) {
    // Logs stacked crosswise, a tall fire roaring off them.
    flame(ctx, 0, -6, 1.7);
    for (const [y, a] of [[40, 0.18], [40, -0.18], [56, 0]]) {
      ctx.save();
      ctx.translate(0, y);
      ctx.rotate(a);
      rrect(ctx, -66, -10, 132, 20, 10);
      fill(ctx, linear(ctx, 0, -10, 0, 10, [
        [0, '#a8683a'],
        [1, C.woodDeep],
      ]), C.soot, 4);
      for (const sx of [-1, 1]) {
        circle(ctx, sx * 60, 0, 7);
        fill(ctx, '#c88a52', C.woodDeep, 2);
      }
      ctx.restore();
    }
  },

  pair_of_dice(ctx) {
    // Two bone dice, one tipped behind the other.
    const die = (x, y, a, pips) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      rrect(ctx, -32, -32, 64, 64, 12);
      fill(ctx, linear(ctx, -32, -32, 32, 32, [
        [0, C.bone],
        [1, C.boneDim],
      ]), C.soot, 5);
      for (const [px, py] of pips) {
        circle(ctx, px * 18, py * 18, 7);
        fill(ctx, C.bloodDeep);
      }
      ctx.restore();
    };
    die(26, -24, 0.35, [[-1, -1], [0, 0], [1, 1]]);
    die(-24, 26, -0.2, [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]]);
  },

  savings_book(ctx) {
    // A bank passbook in oxblood cloth, a brass coin on its cover.
    rrect(ctx, -54, -66, 108, 132, 8);
    fill(ctx, linear(ctx, -54, 0, 54, 0, [
      [0, C.bloodDeep],
      [0.6, '#a81c24'],
      [1, '#5a0a10'],
    ]), C.soot, 5);
    seg(ctx, -42, -66, -42, 66, '#4a080c', 5);
    rrect(ctx, -26, -50, 66, 18, 3);
    fill(ctx, C.paper, C.soot, 2.5);
    for (let i = 0; i < 3; i++) seg(ctx, -20, -44 + i * 4 + 2, 34 - i * 10, -44 + i * 4 + 2, C.ink, 1.6);
    circle(ctx, 8, 18, 30);
    fill(ctx, brassFill(ctx, -12, 48), C.soot, 4);
    circle(ctx, 8, 18, 21);
    ctx.strokeStyle = C.brassDeep;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = typedFont(30);
    ctx.fillStyle = C.brassDeep;
    ctx.fillText('%', 8, 20);
  },

  gold_tooth(ctx) {
    // A gold molar, its roots forked.
    ctx.beginPath();
    ctx.moveTo(-52, -46);
    ctx.bezierCurveTo(-60, -76, -20, -78, 0, -62);
    ctx.bezierCurveTo(20, -78, 60, -76, 52, -46);
    ctx.bezierCurveTo(48, -6, 44, 20, 34, 64);
    ctx.bezierCurveTo(26, 78, 14, 70, 12, 48);
    ctx.bezierCurveTo(8, 22, -8, 22, -12, 48);
    ctx.bezierCurveTo(-14, 70, -26, 78, -34, 64);
    ctx.bezierCurveTo(-44, 20, -48, -6, -52, -46);
    ctx.closePath();
    fill(ctx, linear(ctx, -50, -70, 40, 60, [
      [0, '#fff0b0'],
      [0.35, C.brassLight],
      [0.7, C.brass],
      [1, C.brassDeep],
    ]), C.soot, 5);
    line(ctx, [[-30, -48], [-14, -40], [0, -50], [14, -40], [30, -48]], C.brassDeep, 3);
    ellipse(ctx, -24, -30, 9, 16, 0.3);
    fill(ctx, 'rgba(255, 250, 225, 0.7)');
  },

  pocket_calendar(ctx) {
    // A tear-off calendar leaf, one day ringed in red.
    rrect(ctx, -56, -66, 112, 132, 6);
    fill(ctx, C.paper, C.soot, 5);
    rrect(ctx, -56, -66, 112, 32, 6);
    fill(ctx, C.bloodDeep);
    for (const x of [-30, 0, 30]) {
      circle(ctx, x, -66, 6);
      fill(ctx, C.brass, C.soot, 2.5);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = typedFont(64);
    ctx.fillStyle = C.ink;
    ctx.fillText('7', 0, 14);
    ellipse(ctx, 0, 14, 36, 34, -0.15);
    ctx.strokeStyle = C.blood;
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.setLineDash([3, 4]);
    seg(ctx, -50, 54, 50, 54, C.paperShade, 2);
    ctx.setLineDash([]);
  },

  hand_bell(ctx) {
    // A small brass hand bell on a turned wooden handle.
    rrect(ctx, -11, -84, 22, 46, 10);
    fill(ctx, linear(ctx, -11, 0, 11, 0, [
      [0, C.woodDeep],
      [0.5, '#a8683a'],
      [1, '#3a1c0c'],
    ]), C.soot, 4);
    ctx.beginPath();
    ctx.moveTo(-22, -40);
    ctx.bezierCurveTo(-30, -10, -40, 30, -64, 46);
    ctx.lineTo(64, 46);
    ctx.bezierCurveTo(40, 30, 30, -10, 22, -40);
    ctx.closePath();
    fill(ctx, brassFill(ctx, -40, 46), C.soot, 5);
    ellipse(ctx, 0, 46, 64, 12);
    fill(ctx, C.brassDeep, C.soot, 4);
    circle(ctx, 0, 62, 11);
    fill(ctx, C.brass, C.soot, 4);
    seg(ctx, -14, -28, -30, 30, 'rgba(255, 240, 200, 0.55)', 5);
  },

  racing_form(ctx) {
    // A folded racing paper, a runner ringed in red.
    ctx.save();
    ctx.rotate(-0.12);
    rrect(ctx, -60, -70, 120, 140, 4);
    fill(ctx, C.paper, C.soot, 5);
    rrect(ctx, -60, -70, 120, 30, 4);
    fill(ctx, C.ink);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = typedFont(22);
    ctx.fillStyle = C.paper;
    ctx.fillText('FORM', 0, -55);
    for (let i = 0; i < 5; i++) {
      const y = -24 + i * 20;
      seg(ctx, -48, y, -36, y, C.ink, 5);
      seg(ctx, -28, y, 44 - (i % 2) * 18, y, C.paperShade, 4);
    }
    ellipse(ctx, 0, 16, 56, 14, -0.04);
    ctx.strokeStyle = C.blood;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.restore();
  },

  raven_feather(ctx) {
    // A black raven's feather, its sheen blue-violet.
    ctx.save();
    ctx.rotate(-0.55);
    ctx.beginPath();
    ctx.moveTo(0, 74);
    ctx.bezierCurveTo(-34, 26, -30, -44, 0, -82);
    ctx.bezierCurveTo(30, -44, 32, 26, 0, 74);
    ctx.closePath();
    fill(ctx, linear(ctx, -30, 0, 30, 0, [
      [0, '#121018'],
      [0.45, '#3a3550'],
      [0.6, '#1c1a26'],
      [1, '#08070b'],
    ]), C.boneDim, 4);
    for (let i = 0; i < 6; i++) {
      const y = 50 - i * 20;
      seg(ctx, 0, y, -24 + i * 2, y - 16, 'rgba(120, 112, 160, 0.4)', 2.5);
      seg(ctx, 0, y, 24 - i * 2, y - 16, 'rgba(120, 112, 160, 0.4)', 2.5);
    }
    seg(ctx, 0, 92, 0, -72, C.bone, 3.5);
    ctx.restore();
  },

  // ---- The weak builds' multipliers (decision 33) ----

  tote_board(ctx) {
    // A racecourse tote board: three lit rows of odds in a brass frame.
    rrect(ctx, -70, -56, 140, 112, 8);
    fill(ctx, brassFill(ctx, -56, 56), C.soot, 5);
    rrect(ctx, -60, -46, 120, 92, 4);
    fill(ctx, '#15100e');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = typedFont(30);
    [['2', '3', '4'], ['×', '×', '×'], ['3', '3', '3']].forEach((row, r) => {
      row.forEach((t, c) => {
        ctx.fillStyle = r === 1 ? C.boneDim : r === 2 ? C.amber : C.bone;
        ctx.fillText(t, -36 + c * 36, -24 + r * 26);
      });
    });
    circle(ctx, 0, 66, 8);
    fill(ctx, C.blood, C.soot, 3);
  },

  carillon(ctx) {
    // Three brass bells of falling size hung from one beam.
    rrect(ctx, -74, -70, 148, 14, 4);
    fill(ctx, linear(ctx, 0, -70, 0, -56, [
      [0, '#a8683a'],
      [1, C.woodDeep],
    ]), C.soot, 4);
    for (const [x, sz] of [[-44, 0.8], [6, 1.05], [52, 0.65]]) {
      seg(ctx, x, -56, x, -44, C.soot, 4);
      ctx.save();
      ctx.translate(x, -44);
      ctx.scale(sz, sz);
      ctx.beginPath();
      ctx.moveTo(-12, 0);
      ctx.bezierCurveTo(-18, 22, -22, 50, -38, 62);
      ctx.lineTo(38, 62);
      ctx.bezierCurveTo(22, 50, 18, 22, 12, 0);
      ctx.closePath();
      fill(ctx, brassFill(ctx, 0, 62), C.soot, 5);
      ellipse(ctx, 0, 62, 38, 7);
      fill(ctx, C.brassDeep, C.soot, 3);
      circle(ctx, 0, 72, 7);
      fill(ctx, C.brass, C.soot, 3);
      ctx.restore();
    }
  },

  patience_jar(ctx) {
    // A glass jar, sealed, a heap of brass coins rising inside (green is the House's).
    rrect(ctx, -34, -78, 68, 16, 4);
    fill(ctx, C.brass, C.soot, 4);
    ctx.beginPath();
    ctx.moveTo(-30, -62);
    ctx.lineTo(-48, -40);
    ctx.lineTo(-48, 62);
    ctx.quadraticCurveTo(-48, 74, -36, 74);
    ctx.lineTo(36, 74);
    ctx.quadraticCurveTo(48, 74, 48, 62);
    ctx.lineTo(48, -40);
    ctx.lineTo(30, -62);
    ctx.closePath();
    fill(ctx, 'rgba(215, 205, 190, 0.16)', C.soot, 5);
    for (let i = 0; i < 5; i++) {
      ellipse(ctx, (i % 2 ? 8 : -8), 60 - i * 15, 30, 9);
      fill(ctx, i % 2 ? C.brassDeep : C.brass, C.soot, 3);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = typedFont(26);
    ctx.fillStyle = C.bone;
    ctx.fillText('0', 0, -10);
    seg(ctx, -38, -36, -38, 50, 'rgba(255, 255, 255, 0.35)', 5);
  },

  grandfather_clock(ctx) {
    // A tall clock case, its brass pendulum swinging below the dial.
    rrect(ctx, -34, -82, 68, 164, 8);
    fill(ctx, linear(ctx, -34, 0, 34, 0, [
      [0, C.woodDeep],
      [0.45, '#9a5a2e'],
      [1, '#3a1c0c'],
    ]), C.soot, 5);
    circle(ctx, 0, -46, 26);
    fill(ctx, C.paper, C.brass, 5);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      seg(ctx, Math.cos(a) * 18, -46 + Math.sin(a) * 18, Math.cos(a) * 22, -46 + Math.sin(a) * 22, C.ink, 2.5);
    }
    seg(ctx, 0, -46, 0, -62, C.ink, 4);
    seg(ctx, 0, -46, 12, -40, C.ink, 4);
    rrect(ctx, -20, -10, 40, 82, 4);
    fill(ctx, '#1a0d06', C.soot, 3);
    seg(ctx, 0, -8, 10, 46, C.brassLight, 3.5);
    circle(ctx, 10, 50, 10);
    fill(ctx, brassFill(ctx, 40, 60), C.brassDeep, 3);
  },
};

/** A tongue of fire rising from (x, y), for the Pyre's curios. */
function flame(ctx, x, y, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size, size);
  ctx.beginPath();
  ctx.moveTo(-24, 22);
  ctx.bezierCurveTo(-40, -6, -6, -18, 0, -48);
  ctx.bezierCurveTo(10, -20, 40, -8, 24, 22);
  ctx.closePath();
  fill(ctx, C.blood, C.soot, 3);
  ctx.beginPath();
  ctx.moveTo(-12, 22);
  ctx.bezierCurveTo(-18, 2, -2, -6, 0, -26);
  ctx.bezierCurveTo(8, -6, 20, 4, 12, 22);
  ctx.closePath();
  fill(ctx, C.amber);
  ctx.restore();
}

// Anything without a painter yet (a content id from a later phase): a plain
// charm with a scrawled question mark, so it still reads as a talisman.
function paintUnknown(ctx) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  scrawlText(ctx, '?', 2, 8, 112, C.bone);
}

// Warm light some curios throw onto the enamel around them.
const GLOWS = {
  matchbook: { x: 43, y: -52, r: 52, color: 'rgba(235, 162, 50, 0.32)' },
  the_pyre: { x: 0, y: -30, r: 70, color: 'rgba(235, 162, 50, 0.3)' },
  kindling: { x: 0, y: -40, r: 44, color: 'rgba(235, 162, 50, 0.28)' },
};

// ---- Ink treatment ------------------------------------------------------------------

/** Ragged paint edges: every pixel sampled from a gently wandering offset. */
function roughen(canvas, seed, amp) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  const src = ctx.getImageData(0, 0, w, h);
  const out = ctx.createImageData(w, h);
  const cell = w / 46;
  const gw = Math.ceil(w / cell) + 2;
  const r = rng(seed);
  const gx = new Float32Array(gw * gw);
  const gy = new Float32Array(gw * gw);
  for (let i = 0; i < gx.length; i++) {
    gx[i] = r() * 2 - 1;
    gy[i] = r() * 2 - 1;
  }
  const s = src.data;
  const o = out.data;
  for (let y = 0; y < h; y++) {
    const fy = y / cell;
    const iy = fy | 0;
    let ty = fy - iy;
    ty = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < w; x++) {
      const fx = x / cell;
      const ix = fx | 0;
      let tx = fx - ix;
      tx = tx * tx * (3 - 2 * tx);
      const i0 = iy * gw + ix;
      const i1 = i0 + gw;
      const dx = (gx[i0] + (gx[i0 + 1] - gx[i0]) * tx) * (1 - ty) + (gx[i1] + (gx[i1 + 1] - gx[i1]) * tx) * ty;
      const dy = (gy[i0] + (gy[i0 + 1] - gy[i0]) * tx) * (1 - ty) + (gy[i1] + (gy[i1 + 1] - gy[i1]) * tx) * ty;
      const px = Math.min(w - 1, Math.max(0, Math.round(x + dx * amp)));
      const py = Math.min(h - 1, Math.max(0, Math.round(y + dy * amp)));
      const si = (py * w + px) * 4;
      const di = (y * w + x) * 4;
      o[di] = s[si];
      o[di + 1] = s[si + 1];
      o[di + 2] = s[si + 2];
      o[di + 3] = s[si + 3];
    }
  }
  ctx.putImageData(out, 0, 0);
}

/** Dry-brush streaks lifted out of the paint, all running one way. */
function dryBrush(canvas, seed, angle) {
  const ctx = canvas.getContext('2d');
  const r = rng(seed);
  const w = canvas.width;
  const k = w / 512;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'destination-out';
  // Light enough that the silhouette stays solid when the face is shrunk.
  for (let i = 0; i < 50; i++) {
    ctx.globalAlpha = 0.08 + r() * 0.22;
    ctx.save();
    ctx.translate(r() * w, r() * w);
    ctx.rotate(angle + (r() - 0.5) * 0.12);
    ctx.fillRect(0, 0, (16 + r() * 60) * k, (0.7 + r() * 1.2) * k);
    ctx.restore();
  }
  ctx.restore();
}

function makeCanvas(size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  return canvas;
}

/** The curio alone, on a transparent layer, inked. */
function paintCurio(id, size, seed, reflected) {
  const layer = makeCanvas(size);
  const ctx = layer.getContext('2d', { willReadFrequently: true });
  const k = size / 200;
  ctx.setTransform(k, 0, 0, k, size / 2, size / 2);
  // A mirror shows it backwards, lettering and all.
  if (reflected) ctx.scale(-1, 1);
  (PAINTERS[id] ?? paintUnknown)(ctx, rng(seed));
  roughen(layer, seed + 7, size * 0.0065);
  dryBrush(layer, seed + 11, -0.5 + (seed % 7) * 0.12);
  return layer;
}

/** The curio's silhouette in one flat colour. */
function silhouette(curio, color) {
  const out = makeCanvas(curio.width);
  const ctx = out.getContext('2d');
  ctx.drawImage(curio, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, out.width, out.height);
  return out;
}

/** Enamel: warm black, lighter where the lamp would catch it. */
function paintEnamel(ctx, r) {
  ctx.fillStyle = radial(ctx, -26, -30, 6, 0, 0, 104, [
    [0, '#33251d'],
    [0.6, '#1b1310'],
    [1, '#0b0807'],
  ]);
  ctx.fillRect(-100, -100, 200, 200);
  for (let i = 0; i < 160; i++) {
    ctx.fillStyle = r() < 0.5 ? `rgba(237, 229, 211, ${r() * 0.04})` : `rgba(0, 0, 0, ${r() * 0.25})`;
    const a = r() * TAU;
    const d = Math.sqrt(r()) * 96;
    ctx.fillRect(Math.cos(a) * d, Math.sin(a) * d, 0.8 + r() * 3, 0.8 + r() * 3);
  }
}

/** Cursed enamel: green-black, as if something had grown in it. */
function paintCursedEnamel(ctx, r) {
  ctx.fillStyle = radial(ctx, -26, -30, 6, 0, 0, 104, [
    [0, '#1d3325'],
    [0.6, '#0e1a13'],
    [1, '#050806'],
  ]);
  ctx.fillRect(-100, -100, 200, 200);
  for (let i = 0; i < 160; i++) {
    ctx.fillStyle = r() < 0.5 ? `rgba(69, 194, 122, ${r() * 0.06})` : `rgba(0, 0, 0, ${r() * 0.3})`;
    const a = r() * TAU;
    const d = Math.sqrt(r()) * 96;
    ctx.fillRect(Math.cos(a) * d, Math.sin(a) * d, 0.8 + r() * 3, 0.8 + r() * 3);
  }
}

/**
 * Silvered glass: what Twin Mirrors shows when it copies. The only face that
 * is not dark enamel, so a copy reads as a reflection even when the curio is
 * too small to make out.
 */
function paintSilver(ctx, r) {
  ctx.fillStyle = radial(ctx, -30, -36, 4, 0, 0, 104, [
    [0, '#c9c4b9'],
    [0.5, '#8c877e'],
    [1, '#3a3733'],
  ]);
  ctx.fillRect(-100, -100, 200, 200);
  // Foxing: the silvering gone dark in spots, as old mirrors do.
  for (let i = 0; i < 26; i++) {
    const a = r() * TAU;
    const d = 40 + Math.sqrt(r()) * 56;
    ellipse(ctx, Math.cos(a) * d, Math.sin(a) * d, 2 + r() * 6, 1.5 + r() * 4, a);
    fill(ctx, `rgba(40, 34, 28, ${0.12 + r() * 0.2})`);
  }
}

/**
 * Paint a talisman's face (the enamel disc and its curio) into a size × size
 * context. Transparent outside the disc. `reflected` paints it as Twin Mirrors
 * shows it: mirrored, on silvered glass, behind a glint.
 */
export function paintTalismanFace(ctx, id, size, { reflected = false } = {}) {
  const seed = seedOf(id);
  const r = rng(seed + 3);
  const k = size / 200;
  ctx.save();
  // Relative to the caller's transform, so a face can be painted into part of
  // a larger canvas (a price tag, a note).
  const base = ctx.getTransform();
  ctx.translate(size / 2, size / 2);
  ctx.scale(k, k);
  circle(ctx, 0, 0, 100);
  ctx.clip();

  const cursed = !!getTalisman(id)?.cursed;
  if (reflected) paintSilver(ctx, r);
  else if (cursed) paintCursedEnamel(ctx, r);
  else paintEnamel(ctx, r);
  circle(ctx, 0, 0, 90);
  ctx.strokeStyle = reflected ? 'rgba(255, 252, 244, 0.9)' : cursed ? 'rgba(69, 194, 122, 0.7)' : 'rgba(237, 229, 211, 0.85)';
  ctx.lineWidth = 2.6;
  ctx.stroke();
  circle(ctx, 0, 0, 85.5);
  ctx.strokeStyle = reflected ? 'rgba(30, 26, 22, 0.4)' : 'rgba(179, 169, 147, 0.28)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  const glow = GLOWS[id];
  if (glow) {
    const gx = reflected ? -glow.x : glow.x;
    ctx.fillStyle = radial(ctx, gx, glow.y, 0, gx, glow.y, glow.r, [
      [0, glow.color],
      [1, 'rgba(235, 162, 50, 0)'],
    ]);
    ctx.fillRect(-100, -100, 200, 200);
  }

  // The curio, inside a soot keyline and over its own shadow, so it stands off
  // the enamel (and the silver) at any size.
  const curio = paintCurio(id, size, seed, reflected);
  const soot = silhouette(curio, 'rgba(2, 1, 1, 1)');
  const keyW = Math.max(1, size * (reflected ? 0.011 : 0.006));
  ctx.save();
  ctx.setTransform(base);
  ctx.filter = `blur(${Math.max(1, size * 0.005)}px)`;
  ctx.globalAlpha = reflected ? 0.9 : 0.85;
  ctx.drawImage(soot, size * 0.01, size * 0.014);
  ctx.filter = 'none';
  ctx.globalAlpha = reflected ? 1 : 0.8;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    ctx.drawImage(soot, Math.cos(a) * keyW, Math.sin(a) * keyW);
  }
  ctx.globalAlpha = 1;
  ctx.drawImage(curio, 0, 0);
  ctx.restore();

  // Wear: a few scratches through the enamel and the paint alike.
  ctx.globalAlpha = 0.22;
  for (let i = 0; i < 4; i++) {
    const a = r() * TAU;
    const d = 30 + r() * 50;
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d;
    const b = a + Math.PI / 2 + (r() - 0.5) * 0.8;
    const len = 14 + r() * 26;
    paintScratch(ctx, x, y, x + Math.cos(b) * len, y + Math.sin(b) * len, 1.4 + r(), seed + i * 17, C.boneDim, { bow: 0.04 });
  }
  ctx.globalAlpha = 1;
  // Chips in the enamel at the edge, showing the brass underneath.
  for (let i = 0; i < 3; i++) {
    const a = r() * TAU;
    const d = 93 + r() * 5;
    ellipse(ctx, Math.cos(a) * d, Math.sin(a) * d, 2 + r() * 3, 1.2 + r() * 2, a);
    fill(ctx, 'rgba(196, 154, 82, 0.7)');
  }

  if (reflected) {
    // The glass over the reflection: two bright slants and a dimmer one.
    ctx.save();
    ctx.rotate(0.62);
    for (const [x, w, a] of [
      [-44, 20, 0.2],
      [-16, 7, 0.3],
      [40, 11, 0.12],
    ]) {
      ctx.fillStyle = `rgba(255, 253, 248, ${a})`;
      ctx.fillRect(x, -110, w, 220);
    }
    ctx.restore();
  }
  ctx.restore();
}

const faces = new Map();

/** A talisman's face as a texture, painted once and shared. */
export function talismanFaceTexture(id, { reflected = false } = {}) {
  const key = reflected ? `${id}:mirror` : id;
  let tex = faces.get(key);
  if (tex) return tex;
  const canvas = makeCanvas(FACE_PX);
  paintTalismanFace(canvas.getContext('2d'), id, FACE_PX, { reflected });
  tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  faces.set(key, tex);
  return tex;
}

// ---- The charm ------------------------------------------------------------------------

const FACE_R = 0.0274; // the enamel, inside the bezel
const FACE_Z = 0.0024;
const RING = { r: 0.0052, tube: 0.0013 };
const DISC_Y = -0.0432; // disc centre below the hang point
const REST_GLOW = 0.1; // enough for a face to read at the edge of the lamp's pool
const FLASH_GLOW = 1.25; // the face at a trigger's peak: past the bloom threshold, still legible
const HALO_SIZE = 0.12; // the flash's halo, across (the disc is 0.064)
// An engraving (doc 6.4) shows as a band of its own metal round the bezel,
// with a slow glint: gold for Gilt, green-black for Cursed.
const ENGRAVING_METAL = {
  gilt: 0xe0b44c,
  keen: 0xa9c8dc,
  sharp: 0xd4d8de,
  echo: 0xc07a46,
  restless: 0x7cc79a,
  thrifty: 0xa8864f,
  cursed: 0x2c5a3c,
};

let shared = null;
function geometries() {
  if (shared) return shared;
  // The disc body and bezel in one lathe: a raised lip round a recessed face,
  // a rounded edge, a flat brass back. Profile runs back to front so the
  // normals face out.
  const R = CHARM.radius;
  const H = CHARM.depth / 2;
  const profile = [
    [0, -H],
    [R - 0.0035, -H],
    [R - 0.0009, -H + 0.0007],
    [R, -H + 0.0018],
    [R, H - 0.0016],
    [R - 0.0012, H - 0.0003],
    [R - 0.0026, H],
    [FACE_R + 0.0006, H - 0.0006],
    [FACE_R - 0.0002, FACE_Z],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const body = new THREE.LatheGeometry(profile, 56);
  body.rotateX(Math.PI / 2);
  body.translate(0, DISC_Y, 0);
  const face = new THREE.CircleGeometry(FACE_R, 56);
  face.translate(0, DISC_Y, FACE_Z);
  const ring = new THREE.TorusGeometry(RING.r, RING.tube, 8, 24);
  ring.translate(0, -(RING.r + RING.tube), 0);
  // The lug the ring passes through, on the disc's top edge.
  const lug = new THREE.CylinderGeometry(0.0031, 0.0031, 0.0046, 16);
  lug.rotateX(Math.PI / 2);
  lug.translate(0, DISC_Y + CHARM.radius + 0.0009, 0);
  shared = { body, face, ring, lug, halo: haloTexture() };
  return shared;
}

/** A soft warm disc for the flash: bright just outside the bezel, gone by the edge. */
function haloTexture() {
  const canvas = makeCanvas(128);
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255, 255, 255, 1)');
  g.addColorStop(0.5, 'rgba(255, 255, 255, 0.85)');
  g.addColorStop(0.62, 'rgba(255, 255, 255, 0.4)');
  g.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function defaultBrass() {
  return new THREE.MeshStandardMaterial({ color: 0xc39a5c, metalness: 1, roughness: 0.3 });
}

// Twin Mirrors' bezel while it shows a copy: the brass gone to silver.
const SILVER = new THREE.Color(0xd9d6cf);
// A cursed charm's bezel: blackened iron, and its flash burns green.
const IRON = new THREE.Color(0x3b3a36);

/**
 * A talisman as a hanging charm. The group's origin is the hang point (the
 * top of the ring); the disc hangs below it with its face toward +z.
 *
 *   userData.setGlow(x)   0 at rest, 1 for a trigger's flash
 *   userData.setFace(id)  show another talisman's face (Twin Mirrors' copy)
 *   userData.setDim(on)   darken by about 30% (a Twin Mirrors with nothing to copy)
 */
export function buildTalismanMesh(id, { brass } = {}) {
  const geo = geometries();
  const group = new THREE.Group();
  group.name = `talisman:${id}`;

  // Each charm owns its brass and enamel so it can flash on its own.
  const cursed = !!getTalisman(id)?.cursed;
  const rim = (brass ?? defaultBrass()).clone();
  if (cursed) {
    rim.color.copy(IRON);
    rim.roughness = 0.55;
  }
  rim.emissive = new THREE.Color(cursed ? 0x45c27a : 0xffb46a);
  rim.emissiveIntensity = 0;
  const rimColor = rim.color.clone();
  const tex = talismanFaceTexture(id);
  const enamel = new THREE.MeshPhysicalMaterial({
    map: tex,
    emissive: 0xffffff,
    emissiveMap: tex,
    emissiveIntensity: REST_GLOW,
    roughness: 0.5,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.16,
    envMap: rim.envMap ?? null,
    envMapIntensity: 0.45,
  });

  const parts = [
    new THREE.Mesh(geo.body, rim),
    new THREE.Mesh(geo.face, enamel),
    new THREE.Mesh(geo.ring, rim),
    new THREE.Mesh(geo.lug, rim),
  ];
  for (const mesh of parts) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.role = 'talisman-mesh';
    group.add(mesh);
  }

  // The flash's halo: behind the disc, so only a ring of light shows round
  // the bezel. Added on top of the scene and bright enough to bloom. Not a
  // mesh, and never hit by the pointer.
  const haloMat = new THREE.SpriteMaterial({
    map: geo.halo,
    color: 0xffb060,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const halo = new THREE.Sprite(haloMat);
  halo.scale.setScalar(HALO_SIZE);
  halo.position.set(0, DISC_Y, -CHARM.depth);
  halo.visible = false;
  halo.raycast = () => {};
  group.add(halo);

  let glow = 0;
  let dim = false;
  let faceId = id;
  let band = null;
  const applyGlow = () => {
    enamel.emissiveIntensity = (dim ? 0 : REST_GLOW) + glow * FLASH_GLOW;
    rim.emissiveIntensity = glow * 0.9;
    halo.visible = glow > 0.01;
    haloMat.opacity = Math.min(1, glow) * 0.85;
    if (cursed) haloMat.color.setRGB(0.4, 1.5, 0.75).multiplyScalar(0.6 + Math.min(1, glow) * 0.6);
    else haloMat.color.setRGB(1.5, 0.82, 0.32).multiplyScalar(0.6 + Math.min(1, glow) * 0.6);
  };
  const applyLook = () => {
    rim.color.copy(rimColor);
    if (faceId !== id) rim.color.lerp(SILVER, 0.7);
    if (dim) rim.color.multiplyScalar(0.7);
    enamel.color.setScalar(dim ? 0.68 : 1);
  };

  group.userData = {
    id,
    setGlow(x) {
      glow = Math.max(0, Math.min(1.5, x || 0));
      applyGlow();
    },
    setFace(next) {
      const want = next ?? id;
      if (want === faceId) return;
      faceId = want;
      const t = talismanFaceTexture(want, { reflected: want !== id });
      enamel.map = t;
      enamel.emissiveMap = t;
      applyLook();
    },
    setDim(on) {
      dim = !!on;
      applyLook();
      applyGlow();
    },
    /** The engraving's band round the bezel (null takes it off). */
    setEngraving(engraving) {
      if (!engraving) {
        if (band) band.visible = false;
        return;
      }
      if (!band) {
        band = new THREE.Mesh(
          new THREE.TorusGeometry(CHARM.radius + 0.004, 0.0034, 6, 40),
          new THREE.MeshStandardMaterial({ metalness: 0.7, roughness: 0.3, emissiveIntensity: 0.7 }),
        );
        band.position.set(0, DISC_Y, CHARM.depth * 0.6);
        group.add(band);
      }
      const color = ENGRAVING_METAL[engraving] ?? ENGRAVING_METAL.gilt;
      band.material.color.setHex(color);
      band.material.emissive.setHex(color);
      band.visible = true;
    },
    /** Release this charm's own materials (textures and geometry are shared). */
    dispose() {
      rim.dispose();
      enamel.dispose();
      haloMat.dispose();
      band?.geometry.dispose();
      band?.material.dispose();
    },
  };
  return group;
}
