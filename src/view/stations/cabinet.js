import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RARITY } from '../../core/economy.js';
import { format } from '../../core/num.js';
import { rng } from '../../ui/marks.js';
import { INK, paintLoop, paintScratch, scrawlFont, scrawlText, typedFont } from '../ink.js';

// The Curio Cabinet (design doc 5.8, 8.1): a low mahogany jeweller's counter
// on the player's right. Through its sloped glass the player looks down into
// four velvet compartments: three talismans for tokens, and a fourth for
// oddities that stays boarded up until Phase 5. Each talisman lies on a
// velvet pad with a black card tag tied to it (the price, and the rarity as a
// prisoner's tally). The restock crank is on the right side panel and the
// rarity chart is nailed to the front.
//
// The counter stays under 1.15 m so it never rises over the wheel's rim in
// the wide shot. Local frame: +z faces the player, y up from the floor, the
// origin on the floor under the counter's centre.

const deg = THREE.MathUtils.degToRad;

const BODY = { w: 1.26, d: 0.52, y0: 0.06, y1: 0.7 };
const DECK = { w: 1.3, d: 0.55, y0: 0.7, y1: 0.73 };
const FRONT_Z = DECK.d / 2;
const FLOOR_Y = 0.735;
const INNER_W = 1.25;
const SLOTS = 4;
const SLOT_W = INNER_W / SLOTS;
const slotX = (i) => (i - (SLOTS - 1) / 2) * SLOT_W;
const BACK_Z = -0.2545;
const CAP = { y0: 1.035, y1: 1.055, z0: -0.282, z1: -0.118 };
export const CABINET_HEIGHT = CAP.y1;

// The sloped glass, from the low front rail up to the cap.
const GLASS = { z0: 0.262, y0: 0.765, z1: CAP.z1 - 0.004, y1: CAP.y0 };
const GLASS_RUN = GLASS.z0 - GLASS.z1;
const GLASS_RISE = GLASS.y1 - GLASS.y0;
const GLASS_LEN = Math.hypot(GLASS_RUN, GLASS_RISE);
// rotation.x that lays a +z-facing plane on the slope.
const GLASS_TILT = -Math.atan2(GLASS_RUN, GLASS_RISE);
const glassY = (z) => GLASS.y0 + ((GLASS.z0 - z) * GLASS_RISE) / GLASS_RUN;

// Tags lie on a velvet ramp along the front, tilted up toward the eye so
// the price reads from where the player stands.
const RAMP = { z0: 0.248, y0: 0.745, z1: 0.1, slope: deg(32) };
RAMP.y1 = RAMP.y0 + (RAMP.z0 - RAMP.z1) * Math.tan(RAMP.slope);
const TAG = { w: 0.2, h: 0.14, px: 640 };
// Each talisman reclines on a velvet pad, its face turned up to the player.
const PAD = { w: 0.17, h: 0.17, d: 0.035, z: -0.11, tilt: deg(25) };
const CHARM_SCALE = 1.3;
const CHART = { w: 0.4, h: 0.3, x: -0.34, y: 0.5 };
const CRANK = { x: BODY.w / 2, y: 0.6, z: 0.04, arm: 0.095 };
const CRANK_TAG = { w: 0.16, h: 0.15 };

const LIGHT = 2; // the case light at full mood
const BACK_GLOW = 0.85;
const BULB_GLOW = 3.2;
const TAG_GLOW = 0.32;
const SIGN_GLOW = 0.26;
const SHEEN = 0.5;
const RESTOCK_TIME = 0.8;
const RARITIES = ['common', 'uncommon', 'rare', 'legendary'];

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

// When each compartment goes dark and catches again during a restock.
const flickerOff = (i) => 0.06 + i * 0.12;
const flickerOn = (i) => 0.34 + i * 0.12;
function restockFlicker(i, t) {
  if (t < flickerOff(i)) return 1;
  if (t < flickerOn(i)) return 0.04;
  const k = t - flickerOn(i);
  if (k < 0.04) return 0.75;
  if (k < 0.08) return 0.12;
  return 1;
}

// ---- Canvas painting -----------------------------------------------------------

function canvasTexture(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { canvas, ctx: canvas.getContext('2d'), tex };
}

/**
 * Black card stock cut to an outline: fibres, handling marks and a frame
 * scratched in by hand, like the night cards (design doc 8.4).
 */
function paintCard(ctx, w, h, seed, outline) {
  const r = rng(seed);
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.beginPath();
  outline(ctx);
  ctx.closePath();
  ctx.clip();
  const g = ctx.createRadialGradient(w / 2, h * 0.45, h * 0.1, w / 2, h / 2, Math.max(w, h) * 0.7);
  g.addColorStop(0, '#2d2520');
  g.addColorStop(1, '#100d0b');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < (w * h) / 220; i++) {
    ctx.fillStyle = `rgba(237, 229, 211, ${r() * 0.04})`;
    ctx.fillRect(r() * w, r() * h, 1 + r() * 16, 1);
  }
  for (let i = 0; i < (w * h) / 900; i++) {
    ctx.fillStyle = `rgba(0, 0, 0, ${r() * 0.25})`;
    ctx.fillRect(r() * w, r() * h, 2 + r() * 5, 2 + r() * 5);
  }
  // A pale cut edge, so the card's shape reads against the dark velvet.
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(179, 169, 147, 0.32)';
  ctx.beginPath();
  outline(ctx);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

/** A rectangle frame scratched inside a card, corners overshooting. */
function paintFrame(ctx, x0, y0, x1, y1, seed, alpha = 0.38) {
  ctx.save();
  ctx.globalAlpha = alpha;
  paintScratch(ctx, x0 + 4, y0 + 3, x1 + 2, y0 - 1, 3, seed + 1, INK.boneDim, { bow: 0.01 });
  paintScratch(ctx, x1 - 2, y0 - 4, x1 + 1, y1 + 3, 3, seed + 2, INK.boneDim, { bow: 0.01 });
  paintScratch(ctx, x1 + 3, y1 - 2, x0 - 2, y1, 3, seed + 3, INK.boneDim, { bow: 0.01 });
  paintScratch(ctx, x0, y1 + 4, x0 - 1, y0 - 3, 3, seed + 4, INK.boneDim, { bow: 0.01 });
  ctx.restore();
}

