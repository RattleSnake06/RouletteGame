import { box, clamp01, cone, cylinder, ellipsoid, noise3, smax, smin, smooth, sphere } from '../sculptCore.js';

// The figure (design doc 8.1, 8.5): you, standing at the table, and every
// figure left in the dark. A gambler waiting on the ball with his hands deep
// in his pockets: a rumpled shirt with its sleeves rolled to the forearm and
// its collar open over a loosened black tie, oxblood braces buttoned to
// pressed trousers that break over polished cap-toe shoes, dark hair swept
// back, a day's stubble and the eyes of a man who has not slept. Feet at
// y 0, facing +z, about 1.8 m tall. Each part is a distance field
// (sculptCore.js), meshed at its own cell size: the body coarse, the head
// and shoes fine.

export const version = 2;

// ---- Landmarks (metres) ------------------------------------------------------------------

const HIP = [0.092, 0.93, 0.0];
const KNEE = [0.1, 0.52, 0.016];
const ANKLE = [0.104, 0.1, -0.006];
// The shoulders drawn up a little, as they are when the hands are in the pockets.
const SHOULDER = [0.188, 1.421, -0.006];
const ELBOW = [0.248, 1.142, -0.058];
const WRIST = [0.163, 0.957, 0.05];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// The hand, out of sight in the pocket.
const HAND = lerp3(ELBOW, WRIST, 1.22);
// The rolled sleeve, round the top of the forearm.
const ROLL0 = lerp3(ELBOW, WRIST, -0.06);
const ROLL1 = lerp3(ELBOW, WRIST, 0.17);

/** A tapered capsule between two landmarks (no arrays made per sample). */
const seg = (X, y, z, a, b, ra, rb) => cone(X, y, z, a[0], a[1], a[2], b[0], b[1], b[2], ra, rb);
const cyl = (X, y, z, a, b, r) => cylinder(X, y, z, a[0], a[1], a[2], b[0], b[1], b[2], r);

/** How far along a→b the point projects, 0 to 1. */
function along(x, y, z, a, b) {
  const bx = b[0] - a[0];
  const by = b[1] - a[1];
  const bz = b[2] - a[2];
  return ((x - a[0]) * bx + (y - a[1]) * by + (z - a[2]) * bz) / (bx * bx + by * by + bz * bz);
}

/** Signed distance to a polygon in a plane ([x0, y0, x1, y1, …]), negative inside. */
function poly2(x, y, pts) {
  const n = pts.length / 2;
  let d = (x - pts[0]) ** 2 + (y - pts[1]) ** 2;
  let s = 1;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const vx = pts[i * 2];
    const vy = pts[i * 2 + 1];
    const ex = pts[j * 2] - vx;
    const ey = pts[j * 2 + 1] - vy;
    const wx = x - vx;
    const wy = y - vy;
    const h = clamp01((wx * ex + wy * ey) / (ex * ex + ey * ey));
    const bx = wx - ex * h;
    const by = wy - ey * h;
    d = Math.min(d, bx * bx + by * by);
    const c1 = y >= vy;
    const c2 = y < pts[j * 2 + 1];
    const c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}

// ---- Trousers ----------------------------------------------------------------------------

/** The waistband: a flat band, a little proud of the shirt tucked under it. */
function waistband(X, y, z) {
  const k = Math.sqrt((X / 0.163) ** 2 + ((z + 0.006) / 0.111) ** 2);
  return smax((k - 1) * 0.111, Math.abs(y - 1.03) - 0.026, 0.008);
}
const hips = (X, y, z) => ellipsoid(X, y, z, 0, 0.955, -0.008, 0.166, 0.112, 0.106);

/** Distance (across the cloth) to the slanted mouth of the front pocket. */
function pocketMouth(X, y) {
  const t = clamp01((y - 1.0) / (0.884 - 1.0));
  return Math.hypot(X - (0.119 + 0.059 * t), y - (1.0 + (0.884 - 1.0) * t));
}

