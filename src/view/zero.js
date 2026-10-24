import * as THREE from 'three';
import { rng } from '../ui/marks.js';
import { addPart, sculpted } from './sculpt.js';
import { BROOCH, EYE, HEAD, NECK_TOP, ROLL, bandPoint, eyeOpening, faceSurfaceZ, faceUV, zeroShape } from './shapes/zeroShape.js';

// Madame Zero herself (design doc 5.9, 8.1): a headless automaton in a
// crimson blouse and a black corset, holding her own head in her hands at
// her waist. The head wears an oxblood turban with a red jewel, black
// feathers and a band of green stones; its eyes are blank, and they glow a
// cold green, the House's colour. Porcelain stitched at the seams, a brass
// socket where the neck ends. The head in her hands turns to watch you.
//
// She is sculpted from distance fields (shapes/zeroShape.js); the face is
// painted on a canvas mapped onto the sculpt, and the feathers are drawn
// (no image files). Local frame: +z faces the player, y up from the floor
// of her case.

const TAU = Math.PI * 2;

function canvasTexture(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { canvas, ctx: canvas.getContext('2d'), tex };
}

// ---- The face's paint ---------------------------------------------------------------------
// The canvas covers the front of the head (faceUV in zeroShape.js); a point
// on the face, in metres from the head's centre, is painted where the sculpt
// shows it, so the liner sits on the lids and the lips' colour on the lips.

const FW = 1024;
const FH = 512;
const GLAZE = '#e6dccb';

/** Canvas pixels for a point on the face, x across and y up (metres). */
function at(x, y) {
  const [u, v] = faceUV(x, y, faceSurfaceZ(x, y));
  return [u * FW, (1 - v) * FH];
}

/** A path through face points, in canvas pixels. */
function trace(ctx, points, close = false) {
  ctx.beginPath();
  points.forEach(([x, y], i) => {
    const [cx, cy] = at(x, y);
    if (i) ctx.lineTo(cx, cy);
    else ctx.moveTo(cx, cy);
  });
  if (close) ctx.closePath();
}

/** Pixels per metre on the face near (x, y), for line widths. */
const scaleAt = (x, y) => Math.hypot(...[0, 1].map((k) => at(x + 0.001, y)[k] - at(x, y)[k])) * 1000;

/** The lids' opening, traced round from the inner corner (side: +1 or -1), grown by `grow` metres. */
function almond(side, grow = 0, steps = 24) {
  const top = [];
  const bot = [];
  // Walk across the eye and find where the opening's edges are at each step.
  for (let i = 0; i <= steps; i++) {
    const X = EYE.x - 0.0175 + (0.035 * i) / steps;
    let lo = EYE.y - 0.012;
    let hi = EYE.y + 0.012;
    const inside = (y) => eyeOpening(X, y) < grow;
    let mid = null;
    for (let y = lo; y <= hi; y += 0.0004) if (inside(y)) { mid = y; break; }
    if (mid === null) continue;
    // Bisect each edge.
    let a = mid;
    let b = hi;
    for (let k = 0; k < 18; k++) { const m = (a + b) / 2; if (inside(m)) a = m; else b = m; }
    top.push([X * side, a]);
    a = lo;
    b = mid;
    for (let k = 0; k < 18; k++) { const m = (a + b) / 2; if (inside(m)) b = m; else a = m; }
    bot.push([X * side, b]);
  }
  return { top, bot, outline: [...top, ...bot.reverse()] };
}

