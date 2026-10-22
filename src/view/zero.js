import * as THREE from 'three';
import { rng } from '../ui/marks.js';

// Madame Zero herself (design doc 5.9, 8.1): a headless automaton in a
// crimson blouse and a black corset, holding her own head in her hands at
// her waist. The head wears an oxblood turban with a red jewel, black
// feathers and a band of green stones; its eyes are blank, and they glow a
// cold green, the House's colour. Porcelain stitched at the seams, a brass
// socket where the neck ends. The head in her hands turns to watch you.
//
// Everything is built from primitives and painted canvases (no image files).
// Local frame: +z faces the player, y up from the floor of her case.

const TAU = Math.PI * 2;

// Where the parts sit, in metres from the case floor.
const HEAD = new THREE.Vector3(0, 0.47, 0.2); // held in front of her waist, clear of the easel
const HEAD_R = 0.098;
const FACE_SCALE = new THREE.Vector3(0.86, 1.15, 0.92);
const NECK_TOP = 0.8;

const PORCELAIN = 0xe7dac6;
const CRIMSON = 0x6a1219;
const SOOT = 0x0c0a0b;

function canvasTexture(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { canvas, ctx: canvas.getContext('2d'), tex };
}

/** A seam: a line with stitches across it, as on a mended doll. */
function stitches(ctx, points, { width = 2.4, tick = 7, every = 9, color = '#2a1c18' } = {}) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineWidth = width;
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
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
      ctx.beginPath();
      ctx.moveTo(x - nx * tick * 0.5, y - ny * tick * 0.5);
      ctx.lineTo(x + nx * tick * 0.5, y + ny * tick * 0.5);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** A hairline crack in the glaze, wandering from (x, y). */