function trousers(X, y, z) {
  let d = hips(X, y, z);
  d = smin(d, seg(X, y, z, HIP, KNEE, 0.083, 0.061), 0.05);
  d = smin(d, seg(X, y, z, KNEE, ANKLE, 0.059, 0.052), 0.02);
  // The break: cloth pooling a little over the shoe.
  d = smin(d, ellipsoid(X, y, z, 0.104, 0.114, 0.006, 0.058, 0.03, 0.066), 0.018);
  d = smin(d, waistband(X, y, z), 0.006);
  // The hand in the pocket, pushing the cloth out.
  d = smin(d, ellipsoid(X, y, z, 0.15, 0.902, 0.036, 0.031, 0.054, 0.034), 0.022);
  // The pocket's mouth, gaping where the wrist goes in, and the fly.
  if (z > 0) {
    d += 0.0026 * Math.exp(-((pocketMouth(X, y) / 0.005) ** 2));
    if (y > 0.86 && y < 1.0) d += 0.0014 * Math.exp(-(((X - 0.012) / 0.004) ** 2)) * smooth(0.86, 0.9, y);
  }
  // A pressed crease down the front of each leg.
  const lx = y > KNEE[1] ? HIP[0] + (KNEE[0] - HIP[0]) * smooth(HIP[1], KNEE[1], y) : KNEE[0] + (ANKLE[0] - KNEE[0]) * smooth(KNEE[1], ANKLE[1], y);
  if (z > 0 && y < 0.86 && y > 0.14) d -= 0.0016 * Math.exp(-(((X - lx) / 0.009) ** 2));
  // Wool hangs in soft folds, gathering behind the knee and at the break.
  d += 0.0017 * noise3(X * 26, y * 14, z * 26, 3);
  const knee = smooth(0.42, 0.5, y) * (1 - smooth(0.58, 0.65, y));
  d += knee * 0.0024 * Math.sin(y * 190 + noise3(X * 40, y * 20, z * 40, 5) * 2);
  d += (1 - smooth(0.13, 0.22, y)) * 0.0015 * Math.sin(y * 150 + X * 30 + z * 20 + noise3(X * 30, y * 30, z * 30, 35) * 3);
  // Pulled toward the pocket where the hand is.
  d += smooth(0.84, 0.9, y) * (1 - smooth(0.95, 1.0, y)) * 0.0012 * Math.sin((y - X * 1.4) * 200 + noise3(X * 25, y * 25, z * 25, 33) * 4);
  return d;
}

// The brace buttons on the waistband, front and back.
const BRACE_TABS = [[0.069, 1.037, 1], [0.0, 1.04, -1]];

function braceTab(X, y, z) {
  let d = Infinity;
  for (const [tx, ty, side] of BRACE_TABS) {
    const t = Math.max(waistband(X, y, z) - 0.0034, Math.abs(X - tx) - 0.012, Math.abs(y - ty) - 0.021, -z * side);
    d = Math.min(d, t);
  }
  return d;
}

function lowerField(x, y, z) {
  const X = Math.abs(x);
  return smin(trousers(X, y, z), braceTab(X, y, z), 0.002);
}

function lowerLabel(x, y, z) {
  const X = Math.abs(x);
  return braceTab(X, y, z) < trousers(X, y, z) ? 'braces' : 'trousers';
}

// Shapes from the other parts, for the shading in the creases between them.
function lowerOccluder(x, y, z) {
  const X = Math.abs(x);
  let d = ellipsoid(X, y, z, 0, 1.12, -0.004, 0.158, 0.1, 0.104);
  d = Math.min(d, seg(X, y, z, ELBOW, HAND, 0.036, 0.027));
  return Math.min(d, ellipsoid(X, y, z, 0.106, 0.04, 0.05, 0.05, 0.045, 0.12));
}

// ---- Shoes: cap-toe Oxfords ------------------------------------------------------------

function shoe(X, y, z) {
  let d = ellipsoid(X, y, z, 0.104, 0.052, -0.036, 0.046, 0.052, 0.066);
  d = smin(d, ellipsoid(X, y, z, 0.108, 0.04, 0.098, 0.05, 0.037, 0.082), 0.045);
  // The toe cap, a little rounder, and its stitched seam.
  d = smin(d, ellipsoid(X, y, z, 0.108, 0.034, 0.148, 0.043, 0.03, 0.04), 0.02);
  if (y > 0.022) d += 0.0011 * Math.exp(-(((z - 0.128 + (X - 0.108) ** 2 * 6) / 0.0022) ** 2));
  d = smin(d, cone(X, y, z, 0.104, 0.07, -0.022, 0.104, 0.112, -0.012, 0.043, 0.041), 0.02);
  // The laced panel over the instep, a shade proud.
  d -= 0.0012 * smooth(0.012, 0.004, Math.abs(X - 0.106)) * smooth(0.02, 0.03, z) * (1 - smooth(0.075, 0.085, z)) * smooth(0.06, 0.07, y);
  // A flat sole with a welt round it, and a heel block.
  d = smax(d, -y, 0.003);
  d = smin(d, box(X, y, z, 0.106, 0.008, 0.045, 0.05, 0.008, 0.125, 0.006), 0.004);
  d = smin(d, box(X, y, z, 0.104, 0.014, -0.05, 0.04, 0.014, 0.035, 0.006), 0.003);
  return d;
}

