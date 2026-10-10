import * as THREE from 'three';
import { rng, seedOf } from '../ui/marks.js';
import { INK, paintScratch, scrawlText, typedFont } from './ink.js';

// What the talismans look like (design doc 5.8, 8.5). Every talisman is a
// charm: a brass-rimmed enamel disc with its curio painted on the face in the
// HUD's ink, hanging from a ring. One builder serves the rail and the Curio
// Cabinet, so a talisman looks the same in the shop and on the hook.
//
// Faces are painted on canvas (no image files). A charm is only 40-60 px tall
// at the table, so each curio is one bold silhouette in bone, brass or red on
// dark enamel; the detail is for the Cabinet's close look. No green anywhere:
// green belongs to the House.

/** Charm size in metres: the disc's outer radius and its thickness. */
export const CHARM = { radius: 0.032, depth: 0.008 };

const TAU = Math.PI * 2;
const FACE_PX = 512;

// The palette beyond the HUD's ink: mahogany, brass, ivory, oxblood, copper.
const C = {
  ...INK,
  paper: '#ece3cf',
  paperShade: '#b4a68a',
  manila: '#d9bb83',
  manilaDeep: '#8f6e3a',
  ivory: '#e9dcbf',
  brassLight: '#f0d494',
  brassDeep: '#6a4a1f',
  copper: '#de8748',
  copperLight: '#ffc995',
  copperDeep: '#7a3818',
  iron: '#aaa298',
  ironDeep: '#3f3934',
  wood: '#b06a34',
  woodDeep: '#4e2611',
  amber: '#eba232',
  amberDeep: '#7c3a0c',
  ink: '#1d1310',
  porcelain: '#efe5cf',
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
// Each painter draws one curio centred on (0, 0), inside a radius of about 80.
// `r` is a seeded random stream, so a face always comes out the same.

const PAINTERS = {
  red_ribbon(ctx) {
    // Tails first, so the bow sits over them.
    for (const [bx, by, color] of [
      [-40, 70, C.bloodDeep],
      [38, 72, C.blood],
    ]) {
      band(ctx, bx * 0.08, -2, bx, by, 23, 10);
      fill(ctx, color, '#4a080c', 2.5);
    }
    for (const s of [-1, 1]) {
      const loop = new Path2D();
      loop.moveTo(0, -8);
      loop.bezierCurveTo(s * -32, -70, s * -86, -56, s * -72, -14);
      loop.bezierCurveTo(s * -62, 16, s * -26, 10, 0, -8);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#4a080c';
      ctx.lineWidth = 22;
      ctx.stroke(loop);
      ctx.strokeStyle = C.bloodDeep;
      ctx.lineWidth = 18;
      ctx.stroke(loop);
      ctx.save();
      ctx.translate(s * 1.5, -2.5);
      ctx.strokeStyle = C.blood;
      ctx.lineWidth = 12;
      ctx.stroke(loop);
      ctx.restore();
      // Light catching the outer edge of each loop.
      ctx.beginPath();
      ctx.moveTo(s * -14, -38);
      ctx.bezierCurveTo(s * -36, -66, s * -78, -58, s * -78, -26);
      ctx.strokeStyle = 'rgba(255, 214, 200, 0.75)';
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    rrect(ctx, -14, -25, 28, 32, 8);
    fill(ctx, C.blood, '#4a080c', 3);
    seg(ctx, -7, -19, -5, 0, 'rgba(255, 214, 200, 0.7)', 2.6);
  },

  horseshoe(ctx) {
    // Open end up, so the luck stays in.
    const cx = 0;
    const cy = 6;
    const rx = 44;
    const ry = 52;
    const a0 = -Math.PI * 0.34;
    const a1 = Math.PI * 1.34;
    const arc = () => {
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, a0, a1);
    };
    ctx.lineCap = 'butt';
    arc();
    ctx.strokeStyle = C.ironDeep;
    ctx.lineWidth = 32;
    ctx.stroke();
    arc();
    ctx.strokeStyle = linear(ctx, -50, -50, 50, 60, [
      [0, '#d6cfc3'],
      [0.5, C.iron],
      [1, '#6e665d'],
    ]);
    ctx.lineWidth = 27;
    ctx.stroke();
    // The fuller: the groove the nails sit in.
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, a0 + 0.16, a1 - 0.16);
    ctx.strokeStyle = '#5d554c';
    ctx.lineWidth = 7;
    ctx.stroke();
    for (const deg of [-30, 6, 42, 138, 174, 210]) {
      const a = (deg * Math.PI) / 180;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
      ctx.rotate(a);
      rrect(ctx, -5, -3.2, 10, 6.4, 1.5);
      fill(ctx, C.soot);
      ctx.restore();
    }
    // Calkins: the heels at the two tips.
    for (const a of [a0, a1]) {
      ctx.save();
      ctx.translate(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
      ctx.rotate(a + Math.PI / 2);
      rrect(ctx, -17, -4, 34, 9, 2);
      fill(ctx, '#7b736a', C.ironDeep, 2.5);
      ctx.restore();
    }
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx + 11, ry + 11, 0, Math.PI * 0.82, Math.PI * 1.28);
    ctx.strokeStyle = 'rgba(245, 238, 225, 0.8)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();
  },

  matchbook(ctx) {
    // An open book of matches with its cover folded back, and one match torn
    // out and struck. The card behind the comb keeps it from reading as candles.
    ctx.save();
    ctx.translate(-12, 8);
    ctx.rotate(-0.08);
    rrect(ctx, -44, -50, 80, 70, 4);
    fill(ctx, linear(ctx, 0, -50, 0, 20, [
      [0, '#d9ccb0'],
      [1, '#a3967b'],
    ]), '#3a2e22', 3);
    ctx.strokeStyle = C.blood;
    ctx.lineWidth = 2.4;
    ctx.strokeRect(-38, -44, 68, 58);
    rrect(ctx, -40, -2, 72, 16, 2);
    fill(ctx, '#8f8166');
    for (let i = 0; i < 6; i++) {
      const x = -32 + i * 12;
      if (i === 4) continue; // the one that was torn out
      rrect(ctx, x - 3, -22, 6, 26, 1.2);
      fill(ctx, '#e9dcbc', '#5a4a36', 1.4);
      ellipse(ctx, x, -25, 5.6, 7.4);
      fill(ctx, C.blood, '#4a080c', 1.8);
    }
    rrect(ctx, -46, 12, 84, 44, 4);
    fill(ctx, linear(ctx, 0, 12, 0, 56, [
      [0, '#ea3a42'],
      [1, '#a3151c'],
    ]), '#4a080c', 3);
    rrect(ctx, -46, 44, 84, 10, 2);
    fill(ctx, '#2c0e0c');
    ctx.fillStyle = 'rgba(179, 169, 147, 0.55)';
    for (let i = 0; i < 36; i++) ctx.fillRect(-43 + ((i * 37) % 78), 46 + ((i * 7) % 6), 1.6, 1.6);
    seg(ctx, -38, 21, 30, 21, 'rgba(237, 229, 211, 0.9)', 2.4);
    rrect(ctx, -10, 26, 6, 4, 1);
    fill(ctx, C.boneDim);
    ctx.restore();
    // The struck match, held across the book.
    ctx.save();
    ctx.translate(30, -22);
    ctx.rotate(0.5);
    rrect(ctx, -3.5, 0, 7, 70, 1.5);
    fill(ctx, '#efe2c2', '#3a2e22', 1.8);
    ellipse(ctx, 0, -2, 6.5, 8.5);
    fill(ctx, '#2a1210', C.soot, 2);
    ctx.restore();
    const flame = (s) => {
      ctx.beginPath();
      ctx.moveTo(28, -24);
      ctx.bezierCurveTo(28 - 22 * s, -32, 26 - 8 * s, -56, 36, -70 + (1 - s) * 16);
      ctx.bezierCurveTo(36 + 10 * s, -54, 30 + 24 * s, -36, 28, -24);
      ctx.closePath();
    };
    flame(1);
    fill(ctx, C.blood);
    flame(0.7);
    fill(ctx, C.amber);
    flame(0.36);
    fill(ctx, '#fff4d6');
  },

  lucky_penny(ctx) {
    // A copper cash coin, tipped toward the light: thick edge, raised rim,
    // a square hole punched through the middle.
    ctx.save();
    ctx.rotate(-0.22);
    const rx = 62;
    const ry = 54;
    ellipse(ctx, 0, 10, rx, ry);
    fill(ctx, C.copperDeep, '#2e1408', 3);
    ctx.strokeStyle = 'rgba(40, 16, 6, 0.6)';
    ctx.lineWidth = 1.6;
    for (let i = 0; i <= 24; i++) {
      // Milling on the edge.
      const a = Math.PI * (0.04 + (0.92 * i) / 24);
      const x = Math.cos(a) * rx;
      const y = Math.sin(a) * ry;
      ctx.beginPath();
      ctx.moveTo(x, y + 1);
      ctx.lineTo(x, y + 9);
      ctx.stroke();
    }
    ellipse(ctx, 0, 0, rx, ry);
    fill(ctx, linear(ctx, -40, -50, 40, 50, [
      [0, C.copperLight],
      [0.5, C.copper],
      [1, '#9a4c22'],
    ]), '#3a1a0a', 2.5);
    ellipse(ctx, 0, 0, rx - 7, ry - 6);
    ctx.strokeStyle = 'rgba(80, 34, 12, 0.9)';
    ctx.lineWidth = 2.6;
    ctx.stroke();
    ellipse(ctx, 0, 0, rx - 9.5, ry - 8.5);
    ctx.fillStyle = linear(ctx, -40, -40, 40, 40, [
      [0, '#efa064'],
      [1, '#a85226'],
    ]);
    ctx.fill();
    ctx.save();
    ctx.scale(1, ry / rx);
    ctx.strokeStyle = 'rgba(90, 38, 14, 0.85)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      // Four struck characters round the hole, like old cash.
      ctx.save();
      ctx.rotate((i * TAU) / 4);
      ctx.beginPath();
      ctx.moveTo(-6, -38);
      ctx.lineTo(6, -38);
      ctx.moveTo(0, -44);
      ctx.lineTo(0, -32);
      ctx.stroke();
      ctx.restore();
    }
    rrect(ctx, -21, -21, 42, 42, 2);
    ctx.lineWidth = 4;
    ctx.stroke();
    punch(ctx, () => rrect(ctx, -16, -16, 32, 32, 1.5));
    // The far wall of the hole, catching the light.
    ctx.fillStyle = C.copperDeep;
    ctx.fillRect(-16, -16, 32, 6);
    ctx.restore();
    ctx.beginPath();
    ctx.ellipse(0, 0, rx - 3, ry - 3, 0, Math.PI * 1.0, Math.PI * 1.55);
    ctx.strokeStyle = 'rgba(255, 240, 220, 0.9)';
    ctx.lineWidth = 3.4;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  },

  crumpled_receipt(ctx, r) {
    ctx.save();
    ctx.rotate(-0.2);
    const top = -66;
    const bot = 64;
    const half = 31;
    const pts = [];
    for (let x = -half; x <= half; x += 6.2) pts.push([x, top - ((x / 6.2) & 1 ? 6 : 0)]);
    for (let y = top + 10; y < bot; y += 13) pts.push([half + (r() - 0.5) * 7 - (y > 0 && y < 20 ? 5 : 0), y]);
    for (let x = half; x >= -half; x -= 6.2) pts.push([x, bot + ((x / 6.2) & 1 ? 6 : 0)]);
    for (let y = bot - 10; y > top; y -= 13) pts.push([-half + (r() - 0.5) * 7 + (y < -20 && y > -40 ? 5 : 0), y]);
    const outline = new Path2D();
    pts.forEach(([x, y], i) => (i ? outline.lineTo(x, y) : outline.moveTo(x, y)));
    outline.closePath();
    ctx.fillStyle = C.paper;
    ctx.fill(outline);
    ctx.save();
    ctx.clip(outline);
    // Crumple facets: shaded planes between creases.
    const facets = [
      [[-40, -30], [40, -52], [40, -10], [-40, 6], 'rgba(110, 92, 62, 0.28)'],
      [[-40, 20], [40, 2], [40, 30], [-40, 44], 'rgba(255, 252, 240, 0.4)'],
      [[-40, 44], [40, 30], [40, 80], [-40, 80], 'rgba(110, 92, 62, 0.22)'],
    ];
    for (const [a, b, c, d, color] of facets) {
      ctx.beginPath();
      ctx.moveTo(...a);
      ctx.lineTo(...b);
      ctx.lineTo(...c);
      ctx.lineTo(...d);
      ctx.fillStyle = color;
      ctx.fill();
    }
    for (const seg of [
      [[-34, -30], [34, -52]],
      [[-34, 6], [34, -10]],
      [[-34, 44], [34, 30]],
      [[-10, -70], [6, 70]],
    ]) {
      line(ctx, seg, 'rgba(120, 100, 70, 0.6)', 1.4);
    }
    // Typed lines: words and prices.
    ctx.fillStyle = 'rgba(30, 20, 16, 0.82)';
    const rows = [-50, -40, -30, -20, -10, 0];
    rows.forEach((y, i) => {
      const w = 12 + r() * 16;
      ctx.fillRect(-23, y - (i * 1.8) / 3, w, 3.6);
      ctx.fillRect(10, y - (i * 1.8) / 3 - 1.5, 12, 3.6);
    });
    ctx.setLineDash([3, 3]);
    line(ctx, [[-24, 13], [24, 9]], 'rgba(30, 20, 16, 0.7)', 1.6, 'butt');
    ctx.setLineDash([]);
    ctx.fillRect(-23, 22, 18, 5);
    ctx.fillStyle = C.bloodDeep;
    ctx.fillRect(4, 20, 18, 6);
    ctx.restore();
    ctx.strokeStyle = 'rgba(90, 74, 52, 0.9)';
    ctx.lineWidth = 1.6;
    ctx.stroke(outline);
    // A red ring round the total, the way you'd mark what you owe.
    ctx.beginPath();
    ctx.ellipse(13, 23, 17, 10, -0.15, 0.3, TAU + 0.6);
    ctx.strokeStyle = C.blood;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  },

  pawn_ticket(ctx) {
    ctx.save();
    ctx.rotate(0.16);
    // The string, out through the punched hole.
    ctx.beginPath();
    ctx.moveTo(-52, 0);
    ctx.bezierCurveTo(-74, -6, -82, -30, -66, -44);
    ctx.bezierCurveTo(-56, -52, -40, -48, -38, -60);
    ctx.strokeStyle = C.boneDim;
    ctx.lineWidth = 3;
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
      [0, '#e6cc96'],
      [1, '#c19b5c'],
    ]), C.manilaDeep, 2.5);
    ctx.strokeStyle = C.bloodDeep;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(-28, -28, 86, 56);
    ctx.fillStyle = C.ink;
    ctx.font = typedFont(15);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('No.', -24, -16);
    ctx.fillRect(-24, 18, 32, 2.4);
    ctx.textAlign = 'center';
    scrawlText(ctx, '13', 20, 6, 44, C.blood, { maxWidth: 70 });
    for (let y = -32; y <= 32; y += 6.4) punch(ctx, () => circle(ctx, -36, y, 1.7));
    circle(ctx, -52, 0, 10.5);
    ctx.strokeStyle = C.manilaDeep;
    ctx.lineWidth = 3;
    ctx.stroke();
    punch(ctx, () => circle(ctx, -52, 0, 6.5));
    // The string, back over the card and through the hole.
    ctx.beginPath();
    ctx.moveTo(-52, 4);
    ctx.quadraticCurveTo(-60, 2, -62, -6);
    ctx.strokeStyle = C.boneDim;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  },

  brass_knuckles(ctx) {
    ctx.save();
    ctx.rotate(-0.08);
    const xs = [-45, -15, 15, 45];
    const yR = -14;
    const shape = (extra) => {
      ctx.lineWidth = 18 + extra;
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
    ctx.fillStyle = ctx.strokeStyle = brassFill(ctx, -34, 46);
    shape(0);
    for (const x of xs) {
      circle(ctx, x, yR, 12);
      ctx.strokeStyle = C.brassDeep;
      ctx.lineWidth = 3;
      ctx.stroke();
      punch(ctx, () => circle(ctx, x, yR, 10.5));
      ctx.beginPath();
      ctx.arc(x, yR, 15.5, Math.PI * 1.1, Math.PI * 1.7);
      ctx.strokeStyle = 'rgba(255, 244, 214, 0.85)';
      ctx.lineWidth = 2.4;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-40, 26);
    ctx.bezierCurveTo(-24, 42, 24, 42, 40, 26);
    ctx.strokeStyle = 'rgba(255, 244, 214, 0.6)';
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.restore();
  },

  croupiers_rake(ctx) {
    // A long stick with a wide flat blade, and the chips it pulls in.
    for (const [y, face, rim] of [
      [54, C.blood, C.bone],
      [44, C.ivory, C.bloodDeep],
      [34, C.blood, C.bone],
    ]) {
      ellipse(ctx, 40, y + 4, 20, 9.5);
      fill(ctx, '#2a0a0a');
      ellipse(ctx, 40, y, 20, 9.5);
      fill(ctx, face, '#2a0a0a', 2);
      ctx.setLineDash([3.6, 3.8]);
      ellipse(ctx, 40, y, 13.5, 6);
      ctx.strokeStyle = rim;
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const a = [-66, 50];
    const e = [24, -34];
    ctx.lineCap = 'round';
    line(ctx, [a, e], C.woodDeep, 14);
    line(ctx, [a, e], linear(ctx, -66, 50, 24, -34, [
      [0, '#9a5428'],
      [1, '#d48e50'],
    ]), 10);
    seg(ctx, a[0] - 1, a[1] - 3, e[0] - 2, e[1] - 2, 'rgba(255, 226, 190, 0.5)', 1.8);
    ctx.save();
    ctx.translate(e[0] + 4, e[1] - 4);
    ctx.rotate(Math.atan2(e[1] - a[1], e[0] - a[0]));
    rrect(ctx, -14, -6.5, 15, 13, 2);
    fill(ctx, brassFill(ctx, -6, 6), C.brassDeep, 2);
    rrect(ctx, 0, -44, 11, 88, 3);
    fill(ctx, linear(ctx, 0, 0, 11, 0, [
      [0, '#fbf3e0'],
      [1, '#b9a988'],
    ]), '#4a3a28', 2.5);
    ctx.restore();
  },

  ledger(ctx) {
    ctx.beginPath();
    ctx.moveTo(-78, -32);
    ctx.lineTo(0, -38);
    ctx.lineTo(78, -32);
    ctx.lineTo(80, 54);
    ctx.lineTo(0, 60);
    ctx.lineTo(-80, 54);
    ctx.closePath();
    fill(ctx, C.bloodDeep, '#3a0609', 3);
    for (const s of [-1, 1]) {
      // A few page edges under the open leaves.
      for (let i = 2; i >= 0; i--) {
        ctx.beginPath();
        ctx.moveTo(s * 2, -36 + i * 2);
        ctx.quadraticCurveTo(s * 36, -46 + i * 2, s * 72, -34 + i * 2);
        ctx.lineTo(s * 72, 46 + i * 2.5);
        ctx.quadraticCurveTo(s * 36, 38 + i * 2.5, s * 2, 50 + i * 2.5);
        ctx.closePath();
        fill(ctx, i ? C.paperShade : C.paper, i ? null : '#6e5f48', 1.6);
      }
    }
    ctx.fillStyle = linear(ctx, -14, 0, 14, 0, [
      [0, 'rgba(60, 40, 20, 0)'],
      [0.5, 'rgba(60, 40, 20, 0.45)'],
      [1, 'rgba(60, 40, 20, 0)'],
    ]);
    ctx.fillRect(-14, -44, 28, 96);
    // Left leaf: two gates of tallies, the way you count repeats.
    const inkC = '#24160f';
    for (const [x0, y0] of [
      [-62, -22],
      [-36, -22],
      [-62, 8],
    ]) {
      for (let i = 0; i < 4; i++) {
        seg(ctx, x0 + i * 5.5, y0, x0 + i * 5.5 - 1, y0 + 20, inkC, 3);
      }
      seg(ctx, x0 - 3, y0 + 16, x0 + 21, y0 + 4, inkC, 3);
    }
    seg(ctx, -36, 12, -36, 28, inkC, 3);
    seg(ctx, -30, 12, -31, 28, inkC, 3);
    // Right leaf: ruled columns, and one entry underlined in red.
    for (let i = 0; i < 6; i++) {
      const y = -24 + i * 12;
      seg(ctx, 10, y, 64, y + 1, 'rgba(120, 100, 76, 0.7)', 1.2);
      ctx.fillStyle = 'rgba(36, 22, 15, 0.8)';
      ctx.fillRect(12, y - 7, 10 + ((i * 13) % 18), 3);
      ctx.fillRect(48, y - 7, 12, 3);
    }
    seg(ctx, 44, 38, 64, 37, C.blood, 3.2);
    band(ctx, 3, 52, 9, 76, 8, 4);
    fill(ctx, C.blood, '#4a080c', 1.6);
  },

  abacus(ctx) {
    rrect(ctx, -64, -50, 128, 100, 6);
    ctx.strokeStyle = C.woodDeep;
    ctx.lineWidth = 15;
    ctx.stroke();
    ctx.strokeStyle = linear(ctx, 0, -56, 0, 56, [
      [0, '#c47c42'],
      [1, '#7a3e1c'],
    ]);
    ctx.lineWidth = 10;
    ctx.stroke();
    for (const [x, y] of [
      [-64, -50],
      [64, -50],
      [-64, 50],
      [64, 50],
    ]) {
      rrect(ctx, x - 7, y - 7, 14, 14, 3);
      fill(ctx, brassFill(ctx, y - 7, y + 7), C.brassDeep, 2);
    }
    const rows = [
      { y: -28, color: C.bone, xs: [-48, -36, -24, 30, 42] },
      { y: -9, color: C.blood, xs: [-48, -36, 6, 18, 30, 42] },
      { y: 10, color: C.bone, xs: [-48, -6, 6, 18, 30, 42] },
      { y: 29, color: C.blood, xs: [-48, -36, -24, -12, 42] },
    ];
    for (const { y, color, xs } of rows) {
      ctx.fillStyle = C.boneDim;
      ctx.fillRect(-58, y - 1.3, 116, 2.6);
      for (const x of xs) {
        ellipse(ctx, x, y, 6, 8);
        fill(ctx, color, color === C.bone ? '#5a4c38' : '#3a0609', 1.8);
        ellipse(ctx, x - 2, y - 3, 1.8, 2.4);
        fill(ctx, 'rgba(255, 250, 240, 0.7)');
      }
    }
  },

  wheel_of_fortune(ctx) {
    const cy = 8;
    const R = 56;
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(0, cy);
      ctx.arc(0, cy, R, a, a + TAU / n);
      ctx.closePath();
      fill(ctx, i % 2 ? '#ddd1b6' : C.blood);
    }
    ctx.strokeStyle = C.brassDeep;
    ctx.lineWidth = 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU - Math.PI / 2;
      seg(ctx, 0, cy, Math.cos(a) * R, cy + Math.sin(a) * R, C.brassDeep, 2.2);
    }
    circle(ctx, 0, cy, R);
    ctx.strokeStyle = C.brassDeep;
    ctx.lineWidth = 11;
    ctx.stroke();
    ctx.strokeStyle = brassFill(ctx, cy - R, cy + R);
    ctx.lineWidth = 7;
    ctx.stroke();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU - Math.PI / 2;
      circle(ctx, Math.cos(a) * R, cy + Math.sin(a) * R, 2.8);
      fill(ctx, C.bone);
    }
    circle(ctx, 0, cy, 12);
    fill(ctx, brassFill(ctx, cy - 12, cy + 12), C.brassDeep, 2.5);
    circle(ctx, 0, cy, 4);
    fill(ctx, C.soot);
    // The pointer, at twelve o'clock.
    ctx.beginPath();
    ctx.moveTo(-11, cy - R - 18);
    ctx.lineTo(11, cy - R - 18);
    ctx.lineTo(0, cy - R + 10);
    ctx.closePath();
    fill(ctx, brassFill(ctx, cy - R - 18, cy - R + 10), C.brassDeep, 2.5);
  },

  glass_eye(ctx, r) {
    circle(ctx, 0, 0, 58);
    fill(ctx, radial(ctx, -20, -22, 4, 0, 0, 62, [
      [0, '#fffaf0'],
      [0.45, '#ebe0c9'],
      [0.82, '#a99a80'],
      [1, '#54473a'],
    ]));
    // Veins, from the back of the eye toward the iris.
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + 0.4 + r() * 0.3;
      let x = Math.cos(a) * 56;
      let y = Math.sin(a) * 56;
      const pts = [[x, y]];
      for (let j = 0; j < 4; j++) {
        x += (-Math.cos(a) * 6 + (r() - 0.5) * 7) * 1;
        y += (-Math.sin(a) * 6 + (r() - 0.5) * 7) * 1;
        pts.push([x, y]);
      }
      line(ctx, pts, i % 2 ? C.blood : C.bloodDeep, 1.8);
    }
    const ix = 7;
    const iy = 5;
    circle(ctx, ix, iy, 26);
    fill(ctx, radial(ctx, ix, iy, 4, ix, iy, 26, [
      [0, '#ffd77a'],
      [0.55, C.amber],
      [1, C.amberDeep],
    ]));
    ctx.strokeStyle = 'rgba(110, 50, 10, 0.55)';
    ctx.lineWidth = 1.3;
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * TAU;
      ctx.beginPath();
      ctx.moveTo(ix + Math.cos(a) * 12, iy + Math.sin(a) * 12);
      ctx.lineTo(ix + Math.cos(a) * 24, iy + Math.sin(a) * 24);
      ctx.stroke();
    }
    circle(ctx, ix, iy, 26);
    ctx.strokeStyle = '#2e1404';
    ctx.lineWidth = 3.5;
    ctx.stroke();
    circle(ctx, ix, iy, 11.5);
    fill(ctx, C.soot);
    ellipse(ctx, ix - 9, iy - 10, 6.5, 4.5, -0.6);
    fill(ctx, '#fffbf2');
    ctx.beginPath();
    ctx.arc(0, 0, 50, Math.PI * 1.08, Math.PI * 1.36);
    ctx.strokeStyle = 'rgba(255, 255, 250, 0.7)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();
  },

  piggy_bank(ctx) {
    ctx.save();
    ctx.translate(-4, 6);
    const body = linear(ctx, 0, -40, 0, 48, [
      [0, '#f7eedb'],
      [0.55, '#d8c8a8'],
      [1, C.porcelainShade],
    ]);
    const edge = '#4e4232';
    for (const x of [-30, 14]) {
      rrect(ctx, x, 24, 12, 26, 4);
      fill(ctx, '#9a8a6c', edge, 2);
    }
    ctx.beginPath();
    ctx.moveTo(-50, -2);
    ctx.bezierCurveTo(-64, -12, -72, 4, -62, 8);
    ctx.bezierCurveTo(-54, 10, -56, -6, -66, -6);
    ctx.strokeStyle = edge;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.strokeStyle = '#d8c8a8';
    ctx.lineWidth = 3.4;
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
    ctx.lineWidth = 5;
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
      fill(ctx, body, edge, 2);
      ctx.fillStyle = '#6b5c46';
      ctx.fillRect(x + 1, 49, 11, 4);
    }
    ellipse(ctx, 59, -2, 9, 13);
    fill(ctx, '#e6d6b8', edge, 2.4);
    for (const y of [-6, 3]) {
      ellipse(ctx, 61, y, 1.8, 2.6);
      fill(ctx, C.soot);
    }
    circle(ctx, 40, -11, 3.4);
    fill(ctx, C.soot);
    // A coin half into the slot.
    ctx.save();
    ctx.beginPath();
    ctx.rect(-40, -90, 60, 58);
    ctx.clip();
    circle(ctx, -10, -42, 15);
    fill(ctx, brassFill(ctx, -58, -27), C.brassDeep, 2.5);
    circle(ctx, -10, -42, 9.5);
    ctx.strokeStyle = 'rgba(106, 74, 31, 0.85)';
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-10, -42, 12.5, Math.PI * 1.1, Math.PI * 1.5);
    ctx.strokeStyle = 'rgba(255, 246, 220, 0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    rrect(ctx, -28, -34, 36, 6, 3);
    fill(ctx, '#140c08');
    ctx.beginPath();
    ctx.ellipse(-6, 4, 44, 30, 0, Math.PI * 1.1, Math.PI * 1.45);
    ctx.strokeStyle = 'rgba(255, 252, 244, 0.85)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  },

  twin_mirrors(ctx) {
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(s * 25, -16);
      ctx.rotate(s * -0.34);
      rrect(ctx, -5, 28, 10, 44, 4);
      fill(ctx, brassFill(ctx, 28, 72), C.brassDeep, 2.4);
      circle(ctx, 0, 74, 6);
      fill(ctx, brassFill(ctx, 68, 80), C.brassDeep, 2.4);
      rrect(ctx, -8, 25, 16, 9, 3);
      fill(ctx, '#8a6630', C.brassDeep, 2);
      ellipse(ctx, 0, 0, 25, 32);
      fill(ctx, brassFill(ctx, -32, 32), C.brassDeep, 3);
      ellipse(ctx, 0, 0, 18.5, 25.5);
      fill(ctx, linear(ctx, -18 * s, -26, 18 * s, 26, [
        [0, '#f2efe8'],
        [0.5, '#b4b0a8'],
        [1, '#5e5b56'],
      ]), '#3a2c18', 2);
      ctx.save();
      ellipse(ctx, 0, 0, 18.5, 25.5);
      ctx.clip();
      seg(ctx, -16 * s, 14, 8 * s, -24, 'rgba(255, 255, 255, 0.9)', 4.5);
      seg(ctx, -6 * s, 20, 14 * s, -12, 'rgba(255, 255, 255, 0.55)', 2);
      ctx.restore();
      ctx.fillStyle = 'rgba(255, 240, 200, 0.75)';
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        circle(ctx, Math.cos(a) * 22, Math.sin(a) * 29, 1.3);
        ctx.fill();
      }
      ctx.restore();
    }
  },

  house_key(ctx) {
    ctx.save();
    ctx.rotate(Math.PI / 4);
    ctx.translate(-4, 0);
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
      rrect(ctx, -33 - e, -9 - e, 6 + extra, 18 + extra, 2);
      ctx.fill();
      rrect(ctx, -32 - e, -5 - e, 92 + extra, 10 + extra, 4);
      ctx.fill();
      rrect(ctx, -24 - e, -7.5 - e, 5 + extra, 15 + extra, 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(34 - e, 3);
      ctx.lineTo(58 + e, 3);
      ctx.lineTo(58 + e, 28 + e);
      ctx.lineTo(51 - e, 28 + e);
      ctx.lineTo(51 - e, 20 - e);
      ctx.lineTo(45 + e, 20 - e);
      ctx.lineTo(45 + e, 28 + e);
      ctx.lineTo(34 - e, 28 + e);
      ctx.closePath();
      ctx.fill();
    };
    ctx.fillStyle = C.brassDeep;
    shape(6);
    ctx.fillStyle = brassFill(ctx, -30, 30);
    shape(0);
    punch(ctx, () => circle(ctx, -50, 0, 8.5));
    for (const [x, y] of [
      [-52, -18],
      [-52, 18],
      [-70, 0],
    ]) {
      punch(ctx, () => circle(ctx, x, y, 3.6));
    }
    circle(ctx, -50, 0, 10.5);
    ctx.strokeStyle = C.brassDeep;
    ctx.lineWidth = 2.6;
    ctx.stroke();
    seg(ctx, -18, -2.5, 56, -2.5, 'rgba(255, 244, 214, 0.8)', 2);
    ctx.beginPath();
    ctx.arc(-48, 0, 15, Math.PI * 1.05, Math.PI * 1.55);
    ctx.strokeStyle = 'rgba(255, 244, 214, 0.8)';
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.restore();
  },
};