/** Punch an eyelet: a brass ring around a hole through the card. */
function paintEyelet(ctx, x, y, r) {
  ctx.save();
  ctx.fillStyle = INK.brass;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(40, 24, 10, 0.6)';
  ctx.beginPath();
  ctx.arc(x + r * 0.12, y + r * 0.12, r * 0.72, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A token: a hexagon scratched in six strokes that overshoot their corners. */
function paintHex(ctx, cx, cy, size, seed, color = INK.brass) {
  const r = rng(seed);
  const R = size * 0.44;
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    pts.push([cx + Math.cos(a) * R + (r() - 0.5) * size * 0.03, cy + Math.sin(a) * R + (r() - 0.5) * size * 0.03]);
  }
  for (let i = 0; i < 6; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % 6];
    const ex = (x2 - x1) * 0.12;
    const ey = (y2 - y1) * 0.12;
    paintScratch(ctx, x1 - ex, y1 - ey, x2 + ex, y2 + ey, size * 0.09, seed + i * 7, color, { bow: 0.02, n: 6 });
  }
  ctx.save();
  ctx.globalAlpha *= 0.7;
  paintScratch(ctx, cx - R * 0.2, cy - R * 0.35, cx + R * 0.15, cy + R * 0.38, size * 0.065, seed + 50, color, { n: 5 });
  ctx.restore();
}

/** A coin stack, scratched: two lower rims and the top coin whole. */
function paintCoins(ctx, cx, cy, size, seed, color = INK.bone) {
  const rx = size * 0.42;
  const ry = size * 0.17;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (const [dy, alpha] of [
    [size * 0.3, 0.7],
    [size * 0.15, 0.85],
  ]) {
    ctx.globalAlpha = alpha;
    ctx.lineWidth = size * 0.075;
    ctx.beginPath();
    ctx.ellipse(cx, cy - size * 0.08 + dy, rx, ry, 0, 0, Math.PI);
    ctx.stroke();
  }
  ctx.restore();
  paintLoop(ctx, cx, cy - size * 0.08, rx, ry, seed, color, size * 0.08);
  ctx.save();
  ctx.globalAlpha = 0.6;
  paintLoop(ctx, cx, cy - size * 0.08, rx * 0.45, ry * 0.42, seed + 1, color, size * 0.05);
  ctx.restore();
}

/** Prisoner's tally strokes: I to IIII for common to legendary. */
function paintTally(ctx, x, y, h, count, seed, { color = INK.bone, gap = 24, width = 8 } = {}) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const lean = (r() - 0.5) * h * 0.14;
    const sx = x + i * gap;
    paintScratch(ctx, sx + lean * 0.4, y + h * (0.02 + r() * 0.06), sx - lean * 0.4, y + h * (0.96 - r() * 0.06), width, seed + i * 13, color);
  }
  return x + Math.max(0, count - 1) * gap;
}

/** Scrawled words in chalk: the stroke rubbed thin where the board is rough. */
function chalkText(ctx, text, x, y, px, color, seed, angle = 0) {
  const r = rng(seed);
  ctx.save();
  ctx.font = scrawlFont(px);
  const tw = ctx.measureText(text).width;
  ctx.restore();
  const layer = document.createElement('canvas');
  layer.width = Math.ceil(tw + px);
  layer.height = Math.ceil(px * 2);
  const l = layer.getContext('2d');
  l.textAlign = 'center';
  l.textBaseline = 'middle';
  scrawlText(l, text, layer.width / 2, layer.height / 2, px, color);
  l.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < (layer.width * layer.height) / 60; i++) {
    l.globalAlpha = 0.3 + r() * 0.7;
    l.fillRect(r() * layer.width, r() * layer.height, 1 + r() * 3, 1 + r() * 1.5);
  }
  // The chalk skips along the grain in long dry streaks.
  for (let i = 0; i < px * 0.4; i++) {
    l.globalAlpha = 0.2 + r() * 0.4;
    l.fillRect(r() * layer.width, r() * layer.height, px * (0.2 + r() * 0.6), 1 + r());
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.drawImage(layer, -layer.width / 2, -layer.height / 2);
  ctx.restore();
}

const tagOutline = (w, h) => (c) => {
  const cut = h * 0.17;
  c.moveTo(cut, 0);
  c.lineTo(w, 0);
  c.lineTo(w, h);
  c.lineTo(cut, h);
  c.lineTo(0, h - cut);
  c.lineTo(0, cut);
};

/** A compartment's price tag: price and hexagon, then the rarity tally. */
function drawPriceTag(t, info, seed) {
  const { ctx, canvas, tex } = t;
  const { width: w, height: h } = canvas;
  paintCard(ctx, w, h, seed, tagOutline(w, h));
  paintFrame(ctx, h * 0.3, 22, w - 22, h - 22, seed + 10, 0.3);
  paintEyelet(ctx, h * 0.13, h / 2, h * 0.055);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const sold = info.state === 'sold';
  const dim = sold ? 0.3 : info.affordable ? 1 : 0.5;
  const priceX = w * 0.43;
  const priceY = h * 0.37;
  ctx.save();
  ctx.globalAlpha = dim;
  scrawlText(ctx, info.price, priceX, priceY, 196, info.affordable || sold ? INK.bone : INK.boneDim);
  paintHex(ctx, w * 0.73, h * 0.36, 118, seed + 20);
  ctx.restore();

  // The rarity, as a prisoner counts it.
  ctx.save();
  ctx.globalAlpha = sold ? 0.35 : 1;
  ctx.globalAlpha *= 0.3;
  paintScratch(ctx, h * 0.3, h * 0.66, w - 40, h * 0.655, 3, seed + 30, INK.boneDim, { bow: 0.01 });
  ctx.globalAlpha = sold ? 0.35 : 1;
  const end = paintTally(ctx, h * 0.33, h * 0.72, h * 0.19, info.marks, seed + 40);
  ctx.font = typedFont(46);
  ctx.fillStyle = INK.boneDim;
  ctx.textAlign = 'left';
  ctx.fillText(info.rarity, end + 34, h * 0.815);
  ctx.restore();

  if (!sold && !info.affordable && info.short) {
    ctx.save();
    ctx.font = typedFont(36);
    ctx.fillStyle = INK.boneDim;
    ctx.textAlign = 'right';
    ctx.fillText(`${info.short} short`, w - 36, h * 0.6);
    ctx.restore();
  }
  if (sold) {
    // Struck off, and "sold" across it in red chalk.
    paintScratch(ctx, w * 0.22, h * 0.48, w * 0.86, h * 0.26, 7, seed + 60, INK.bloodDeep, { bow: 0.03 });
    chalkText(ctx, 'sold', w * 0.58, h * 0.44, 132, INK.blood, seed + 70, -0.14);
  }
  tex.needsUpdate = true;
}