function shoesField(x, y, z) {
  return shoe(Math.abs(x), y, z);
}

function shoesLabel(x, y, z) {
  if (y < 0.013) return 'sole';
  if (y < 0.028 && z < -0.014) return 'sole';
  return 'shoes';
}

const shoesOccluder = (x, y, z) => seg(Math.abs(x), y, z, KNEE, ANKLE, 0.059, 0.052);

// ---- The upper body: shirt, braces, tie, forearms, neck -----------------------------------

function torso(X, y, z) {
  let d = ellipsoid(X, y, z, 0, 1.335, 0.0, 0.168, 0.19, 0.105);
  d = smin(d, ellipsoid(X, y, z, 0, 1.15, -0.004, 0.152, 0.17, 0.1), 0.06);
  d = smin(d, ellipsoid(X, y, z, 0, 1.0, -0.006, 0.156, 0.08, 0.102), 0.05);
  d = smin(d, sphere(X, y, z, SHOULDER[0] - 0.006, SHOULDER[1], SHOULDER[2], 0.062), 0.07);
  // The slope from the neck to the shoulder, and the blades behind.
  d = smin(d, cone(X, y, z, 0.03, 1.5, -0.025, 0.17, 1.447, -0.012, 0.05, 0.05), 0.05);
  d = smin(d, ellipsoid(X, y, z, 0.08, 1.36, -0.068, 0.07, 0.09, 0.04), 0.04);
  return d;
}

// The collar's points, splayed open on the chest (a front view, x and y).
const LEAF = [0.038, 1.503, 0.022, 1.432, 0.057, 1.385, 0.099, 1.452, 0.07, 1.505];
// The open neck between them, down to the knot.
const VNECK = [0.0, 1.398, 0.025, 1.43, 0.042, 1.52, 0.05, 1.57, 0.0, 1.57];

function collarBand(X, y, z) {
  // A band round the neck's foot, standing up behind and falling open in front.
  const a = 0.36;
  const cy = 1.49;
  const yy = (y - cy) * Math.cos(a) - z * Math.sin(a);
  const zz = (y - cy) * Math.sin(a) + z * Math.cos(a);
  const q = Math.sqrt(X * X + zz * zz) - 0.063;
  const d = box(q, yy, 0, 0, 0.004, 0, 0.0055, 0.014, 1, 0.004);
  // Lower toward the front, where it turns down into the points.
  return smax(d + 0.006 * smooth(-0.01, 0.03, zz), zz - 0.03, 0.016);
}

// A shell over the shirt (its back face hidden just under it), cut to shape.
function collarLeaf(X, y, z) {
  const t = torso(X, y, z);
  return Math.max(smax(t - 0.006, poly2(X, y, LEAF) + 0.001, 0.003), -t - 0.004, 0.02 - z);
}

/** How far across from the middle of the nearest brace. */
function braceDist(X, y, z) {
  if (y > 1.43) return Math.abs(X - 0.111);
  if (z > 0) return y > 1.02 ? Math.abs(X - (0.068 + (y - 1.03) * 0.1)) : 1;
  if (y < 1.04) return 1;
  // Behind, the two straps meet in a Y between the blades.
  return y < 1.25 ? X : Math.abs(X - (y - 1.25) * 0.5);
}
const BRACE_W = 0.0135;