// Anything without a painter yet (a content id from a later phase): a plain
// charm with a scrawled question mark, so it still reads as a talisman.
function paintUnknown(ctx) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  scrawlText(ctx, '?', 2, 8, 104, C.bone);
}

// Warm light some curios throw onto the enamel around them.
const GLOWS = {
  matchbook: { x: 32, y: -46, r: 44, color: 'rgba(235, 162, 50, 0.3)' },
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
  for (let i = 0; i < 80; i++) {
    ctx.globalAlpha = 0.1 + r() * 0.28;
    ctx.save();
    ctx.translate(r() * w, r() * w);
    ctx.rotate(angle + (r() - 0.5) * 0.12);
    ctx.fillRect(0, 0, (16 + r() * 70) * k, (0.7 + r() * 1.3) * k);
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

/**
 * Paint a talisman's face (the enamel disc and its curio) into a size × size
 * context. Transparent outside the disc. `reflected` paints it as Twin Mirrors
 * shows it: mirrored, behind a silvered glint.
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

  // Enamel: warm black, lighter where the lamp would catch it.
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
  circle(ctx, 0, 0, 90);
  ctx.strokeStyle = 'rgba(237, 229, 211, 0.85)';
  ctx.lineWidth = 2.2;
  ctx.stroke();
  circle(ctx, 0, 0, 85.5);
  ctx.strokeStyle = 'rgba(179, 169, 147, 0.28)';
  ctx.lineWidth = 1;
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

  // The curio, over its own soot shadow so it stands off the enamel.
  const curio = paintCurio(id, size, seed, reflected);
  const shadow = makeCanvas(size);
  const sctx = shadow.getContext('2d');
  sctx.drawImage(curio, 0, 0);
  sctx.globalCompositeOperation = 'source-in';
  sctx.fillStyle = 'rgba(2, 1, 1, 0.85)';
  sctx.fillRect(0, 0, size, size);
  ctx.save();
  ctx.setTransform(base);
  ctx.filter = `blur(${Math.max(1, size * 0.004)}px)`;
  ctx.drawImage(shadow, size * 0.008, size * 0.012);
  ctx.filter = 'none';
  ctx.drawImage(curio, 0, 0);
  ctx.restore();

  // Wear: a few scratches through the enamel and the paint alike.
  ctx.globalAlpha = 0.24;
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
    ctx.fillStyle = 'rgba(225, 222, 214, 0.08)';
    ctx.fillRect(-100, -100, 200, 200);
    for (const [x, w, a] of [
      [-30, 16, 0.12],
      [-6, 5, 0.2],
      [36, 9, 0.08],
    ]) {
      ctx.save();
      ctx.rotate(0.6);
      ctx.fillStyle = `rgba(245, 242, 235, ${a})`;
      ctx.fillRect(x, -110, w, 220);
      ctx.restore();
    }
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
const REST_GLOW = 0.07; // enough for a face to read at the edge of the lamp's pool

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
  shared = { body, face, ring, lug };
  return shared;
}

function defaultBrass() {
  return new THREE.MeshStandardMaterial({ color: 0xc39a5c, metalness: 1, roughness: 0.3 });
}

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

  let glow = 0;
  let dim = false;
  let faceId = id;
  const applyGlow = () => {
    enamel.emissiveIntensity = (dim ? 0 : REST_GLOW) + glow * 0.95;
    rim.emissiveIntensity = glow * 0.55;
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
    },
    setDim(on) {
      dim = !!on;
      enamel.color.setScalar(dim ? 0.68 : 1);
      rim.color.copy(rimColor).multiplyScalar(dim ? 0.7 : 1);
      applyGlow();
    },
    /** Release this charm's own materials (textures and geometry are shared). */
    dispose() {
      rim.dispose();
      enamel.dispose();
    },
  };
  return group;
}
