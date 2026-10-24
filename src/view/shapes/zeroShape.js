import { box, clamp01, cone, ellipsoid, noise3, smax, smin, smooth, sphere, torusY } from '../sculptCore.js';

// Madame Zero (design doc 5.9, 8.1), sculpted: a headless automaton in a
// long black satin skirt, a boned corset laced over the front, and a crimson
// blouse ruffled at the neck, its sleeves puffed. Porcelain forearms swing
// on ball joints, ringed in brass at the wrist; the hands press flat to the
// sides of her own head, held at her waist, fingers curled round the cheeks,
// nails lacquered black. The head is a porcelain doll's: blank domed eyes
// under heavy lids, a small nose, a bow of a mouth, the face painted over
// (zero.js) and mapped to it here, under a wound oxblood turban with a black
// band and a gold brooch set with a ruby.
//
// Three frames, as zero.js holds them: the body's (her case floor, +z toward
// the player), the grip's (the head's centre, tilted askew in her hands) and
// the head's own (the same centre, turning inside the grip to watch you).

export const version = 1;

// ---- Frames and landmarks ------------------------------------------------------------------

/** The head's centre in the body's frame, and how far askew she holds it. */
export const HEAD = [0, 0.47, 0.2];
export const ROLL = -0.1;
/** Where her neck ends in its brass socket. */
export const NECK_TOP = 0.8;
/** The head's porcelain, as an ellipsoid's half sizes (the face is painted to it). */
export const FACE = [0.0843, 0.1127, 0.0902];

const SHOULDER = [0.198, 0.668, -0.004];
const ELBOW = [0.262, 0.53, 0.07];
// The wrist, in the grip's frame, and in the body's (one per side: the grip is askew).
const WRIST_GRIP = [0.106, -0.04, -0.03];
const gripToBody = (p) => {
  const c = Math.cos(ROLL);
  const s = Math.sin(ROLL);
  return [HEAD[0] + p[0] * c - p[1] * s, HEAD[1] + p[0] * s + p[1] * c, HEAD[2] + p[2]];
};
const WRISTS = [gripToBody(WRIST_GRIP), gripToBody([-WRIST_GRIP[0], WRIST_GRIP[1], WRIST_GRIP[2]])];
const ELBOWS = [ELBOW, [-ELBOW[0], ELBOW[1], ELBOW[2]]];

const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const seg = (x, y, z, a, b, ra, rb) => cone(x, y, z, a[0], a[1], a[2], b[0], b[1], b[2], ra, rb);

/** A limb's axis, for rings round it and angles about it. */
function axis(a, b) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(...d);
  const dir = d.map((v) => v / len);
  // Any two directions square to it.
  const ref = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = [dir[1] * ref[2] - dir[2] * ref[1], dir[2] * ref[0] - dir[0] * ref[2], dir[0] * ref[1] - dir[1] * ref[0]];
  const ul = Math.hypot(...u);
  const uu = u.map((v) => v / ul);
  const vv = [dir[1] * uu[2] - dir[2] * uu[1], dir[2] * uu[0] - dir[0] * uu[2], dir[0] * uu[1] - dir[1] * uu[0]];
  return { a, len, dir, u: uu, v: vv };
}

/** Along the axis (0 to 1), distance from it, and the angle round it. */
function onAxis(ax, x, y, z, out) {
  const wx = x - ax.a[0];
  const wy = y - ax.a[1];
  const wz = z - ax.a[2];
  const t = wx * ax.dir[0] + wy * ax.dir[1] + wz * ax.dir[2];
  const rx = wx - ax.dir[0] * t;
  const ry = wy - ax.dir[1] * t;
  const rz = wz - ax.dir[2] * t;
  out[0] = t / ax.len;
  out[1] = Math.sqrt(rx * rx + ry * ry + rz * rz);
  out[2] = Math.atan2(rx * ax.v[0] + ry * ax.v[1] + rz * ax.v[2], rx * ax.u[0] + ry * ax.u[1] + rz * ax.u[2]);
  return out;
}

/** A ring round an axis at `t` along it: radius R, tube r. */
function ring(ax, x, y, z, t, R, r, tmp) {
  onAxis(ax, x, y, z, tmp);
  const q = tmp[1] - R;
  const h = (tmp[0] - t) * ax.len;
  return Math.sqrt(q * q + h * h) - r;
}

const TMP = [0, 0, 0];