// The tie, loosened: the knot pulled down below the open collar, the blade
// hanging a little askew. It is the one thing not mirrored, so it takes x.
const KNOT = [0.004, 1.418, 0.094];
function tieStrip(x, y) {
  const drop = 1.405 - y;
  const cx = 0.004 + drop * 0.055;
  const w = 0.013 + drop * 0.09;
  const ax = Math.abs(x - cx);
  return Math.max(ax - w, 1.076 + ax * 0.9 - y, y - 1.41);
}
function tie(x, y, z) {
  // The knot: a tapered block, wide under the collar and narrowing to the blade.
  const kw = 0.0105 + 0.0085 * smooth(1.404, 1.432, y);
  const knot = box(x, y, z, KNOT[0], KNOT[1], KNOT[2] + 0.001, kw, 0.0125, 0.0065, 0.0035) - 0.0005 * Math.sin((y - 1.405) * 600 + x * 400);
  const t = torso(Math.abs(x), y, z);
  const blade = Math.max(t - 0.0046, -t - 0.004, tieStrip(x, y), -z);
  return smin(knot, blade, 0.006);
}

function sleeve(X, y, z) {
  let d = seg(X, y, z, SHOULDER, ELBOW, 0.059, 0.048);
  // The rolled cuff, ending square on the forearm, with two turns of cloth.
  d = smin(d, cyl(X, y, z, ROLL0, ROLL1, 0.0435) - 0.003, 0.012);
  d = smin(d, cyl(X, y, z, lerp3(ELBOW, WRIST, 0.05), lerp3(ELBOW, WRIST, 0.08), 0.0455) - 0.0025, 0.005);
  d = smin(d, cyl(X, y, z, lerp3(ELBOW, WRIST, 0.125), lerp3(ELBOW, WRIST, 0.155), 0.0445) - 0.0025, 0.005);
  // Creases bunched in the crook of the elbow.
  const t = along(X, y, z, SHOULDER, ELBOW);
  d += smooth(0.6, 0.95, t) * 0.0022 * Math.sin(t * 70 + noise3(X * 50, y * 50, z * 50, 9) * 3);
  d += 0.0012 * noise3(X * 28, y * 28, z * 28, 7);
  return d;
}

function forearm(X, y, z) {
  let d = seg(X, y, z, ELBOW, HAND, 0.039, 0.027);
  const swell = lerp3(ELBOW, WRIST, 0.3);
  d = smin(d, ellipsoid(X, y, z, swell[0] + 0.003, swell[1], swell[2] - 0.002, 0.037, 0.058, 0.037), 0.02);
  return d;
}

/** The neck, shared by the body and the head so the two meet without a seam. */
function neck(X, y, z) {
  let d = cone(X, y, z, 0, 1.45, -0.012, 0, 1.62, -0.002, 0.055, 0.047);
  // The cords running down to the collarbone, and the Adam's apple.
  d = smin(d, cone(X, y, z, 0.047, 1.6, -0.012, 0.014, 1.46, 0.04, 0.011, 0.012), 0.018);
  return smin(d, sphere(X, y, z, 0, 1.54, 0.04, 0.011), 0.014);
}

function shirt(X, y, z) {
  let d = smin(torso(X, y, z), sleeve(X, y, z), 0.04);
  // The cuff's edge eases onto the forearm rather than stepping off it.
  d = smin(d, forearm(X, y, z), 0.006);
  // Bloused a little over the waistband, and tucked in below it.
  d = smin(d, ellipsoid(X, y, z, 0, 1.078, -0.006, 0.168, 0.04, 0.112), 0.03);
  d = smax(d, 1.012 - y, 0.01);
  // The open neck sits a shade behind the shirt's edge.
  if (z > 0.03) d += 0.003 * smooth(0, -0.006, poly2(X, y, VNECK));
  // Cotton wrinkles: pulled from the armpits toward the pockets, and bunched
  // round the waist where it is tucked in.
  d += 0.0022 * noise3(X * 22, y * 12, z * 22, 11);
  d += 0.0011 * smooth(0.11, 0.16, X) * (1 - smooth(1.28, 1.36, y)) * smooth(1.06, 1.12, y) * Math.sin((y + X * 0.7 - z * 0.5) * 150 + noise3(X * 20, y * 20, z * 20, 31) * 4);
  const tuck = smooth(1.04, 1.06, y) * (1 - smooth(1.07, 1.15, y));
  d += tuck * 0.0032 * Math.sin(Math.atan2(X, z) * 18 + noise3(X * 30, y * 30, z * 30, 13) * 2);
  // The braces lie a shade proud of the shirt.
  d -= 0.0022 * smooth(BRACE_W + 0.0016, BRACE_W - 0.0016, braceDist(X, y, z));
  return d;
}