function crack(ctx, x, y, len, angle, seed) {
  const r = rng(seed);
  ctx.save();
  ctx.strokeStyle = 'rgba(60, 48, 40, 0.55)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  let a = angle;
  for (let s = 0; s < len; s += 6) {
    a += (r() - 0.5) * 0.9;
    x += Math.cos(a) * 6;
    y += Math.sin(a) * 6;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

// The face is painted on an equirectangular map: on a sphere, u 0.25 faces
// +z, so the face is centred a quarter of the way across.
const FW = 1024;
const FH = 512;
const FX = FW * 0.25;
const FY = FH / 2;
// Metres on the face to pixels on the map (near the front, where it counts).
const px = (d) => (Math.asin(Math.max(-1, Math.min(1, d / (HEAD_R * FACE_SCALE.x)))) / TAU) * FW;
const py = (d) => -(Math.asin(Math.max(-1, Math.min(1, d / (HEAD_R * FACE_SCALE.y)))) / Math.PI) * FH;

const EYE = { x: 0.029, y: 0.006, w: 0.03, h: 0.0105 };

/** Her eyes' almond shape, centred on (cx, cy), the outer corner on `side`. */
function eyePath(ctx, cx, cy, w, h, side) {
  ctx.beginPath();
  ctx.moveTo(cx - (w / 2) * side, cy + h * 0.15);
  ctx.quadraticCurveTo(cx, cy - h * 1.15, cx + (w / 2) * side, cy - h * 0.25);
  ctx.quadraticCurveTo(cx, cy + h * 0.95, cx - (w / 2) * side, cy + h * 0.15);
  ctx.closePath();
}

/** The face: porcelain, blank eyes, brows drawn down, a moon, the seams. */
function paintFace() {
  const t = canvasTexture(FW, FH);
  const { ctx } = t;
  // Glaze, cold in the hollows: darker toward the sides of the face.
  const g = ctx.createRadialGradient(FX, FY - 20, 20, FX, FY, FW * 0.3);
  g.addColorStop(0, '#efe4d2');
  g.addColorStop(0.55, '#d9cbb6');
  g.addColorStop(1, '#8f8578');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, FW, FH);
  const r = rng(77);
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = `rgba(90, 70, 60, ${r() * 0.05})`;
    ctx.fillRect(r() * FW, r() * FH, 1 + r() * 3, 1 + r() * 3);
  }
  // Sunken sockets, smudged dark, so the eyes seem to sit deep.
  for (const side of [-1, 1]) {
    const cx = FX + px(EYE.x) * side;
    const cy = FY + py(EYE.y);
    const sg = ctx.createRadialGradient(cx, cy, 4, cx, cy, 46);
    sg.addColorStop(0, 'rgba(40, 24, 28, 0.75)');
    sg.addColorStop(1, 'rgba(40, 24, 28, 0)');
    ctx.fillStyle = sg;
    ctx.fillRect(cx - 50, cy - 50, 100, 100);
  }
  // The eyes: white and blank, rimmed in black, winged at the corners.
  for (const side of [-1, 1]) {
    const cx = FX + px(EYE.x) * side;
    const cy = FY + py(EYE.y);
    const w = px(EYE.w);
    const h = -py(EYE.h) * 2;
    eyePath(ctx, cx, cy, w, h, side);
    ctx.fillStyle = '#f4f1e8';
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#120a0a';
    ctx.stroke();
    // The upper lid's shadow on the white.
    ctx.save();
    eyePath(ctx, cx, cy, w, h, side);
    ctx.clip();
    ctx.fillStyle = 'rgba(70, 60, 60, 0.35)';
    ctx.fillRect(cx - w, cy - h * 1.2, w * 2, h * 0.7);
    ctx.restore();
    // The wing, and two tear-lines drawn down the cheek.
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#120a0a';
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(cx + (w / 2) * side, cy - h * 0.25);
    ctx.lineTo(cx + (w / 2 + 16) * side, cy - h * 0.9);
    ctx.stroke();
    ctx.lineWidth = 2.6;
    for (const k of [-0.12, 0.18]) {
      ctx.beginPath();
      ctx.moveTo(cx + w * k * side, cy + h * 0.7);
      ctx.lineTo(cx + w * k * side + side * 2, cy + h * 0.7 + 30);
      ctx.stroke();
    }
  }
  // Brows: heavy, and drawn down hard toward the nose.
  ctx.strokeStyle = '#0d0808';
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.moveTo(FX + 14 * side, FY + py(0.022));
    ctx.quadraticCurveTo(FX + 40 * side, FY + py(0.031), FX + (px(EYE.x) + px(EYE.w) / 2 + 8) * side, FY + py(0.036));
    ctx.stroke();
  }
  // A crescent moon over the brows.
  ctx.fillStyle = '#120a0a';
  ctx.beginPath();
  ctx.arc(FX, FY + py(0.046), 11, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#e4d8c5';
  ctx.beginPath();
  ctx.arc(FX + 5, FY + py(0.046) - 3, 9.5, 0, TAU);
  ctx.fill();
  // Lips, thin and dark, set in a line.
  const my = FY + py(-0.047);
  ctx.fillStyle = '#5a2a2c';
  ctx.beginPath();
  ctx.moveTo(FX - 26, my);
  ctx.quadraticCurveTo(FX - 10, my - 9, FX, my - 5);
  ctx.quadraticCurveTo(FX + 10, my - 9, FX + 26, my);
  ctx.quadraticCurveTo(FX, my + 12, FX - 26, my);
  ctx.fill();
  ctx.strokeStyle = '#1d0c0d';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(FX - 26, my);
  ctx.quadraticCurveTo(FX, my + 2, FX + 26, my);
  ctx.stroke();
  // The seams: down from the left eye to the jaw, across the right cheek,
  // and straight down the chin.
  const lx = FX - px(EYE.x);
  stitches(ctx, [
    [lx - 18, FY + py(-0.004)],
    [lx - 24, FY + py(-0.03)],
    [lx - 14, FY + py(-0.06)],
    [lx - 6, FY + py(-0.085)],
  ]);
  stitches(ctx, [
    [FX + px(0.03), FY + py(-0.02)],
    [FX + px(0.05), FY + py(-0.032)],
  ]);
  stitches(ctx, [
    [FX, my + 14],
    [FX + 1, FY + py(-0.09)],
  ], { tick: 9 });
  crack(ctx, FX + 30, FY + py(0.07), 70, 0.6, 11);
  crack(ctx, FX - 60, FY + py(0.045), 50, 2.6, 13);
  t.tex.needsUpdate = true;
  return t;
}