// ---- The skirt -------------------------------------------------------------------------------

const DZ = 0.74; // her body is deeper than wide by this much

/** The skirt and corset's radius (across) at height y. */
function hipRadius(y) {
  if (y < 0.12) return 0.207 - y * 0.12;
  if (y < 0.3) return 0.1926 - (y - 0.12) * 0.17;
  if (y < 0.345) return 0.162 - (y - 0.3) * 0.31;
  if (y < 0.4) return 0.148 + (y - 0.345) * 0.07;
  return 0.152 + (y - 0.4) * 0.25;
}

function skirtField(x, y, z) {
  const zz = z / DZ;
  const rho = Math.sqrt(x * x + zz * zz);
  const th = Math.atan2(x, zz);
  // Deep satin folds, falling from the waist and opening toward the hem.
  const open = 1 - smooth(0.05, 0.34, y);
  const folds = (0.002 + 0.009 * open) * Math.sin(th * 11 + noise3(th * 2, y * 4, 0, 41) * 1.6);
  let d = (rho - hipRadius(y) - folds) * DZ;
  d = smax(d, -y, 0.004);
  return smax(d, y - 0.34, 0.01);
}

// ---- The bodice: corset, blouse, sleeves, neck ------------------------------------------------

/** The corset's top and bottom edges, by the angle round her (0 at the front). */
const corsetTop = (th) => 0.468 + 0.018 * Math.exp(-(((Math.abs(th) - 0.42) / 0.3) ** 2)) - 0.012 * Math.exp(-((th / 0.13) ** 2)) - 0.012 * smooth(1.2, 2.6, Math.abs(th));
const corsetBottom = (th) => 0.298 - 0.04 * Math.exp(-((th / 0.38) ** 2));

function corset(x, y, z) {
  const zz = z / DZ;
  const rho = Math.sqrt(x * x + zz * zz);
  const th = Math.atan2(x, zz);
  // Boned: a raised channel every so often round her.
  const bone = 0.0014 * smooth(0.55, 0.95, Math.abs(Math.cos(th * 7)));
  // A gap down the front where it laces.
  const gap = 0.004 * smooth(0.2, 0.06, Math.abs(th));
  let d = (rho - hipRadius(y) - 0.004 - bone + gap) * DZ;
  d = smax(d, y - corsetTop(th), 0.006);
  return smax(d, corsetBottom(th) - y, 0.006);
}

// High round the neck, opening in a small scoop at the front.
const NECKLINE = (th) => 0.662 + 0.078 * smooth(0.0, 0.85, Math.abs(th));

function torso(X, y, z) {
  let d = ellipsoid(X, y, z, 0, 0.585, -0.004, 0.158, 0.15, 0.112);
  d = smin(d, ellipsoid(X, y, z, 0, 0.47, -0.004, 0.15, 0.08, 0.108), 0.04);
  d = smin(d, sphere(X, y, z, SHOULDER[0] - 0.02, SHOULDER[1] - 0.004, SHOULDER[2], 0.05), 0.05);
  d = smin(d, cone(X, y, z, 0.03, 0.72, -0.012, 0.16, 0.684, -0.006, 0.042, 0.042), 0.04);
  // The bust.
  d = smin(d, ellipsoid(X, y, z, 0.062, 0.548, 0.07, 0.066, 0.058, 0.056), 0.035);
  return d;
}

const SLEEVE = axis(SHOULDER, lerp3(SHOULDER, ELBOW, 0.9));

function sleeve(X, y, z) {
  onAxis(SLEEVE, X, y, z, TMP);
  const t = TMP[0];
  const tc = clamp01(t);
  // Puffed: gathered at the shoulder seam and the cuff, full between.
  const full = Math.sin(Math.PI * tc) ** 0.7;
  const gather = (1 - full) * 0.004 + 0.0018;
  const r = 0.033 + 0.039 * full + gather * Math.sin(TMP[2] * 14 + noise3(X * 40, y * 40, z * 40, 43) * 1.5);
  const ends = Math.max(-t, t - 1) * SLEEVE.len;
  return smax(TMP[1] - r, ends, 0.02);
}
const cuff = (X, y, z) => ring(SLEEVE, X, y, z, 0.97, 0.03, 0.009, TMP);