/** The crank's tag: what a paid restock costs, and the free one each night. */
function drawCrankTag(t, info) {
  const { ctx, canvas, tex } = t;
  const { width: w, height: h } = canvas;
  const cut = w * 0.16;
  paintCard(ctx, w, h, 811, (c) => {
    c.moveTo(cut, 0);
    c.lineTo(w - cut, 0);
    c.lineTo(w, cut);
    c.lineTo(w, h);
    c.lineTo(0, h);
    c.lineTo(0, cut);
  });
  paintFrame(ctx, 22, cut * 0.9, w - 22, h - 22, 820, 0.3);
  paintEyelet(ctx, w / 2, h * 0.09, w * 0.04);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  scrawlText(ctx, 'restock', w / 2, h * 0.28, 66, INK.bone);
  ctx.save();
  ctx.globalAlpha = info.affordable ? 1 : 0.5;
  scrawlText(ctx, info.cost, w * 0.43, h * 0.56, info.cost.length > 3 ? 96 : 140, INK.bone);
  paintCoins(ctx, w * 0.76, h * 0.56, 92, 830);
  ctx.restore();
  if (!info.affordable) paintScratch(ctx, w * 0.18, h * 0.66, w * 0.9, h * 0.46, 7, 840, INK.blood, { bow: 0.03 });
  ctx.font = typedFont(34);
  ctx.fillStyle = INK.boneDim;
  ctx.fillText('free each night', w / 2, h * 0.86);
  tex.needsUpdate = true;
}

const percent = (p) => (p >= 0.1 || p === 0 ? `${Math.round(p * 100)}%` : `${(p * 100).toFixed(1)}%`);

/** The rarity chart: each rarity's price in tokens and its chance per compartment. */
function drawChart(t, odds) {
  const { ctx, canvas, tex } = t;
  const { width: w, height: h } = canvas;
  paintCard(ctx, w, h, 901, (c) => c.rect(0, 0, w, h));
  paintFrame(ctx, 24, 26, w - 24, h - 24, 910);
  // Nail holes the card was hung by.
  for (const x of [52, w - 52]) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.beginPath();
    ctx.arc(x, 50, 9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  scrawlText(ctx, 'the odds', w / 2, 84, 60, INK.bone);
  ctx.font = typedFont(28);
  ctx.fillStyle = INK.boneDim;
  ctx.fillText('in each compartment', w / 2, 140);
  RARITIES.forEach((rarity, i) => {
    const y = 218 + i * 94;
    paintTally(ctx, 62, y - 30, 60, i + 1, 920 + i * 17, { gap: 17, width: 6 });
    ctx.font = typedFont(44);
    ctx.fillStyle = INK.bone;
    ctx.textAlign = 'left';
    ctx.fillText(rarity, 158, y + 2);
    ctx.textAlign = 'right';
    scrawlText(ctx, String(RARITY[rarity].price), 538, y, 60, INK.brass);
    paintHex(ctx, 576, y, 50, 940 + i * 11);
    ctx.font = typedFont(44);
    ctx.fillStyle = INK.boneDim;
    ctx.fillText(odds ? percent(odds[rarity] ?? 0) : '', w - 46, y + 2);
  });
  tex.needsUpdate = true;
}

/** Weathered boards for the shuttered compartment, one per plank. */
function drawPlank(t, seed, words) {
  const { ctx, canvas, tex } = t;
  const { width: w, height: h } = canvas;
  const r = rng(seed);
  const tone = 0.75 + r() * 0.35;
  ctx.fillStyle = `rgb(${(66 * tone) | 0}, ${(48 * tone) | 0}, ${(34 * tone) | 0})`;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 46; i++) {
    const gy = r() * h;
    ctx.strokeStyle = `rgba(18, 11, 7, ${0.12 + r() * 0.35})`;
    ctx.lineWidth = 1 + r() * 2.2;
    ctx.beginPath();
    const phase = r() * 6;
    for (let x = 0; x <= w; x += 16) ctx.lineTo(x, gy + Math.sin(x * 0.012 + phase) * 4);
    ctx.stroke();
  }
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = `rgba(200, 180, 150, ${r() * 0.06})`;
    ctx.fillRect(r() * w, r() * h, 30 + r() * 140, 1 + r() * 3);
  }
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(0, 0, w, 5);
  ctx.fillRect(0, h - 7, w, 7);
  // Two nails at each end, driven into the frame.
  for (const nx of [26, w - 26]) {
    for (const ny of [h * 0.3, h * 0.7]) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.beginPath();
      ctx.arc(nx + 2, ny + 2, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4a4038';
      ctx.beginPath();
      ctx.arc(nx, ny, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(220, 200, 170, 0.35)';
      ctx.fillRect(nx - 3, ny - 4, 3, 2);
    }
  }
  if (words) chalkText(ctx, words, w / 2, h / 2 + 4, h * 0.55, INK.bone, seed + 3, -0.03);
  tex.needsUpdate = true;
}

/** A warm glow in the middle of a compartment's back wall. */
function glowTexture() {
  const t = canvasTexture(128, 128);
  const g = t.ctx.createRadialGradient(64, 58, 4, 64, 64, 70);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.45, '#9a7a68');
  g.addColorStop(1, '#100606');
  t.ctx.fillStyle = g;
  t.ctx.fillRect(0, 0, 128, 128);
  t.tex.needsUpdate = true;
  return t.tex;
}

