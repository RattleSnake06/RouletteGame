import * as THREE from 'three';
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
// the real thing. No green anywhere: green belongs to the House.

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
};

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

  if (reflected) paintSilver(ctx, r);
  else paintEnamel(ctx, r);
  circle(ctx, 0, 0, 90);
  ctx.strokeStyle = reflected ? 'rgba(255, 252, 244, 0.9)' : 'rgba(237, 229, 211, 0.85)';
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
  const rim = (brass ?? defaultBrass()).clone();
  rim.emissive = new THREE.Color(0xffb46a);
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
  const applyGlow = () => {
    enamel.emissiveIntensity = (dim ? 0 : REST_GLOW) + glow * FLASH_GLOW;
    rim.emissiveIntensity = glow * 0.9;
    halo.visible = glow > 0.01;
    haloMat.opacity = Math.min(1, glow) * 0.85;
    haloMat.color.setRGB(1.5, 0.82, 0.32).multiplyScalar(0.6 + Math.min(1, glow) * 0.6);
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
    /** Release this charm's own materials (textures and geometry are shared). */
    dispose() {
      rim.dispose();
      enamel.dispose();
      haloMat.dispose();
    },
  };
  return group;
}