function blouse(X, y, z) {
  let d = torso(X, y, z);
  if (X > 0.1 && y > 0.46) d = smin(d, sleeve(X, y, z), 0.03);
  // Gathered into the neckline in soft vertical folds.
  const th = Math.atan2(X, z / 0.7);
  const near = smooth(0.56, 0.66, y);
  d += near * 0.0022 * Math.sin(th * 26 + noise3(X * 30, y * 10, z * 30, 47) * 2);
  d += 0.0014 * noise3(X * 24, y * 24, z * 24, 49);
  // Under the corset below its top.
  return d;
}

/** The ruffle round the neckline: a rolled frill, gathered. */
// How far out the blouse is along the neckline, round her (read off the
// sculpt once), so the ruffle sits on it.
const NECK_RHO = Array.from({ length: 65 }, (_, i) => {
  const th = (i / 64) * Math.PI;
  const y = NECKLINE(th);
  let lo = 0;
  let hi = 0.3;
  for (let k = 0; k < 30; k++) {
    const m = (lo + hi) / 2;
    if (torso(Math.sin(th) * m, y, Math.cos(th) * m * 0.7) < 0) lo = m;
    else hi = m;
  }
  return lo;
});
function neckRho(th) {
  const f = (Math.min(Math.abs(th), Math.PI) / Math.PI) * 64;
  const i = Math.min(63, Math.floor(f));
  return NECK_RHO[i] + (NECK_RHO[i + 1] - NECK_RHO[i]) * (f - i);
}

/** The ruffle round the neckline: a rolled frill, gathered. */
function ruffle(X, y, z) {
  const th = Math.atan2(X, z / 0.7);
  const rho = Math.sqrt(X * X + (z / 0.7) ** 2);
  const yc = NECKLINE(th) + 0.0035 * Math.sin(th * 34);
  const R = neckRho(th) + 0.004 + 0.0035 * Math.cos(th * 34);
  const q = (rho - R) * 0.8;
  return Math.sqrt(q * q + (y - yc) ** 2) - 0.0095;
}

function neck(X, y, z) {
  let d = cone(X, y, z, 0, 0.66, -0.008, 0, NECK_TOP, -0.004, 0.041, 0.034);
  // The breastbone and collarbones under the porcelain.
  d = smin(d, ellipsoid(X, y, z, 0, 0.655, 0.03, 0.12, 0.045, 0.06), 0.03);
  return smax(d, y - NECK_TOP, 0.002);
}

const choker = (X, y, z) => torusY(X, y, z, 0, 0.755, -0.002, 0.037, 0.0075);

// Each piece is only worked out near where it can be: far from it, it
// cannot be the nearest surface, so the sum skips it.
function bodiceField(x, y, z) {
  const X = Math.abs(x);
  let d = blouse(X, y, z);
  if (y < 0.5) d = Math.min(d, corset(X, y, z));
  if (y > 0.59) {
    d = Math.min(d, ruffle(X, y, z));
    d = smin(d, neck(X, y, z), 0.012);
    if (y > 0.72) d = Math.min(d, choker(X, y, z));
  }
  if (X > 0.17) d = Math.min(d, cuff(X, y, z));
  return d;
}

function bodiceLabel(x, y, z) {
  const X = Math.abs(x);
  const c = y < 0.5 ? corset(X, y, z) : 1;
  const b = blouse(X, y, z);
  if (c < b && c < 0.002) return 'corset';
  if (y > 0.72 && choker(X, y, z) < 0.0015) return 'soot';
  if (X > 0.17 && cuff(X, y, z) < Math.min(b, 0.0015)) return 'soot';
  if (y > 0.59 && ruffle(X, y, z) < Math.min(b, 0.0015)) return 'soot';
  const th = Math.atan2(X, z / 0.7);
  // Bare porcelain above the neckline, inside the ruffle.
  if (y > NECKLINE(th) && y > 0.59 && Math.sqrt(X * X + (z / 0.7) ** 2) < neckRho(th) + 0.004) return 'porcelain';
  return 'blouse';
}

const bodiceOccluder = (x, y, z) => skirtField(x, y, z);

// ---- The lacing down the corset's front --------------------------------------------------------

/** How far in front of the corset's surface at x 0, height y. */
function corsetFront(y) {
  return (hipRadius(y) + 0.004 - 0.004) * DZ;
}
const EYELETS = [];
for (let i = 0; i < 6; i++) {
  const y = 0.31 + i * 0.029;
  EYELETS.push([0.019 + i * 0.0006, y, corsetFront(y) + 0.0015]);
}