function upperField(x, y, z) {
  const X = Math.abs(x);
  let d = shirt(X, y, z);
  d = smin(d, forearm(X, y, z), 0.008);
  // The neck tucks inside the head's own just under the jaw.
  const n = smax(neck(X, y, z) + 0.002 * smooth(1.56, 1.6, y), y - 1.606, 0.004);
  return smin(d, n, 0.02);
}

function upperLabel(x, y, z) {
  const X = Math.abs(x);
  // Bare below a clean ring at the cuff's edge.
  if (X > 0.12 && along(X, y, z, ELBOW, WRIST) > 0.172 && forearm(X, y, z) < torso(X, y, z)) return 'skin';
  if (y > 1.46 && neck(X, y, z) < torso(X, y, z) + 0.002) return 'skin';
  if (z > 0.03 && poly2(X, y, VNECK) < 0) return 'skin';
  if (braceDist(X, y, z) < BRACE_W) return 'braces';
  return 'shirt';
}

// The collar and the tie, finer than the shirt so their edges stay crisp.
function collarField(x, y, z) {
  const X = Math.abs(x);
  return Math.min(smin(collarBand(X, y, z), collarLeaf(X, y, z), 0.004), tie(x, y, z));
}

function collarLabel(x, y, z) {
  const X = Math.abs(x);
  return tie(x, y, z) < smin(collarBand(X, y, z), collarLeaf(X, y, z), 0.004) ? 'tie' : 'shirt';
}

const collarOccluder = (x, y, z) => smin(torso(Math.abs(x), y, z), neck(Math.abs(x), y, z), 0.02);

// The tie's silk: dull oxblood stripes running across it on the bias.
function collarTint(x, y, z) {
  if (collarLabel(x, y, z) !== 'tie') return null;
  const k = 0.55 + 0.45 * smooth(0.35, 0.6, Math.abs(Math.sin((y + x * 0.9) * 260)));
  return [k * 1.15, k * 0.8, k * 0.82];
}

function upperOccluder(x, y, z) {
  const X = Math.abs(x);
  let d = smin(hips(X, y, z), waistband(X, y, z), 0.006);
  d = Math.min(d, ellipsoid(X, y, z, 0, 1.635, 0.03, 0.062, 0.045, 0.07));
  return d;
}

// ---- The head ----------------------------------------------------------------------------

const EYE = [0.031, 1.6935, 0.077];
const EYE_R = 0.0128;

/** The eye's opening between the lids: an almond, its outer corner lifted. */
function eyeOpening(X, y) {
  const u = X - EYE[0];
  const top = EYE[1] + 0.0048 - 28 * u * u + 0.05 * u;
  const bot = EYE[1] - 0.0052 + 22 * u * u + 0.05 * u;
  return Math.max(y - top, bot - y);
}