/** Where the glass catches the light: strongest along the top, a few streaks. */
function sheenTexture() {
  const t = canvasTexture(128, 256);
  const { ctx } = t;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#9a9a9a');
  g.addColorStop(0.35, '#3a3a3a');
  g.addColorStop(0.6, '#101010');
  g.addColorStop(1, '#060606');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 256);
  ctx.globalCompositeOperation = 'lighter';
  for (const [x, wd, a] of [
    [18, 10, 0.18],
    [40, 4, 0.12],
    [86, 16, 0.1],
  ]) {
    ctx.fillStyle = `rgba(255, 255, 255, ${a})`;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + wd, 0);
    ctx.lineTo(x + wd - 60, 256);
    ctx.lineTo(x - 60, 256);
    ctx.fill();
  }
  t.tex.colorSpace = THREE.NoColorSpace;
  t.tex.needsUpdate = true;
  return t.tex;
}

// ---- Geometry helpers ------------------------------------------------------------

/** A board cut to a (z, y) profile, `thickness` along x, centred on x = 0. */
function profileGeometry(points, thickness) {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  // Shape x becomes local z; the extrusion runs along x.
  geo.rotateY(-Math.PI / 2);
  geo.translate(thickness / 2, 0, 0);
  return geo;
}

/** A thin twine string sagging from a to b. */
function stringMesh(a, b, sag, material) {
  const mid = a.clone().lerp(b, 0.5);
  mid.y -= sag;
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.0009, 5, false), material);
}