function lacingParts(X, y, z) {
  let brass = Infinity;
  for (const [ex, ey, ez] of EYELETS) {
    // A brass ring set in the cloth, its hole dark.
    const q = Math.hypot(X - ex, y - ey) - 0.0042;
    brass = Math.min(brass, Math.sqrt(q * q + (z - ez) ** 2) - 0.0016);
  }
  let lace = Infinity;
  for (let i = 0; i < EYELETS.length - 1; i++) {
    const a = EYELETS[i];
    const b = EYELETS[i + 1];
    // Crossing from one side to the other between each pair of eyelets.
    lace = Math.min(lace, cone(X, y, z, a[0], a[1], a[2] + 0.002, -b[0], b[1], b[2] + 0.0025, 0.0019, 0.0019));
    lace = Math.min(lace, cone(X, y, z, -a[0], a[1], a[2] + 0.002, b[0], b[1], b[2] + 0.0025, 0.0019, 0.0019));
  }
  // The bow at the top, its tails hanging.
  const top = EYELETS[EYELETS.length - 1];
  lace = Math.min(lace, ellipsoid(X, y, z, 0.009, top[1] + 0.008, top[2] + 0.004, 0.009, 0.0055, 0.003));
  lace = Math.min(lace, cone(X, y, z, 0.002, top[1] + 0.006, top[2] + 0.004, 0.012, top[1] - 0.03, top[2] + 0.006, 0.0022, 0.0018));
  return [brass, lace];
}

function lacingField(x, y, z) {
  const [b, l] = lacingParts(Math.abs(x), y, z);
  return Math.min(b, l);
}

function lacingLabel(x, y, z) {
  const [b, l] = lacingParts(Math.abs(x), y, z);
  return b < l ? 'brass' : 'lace';
}

// ---- The forearms ---------------------------------------------------------------------------

const FOREARMS = [0, 1].map((i) => {
  const e = ELBOWS[i];
  const w = WRISTS[i];
  return { e, w, ax: axis(e, w), a: lerp3(e, w, 0.12), b: lerp3(e, w, 0.9), swell: lerp3(e, w, 0.32) };
});

function armParts(x, y, z) {
  let porcelain = Infinity;
  let brass = Infinity;
  for (let i = 0; i < 2; i++) {
    const { e, w, ax, a, b, swell } = FOREARMS[i];
    // Far from this arm, it cannot be the nearest.
    if (seg(x, y, z, e, w, 0.034, 0.034) > Math.min(porcelain, brass)) continue;
    let d = seg(x, y, z, a, b, 0.0235, 0.0165);
    d = smin(d, sphere(x, y, z, swell[0], swell[1], swell[2], 0.025), 0.03);
    // Ball joints at the elbow and the wrist, a fine gap round each.
    d = Math.min(d, sphere(x, y, z, e[0], e[1], e[2], 0.027));
    d = Math.min(d, sphere(x, y, z, w[0], w[1], w[2], 0.0172));
    d = smax(d, -ring(ax, x, y, z, 0.11, 0.0238, 0.0017, TMP), 0.001);
    d = smax(d, -ring(ax, x, y, z, 0.915, 0.0168, 0.0015, TMP), 0.001);
    porcelain = Math.min(porcelain, d);
    for (const t of [0.72, 0.78, 0.84]) brass = Math.min(brass, ring(ax, x, y, z, t, 0.0202 - (t - 0.72) * 0.014, 0.003, TMP));
  }
  return [porcelain, brass];
}

function armsField(x, y, z) {
  const [p, b] = armParts(x, y, z);
  return Math.min(p, b);
}

function armsLabel(x, y, z) {
  const [p, b] = armParts(x, y, z);
  return b < p ? 'brass' : 'porcelain';
}

const armsOccluder = (x, y, z) => smin(blouse(Math.abs(x), y, z), sleeve(Math.abs(x), y, z), 0.02);

// ---- The head (its own frame: the centre of the head, the face toward +z) -----------------------

export const EYE = { x: 0.029, y: 0.006, z: 0.071, r: 0.0155 };

/** The lids' opening: an almond, its outer corner lifted. */
export function eyeOpening(X, y) {
  const u = X - EYE.x;
  const top = EYE.y + 0.0065 - 24 * u * u + 0.08 * u;
  const bot = EYE.y - 0.0047 + 17 * u * u + 0.08 * u;
  return Math.max(y - top, bot - y);
}