function headSkin(X, y, z) {
  let d = ellipsoid(X, y, z, 0, 1.712, -0.008, 0.074, 0.09, 0.094);
  d = smin(d, ellipsoid(X, y, z, 0, 1.672, 0.028, 0.064, 0.082, 0.074), 0.03);
  // The jaw, a little square, and the chin.
  d = smin(d, ellipsoid(X, y, z, 0, 1.63, 0.034, 0.058, 0.043, 0.06), 0.03);
  d = smin(d, ellipsoid(X, y, z, 0.034, 1.618, 0.022, 0.02, 0.016, 0.03), 0.02);
  d = smin(d, sphere(X, y, z, 0, 1.607, 0.073, 0.021), 0.02);
  // Cheekbones and the brow.
  d = smin(d, sphere(X, y, z, 0.046, 1.676, 0.061, 0.019), 0.02);
  d = smin(d, cone(X, y, z, 0, 1.713, 0.083, 0.042, 1.712, 0.077, 0.013, 0.01), 0.016);
  // Eye sockets, and the lids closing over the eyes but for the opening.
  d = smax(d, -ellipsoid(X, y, z, EYE[0], 1.695, 0.09, 0.02, 0.0125, 0.016), 0.008);
  const lids = smax(sphere(X, y, z, EYE[0], EYE[1], EYE[2], EYE_R + 0.0014), -eyeOpening(X, y), 0.0012);
  d = smin(d, lids, 0.003);
  // A heavy fold over the upper lid.
  d = smin(d, ellipsoid(X, y, z, EYE[0] + 0.002, 1.7045, 0.083, 0.014, 0.003, 0.005), 0.004);
  // The nose's bridge, tip and wings, and the nostrils.
  d = smin(d, cone(X, y, z, 0, 1.703, 0.088, 0, 1.662, 0.106, 0.0085, 0.011), 0.01);
  d = smin(d, sphere(X, y, z, 0, 1.655, 0.104, 0.013), 0.008);
  d = smin(d, sphere(X, y, z, 0.0115, 1.652, 0.096, 0.0085), 0.006);
  d = smax(d, -ellipsoid(X, y, z, 0.0072, 1.6442, 0.0975, 0.0034, 0.0022, 0.0045), 0.002);
  // The folds from the nose to the mouth's corners.
  d -= 0.0012 * Math.exp(-(((X - 0.022 - (1.655 - y) * 0.35) / 0.003) ** 2)) * smooth(1.625, 1.635, y) * (1 - smooth(1.65, 1.655, y)) * smooth(0.07, 0.08, z);
  // The lips, and the line between them.
  d = smin(d, smin(lipUpper(X, y, z), lipLower(X, y, z), 0.002), 0.006);
  d = smax(d, -box(X, y, z, 0, 1.6292, 0.099, 0.0215, 0.0009, 0.009, 0), 0.0016);
  // The groove from the nose to the lip.
  d += 0.0009 * Math.exp(-((X / 0.003) ** 2)) * smooth(1.637, 1.641, y) * (1 - smooth(1.646, 1.65, y));
  // Ears, hollowed.
  d = smin(d, ellipsoid(X, y, z, 0.077, 1.683, -0.004, 0.011, 0.03, 0.019), 0.006);
  d = smax(d, -ellipsoid(X, y, z, 0.085, 1.684, -0.002, 0.006, 0.021, 0.012), 0.003);
  // The neck, ending inside the body's just above the collar.
  return smin(d, smax(neck(X, y, z) + 0.001, 1.55 - y, 0.004), 0.03);
}
// The upper lip with a dip in its middle, the lower one fuller.
const lipUpper = (X, y, z) => cone(X, y, z, 0.006, 1.6338, 0.0932, 0.0225, 1.6318, 0.0866, 0.0062, 0.0031) - 0.0006 * smooth(0.006, 0.0, X);
const lipLower = (X, y, z) => cone(X, y, z, 0, 1.6242, 0.0925, 0.0195, 1.626, 0.0866, 0.0076, 0.0031);
const eye = (X, y, z) => sphere(X, y, z, EYE[0], EYE[1], EYE[2], EYE_R);

/** How high the hair comes down, all round the head. */
function hairline(X, z) {
  let h = 1.62 + 0.131 * smooth(-0.05, 0.075, z);
  h -= 0.028 * smooth(0.035, 0.068, X) * smooth(0.0, 0.06, z);
  // Clear of the ears.
  h = Math.max(h, 1.712 * smooth(0.06, 0.07, X) * (1 - smooth(0.02, 0.04, Math.abs(z - 0.003))));
  return h;
}

function hair(x, y, z) {
  const X = Math.abs(x);
  let d = ellipsoid(x, y, z, 0.002, 1.722, -0.01, 0.081, 0.093, 0.102);
  // Swept back over the crown, a little fuller on the parting side.
  d = smin(d, ellipsoid(x, y, z, 0.008, 1.776, 0.004, 0.068, 0.042, 0.088), 0.03);
  // Strands combed back: fine across, long front to back.
  d += 0.0011 * noise3(x * 170, y * 120, z * 18, 17) + 0.0005 * noise3(x * 380, y * 260, z * 40, 19);
  // The parting, on the left.
  d += 0.0018 * Math.exp(-(((x + 0.03) / 0.003) ** 2)) * smooth(0.0, 0.06, z) * smooth(1.76, 1.78, y);
  d = smax(d, hairline(X, z) - y, 0.006);
  return d;
}

function headField(x, y, z) {
  const X = Math.abs(x);
  return Math.min(smin(headSkin(X, y, z), hair(x, y, z), 0.002), eye(X, y, z));
}