/** What glows: only the eyes, on black. */
function paintEyeGlow() {
  const t = canvasTexture(FW, FH);
  const { ctx } = t;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, FW, FH);
  for (const side of [-1, 1]) {
    const cx = FX + px(EYE.x) * side;
    const cy = FY + py(EYE.y);
    eyePath(ctx, cx, cy, px(EYE.w) * 0.86, -py(EYE.h) * 1.6, side);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }
  t.tex.needsUpdate = true;
  return t;
}

/** Her arms and chest: porcelain with the seams sewn shut. */
function paintSkin() {
  const t = canvasTexture(256, 256);
  const { ctx } = t;
  ctx.fillStyle = '#ddd0bc';
  ctx.fillRect(0, 0, 256, 256);
  const r = rng(91);
  for (let i = 0; i < 600; i++) {
    ctx.fillStyle = `rgba(90, 70, 60, ${r() * 0.06})`;
    ctx.fillRect(r() * 256, r() * 256, 1 + r() * 4, 1 + r() * 4);
  }
  stitches(ctx, [
    [128, 10],
    [124, 120],
    [130, 246],
  ], { width: 3, tick: 10, every: 12 });
  // Little sigils inked along the arm.
  ctx.strokeStyle = 'rgba(30, 18, 16, 0.7)';
  ctx.lineWidth = 2;
  for (const y of [60, 150, 210]) {
    ctx.beginPath();
    ctx.arc(60, y, 7, 0, TAU);
    ctx.moveTo(60, y - 12);
    ctx.lineTo(60, y + 12);
    ctx.stroke();
  }
  crack(ctx, 200, 40, 60, 1.8, 5);
  t.tex.needsUpdate = true;
  return t;
}