const lipUpper = (X, y, z) => cone(X, y, z, 0.003, -0.0438, 0.0875, 0.0135, -0.0462, 0.0832, 0.0041, 0.002) - 0.0005 * smooth(0.004, 0.0, X);
const lipLower = (X, y, z) => cone(X, y, z, 0, -0.0502, 0.0866, 0.0115, -0.0489, 0.0832, 0.0047, 0.002);

function face(X, y, z) {
  let d = ellipsoid(X, y, z, 0, 0, 0, FACE[0], FACE[1], FACE[2]);
  // The jaw tapering to a small, pointed chin.
  d = smax(d, ellipsoid(X, y, z, 0, 0.03, -0.004, 0.092, 0.16, 0.1), 0.02);
  d = smin(d, sphere(X, y, z, 0, -0.084, 0.058, 0.02), 0.025);
  // Round cheeks, high, and the brow.
  d = smin(d, sphere(X, y, z, 0.041, -0.024, 0.055, 0.029), 0.025);
  d = smin(d, ellipsoid(X, y, z, 0.026, 0.026, 0.07, 0.024, 0.009, 0.014), 0.012);
  // The eyes: blank domes set deep, the lids closing over all but an almond.
  d = smax(d, -ellipsoid(X, y, z, EYE.x, EYE.y, 0.082, 0.02, 0.0115, 0.012), 0.006);
  const lids = smax(sphere(X, y, z, EYE.x, EYE.y, EYE.z, EYE.r + 0.0016), -eyeOpening(X, y), 0.0012);
  d = smin(d, lids, 0.003);
  d = Math.min(d, sphere(X, y, z, EYE.x, EYE.y, EYE.z, EYE.r));
  // A little nose, turned up at the tip.
  d = smin(d, cone(X, y, z, 0, 0.004, 0.086, 0, -0.019, 0.0975, 0.0055, 0.0072), 0.008);
  d = smin(d, sphere(X, y, z, 0, -0.0215, 0.0965, 0.0078), 0.006);
  d = smin(d, sphere(X, y, z, 0.0072, -0.0235, 0.0915, 0.0052), 0.004);
  d = smax(d, -ellipsoid(X, y, z, 0.0042, -0.0282, 0.0925, 0.0022, 0.0014, 0.003), 0.0012);
  // A bow of a mouth, set in a line.
  d = smin(d, smin(lipUpper(X, y, z), lipLower(X, y, z), 0.0015), 0.004);
  d = smax(d, -box(X, y, z, 0, -0.0469, 0.088, 0.0135, 0.0005, 0.006, 0), 0.001);
  // The neck, cut short and capped in brass.
  d = smin(d, cone(X, y, z, 0, -0.075, -0.012, 0, -0.142, -0.014, 0.034, 0.032), 0.02);
  return smax(d, -0.142 - y, 0.002);
}

/** The turban's lower edge: up on the brow, down over the ears and the nape. */
const TURBAN_TILT = 0.36;

/** A wrap of cloth: a ring round the head, tilted forward by `tilt`, twisted by `twist`. */
function wrap(x, y, z, cy, R, r, tilt, twist) {
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const cw = Math.cos(twist);
  const sw = Math.sin(twist);
  // Into the ring's own frame: undo the twist about y, then the tilt about x.
  const x1 = x * cw - z * sw;
  const z1 = x * sw + z * cw;
  const y1 = y - cy;
  const y2 = y1 * ct - z1 * st;
  const z2 = y1 * st + z1 * ct;
  const q = Math.sqrt(x1 * x1 + z2 * z2) - R;
  return Math.sqrt(q * q + y2 * y2) - r;
}

// The turns, bottom to top: height, radius, thickness, tilt and twist.
const TURNS = [
  [0.05, 0.09, 0.023, TURBAN_TILT, 0],
  [0.086, 0.097, 0.026, -0.2, 0.5],
  [0.122, 0.093, 0.026, 0.26, -0.35],
  [0.157, 0.079, 0.025, -0.22, 0.9],
  [0.188, 0.056, 0.023, 0.3, -0.6],
  [0.212, 0.026, 0.02, 0, 0],
];