function headLabel(x, y, z) {
  const X = Math.abs(x);
  const s = headSkin(X, y, z);
  const e = eye(X, y, z);
  if (e < s && e < hair(x, y, z)) {
    // Looking down a touch, at the wheel.
    const r = Math.hypot(X - EYE[0], y - (EYE[1] - 0.0012));
    return r < 0.0022 ? 'pupil' : r < 0.0056 ? 'iris' : 'eye';
  }
  if (hair(x, y, z) < s + 0.0006) return 'hair';
  if (z > 0.082 && Math.min(lipUpper(X, y, z), lipLower(X, y, z)) < 0.0016) return 'lips';
  return 'skin';
}

// The skin's colour across the face: a day's stubble on the jaw and lip,
// shadows under the eyes, a flush on the cheeks and ears.
function headTint(x, y, z) {
  const X = Math.abs(x);
  // Clear of the socket's shade (the colours top out at 1).
  if (eye(X, y, z) < 0.0008) return [1.6, 1.6, 1.6];
  let r = 1;
  let g = 1;
  let b = 1;
  const jaw = (1 - smooth(1.633 + X * 0.34, 1.65 + X * 0.34, y)) * smooth(1.56, 1.6, y) * smooth(-0.02, 0.03, z);
  const lips = Math.exp(-((Math.hypot(X / 1.4, y - 1.629) / 0.011) ** 4));
  const stubble = jaw * (1 - lips) * (0.7 + 0.3 * noise3(x * 900, y * 900, z * 900, 23));
  r -= stubble * 0.34;
  g -= stubble * 0.3;
  b -= stubble * 0.21;
  const tired = Math.exp(-(((X - 0.031) / 0.014) ** 2 + ((y - 1.684) / 0.0055) ** 2)) * (y < 1.689 ? 1 : 0);
  r -= tired * 0.13;
  g -= tired * 0.17;
  b -= tired * 0.12;
  const flush = Math.exp(-(((X - 0.05) / 0.016) ** 2 + ((y - 1.664) / 0.014) ** 2)) + 0.8 * smooth(0.07, 0.082, X) * (1 - smooth(1.71, 1.72, y)) * smooth(1.65, 1.66, y);
  r += flush * 0.04;
  g -= flush * 0.05;
  b -= flush * 0.05;
  // The brows, painted in hair: thick at the bridge, thinning outward, drawn
  // down a little in the middle.
  const u = X - 0.03;
  const half = 0.0044 - (X - 0.01) * 0.065;
  const brow = z > 0.06 ? smooth(half + 0.0013, half - 0.0009, Math.abs(y - (1.7138 - u * 0.05 - (u / 0.03) ** 2 * 0.002))) * smooth(0.006, 0.012, X) * (1 - smooth(0.049, 0.057, X)) : 0;
  const k = 1 - brow * (0.74 + 0.1 * noise3(x * 2200, y * 500, z * 500, 29));
  return [r * k, g * k, b * k];
}

const headOccluder = (x, y, z) => smin(torso(Math.abs(x), y, z), collarBand(Math.abs(x), y, z), 0.004);

// ---- The shape -----------------------------------------------------------------------------

const PART = (name, labels, field, label, min, max, cell, more = {}) => ({ name, labels, field, label, min, max, cell, ...more });

export const figureShape = {
  version,
  parts: [
    PART('lower', ['trousers', 'braces'], lowerField, lowerLabel, [-0.24, 0.06, -0.15], [0.24, 1.075, 0.16], 0.0085, { occluder: lowerOccluder }),
    PART('shoes', ['shoes', 'sole'], shoesField, shoesLabel, [-0.17, -0.004, -0.11], [0.17, 0.13, 0.25], 0.006, { occluder: shoesOccluder }),
    PART('upper', ['shirt', 'braces', 'skin'], upperField, upperLabel, [-0.32, 0.9, -0.17], [0.32, 1.625, 0.15], 0.007, { occluder: upperOccluder, ao: 0.24 }),
    PART('collar', ['shirt', 'tie'], collarField, collarLabel, [-0.12, 1.06, -0.1], [0.12, 1.56, 0.14], 0.0036, { occluder: collarOccluder, tint: collarTint }),
    PART('head', ['skin', 'hair', 'eye', 'iris', 'pupil', 'lips'], headField, headLabel, [-0.11, 1.54, -0.13], [0.11, 1.84, 0.13], 0.0034, { occluder: headOccluder, tint: headTint, ao: 0.24 }),
  ],
};