function box(w, h, d, material, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

// ---- The station ---------------------------------------------------------------

export function createCabinet({ materials, interaction, callbacks = {}, makeCharm }) {
  const group = new THREE.Group();
  group.name = 'cabinet';
  const wood = materials.mahogany;
  const brass = materials.brass;
  const envMap = brass.envMap ?? null;
  const shadowed = (m) => {
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };

  // ---- Counter ---------------------------------------------------------------
  const plinth = box(BODY.w - 0.06, BODY.y0, BODY.d - 0.05, new THREE.MeshStandardMaterial({ color: 0x0d0907, roughness: 0.8 }), 0, BODY.y0 / 2, 0);
  const body = shadowed(box(BODY.w, BODY.y1 - BODY.y0, BODY.d, wood, 0, (BODY.y0 + BODY.y1) / 2, 0));
  const deck = shadowed(box(DECK.w, DECK.y1 - DECK.y0, DECK.d, wood, 0, (DECK.y0 + DECK.y1) / 2, 0));
  group.add(plinth, body, deck);
  // Raised panel frames on the front: a stile down the middle, rails top and bottom.
  const fz = BODY.d / 2 + 0.006;
  group.add(box(0.05, BODY.y1 - BODY.y0 - 0.02, 0.012, wood, 0, (BODY.y0 + BODY.y1) / 2, fz));
  group.add(box(BODY.w - 0.02, 0.05, 0.012, wood, 0, BODY.y1 - 0.035, fz));
  group.add(box(BODY.w - 0.02, 0.06, 0.012, wood, 0, BODY.y0 + 0.04, fz));
  for (const sx of [-1, 1]) group.add(box(0.04, BODY.y1 - BODY.y0 - 0.02, 0.012, wood, sx * (BODY.w / 2 - 0.02), (BODY.y0 + BODY.y1) / 2, fz));
  // A brass lock on the right door.
  const lock = box(0.034, 0.06, 0.006, brass, 0.3, 0.5, fz + 0.009);
  const keyhole = box(0.006, 0.018, 0.002, new THREE.MeshStandardMaterial({ color: 0x050403 }), 0.3, 0.495, fz + 0.0125);
  group.add(lock, keyhole);

  // ---- The case: ends, front rail, back, cap -----------------------------------
  const endProfile = [
    [FRONT_Z, DECK.y1],
    [FRONT_Z, GLASS.y0],
    [CAP.z1, CAP.y1],
    [CAP.z0, CAP.y1],
    [CAP.z0, DECK.y1],
  ];
  const endGeo = profileGeometry(endProfile, 0.025);
  for (const sx of [-1, 1]) {
    const end = shadowed(new THREE.Mesh(endGeo, wood));
    end.position.x = sx * (DECK.w / 2 - 0.0125);
    group.add(end);
  }
  const rail = shadowed(box(INNER_W, GLASS.y0 - DECK.y1, 0.026, wood, 0, (DECK.y1 + GLASS.y0) / 2, FRONT_Z - 0.013));
  const back = shadowed(box(INNER_W, CAP.y0 - DECK.y1, 0.02, wood, 0, (DECK.y1 + CAP.y0) / 2, BACK_Z - 0.0115));
  const cap = shadowed(box(DECK.w, CAP.y1 - CAP.y0, CAP.z1 - CAP.z0, wood, 0, (CAP.y0 + CAP.y1) / 2, (CAP.z0 + CAP.z1) / 2));
  group.add(rail, back, cap);
  // Brass beading where the glass meets the wood.
  const beadGeo = new THREE.CylinderGeometry(0.005, 0.005, INNER_W, 8);
  beadGeo.rotateZ(Math.PI / 2);
  for (const [y, z] of [
    [GLASS.y0, GLASS.z0],
    [GLASS.y1, GLASS.z1],
  ]) {
    const bead = new THREE.Mesh(beadGeo, brass);
    bead.position.set(0, y, z);
    group.add(bead);
  }

  // ---- Inside: velvet floor, price ramp, dividers ------------------------------
  const velvet = new THREE.MeshPhysicalMaterial({
    color: 0x3a0a10,
    roughness: 0.92,
    sheen: 1,
    sheenRoughness: 0.4,
    sheenColor: new THREE.Color(0xb04a52),
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(INNER_W, FRONT_Z - 0.026 - BACK_Z), velvet);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, FLOOR_Y, (FRONT_Z - 0.026 + BACK_Z) / 2);
  floor.receiveShadow = true;
  const ramp = new THREE.Mesh(
    profileGeometry(
      [
        [RAMP.z0, FLOOR_Y],
        [RAMP.z0, RAMP.y0],
        [RAMP.z1, RAMP.y1],
        [RAMP.z1 - 0.012, RAMP.y1],
        [RAMP.z1 - 0.012, FLOOR_Y],
      ],
      INNER_W,
    ),
    velvet,
  );
  group.add(floor, ramp);

  const dividerProfile = [
    [FRONT_Z - 0.026, FLOOR_Y],
    [FRONT_Z - 0.026, glassY(FRONT_Z - 0.026) - 0.004],
    [GLASS.z1, CAP.y0 - 0.002],
    [BACK_Z, CAP.y0 - 0.002],
    [BACK_Z, FLOOR_Y],
  ];
  const dividerGeo = profileGeometry(dividerProfile, 0.01);
  const edgeGeo = new THREE.BoxGeometry(0.012, 0.003, GLASS_LEN - 0.02);
  for (let i = 1; i < SLOTS; i++) {
    const x = slotX(i) - SLOT_W / 2;
    const divider = new THREE.Mesh(dividerGeo, wood);
    divider.position.x = x;
    group.add(divider);
    // A brass edge along each divider, seen as a thin line through the glass.
    const edge = new THREE.Mesh(edgeGeo, brass);
    edge.rotation.x = GLASS_TILT + Math.PI / 2;
    edge.position.set(x, (GLASS.y0 + GLASS.y1) / 2 - 0.006, (GLASS.z0 + GLASS.z1) / 2 - 0.004);
    group.add(edge);
  }

  // ---- Glass -----------------------------------------------------------------
  // A faint tint so it reads as a surface, and an additive layer that only
  // carries the reflection, strongest along the top so the tags stay clear.
  const glassGeo = new THREE.PlaneGeometry(INNER_W, GLASS_LEN);
  const glassTint = new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.1, transparent: true, opacity: 0.07, depthWrite: false });
  const glassSheen = new THREE.MeshStandardMaterial({
    color: 0x000000,
    roughness: 0.14,
    metalness: 0,
    envMap,
    envMapIntensity: SHEEN,
    alphaMap: sheenTexture(),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const glassAt = new THREE.Group();
  glassAt.position.set(0, (GLASS.y0 + GLASS.y1) / 2, (GLASS.z0 + GLASS.z1) / 2);
  glassAt.rotation.x = GLASS_TILT;
  const tint = new THREE.Mesh(glassGeo, glassTint);
  const sheen = new THREE.Mesh(glassGeo, glassSheen);
  sheen.position.z = 0.0005;
  tint.renderOrder = 3;
  sheen.renderOrder = 4;
  glassAt.add(tint, sheen);
  group.add(glassAt);

  // ---- The case light ----------------------------------------------------------
  // One warm lamp tucked under the glass over the talismans, no shadows. A
  // gentle falloff so the outer compartments are not left in the dark.
  const light = new THREE.PointLight(0xffc690, LIGHT, 1.6, 1);
  light.position.set(slotX(1), 0.93, -0.02);
  group.add(light);
  let level = 1;

  // ---- Compartments --------------------------------------------------------------
  const glowTex = glowTexture();
  const padGeo = new RoundedBoxGeometry(PAD.w, PAD.h, PAD.d, 3, 0.012);
  const twine = new THREE.MeshStandardMaterial({ color: 0x8a7a60, roughness: 1 });
  const tagGeo = new THREE.PlaneGeometry(TAG.w, TAG.h);
  const shadeGeo = new THREE.CylinderGeometry(0.009, 0.017, 0.014, 14, 1, true);
  const bulbGeo = new THREE.SphereGeometry(0.0065, 10, 8);
  const pinGeo = new THREE.SphereGeometry(0.0035, 8, 6);
  let locked = false;
  let restockT = -1;
  let firstSync = true;

  const slots = [];
  for (let i = 0; i < SLOTS; i++) {
    const x = slotX(i);
    const s = { i, x, state: 'empty', id: null, charm: null, outgoing: [], rise: 1, riseDelay: 0, light: 0, flare: 0, hover: false, shake: 0, tagKey: '' };

    // The back wall glows when the compartment holds something.
    s.backMat = new THREE.MeshStandardMaterial({ color: 0x2a0c0e, roughness: 0.95, emissive: 0xffb27a, emissiveMap: glowTex, emissiveIntensity: 0 });
    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(SLOT_W - 0.01, CAP.y0 - FLOOR_Y), s.backMat);
    backWall.position.set(x, (FLOOR_Y + CAP.y0) / 2, BACK_Z);
    group.add(backWall);

    // Its lamp: a tiny shaded bulb under the cap.
    s.bulbMat = new THREE.MeshStandardMaterial({ color: 0x2a2018, emissive: 0xffd6a0, emissiveIntensity: 0 });
    const shade = new THREE.Mesh(shadeGeo, brass);
    shade.position.set(x, 1.006, BACK_Z + 0.05);
    const bulb = new THREE.Mesh(bulbGeo, s.bulbMat);
    bulb.position.set(x, 0.998, BACK_Z + 0.05);
    group.add(shade, bulb);

    // The velvet pad the talisman reclines on, with a pin to hang it from.
    s.pad = new THREE.Group();
    s.pad.position.set(x, FLOOR_Y + 0.081, PAD.z);
    s.pad.rotation.x = -PAD.tilt;
    const padMesh = new THREE.Mesh(padGeo, velvet);
    padMesh.receiveShadow = true;
    const pin = new THREE.Mesh(pinGeo, brass);
    pin.position.set(0, PAD.h * 0.36, PAD.d / 2 + 0.002);
    const tie = new THREE.Mesh(pinGeo, brass);
    const tieAt = new THREE.Vector3(-PAD.w / 2 + 0.02, -PAD.h / 2 + 0.03, PAD.d / 2 + 0.001);
    tie.position.copy(tieAt);
    s.mount = new THREE.Group();
    s.mount.position.set(0, PAD.h * 0.36, PAD.d / 2 + 0.007);
    s.mount.scale.setScalar(CHARM_SCALE);
    s.pad.add(padMesh, pin, tie, s.mount);
    group.add(s.pad);

    // The price tag lies on the ramp, tied to the pad. It pivots on its
    // eyelet so a shake swings it on the string.
    s.tagTex = canvasTexture(TAG.px, Math.round((TAG.px * TAG.h) / TAG.w));
    s.tagMat = new THREE.MeshStandardMaterial({
      map: s.tagTex.tex,
      emissiveMap: s.tagTex.tex,
      emissive: 0xffffff,
      emissiveIntensity: TAG_GLOW,
      roughness: 0.9,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    });
    const along = 0.088; // tag centre, measured up the ramp from its front edge
    const eyeletX = -TAG.w / 2 + TAG.h * 0.13; // where drawPriceTag punches the eyelet
    s.tagAt = new THREE.Group();
    s.tagAt.position.set(
      x + eyeletX,
      RAMP.y0 + along * Math.sin(RAMP.slope) + 0.0025,
      RAMP.z0 - along * Math.cos(RAMP.slope),
    );
    s.tagAt.rotation.x = -(Math.PI / 2 - RAMP.slope);
    s.tagPivot = new THREE.Group();
    s.tagPivot.rotation.z = (i % 2 ? 1 : -1) * 0.035;
    s.tag = new THREE.Mesh(tagGeo, s.tagMat);
    s.tag.position.x = -eyeletX;
    s.tag.userData.role = 'compartment';
    s.tag.userData.slot = i;
    s.tagPivot.add(s.tag);
    s.tagAt.add(s.tagPivot);
    group.add(s.tagAt);
    s.pad.updateMatrix();
    s.tagAt.updateMatrix();
    const from = new THREE.Vector3(0, 0, 0.001).applyMatrix4(s.tagAt.matrix);
    const to = tieAt.clone().applyMatrix4(s.pad.matrix);
    s.string = stringMesh(from, to, 0.012, twine);
    group.add(s.string);

    // What the pointer hits: the compartment's whole volume under the glass.
    const hit = new THREE.Mesh(profileGeometry(dividerProfile, SLOT_W - 0.01), new THREE.MeshBasicMaterial());
    hit.material.visible = false;
    hit.position.x = x;
    hit.userData.role = 'compartment';
    hit.userData.slot = i;
    group.add(hit);
    s.hit = hit;
    slots.push(s);
  }

  // ---- The shutter over the oddity compartment ----------------------------------
  const oddity = slots[SLOTS - 1];
  oddity.boards = new THREE.Group();
  oddity.boards.position.set(oddity.x, (GLASS.y0 + GLASS.y1) / 2, (GLASS.z0 + GLASS.z1) / 2);
  oddity.boards.rotation.x = GLASS_TILT;
  const plankSide = new THREE.MeshStandardMaterial({ color: 0x2a1d14, roughness: 0.9 });
  oddity.plankMats = [];
  [
    [-0.15, 0.13, 0.09, null],
    [0.0, -0.05, 0.1, 'not yet'],
    [0.15, 0.04, 0.085, null],
  ].forEach(([along, angle, width, words], k) => {
    const t = canvasTexture(512, Math.round((512 * width) / 0.36));
    drawPlank(t, 1201 + k * 31, words);
    const face = new THREE.MeshStandardMaterial({ map: t.tex, emissiveMap: t.tex, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.85 });
    oddity.plankMats.push(face);
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.36, width, 0.012), [plankSide, plankSide, plankSide, plankSide, face, plankSide]);
    plank.position.set(0, along, 0.008 + k * 0.001);
    plank.rotation.z = angle;
    plank.castShadow = true;
    plank.userData.role = 'compartment';
    plank.userData.slot = oddity.i;
    oddity.boards.add(plank);
  });
  oddity.boards.visible = false;
  group.add(oddity.boards);

  // ---- Restock crank, right side panel --------------------------------------------
  const crank = new THREE.Group();
  crank.position.set(CRANK.x, CRANK.y, CRANK.z);
  const axisX = (geo) => geo.rotateZ(Math.PI / 2);
  const hub = new THREE.Mesh(axisX(new THREE.CylinderGeometry(0.034, 0.038, 0.022, 24)), brass);
  hub.position.x = 0.011;
  const axle = new THREE.Mesh(axisX(new THREE.CylinderGeometry(0.008, 0.008, 0.04, 10)), brass);
  axle.position.x = 0.03;
  const crankArm = new THREE.Group();
  crankArm.position.x = 0.046;
  const arm = box(0.012, CRANK.arm + 0.02, 0.02, brass, 0, CRANK.arm / 2, 0);
  const knob = new THREE.Mesh(axisX(new THREE.CylinderGeometry(0.013, 0.016, 0.065, 14)), wood);
  knob.position.set(0.04, CRANK.arm, 0);
  const knobCap = new THREE.Mesh(new THREE.SphereGeometry(0.013, 12, 8), brass);
  knobCap.position.set(0.074, CRANK.arm, 0);
  crankArm.add(arm, knob, knobCap);
  crankArm.rotation.x = deg(-20);
  crank.add(hub, axle, crankArm);
  hub.castShadow = true;
  arm.castShadow = true;
  // A generous invisible handle: the crank itself is thin.
  const crankHit = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.26, 0.26), new THREE.MeshBasicMaterial());
  crankHit.material.visible = false;
  crankHit.position.x = 0.07;
  crankHit.userData.role = 'crank';
  crank.add(crankHit);
  group.add(crank);
  const crankRest = crankArm.rotation.x;

  // Its tag hangs off the axle on a string, turned to face the player.
  const crankTex = canvasTexture(512, Math.round((512 * CRANK_TAG.h) / CRANK_TAG.w));
  const crankTagMat = new THREE.MeshStandardMaterial({
    map: crankTex.tex,
    emissiveMap: crankTex.tex,
    emissive: 0xffffff,
    emissiveIntensity: TAG_GLOW,
    roughness: 0.9,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  });
  const crankTagAt = new THREE.Group();
  crankTagAt.position.set(CRANK.x + 0.11, CRANK.y - 0.1, CRANK.z + 0.09);
  crankTagAt.rotation.set(deg(-12), deg(-26), 0, 'YXZ');
  const crankTagPivot = new THREE.Group();
  const crankTag = new THREE.Mesh(new THREE.PlaneGeometry(CRANK_TAG.w, CRANK_TAG.h), crankTagMat);
  crankTag.position.y = -CRANK_TAG.h * 0.41;
  crankTag.userData.role = 'crank';
  crankTagPivot.add(crankTag);
  crankTagAt.add(crankTagPivot);
  group.add(crankTagAt);
  group.add(stringMesh(new THREE.Vector3(CRANK.x + 0.05, CRANK.y, CRANK.z), crankTagAt.position.clone(), 0.015, twine));

  // ---- Rarity chart, nailed to the front-left panel ---------------------------------
  const chartTex = canvasTexture(800, 600);
  const chartMat = new THREE.MeshStandardMaterial({ map: chartTex.tex, emissiveMap: chartTex.tex, emissive: 0xffffff, emissiveIntensity: SIGN_GLOW, roughness: 0.9 });
  const chartAt = new THREE.Group();
  chartAt.position.set(CHART.x, CHART.y, fz + 0.009);
  chartAt.rotation.z = 0.018;
  const chart = new THREE.Mesh(new THREE.PlaneGeometry(CHART.w, CHART.h), chartMat);
  chart.userData.role = 'chart';
  chartAt.add(chart);
  const nailGeo = new THREE.CylinderGeometry(0.0055, 0.0055, 0.006, 10);
  nailGeo.rotateX(Math.PI / 2);
  for (const sx of [-1, 1]) {
    const nail = new THREE.Mesh(nailGeo, materials.darkMetal ?? brass);
    nail.position.set(sx * (CHART.w / 2 - 0.026), CHART.h / 2 - 0.025, 0.003);
    chartAt.add(nail);
  }
  group.add(chartAt);
  drawChart(chartTex, null);

  // ---- Pointer -------------------------------------------------------------------
  const hover = (target, ev) => callbacks.onHover?.(target, ev);
  for (const s of slots) {
    const handler = {
      enabled: () => !locked,
      hover(hit, ev) {
        s.hover = true;
        hover({ kind: 'slot', slot: s.i }, ev);
      },
      leave() {
        s.hover = false;
        hover(null);
      },
      click: () => callbacks.onBuy?.(s.i),
    };
    interaction.add(s.hit, handler);
    interaction.add(s.tag, handler);
    if (s.boards) interaction.add(s.boards, handler);
  }
  let crankHover = false;
  const crankHandler = {
    enabled: () => !locked,
    hover(hit, ev) {
      crankHover = true;
      hover({ kind: 'crank' }, ev);
    },
    leave() {
      crankHover = false;
      hover(null);
    },
    click: () => callbacks.onRestock?.(),
  };
  interaction.add(crankHit, crankHandler);
  interaction.add(crankTag, crankHandler);
  interaction.add(chart, {
    enabled: () => !locked,
    cursor: 'help',
    hover: (hit, ev) => hover({ kind: 'chart' }, ev),
    leave: () => hover(null),
  });

  // ---- Charms --------------------------------------------------------------------
  // One model per talisman id, reused across restocks.
  const pool = new Map();
  function takeCharm(id) {
    const list = pool.get(id) ?? [];
    pool.set(id, list);
    let obj = list.find((o) => !o.parent);
    if (!obj) {
      obj = makeCharm?.(id);
      if (!obj) return null;
      list.push(obj);
    }
    obj.position.set(0, 0, 0);
    obj.scale.setScalar(1);
    obj.visible = true;
    return obj;
  }
  const releaseCharm = (obj) => {
    obj.userData.setGlow?.(0);
    obj.parent?.remove(obj);
  };

  function setCharm(s, id) {
    if (id === s.id) return;
    if (s.charm) {
      if (firstSync) releaseCharm(s.charm);
      // Bought, it lifts off the pad; restocked away, it sinks into the velvet.
      else s.outgoing.push({ obj: s.charm, t: 0, sink: restockT >= 0 });
    }
    s.charm = null;
    s.id = id;
    if (!id) return;
    const obj = takeCharm(id);
    if (!obj) return;
    s.mount.add(obj);
    s.charm = obj;
    if (firstSync) {
      s.rise = 1;
      s.riseDelay = 0;
    } else {
      s.rise = 0;
      s.riseDelay = restockT >= 0 ? Math.max(0, flickerOn(s.i) + 0.08 - restockT) : 0;
    }
  }

  // ---- Sync ------------------------------------------------------------------------
  let crankKey = '';
  let chartKey = '';

  function syncSlot(s, offer) {
    let state = 'empty';
    if (offer?.kind === 'talisman') state = offer.sold || !offer.id ? 'sold' : 'stock';
    else if (offer?.shut) state = 'shut';
    s.state = state;
    if (s.boards) s.boards.visible = state === 'shut';
    s.pad.visible = state !== 'shut';
    const tagged = state === 'stock' || state === 'sold';
    s.tagAt.visible = tagged;
    s.string.visible = tagged;
    setCharm(s, state === 'stock' ? offer.id : null);
    if (!tagged) return;
    const info = {
      state,
      price: state === 'stock' ? format(offer.price) : s.lastPrice ?? '',
      rarity: state === 'stock' ? offer.rarity : s.lastRarity ?? '',
      marks: 0,
      affordable: state === 'stock' ? offer.affordable !== false : true,
      short: offer.short ?? 0,
    };
    // A sold tag keeps what it said, struck off.
    if (state === 'stock') {
      s.lastPrice = info.price;
      s.lastRarity = info.rarity;
    }
    info.marks = RARITIES.indexOf(info.rarity) + 1;
    const key = JSON.stringify(info);
    if (key === s.tagKey) return;
    s.tagKey = key;
    drawPriceTag(s.tagTex, info, 500 + s.i * 37);
  }

  function sync(view) {
    if (!view) return;
    const offers = view.slots ?? [];
    for (const s of slots) syncSlot(s, offers[s.i]);
    if (view.restockCost !== undefined) {
      // cabinetView has no restock affordability yet; read it when it does.
      const info = { cost: format(view.restockCost), affordable: view.canRestock !== false };
      const key = JSON.stringify(info);
      if (key !== crankKey) {
        crankKey = key;
        drawCrankTag(crankTex, info);
      }
    }
    if (view.rarityOdds) {
      const key = JSON.stringify(view.rarityOdds);
      if (key !== chartKey) {
        chartKey = key;
        drawChart(chartTex, view.rarityOdds);
      }
    }
    firstSync = false;
  }

  // ---- Reactions ---------------------------------------------------------------------
  let crankShake = 0;
  let chartShake = 0;

  function pulse(slot) {
    const s = slots[slot];
    if (s) s.flare = 1;
  }

  function deny(target) {
    if (!target) return;
    if (target.kind === 'slot' && slots[target.slot]) slots[target.slot].shake = 1;
    else if (target.kind === 'crank') crankShake = 1;
    else if (target.kind === 'chart') chartShake = 1;
  }

  function restockAnim() {
    restockT = 0;
    // Whatever stands in a compartment rises in again when its light catches.
    for (const s of slots) {
      if (!s.charm) continue;
      s.rise = 0;
      s.riseDelay = flickerOn(s.i) + 0.08;
    }
  }

  // ---- Per frame -----------------------------------------------------------------------
  function update(dt, t = 0) {
    // An old bulb never burns quite steady.
    const waver = 1 + Math.sin(t * 6.1) * 0.012 + Math.sin(t * 15.7) * 0.008;
    const ease = 1 - Math.exp(-dt * 6);
    if (restockT >= 0) {
      restockT += dt;
      const e = easeInOut(Math.min(1, restockT / RESTOCK_TIME));
      crankArm.rotation.x = crankRest + e * Math.PI * 2;
      if (restockT >= RESTOCK_TIME + 0.1) {
        restockT = -1;
        crankArm.rotation.x = crankRest;
      }
    }
    let lit = 0;
    let lamps = 0;
    for (const s of slots) {
      const target = s.state === 'stock' ? 1 : s.state === 'sold' ? 0.05 : 0;
      s.light += (target - s.light) * ease;
      s.flare = Math.max(0, s.flare - dt * 2.2);
      const flick = restockT >= 0 ? restockFlicker(s.i, restockT) : 1;
      const hovered = s.hover && !locked ? 0.25 : 0;
      const L = (s.light + hovered * Math.max(s.light, 0.3)) * flick + s.flare * 0.9;
      s.backMat.emissiveIntensity = BACK_GLOW * level * L * waver;
      s.bulbMat.emissiveIntensity = BULB_GLOW * level * Math.min(1.2, s.light * flick + s.flare * 0.5) * waver;
      s.tagMat.emissiveIntensity = TAG_GLOW * level * (0.6 + 0.4 * Math.min(1, s.light * flick + hovered));
      if (s.state !== 'shut') {
        lit += s.light * flick + s.flare * 0.4;
        lamps += 1;
      }
      // A talisman rises out of the velvet when it arrives.
      if (s.charm) {
        if (s.riseDelay > 0) s.riseDelay -= dt;
        else s.rise = Math.min(1, s.rise + dt / 0.3);
        const e = easeInOut(s.rise);
        s.charm.visible = s.rise > 0;
        s.charm.position.set(0, -0.04 * (1 - e), -0.01 * (1 - e));
        s.charm.scale.setScalar(Math.max(0.001, 0.5 + 0.5 * e));
        s.charm.userData.setGlow?.(Math.min(1, s.flare));
      }
      for (const out of s.outgoing) {
        out.t += dt / 0.28;
        if (out.sink) out.obj.position.set(0, -0.04 * out.t, -0.01 * out.t);
        else out.obj.position.set(0, 0.05 * out.t, 0.03 * out.t);
        out.obj.scale.setScalar(Math.max(0.001, 1 - out.t));
        if (out.t >= 1) releaseCharm(out.obj);
      }
      s.outgoing = s.outgoing.filter((o) => o.t < 1);
      // A refusal shakes the tag on its string.
      if (s.shake > 0) {
        s.shake = Math.max(0, s.shake - dt / 0.4);
        s.tagPivot.rotation.z = (s.i % 2 ? 1 : -1) * 0.035 + Math.sin(s.shake * 38) * 0.09 * s.shake;
      }
    }
    if (oddity.plankMats) for (const m of oddity.plankMats) m.emissiveIntensity = 0.16 * level;
    light.intensity = LIGHT * level * (0.2 + (0.8 * lit) / Math.max(1, lamps)) * waver;
    glassSheen.envMapIntensity = SHEEN * (0.25 + 0.75 * level);
    crankTagMat.emissiveIntensity = TAG_GLOW * level * (crankHover && !locked ? 1.35 : 1);
    chartMat.emissiveIntensity = SIGN_GLOW * level;
    if (crankShake > 0) {
      crankShake = Math.max(0, crankShake - dt / 0.4);
      const wob = Math.sin(crankShake * 36) * crankShake;
      if (restockT < 0) crankArm.rotation.x = crankRest + wob * 0.12;
      crankTagPivot.rotation.z = wob * 0.12;
    }
    if (chartShake > 0) {
      chartShake = Math.max(0, chartShake - dt / 0.4);
      chartAt.rotation.z = 0.018 + Math.sin(chartShake * 36) * 0.03 * chartShake;
    }
  }

  function setLocked(v) {
    locked = v;
    if (!v) return;
    const wasHovered = crankHover || slots.some((s) => s.hover);
    crankHover = false;
    for (const s of slots) s.hover = false;
    if (wasHovered) hover(null);
  }

  function setLightLevel(x) {
    level = Math.max(0, x);
  }

  // ---- Where things are, for notes and the smoke test ----------------------------------
  function slotWorldPosition(slot, out = new THREE.Vector3()) {
    const s = slots[slot];
    if (!s) return null;
    group.updateMatrixWorld();
    if (s.state === 'shut') return oddity.boards.localToWorld(out.set(0, 0, 0.01));
    return s.pad.localToWorld(out.set(0, PAD.h * 0.05, PAD.d / 2 + 0.01));
  }

  function crankWorldPosition(out = new THREE.Vector3()) {
    group.updateMatrixWorld();
    return crank.localToWorld(out.set(0.06, 0.02, 0));
  }

  function chartWorldPosition(out = new THREE.Vector3()) {
    group.updateMatrixWorld();
    return chartAt.localToWorld(out.set(0, 0, 0));
  }

  return {
    group,
    /** Where the first-person camera looks when turned to the cabinet (local). */
    focus: new THREE.Vector3(0, 0.8, 0.04),
    sync,
    pulse,
    deny,
    restockAnim,
    update,
    setLocked,
    setLightLevel,
    slotWorldPosition,
    crankWorldPosition,
    chartWorldPosition,
  };
}