function turbanBase(x, y, z) {
  // A small crown under it all, so the turns make the shape.
  let d = ellipsoid(x, y, z, 0, 0.115, -0.01, 0.084, 0.086, 0.09);
  // Wound in swollen turns, each a little askew of the last; where one lies
  // on the next the cloth creases.
  for (const [cy, R, r, tilt, twist] of TURNS) d = smin(d, wrap(x, y, z, cy, R, r, tilt, twist), 0.003);
  // Two turns crossing the front, up from the temples to the crown.
  d = smin(d, wrap(x, y, z, 0.11, 0.1, 0.019, 1.05, 0.55), 0.003);
  return smin(d, wrap(x, y, z, 0.11, 0.1, 0.019, 1.05, -0.55), 0.003);
}

function turban(x, y, z) {
  let d = turbanBase(x, y, z);
  // Gathered in pleats under the brooch.
  const bx = x - BROOCH[0];
  const by = y - BROOCH[1];
  const bz = z - BROOCH[2];
  const near = Math.exp(-(bx * bx + by * by + bz * bz) / 0.0025);
  d += near * 0.003 * Math.sin(Math.atan2(by, bx) * 7);
  // Soft cloth: shallow creases along the turns.
  d += 0.0011 * noise3(x * 70, y * 40, z * 70, 51);
  // Clear of the face below its edge.
  return smax(d, turbanEdge(z) - y, 0.01);
}

/** The black band round the brow, on the turban's edge. */
const bandY = (th) => 0.063 - 0.012 * (1 - Math.cos(th)) - 0.006 * Math.sin(th) ** 2;
/** How far out the band sits: on the brow, a little proud of the porcelain. */
function bandRadius(th) {
  const y = bandY(th);
  const s = Math.sqrt(Math.max(0.05, 1 - (y / FACE[1]) ** 2));
  return 1 / Math.hypot(Math.sin(th) / (FACE[0] * s), Math.cos(th) / (FACE[2] * s)) + 0.0045;
}
export function bandPoint(th) {
  // th is the angle round the head from the front (+z), toward +x.
  const R = bandRadius(th) + 0.0065;
  return [Math.sin(th) * R, bandY(th), Math.cos(th) * R];
}
function band(x, y, z) {
  const th = Math.atan2(x, z);
  if (Math.abs(th) > 1.9) return 1;
  const q = Math.sqrt(x * x + z * z) - bandRadius(th);
  return box(q, y, 0, 0, bandY(th), 0, 0.0065, 0.0078, 1, 0.004);
}

/** The brooch: a scalloped gold rosette tilted up, a ruby domed in its bezel. */
export const BROOCH = [0, 0.152, 0];
{
  // Pinned to the cloth where the crossing turns meet at the front.
  let z = 0.2;
  for (let i = 0; i < 200 && turbanBase(0, BROOCH[1], z) > 0.0002; i++) z -= Math.max(turbanBase(0, BROOCH[1], z) * 0.8, 0.0002);
  BROOCH[2] = z + 0.003;
}
const BROOCH_TILT = -0.4;
function broochParts(x, y, z) {
  const c = Math.cos(BROOCH_TILT);
  const s = Math.sin(BROOCH_TILT);
  const ly = (y - BROOCH[1]) * c - (z - BROOCH[2]) * s;
  const lz = (y - BROOCH[1]) * s + (z - BROOCH[2]) * c;
  const lx = x - BROOCH[0];
  const r = Math.hypot(lx, ly);
  const th = Math.atan2(ly, lx);
  const petal = 0.025 + 0.0028 * Math.cos(th * 12);
  let gold = box(r - petal, lz, 0, 0, 0, 0, 0.0001, 0.003, 1, 0.0025);
  gold = Math.min(gold, Math.sqrt((r - 0.0158) ** 2 + (lz - 0.0035) ** 2) - 0.0022);
  const ruby = ellipsoid(lx, ly, lz, 0, 0, 0.003, 0.0142, 0.0142, 0.0085);
  return [gold, ruby];
}

/** The turban's lower edge, by depth (z): up on the brow, down at the nape. */
const turbanEdge = (z) => 0.034 + 0.03 * smooth(-0.6, 0.9, z / 0.1) - 0.03 * (1 - smooth(-0.08, 0.02, z));

// The face stops a little way up inside the turban, where nothing sees it.
const faceUnder = (X, y, z) => smax(face(X, y, z), y - turbanEdge(z) - 0.03, 0.004);

const nearBrooch = (x, y, z) => Math.hypot(x - BROOCH[0], y - BROOCH[1], z - BROOCH[2]) - 0.032;