/** A seam: a line with stitches across it, as on a mended doll. */
function stitches(ctx, points, { width = 0.0007, tick = 0.0028, every = 0.0034, color = '#2a1c18' } = {}) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  const k = scaleAt(points[0][0], points[0][1]);
  ctx.lineWidth = width * k;
  trace(ctx, points);
  ctx.stroke();
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const nx = -(y1 - y0) / len;
    const ny = (x1 - x0) / len;
    for (let d = every / 2; d < len; d += every) {
      const x = x0 + ((x1 - x0) * d) / len;
      const y = y0 + ((y1 - y0) * d) / len;
      trace(ctx, [[x - nx * tick * 0.5, y - ny * tick * 0.5], [x + nx * tick * 0.5, y + ny * tick * 0.5]]);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** A hairline crack in the glaze, wandering from (x, y). */
function crack(ctx, x, y, len, angle, seed) {
  const r = rng(seed);
  const points = [[x, y]];
  let a = angle;
  for (let s = 0; s < len; s += 0.002) {
    a += (r() - 0.5) * 0.9;
    x += Math.cos(a) * 0.002;
    y += Math.sin(a) * 0.002;
    points.push([x, y]);
  }
  ctx.save();
  ctx.strokeStyle = 'rgba(60, 48, 40, 0.5)';
  ctx.lineWidth = 1.2;
  trace(ctx, points);
  ctx.stroke();
  ctx.restore();
}

/** The face: glaze, blank eyes ringed in black, brows drawn down, a moon, the seams. */
function paintFace() {
  const t = canvasTexture(FW, FH);
  const { ctx } = t;
  ctx.fillStyle = GLAZE;
  ctx.fillRect(0, 0, FW, FH);
  const r = rng(77);
  for (let i = 0; i < 3000; i++) {
    ctx.fillStyle = `rgba(90, 70, 60, ${r() * 0.045})`;
    ctx.fillRect(r() * FW, r() * FH, 1 + r() * 3, 1 + r() * 3);
  }
  // A cold grey bloom on the cheeks, as on old bisque.
  for (const side of [-1, 1]) {
    const [cx, cy] = at(0.04 * side, -0.026);
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 60);
    g.addColorStop(0, 'rgba(150, 110, 112, 0.22)');
    g.addColorStop(1, 'rgba(150, 110, 112, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - 64, cy - 64, 128, 128);
  }
  for (const side of [-1, 1]) {
    // Sunken sockets, smudged dark round the lids, so the eyes sit deep.
    const [sx, sy] = at(EYE.x * side, EYE.y);
    const sg = ctx.createRadialGradient(sx, sy, 6, sx, sy, 50);
    sg.addColorStop(0, 'rgba(40, 24, 28, 0.6)');
    sg.addColorStop(1, 'rgba(40, 24, 28, 0)');
    ctx.fillStyle = sg;
    ctx.fillRect(sx - 54, sy - 54, 108, 108);
    // The eyes: white and blank, the paint lapping just past the lids.
    const eye = almond(side, 0.0006);
    trace(ctx, eye.outline, true);
    ctx.fillStyle = '#f4f1e8';
    ctx.fill();
    // Rimmed in black, heavier on the upper lid, winged at the outer corner.
    const k = scaleAt(EYE.x * side, EYE.y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#120a0a';
    ctx.lineWidth = 0.0016 * k;
    trace(ctx, eye.top);
    ctx.stroke();
    ctx.lineWidth = 0.0009 * k;
    trace(ctx, eye.bot);
    ctx.stroke();
    const corner = eye.top[eye.top.length - 1];
    ctx.lineWidth = 0.0014 * k;
    trace(ctx, [corner, [corner[0] + 0.006 * side, corner[1] + 0.0042], [corner[0] + 0.0085 * side, corner[1] + 0.0065]]);
    ctx.stroke();
    // Two tear lines drawn down the cheek.
    ctx.lineWidth = 0.0007 * k;
    for (const dx of [-0.004, 0.005]) {
      const x0 = (EYE.x + dx) * side;
      trace(ctx, [[x0, EYE.y - 0.0072], [x0 + 0.0006 * side, EYE.y - 0.0175]]);
      ctx.stroke();
    }
    // Brows: heavy at the bridge, drawn down hard toward the nose, tapering out.
    const brow = [];
    for (let i = 0; i <= 12; i++) {
      const f = i / 12;
      const x = 0.009 + 0.038 * f;
      brow.push([x, 0.0215 + 0.0125 * Math.sin(f * 1.35), 0.0019 * (1 - f) + 0.0004]);
    }
    trace(ctx, [...brow.map(([x, y, w]) => [x * side, y + w]), ...brow.reverse().map(([x, y, w]) => [x * side, y - w])], true);
    ctx.fillStyle = '#0d0808';
    ctx.fill();
  }
  // A crescent moon over the brows.
  const [mx, my] = at(0, 0.044);
  const mk = scaleAt(0, 0.044);
  ctx.fillStyle = '#120a0a';
  ctx.beginPath();
  ctx.arc(mx, my, 0.0042 * mk, 0, TAU);
  ctx.fill();
  ctx.fillStyle = GLAZE;
  ctx.beginPath();
  ctx.arc(mx + 0.0018 * mk, my - 0.0011 * mk, 0.0036 * mk, 0, TAU);
  ctx.fill();
  // Lips, dark, set in a line: painted over the sculpted bow.
  const lips = [];
  for (let i = 0; i <= 16; i++) {
    const x = -0.0145 + (0.029 * i) / 16;
    const bow = 0.0012 * Math.exp(-(((Math.abs(x) - 0.0045) / 0.003) ** 2));
    lips.push([x, -0.0468 + 0.0042 * (1 - (x / 0.0145) ** 2) + bow]);
  }
  for (let i = 16; i >= 0; i--) {
    const x = -0.0145 + (0.029 * i) / 16;
    lips.push([x, -0.0468 - 0.0058 * (1 - (x / 0.0145) ** 2)]);
  }
  trace(ctx, lips, true);
  ctx.fillStyle = '#5a2228';
  ctx.fill();
  ctx.strokeStyle = '#1d0c0d';
  ctx.lineWidth = 0.0006 * scaleAt(0, -0.047);
  trace(ctx, [[-0.0145, -0.0468], [0, -0.0471], [0.0145, -0.0468]]);
  ctx.stroke();
  // The seams: down from one eye to the jaw, across the other cheek, and
  // straight down the chin.
  stitches(ctx, [[-0.045, -0.002], [-0.049, -0.03], [-0.04, -0.058], [-0.033, -0.08]]);
  stitches(ctx, [[0.026, -0.02], [0.05, -0.032]]);
  stitches(ctx, [[0, -0.058], [0.0005, -0.092]], { tick: 0.0034 });
  crack(ctx, 0.012, 0.05, 0.026, 0.4, 11);
  crack(ctx, -0.05, 0.034, 0.02, 2.6, 13);
  t.tex.needsUpdate = true;
  return t;
}

/** What glows: only the eyes, on black. */
function paintEyeGlow() {
  const t = canvasTexture(FW, FH);
  const { ctx } = t;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, FW, FH);
  ctx.fillStyle = '#fff';
  for (const side of [-1, 1]) {
    trace(ctx, almond(side, -0.0006).outline, true);
    ctx.fill();
  }
  t.tex.needsUpdate = true;
  return t;
}

// ---- Feathers ------------------------------------------------------------------------------

/** A cock feather's vane: a pale shaft, fine glossy barbs raked toward the tip. */
function paintFeather() {
  const t = canvasTexture(64, 256);
  const { ctx } = t;
  const r = rng(303);
  ctx.clearRect(0, 0, 64, 256);
  ctx.lineCap = 'round';
  for (let y = 6; y < 252; y += 1.1) {
    const v = y / 256; // 0 at the tip
    // Narrow at the tip, fullest two thirds down, thinning to the quill.
    const half = 30 * Math.sin(Math.PI * Math.min(1, v * 1.25 + 0.04)) ** 0.5 * (1 - 0.35 * smooth01(0.75, 1, v));
    for (const side of [-1, 1]) {
      const len = half * (0.94 + r() * 0.06);
      const shade = 12 + r() * 16;
      ctx.strokeStyle = `rgb(${shade}, ${shade + 4}, ${shade + 2})`;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(32, y + 3);
      ctx.quadraticCurveTo(32 + side * len * 0.55, y + 0.5, 32 + side * len, y - 7);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = '#3a3630';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(32, 6);
  ctx.lineTo(32, 256);
  ctx.stroke();
  t.tex.needsUpdate = true;
  return t;
}

const smooth01 = (a, b, x) => {
  const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/** A feather, base at the origin, rising along +y, curling back (-z) toward its tip. */
function featherGeometry(len, width, curl) {
  const rows = 20;
  const pos = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const y = len * t;
    const z = -curl * len * t * t;
    for (const [k, s] of [[0, -1], [0.5, 0], [1, 1]]) {
      const x = s * width * 0.5;
      // The vane cups a little either side of the shaft.
      pos.push(x, y, z + Math.abs(s) * width * 0.12);
      uv.push(k, t);
    }
    if (i < rows) {
      const a = i * 3;
      idx.push(a, a + 1, a + 3, a + 1, a + 4, a + 3, a + 1, a + 2, a + 4, a + 2, a + 5, a + 4);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---- Madame Zero ---------------------------------------------------------------------------

export function createZero({ brass }) {
  const group = new THREE.Group();
  group.name = 'madame-zero';
  const model = sculpted('zero', zeroShape);

  // The sculpt's vertex colours carry its baked shading into every material.
  const v = { vertexColors: true };
  const porcelain = new THREE.MeshPhysicalMaterial({ ...v, color: GLAZE, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.14 });
  const blouse = new THREE.MeshPhysicalMaterial({ ...v, color: 0x6e131b, emissive: 0x100204, roughness: 0.72, sheen: 1, sheenColor: 0xd04058, sheenRoughness: 0.45 });
  const turban = new THREE.MeshPhysicalMaterial({ ...v, color: 0x561018, emissive: 0x0c0203, roughness: 0.78, sheen: 1, sheenColor: 0xb83a4c, sheenRoughness: 0.4 });
  const corset = new THREE.MeshPhysicalMaterial({ ...v, color: 0x100d0e, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.3, sheen: 0.5, sheenColor: 0x5a4850 });
  const skirt = new THREE.MeshPhysicalMaterial({ ...v, color: 0x0e0c0d, roughness: 0.55, sheen: 0.9, sheenColor: 0x4a4048, sheenRoughness: 0.35 });
  const soot = new THREE.MeshStandardMaterial({ ...v, color: 0x0c0a0b, roughness: 0.45, metalness: 0.1 });
  const lace = new THREE.MeshPhysicalMaterial({ ...v, color: 0x4a0c12, roughness: 0.5, sheen: 0.8, sheenColor: 0xa03040 });
  const nail = new THREE.MeshPhysicalMaterial({ ...v, color: 0x080607, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 });
  const ruby = new THREE.MeshPhysicalMaterial({ color: 0x9a1015, emissive: 0x6a0a0e, emissiveIntensity: 0.6, roughness: 0.06, clearcoat: 1 });
  const green = new THREE.MeshStandardMaterial({ color: 0x1f6a42, emissive: 0x2a8a52, emissiveIntensity: 0.7, roughness: 0.15, metalness: 0.2 });

  // Lit inside her case by its own lamp, which casts no shadows: she need
  // not draw into the room's shadow maps.
  const opts = { castShadow: false };
  // Two of her: the full sculpt for her own station, the quick one when she
  // is a few pixels across the hall. `lod(parent)` gives the pair to fill.
  const pairs = [];
  const lod = (parent) => {
    const fine = new THREE.Group();
    const rough = new THREE.Group();
    rough.visible = false;
    parent.add(fine, rough);
    pairs.push([fine, rough]);
    return [fine, rough];
  };
  const both = (parent, name, materials) => {
    const [fine, rough] = lod(parent);
    addPart(fine, model, name, materials, opts);
    addPart(rough, model, name, materials, { ...opts, lod: 'far' });
  };

  // ---- The body --------------------------------------------------------------------------
  const body = new THREE.Group();
  group.add(body);
  both(body, 'skirt', { skirt });
  both(body, 'bodice', { corset, blouse, porcelain, soot });
  both(body, 'lacing', { brass, lace });
  both(body, 'arms', { porcelain, brass });
  // The neck ends in a brass socket: whatever held her head is long gone.
  const socket = new THREE.Mesh(new THREE.TorusGeometry(0.033, 0.0055, 10, 32), brass);
  socket.rotation.x = Math.PI / 2;
  socket.position.y = NECK_TOP;
  body.add(socket);
  const hollow = new THREE.Mesh(new THREE.CircleGeometry(0.031, 28), new THREE.MeshBasicMaterial({ color: 0x050303 }));
  hollow.rotation.x = -Math.PI / 2;
  hollow.position.y = NECK_TOP + 0.001;
  body.add(hollow);
  const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.006, 0.05, 10), brass);
  spindle.position.y = NECK_TOP + 0.02;
  body.add(spindle);
  // The green stone on her choker.
  const stone = new THREE.Mesh(new THREE.OctahedronGeometry(0.0095), green);
  stone.scale.z = 0.6;
  stone.position.set(0, 0.748, 0.045);
  body.add(stone);

  // ---- The head in her hands ---------------------------------------------------------------
  // `held` is where her hands keep it, askew; `head` turns inside it to watch you.
  const held = new THREE.Group();
  held.position.set(...HEAD);
  held.rotation.z = ROLL;
  body.add(held);
  both(held, 'hands', { porcelain, nail });
  const head = new THREE.Group();
  held.add(head);
  const faceTex = paintFace();
  const glowTex = paintEyeGlow();
  const faceMat = new THREE.MeshPhysicalMaterial({
    ...v,
    map: faceTex.tex,
    emissiveMap: glowTex.tex,
    emissive: 0xc8ffe0,
    emissiveIntensity: 0.9,
    roughness: 0.28,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
  });
  both(head, 'head', { face: faceMat, nape: porcelain, soot, brass, ruby });
  both(head, 'turban', { turban });
  // Green stones set round the band.
  for (let i = -2; i <= 2; i++) {
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(i === 0 ? 0.0078 : 0.0056), green);
    const [x, y, z] = bandPoint(i * 0.34);
    gem.position.set(x, y, z);
    gem.rotation.y = i * 0.34;
    gem.scale.z = 0.62;
    head.add(gem);
  }
  // Feathers fanned up behind the brooch, black with a green-violet sheen.
  const featherTex = paintFeather();
  const feather = new THREE.MeshPhysicalMaterial({
    color: 0x9a9a9a,
    map: featherTex.tex,
    alphaTest: 0.4,
    side: THREE.DoubleSide,
    roughness: 0.35,
    iridescence: 0.7,
    iridescenceIOR: 1.6,
    iridescenceThicknessRange: [380, 640],
  });
  const fan = new THREE.Group();
  fan.position.set(BROOCH[0], BROOCH[1] + 0.03, BROOCH[2] - 0.03);
  fan.rotation.x = -0.25;
  head.add(fan);
  for (const [a, len, w, curl] of [[-0.78, 0.14, 0.017, 0.7], [-0.4, 0.175, 0.019, 0.6], [-0.08, 0.2, 0.02, 0.55], [0.26, 0.18, 0.019, 0.62], [0.62, 0.15, 0.017, 0.72]]) {
    const plume = new THREE.Mesh(featherGeometry(len, w, curl), feather);
    plume.rotation.set(0, a * 0.4, -a);
    fan.add(plume);
  }

  // ---- Motion ----------------------------------------------------------------------------
  const tmp = new THREE.Vector3();
  const here = new THREE.Vector3();
  let far = false;
  let yaw = 0;
  let pitch = 0;
  let twitch = 0;

  /**
   * Each frame. `flare` (0 to 2) brightens her eyes and jolts the head;
   * `watch` is a point in the world (the camera) her head turns toward.
   */
  function update(dt, t, { flare = 0, watch = null } = {}) {
    body.scale.y = 1 + Math.sin(t * 1.1) * 0.004; // the clockwork breathes
    // Near or far (with a margin, so she does not flicker between the two).
    if (watch) {
      group.getWorldPosition(here);
      const d = here.distanceTo(watch);
      const next = far ? d > 3.6 : d > 4.2;
      if (next !== far) {
        far = next;
        for (const [fine, rough] of pairs) {
          fine.visible = !far;
          rough.visible = far;
        }
      }
    }
    // Her eyes hold a cold, uneven light, and blaze when she deals.
    faceMat.emissiveIntensity = 1.3 + 0.35 * Math.sin(t * 2.3) * Math.sin(t * 0.7) + flare * 1.8;
    // The head turns to follow you, slowly, and never quite all the way:
    // little enough that her fingers stay on her cheeks.
    if (watch) {
      held.updateMatrixWorld();
      held.worldToLocal(tmp.copy(watch));
      const wantYaw = THREE.MathUtils.clamp(Math.atan2(tmp.x, tmp.z), -0.3, 0.3);
      const wantPitch = THREE.MathUtils.clamp(-Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z)), -0.25, 0.2);
      const k = 1 - Math.exp(-dt * 0.9);
      yaw += (wantYaw - yaw) * k;
      pitch += (wantPitch - pitch) * k;
    }
    // A jolt when her eyes flare, then a slow, listening tilt.
    if (flare > 1.2 && twitch <= 0) twitch = 1;
    twitch = Math.max(0, twitch - dt * 1.8);
    const jolt = Math.sin(twitch * 26) * twitch * 0.08;
    head.rotation.set(pitch + Math.sin(t * 0.43) * 0.025, yaw + jolt, Math.sin(t * 0.29) * 0.045 + jolt * 0.5);
  }

  return { group, update };
}