/** A mesh from `a` to `b` along its local y (cylinders, stretched spheres). */
function between(mesh, a, b) {
  mesh.position.copy(a).lerp(b, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return mesh;
}

export function createZero({ brass }) {
  const group = new THREE.Group();
  group.name = 'madame-zero';
  const V2 = (x, y) => new THREE.Vector2(x, y);
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

  const skinTex = paintSkin();
  const skin = new THREE.MeshStandardMaterial({ color: 0xffffff, map: skinTex.tex, roughness: 0.32, metalness: 0.03 });
  const porcelain = new THREE.MeshStandardMaterial({ color: PORCELAIN, roughness: 0.3, metalness: 0.03 });
  const crimson = new THREE.MeshStandardMaterial({ color: CRIMSON, roughness: 0.78 });
  const soot = new THREE.MeshStandardMaterial({ color: SOOT, roughness: 0.45, metalness: 0.1 });
  const feather = new THREE.MeshStandardMaterial({ color: 0x24302b, roughness: 0.7, side: THREE.DoubleSide });
  const green = new THREE.MeshStandardMaterial({ color: 0x1f6a42, emissive: 0x2a8a52, emissiveIntensity: 0.7, roughness: 0.15, metalness: 0.2 });
  const ruby = new THREE.MeshStandardMaterial({ color: 0x9a1015, emissive: 0x6a0a0e, emissiveIntensity: 0.6, roughness: 0.12, metalness: 0.2 });
  const add = (mesh, parent = body) => {
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // ---- The body ------------------------------------------------------------------------
  const body = new THREE.Group();
  group.add(body);
  // Skirt and corset in black, pinched at the waist.
  // A long skirt to the case floor; she stands tall, so the head in her
  // hands clears the cards on the easel.
  const CORSET = [V2(0.2, 0), V2(0.185, 0.18), V2(0.15, 0.33), V2(0.155, 0.41), V2(0.17, 0.47)];
  const DEPTH = 0.74;
  const corset = add(new THREE.Mesh(new THREE.LatheGeometry(CORSET, 32), soot));
  corset.scale.z = DEPTH;
  // The corset's radius at height y, read off its profile.
  const corsetR = (y) => {
    const i = Math.max(1, CORSET.findIndex((p) => p.y >= y));
    const [a, b] = [CORSET[i - 1], CORSET[i]];
    return a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y);
  };
  // Two rows of brass eyelets down the corset's front.
  for (let i = 0; i < 6; i++) {
    const y = 0.2 + i * 0.05;
    for (const sx of [-1, 1]) {
      const eyelet = new THREE.Mesh(new THREE.TorusGeometry(0.006, 0.0018, 6, 12), brass);
      eyelet.position.set(sx * 0.022, y, corsetR(y) * DEPTH);
      body.add(eyelet);
    }
  }
  // The blouse: crimson, broad at the shoulders, open at the neck.
  const blouse = add(new THREE.Mesh(new THREE.LatheGeometry([V2(0.168, 0.45), V2(0.19, 0.53), V2(0.206, 0.61), V2(0.218, 0.675), V2(0.18, 0.71), V2(0.06, 0.725)], 32), crimson));
  blouse.scale.z = 0.72;
  // The neckline: bare porcelain, a folded collar round it.
  const chest = add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 16), porcelain));
  chest.scale.set(1.25, 0.62, 0.5);
  chest.position.set(0, 0.685, 0.045);
  const collar = add(new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.018, 8, 32), crimson));
  collar.scale.set(1.15, 1, 0.62);
  collar.rotation.x = Math.PI / 2 - 0.25;
  collar.position.set(0, 0.675, 0.0);
  // Gold chains hanging over the chest, one with a pendant.
  for (const [r, y, pendant] of [
    [0.06, 0.71, false],
    [0.085, 0.71, true],
  ]) {
    const chain = new THREE.Mesh(new THREE.TorusGeometry(r, 0.0022, 6, 32, Math.PI), brass);
    chain.rotation.set(-0.6, 0, Math.PI);
    chain.position.set(0, y, 0.035);
    body.add(chain);
    if (pendant) {
      const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.004, 16), brass);
      drop.rotation.x = Math.PI / 2 - 0.4;
      drop.position.set(0, y - r * 0.82, 0.035 + r * 0.56);
      body.add(drop);
    }
  }
  // The neck ends in a brass socket: whatever held her head is long gone.
  const neck = add(new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.04, NECK_TOP - 0.69, 20), porcelain));
  neck.position.y = (NECK_TOP + 0.69) / 2;
  const socket = new THREE.Mesh(new THREE.TorusGeometry(0.033, 0.006, 8, 24), brass);
  socket.rotation.x = Math.PI / 2;
  socket.position.y = NECK_TOP;
  body.add(socket);
  const hollow = new THREE.Mesh(new THREE.CircleGeometry(0.031, 24), new THREE.MeshBasicMaterial({ color: 0x050303 }));
  hollow.rotation.x = -Math.PI / 2;
  hollow.position.y = NECK_TOP + 0.001;
  body.add(hollow);
  const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.006, 0.05, 8), brass);
  spindle.position.y = NECK_TOP + 0.02;
  body.add(spindle);
  // A black choker with a green stone.
  const choker = add(new THREE.Mesh(new THREE.TorusGeometry(0.039, 0.008, 8, 24), soot));
  choker.rotation.x = Math.PI / 2;
  choker.position.y = 0.755;
  const stone = add(new THREE.Mesh(new THREE.OctahedronGeometry(0.011), green));
  stone.position.set(0, 0.745, 0.047);

  // ---- The arms, down to the head in her hands -------------------------------------------
  const hands = [];
  for (const sx of [-1, 1]) {
    // Elbows out, forearms coming in to the head's sides, as if offering it.
    const shoulder = V3(sx * 0.205, 0.67, 0.0);
    const elbow = V3(sx * 0.262, 0.53, 0.07);
    const wrist = V3(sx * (HEAD_R * FACE_SCALE.x + 0.028), HEAD.y - 0.035, HEAD.z - 0.02);
    // A puffed sleeve to the elbow, a black band at its cuff.
    const sleeve = add(between(new THREE.Mesh(new THREE.SphereGeometry(0.058, 18, 14), crimson), shoulder, elbow));
    sleeve.scale.set(1, 1.95, 1);
    const cuff = add(new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.009, 8, 20), soot));
    cuff.position.copy(shoulder).lerp(elbow, 0.9);
    cuff.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), elbow.clone().sub(shoulder).normalize());
    // Porcelain forearms, stitched, ringed in gold at the wrist.
    add(between(new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.022, elbow.distanceTo(wrist), 14), skin), elbow, wrist));
    for (const k of [0.78, 0.86, 0.93]) {
      const bangle = new THREE.Mesh(new THREE.TorusGeometry(0.021, 0.0035, 6, 20), brass);
      bangle.position.copy(elbow).lerp(wrist, k);
      bangle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), wrist.clone().sub(elbow).normalize());
      body.add(bangle);
    }
    // The hand: flat against the side of the head, the fingers curled
    // forward round the cheek and jaw, black at the nails.
    const hand = new THREE.Group();
    hand.position.set(sx * (HEAD_R * FACE_SCALE.x + 0.012), HEAD.y - 0.025, HEAD.z);
    body.add(hand);
    hands.push(hand);
    const palm = add(new THREE.Mesh(new THREE.SphereGeometry(0.032, 16, 12), skin), hand);
    palm.scale.set(0.42, 1.05, 0.95);
    for (let f = 0; f < 4; f++) {
      const base = V3(-sx * 0.004, -0.012 + f * 0.015, 0.018);
      const tip = V3(-sx * 0.04, -0.006 + f * 0.017 - Math.abs(f - 1.5) * 0.004, 0.07 - Math.abs(f - 1.5) * 0.006);
      add(between(new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.007, base.distanceTo(tip), 8), skin), base, tip), hand);
      const nail = new THREE.Mesh(new THREE.SphereGeometry(0.005, 8, 6), soot);
      nail.position.copy(tip);
      hand.add(nail);
    }
    // The thumb, curled under the jaw.
    add(between(new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.0065, 0.045, 8), skin), V3(0, -0.02, 0.012), V3(-sx * 0.03, -0.045, 0.03)), hand);
  }

  // ---- The head ------------------------------------------------------------------------
  // `held` is where her hands keep it; `head` turns inside it to watch you.
  const held = new THREE.Group();
  held.position.copy(HEAD);
  held.rotation.z = -0.1; // askew in her grip
  body.add(held);
  const head = new THREE.Group();
  held.add(head);
  const faceTex = paintFace();
  const glowTex = paintEyeGlow();
  const faceMat = new THREE.MeshStandardMaterial({
    map: faceTex.tex,
    emissiveMap: glowTex.tex,
    emissive: 0xc8ffe0,
    emissiveIntensity: 0.9,
    roughness: 0.3,
    metalness: 0.03,
  });
  const face = add(new THREE.Mesh(new THREE.SphereGeometry(HEAD_R, 48, 32), faceMat), head);
  face.scale.copy(FACE_SCALE);
  const nose = add(new THREE.Mesh(new THREE.ConeGeometry(0.0115, 0.034, 10), porcelain), head);
  nose.rotation.x = Math.PI / 2 - 0.3;
  nose.position.set(0, -0.012, HEAD_R * FACE_SCALE.z - 0.004);
  // The turban: a swollen crown of oxblood cloth, wound in folds.
  const turban = add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 28, 18), crimson), head);
  turban.scale.set(1.04, 0.92, 1.02);
  turban.position.y = 0.135;
  for (const [y, r, tilt, twist] of [
    [0.095, 0.08, 0.16, 0.2],
    [0.125, 0.078, -0.14, -0.3],
    [0.16, 0.058, 0.25, 0.5],
  ]) {
    const fold = add(new THREE.Mesh(new THREE.TorusGeometry(r, 0.018, 8, 28), crimson), head);
    fold.rotation.set(Math.PI / 2 + tilt, twist, 0);
    fold.position.y = y;
  }
  // Wraps of cloth crossing the front, so it reads as wound, not as a cap.
  for (const [y, rot] of [
    [0.13, 0.55],
    [0.12, -0.6],
  ]) {
    const wrap = add(new THREE.Mesh(new THREE.TorusGeometry(0.086, 0.016, 8, 28, Math.PI), crimson), head);
    wrap.rotation.set(Math.PI / 2 - 0.5, 0, rot);
    wrap.position.set(0, y, 0.012);
  }
  // A black band across the brow, set with green stones.
  const band = add(new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.009, 8, 32, Math.PI * 1.1), soot), head);
  band.rotation.set(Math.PI / 2 - 0.08, 0, Math.PI * 0.95);
  band.position.y = 0.066;
  for (let i = -2; i <= 2; i++) {
    const a = i * 0.32;
    const gem = add(new THREE.Mesh(new THREE.OctahedronGeometry(i === 0 ? 0.008 : 0.0055), green), head);
    gem.position.set(Math.sin(a) * 0.088, 0.066 + Math.abs(i) * 0.002, Math.cos(a) * 0.088);
  }
  // The brooch: gold, with a red jewel; black feathers fanned behind it.
  const brooch = add(new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.027, 0.008, 24), brass), head);
  brooch.rotation.x = Math.PI / 2 - 0.35;
  brooch.position.set(0, 0.15, 0.083);
  const setting = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.003, 6, 20), brass);
  setting.rotation.x = -0.35;
  setting.position.set(0, 0.15, 0.088);
  head.add(setting);
  const jewel = add(new THREE.Mesh(new THREE.SphereGeometry(0.015, 16, 12), ruby), head);
  jewel.scale.z = 0.6;
  jewel.position.set(0, 0.151, 0.09);
  // Feathers: long dark leaves fanned up behind the brooch.
  const leaf = new THREE.SphereGeometry(1, 12, 8);
  for (let i = 0; i < 5; i++) {
    const a = (i - 2) * 0.32;
    const plume = add(new THREE.Mesh(leaf, feather), head);
    plume.scale.set(0.017, 0.07, 0.004);
    plume.position.set(Math.sin(a) * 0.065, 0.18 + Math.cos(a) * 0.055, 0.05 - Math.abs(a) * 0.03);
    plume.rotation.set(-0.3, 0, -a);
  }
  // Gold hoops at her ears.
  for (const sx of [-1, 1]) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.0022, 6, 16), brass);
    hoop.rotation.y = Math.PI / 2;
    hoop.position.set(sx * 0.082, -0.032, -0.005);
    head.add(hoop);
  }

  // ---- Motion --------------------------------------------------------------------------
  const tmp = new THREE.Vector3();
  let yaw = 0;
  let pitch = 0;
  let twitch = 0;

  /**
   * Each frame. `flare` (0 to 2) brightens her eyes and jolts the head;
   * `watch` is a point in the world (the camera) her head turns toward.
   */
  function update(dt, t, { flare = 0, watch = null } = {}) {
    body.scale.y = 1 + Math.sin(t * 1.1) * 0.004; // the clockwork breathes
    // Her eyes hold a cold, uneven light, and blaze when she deals.
    faceMat.emissiveIntensity = 1.3 + 0.35 * Math.sin(t * 2.3) * Math.sin(t * 0.7) + flare * 1.8;
    // The head turns to follow you, slowly, and never quite all the way.
    if (watch) {
      held.updateMatrixWorld();
      held.worldToLocal(tmp.copy(watch));
      const wantYaw = THREE.MathUtils.clamp(Math.atan2(tmp.x, tmp.z), -0.7, 0.7);
      const wantPitch = THREE.MathUtils.clamp(-Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z)), -0.45, 0.35);
      const k = 1 - Math.exp(-dt * 0.9);
      yaw += (wantYaw - yaw) * k;
      pitch += (wantPitch - pitch) * k;
    }
    // A jolt when her eyes flare, then a slow, listening tilt.
    if (flare > 1.2 && twitch <= 0) twitch = 1;
    twitch = Math.max(0, twitch - dt * 1.8);
    const jolt = Math.sin(twitch * 26) * twitch * 0.12;
    head.rotation.set(pitch + Math.sin(t * 0.43) * 0.03, yaw + jolt, Math.sin(t * 0.29) * 0.06 + jolt * 0.5);
    for (const [i, hand] of hands.entries()) hand.position.y = HEAD.y - 0.025 + Math.sin(t * 0.8 + i * 2) * 0.002;
  }

  return { group, update };
}