function headField(x, y, z) {
  const X = Math.abs(x);
  let d = faceUnder(X, y, z);
  if (y > 0.02 && y < 0.09) d = Math.min(d, band(X, y, z));
  if (nearBrooch(x, y, z) < d) {
    const [g, r] = broochParts(x, y, z);
    d = Math.min(d, g, r);
  }
  return d;
}

function headLabel(x, y, z) {
  const X = Math.abs(x);
  const f = faceUnder(X, y, z);
  const b = y > 0.02 && y < 0.09 ? band(X, y, z) : 1;
  const [g, r] = nearBrooch(x, y, z) < 0.01 ? broochParts(x, y, z) : [1, 1];
  const m = Math.min(f, b, g, r);
  if (m === r) return 'ruby';
  if (m === g) return 'brass';
  if (m === b) return 'soot';
  if (y < -0.138) return 'brass';
  return z > -0.01 ? 'face' : 'nape';
}

// Below its edge the turban cannot be the nearest surface: a bound stands in.
function turbanField(x, y, z) {
  if (y < -0.012) return -0.008 - y;
  return turban(x, y, z);
}

/** The face's paint, mapped onto the front of the head: u across, v up. */
export function faceUV(x, y, z) {
  const px = x / FACE[0];
  const py = y / FACE[1];
  const pz = z / FACE[2];
  const len = Math.sqrt(px * px + py * py + pz * pz) || 1;
  return [0.5 + Math.atan2(px, pz) / Math.PI, 0.5 + Math.asin(Math.max(-1, Math.min(1, py / len))) / Math.PI];
}

/** The face's surface in front of (x, y), for painting to it. */
export function faceSurfaceZ(x, y) {
  let z = 0.14;
  for (let i = 0; i < 80; i++) {
    const d = face(Math.abs(x), y, z);
    if (d < 0.0002) break;
    z -= Math.max(d * 0.8, 0.0002);
  }
  return z;
}

const headOccluder = (x, y, z) => {
  // Her hands, roughly, for the shade they cast on the cheeks.
  const X = Math.abs(x);
  return ellipsoid(X, y, z, 0.1, -0.03, 0.01, 0.018, 0.045, 0.05);
};

// ---- The hands (the grip's frame) -----------------------------------------------------------------

/** How far from the head's centre its surface is, at height y, `a` round from the front. */
function headRadius(y, a) {
  const sx = Math.sin(a);
  const cz = Math.cos(a);
  let lo = 0.0;
  let hi = 0.2;
  for (let i = 0; i < 28; i++) {
    const m = (lo + hi) / 2;
    if (face(sx * m, y, cz * m) < 0) lo = m;
    else hi = m;
  }
  return lo;
}
/** A point hugging the head: `a` round from the front, `off` out from its surface. */
function hug(a, y, off) {
  const R = headRadius(y, a) + off;
  return [Math.sin(a) * R, y, Math.cos(a) * R];
}

const DEG = Math.PI / 180;
// Four fingers stacked down the side of the face, curling forward round it.
const FINGERS = [
  { y: -0.004, r: 0.0058, a: [72, 58, 47, 39] },
  { y: -0.019, r: 0.006, a: [74, 58, 45, 35] },
  { y: -0.034, r: 0.0057, a: [74, 60, 48, 39] },
  { y: -0.048, r: 0.005, a: [72, 61, 52, 45] },
].map((f) => {
  const p = f.a.map((deg, i) => hug(deg * DEG, f.y - i * 0.0015, f.r + 0.0012));
  // A sphere round the whole finger, to skip it from afar.
  const c = [0, 1, 2].map((k) => p.reduce((s, q) => s + q[k], 0) / p.length);
  const reach = Math.max(...p.map((q) => Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]))) + f.r * 1.2;
  return { ...f, p, c, reach };
});
const THUMB = [hug(96 * DEG, -0.064, 0.01), hug(78 * DEG, -0.078, 0.0075), hug(62 * DEG, -0.086, 0.0068)];
// The heel of the hand, where the wrist comes in.
const HEEL = hug(100 * DEG, -0.04, 0.009);
// The middle of the hand's back, with its outward and backward directions.
const PALM = { c: hug(86 * DEG, -0.027, 0.0045), n: [Math.sin(86 * DEG), 0, Math.cos(86 * DEG)], t: [Math.cos(86 * DEG), 0, -Math.sin(86 * DEG)] };

function handParts(x, y, z) {
  const X = Math.abs(x);
  // The hand's back, rounded over the palm pressed to the side of the head.
  const px = X - PALM.c[0];
  const py = y - PALM.c[1];
  const pz = z - PALM.c[2];
  let p = ellipsoid(px * PALM.n[0] + pz * PALM.n[2], py, px * PALM.t[0] + pz * PALM.t[2], 0, 0, 0, 0.0105, 0.031, 0.033);
  p = smin(p, seg(X, y, z, HEEL, WRIST_GRIP, 0.012, 0.0145), 0.012);
  let nail = Infinity;
  for (const f of FINGERS) {
    if (Math.hypot(X - f.c[0], y - f.c[1], z - f.c[2]) - f.reach > Math.min(p, nail)) continue;
    const [k0, k1, k2, tip] = f.p;
    let g = seg(X, y, z, k0, k1, f.r, f.r * 0.94);
    g = smin(g, seg(X, y, z, k1, k2, f.r * 0.94, f.r * 0.86), 0.002);
    g = smin(g, seg(X, y, z, k2, tip, f.r * 0.86, f.r * 0.76), 0.0015);
    // Knuckles, a little proud, as on a jointed doll.
    g = smin(g, sphere(X, y, z, k1[0], k1[1], k1[2], f.r * 1.04), 0.002);
    g = smin(g, sphere(X, y, z, k2[0], k2[1], k2[2], f.r * 0.95), 0.002);
    p = smin(p, g, 0.005);
    // The nail: lacquer on the back of the last joint.
    const n = ellipsoid(X, y, z, tip[0] * 1.02, tip[1], tip[2] * 1.02, f.r * 0.8, f.r * 0.7, f.r * 0.95);
    nail = Math.min(nail, Math.max(n, g - 0.0006));
  }
  let t = seg(X, y, z, THUMB[0], THUMB[1], 0.0072, 0.0064);
  t = smin(t, seg(X, y, z, THUMB[1], THUMB[2], 0.0064, 0.0052), 0.002);
  p = smin(p, t, 0.006);
  const th = THUMB[2];
  nail = Math.min(nail, Math.max(ellipsoid(X, y, z, th[0] * 1.02, th[1] - 0.001, th[2] * 1.02, 0.0045, 0.004, 0.005), t - 0.0006));
  return [p, nail];
}

function handsField(x, y, z) {
  const [p, n] = handParts(x, y, z);
  return Math.min(p, n);
}

function handsLabel(x, y, z) {
  const [p, n] = handParts(x, y, z);
  return n < p + 0.0003 ? 'nail' : 'porcelain';
}

const handsOccluder = (x, y, z) => face(Math.abs(x), y, z);

// ---- The shape ---------------------------------------------------------------------------------

const PART = (name, labels, field, label, min, max, cell, more = {}) => ({ name, labels, field, label, min, max, cell, ...more });

export const zeroShape = {
  version,
  parts: [
    PART('skirt', ['skirt'], skirtField, null, [-0.23, -0.004, -0.18], [0.23, 0.35, 0.18], 0.012, { ao: 0.2 }),
    PART('bodice', ['corset', 'blouse', 'porcelain', 'soot'], bodiceField, bodiceLabel, [-0.3, 0.25, -0.16], [0.3, 0.81, 0.17], 0.006, { occluder: bodiceOccluder }),
    PART('lacing', ['brass', 'lace'], lacingField, lacingLabel, [-0.034, 0.29, 0.085], [0.034, 0.49, 0.135], 0.0017, { ao: 0.15 }),
    PART('arms', ['porcelain', 'brass'], armsField, armsLabel, [-0.3, 0.38, -0.04], [0.3, 0.57, 0.2], 0.0038, { occluder: armsOccluder }),
    PART('hands', ['porcelain', 'nail'], handsField, handsLabel, [-0.13, -0.105, -0.06], [0.13, 0.012, 0.095], 0.0021, { occluder: handsOccluder, ao: 0.22 }),
    PART('head', ['face', 'nape', 'soot', 'brass', 'ruby'], headField, headLabel, [-0.1, -0.15, -0.11], [0.1, 0.19, 0.145], 0.0028, { occluder: headOccluder, uv: faceUV }),
    PART('turban', ['turban'], turbanField, null, [-0.14, -0.03, -0.145], [0.14, 0.25, 0.14], 0.0048, { occluder: (x, y, z) => face(Math.abs(x), y, z) }),
  ],
};
