import * as THREE from 'three';
import { RARITY } from '../../core/economy.js';
import { format } from '../../core/num.js';
import { rng } from '../../ui/marks.js';
import { INK, paintScratch, scrawlFont, scrawlText, typedFont } from '../ink.js';

// Madame Zero and the gramophone (design doc 5.9, 5.10, 8.1; decision 24):
// the station left of the Cage. A fortune-teller automaton sits in a glass
// booth on a mahogany plinth, green-eyed, a crystal ball under her hands.
// Her lever is on the booth's right; the three cards she deals stand on an
// easel along the plinth's front, tilted up to the eye. On her left the
// gramophone sits on a stool, its record crate on the floor beneath it.
//
// On a phone the cards are small, so a tap opens the card's own card (with
// Take), as at the Cabinet; with a mouse, hovering shows its note.
//
// Local frame: +z faces the player, y up from the floor, the origin on the
// floor under the booth's centre.

const deg = THREE.MathUtils.degToRad;
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

const PLINTH = { w: 0.86, h: 0.82, d: 0.56 };
const CASE = { w: 0.82, d: 0.5, y0: 0.85, y1: 1.78 };
const ROOF_Y = 1.86;
// The easel the cards stand on, along the plinth's front.
const EASEL = { y: PLINTH.h + 0.015, z: PLINTH.d / 2 + 0.07, tilt: deg(30) };
const CARD = { w: 0.25, h: 0.34, gap: 0.04, px: 512 };
const cardX = (i) => (i - 1) * (CARD.w + CARD.gap);
// The slot the cards come out of, on the plinth's front under the glass.
const SLOT = new THREE.Vector3(0, PLINTH.h - 0.05, PLINTH.d / 2 + 0.01);
const LEVER = { x: PLINTH.w / 2 + 0.07, y: 0.66, z: 0.12, len: 0.34, rest: deg(-18), pulled: deg(62) };
const GRAMO = { x: -0.74, seat: 0.6 };

const LIGHT = 1.4; // the booth's lamp at full mood
const EYE_GLOW = 1.4;
const DEAL_TIME = 0.55;
const DEAL_STAGGER = 0.12;
const PULL_TIME = 0.75;

// Each record's sleeve and label, by its tune (records.js).
const RECORD_INK = {
  waltz: ['#2f6b4a', '#d9e8c9'],
  tango: ['#a3242c', '#f2d6c4'],
  lullaby: ['#5f7896', '#e6eef5'],
  overture: ['#b48a43', '#2a1708'],
  march: ['#2c2433', '#c9bfd2'],
  boogie: ['#c46a2a', '#2a1708'],
  nocturne: ['#24345e', '#d8deef'],
  static: ['#6f6b62', '#1a1814'],
  carousel: ['#b8483a', '#f4ead2'],
};
const inkFor = (tune) => RECORD_INK[tune] ?? ['#4a3a2a', INK.bone];

function canvasTexture(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { canvas, ctx: canvas.getContext('2d'), tex };
}

/** Words broken into lines no wider than `width` in the current font. */
function wrap(ctx, text, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Card stock: ivory for white cards, soot for black, worn at the edges. */
function paintStock(ctx, w, h, seed, black) {
  const r = rng(seed);
  const g = ctx.createRadialGradient(w / 2, h * 0.42, h * 0.1, w / 2, h / 2, h * 0.75);
  g.addColorStop(0, black ? '#1a1c19' : '#efe5cc');
  g.addColorStop(1, black ? '#060706' : '#b9ab88');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < (w * h) / 260; i++) {
    ctx.fillStyle = black ? `rgba(237, 229, 211, ${r() * 0.04})` : `rgba(60, 40, 20, ${r() * 0.06})`;
    ctx.fillRect(r() * w, r() * h, 1 + r() * 14, 1);
  }
  ctx.lineWidth = 10;
  ctx.strokeStyle = black ? 'rgba(69, 194, 122, 0.55)' : 'rgba(30, 20, 10, 0.7)';
  ctx.strokeRect(22, 22, w - 44, h - 44);
  ctx.lineWidth = 3;
  ctx.strokeRect(38, 38, w - 76, h - 76);
}

/** An eye, the House's mark, at (cx, cy). */
function paintEye(ctx, cx, cy, size, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = size * 0.09;
  ctx.beginPath();
  ctx.moveTo(cx - size, cy);
  ctx.quadraticCurveTo(cx, cy - size * 0.75, cx + size, cy);
  ctx.quadraticCurveTo(cx, cy + size * 0.75, cx - size, cy);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A fortune card's face: rarity, her line, what it does. */
function drawCardFace(t, card, seed) {
  const { ctx, canvas, tex } = t;
  const { width: w, height: h } = canvas;
  const black = card.kind === 'black';
  const ink = black ? INK.bone : '#1c140c';
  const accent = black ? '#6fe39e' : INK.bloodDeep;
  paintStock(ctx, w, h, seed, black);
  // The rarity as a prisoner's tally, as on the Cabinet's tags.
  const marks = Math.max(1, Object.keys(RARITY).indexOf(card.rarity) + 1);
  for (let i = 0; i < marks; i++) paintScratch(ctx, w / 2 - (marks - 1) * 14 + i * 28, 66, w / 2 - (marks - 1) * 14 + i * 28 + 3, 120, 7, seed + i * 7, accent);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = scrawlFont(68);
  const lines = wrap(ctx, card.text, w - 110);
  const size = lines.length > 3 ? 56 : 68;
  ctx.font = scrawlFont(size);
  const wrapped = wrap(ctx, card.text, w - 110);
  let y = 214;
  for (const line of wrapped) {
    scrawlText(ctx, line, w / 2, y, size, ink);
    y += size * 1.05;
  }
  // A scratched rule, then the effect in type.
  paintScratch(ctx, 90, y - 6, w - 90, y - 12, 4, seed + 31, accent);
  ctx.font = typedFont(34);
  ctx.fillStyle = ink;
  y += 40;
  for (const line of wrap(ctx, card.effect, w - 120)) {
    ctx.fillText(line, w / 2, y);
    y += 40;
  }
  paintEye(ctx, w / 2, h - 96, 34, accent);
  if (!card.takeable) {
    // Dealt, but it could do nothing now: scored through.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, w, h);
    paintScratch(ctx, 60, h * 0.75, w - 60, h * 0.25, 12, seed + 53, INK.blood);
  }
  tex.needsUpdate = true;
}

/** A card's back: the lore line scratched under her eye. */
function drawCardBack(t, card, seed) {
  const { ctx, canvas, tex } = t;
  const { width: w, height: h } = canvas;
  const black = card.kind === 'black';
  paintStock(ctx, w, h, seed + 5, !black);
  const ink = black ? '#1c140c' : INK.bone;
  paintEye(ctx, w / 2, h * 0.36, 70, black ? INK.bloodDeep : '#6fe39e');
  ctx.textAlign = 'center';
  ctx.font = typedFont(34);
  ctx.fillStyle = ink;
  let y = h * 0.58;
  for (const line of wrap(ctx, card.lore ?? '', w - 120)) {
    ctx.fillText(line, w / 2, y);
    y += 42;
  }
  tex.needsUpdate = true;
}

/** The booth's sign: her name, backlit like the Cage's board. */
function drawSign(t) {
  const { ctx, canvas, tex } = t;
  const { width: w, height: h } = canvas;
  ctx.fillStyle = '#120c09';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#a8864c';
  ctx.lineWidth = 6;
  ctx.strokeRect(12, 12, w - 24, h - 24);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = '#45c27a';
  ctx.shadowBlur = 18;
  scrawlText(ctx, 'Madame Zero', w / 2, h * 0.42, 72, '#9ff0c0');
  ctx.shadowBlur = 0;
  ctx.font = typedFont(30);
  ctx.fillStyle = '#c8a462';
  ctx.fillText('FORTUNES · ONCE A DEBT', w / 2, h * 0.78);
  tex.needsUpdate = true;
}

/** The lever's tag: what the next pull costs. */
function drawLeverTag(t, info) {
  const { ctx, canvas, tex } = t;
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = info.ok ? '#c49a52' : '#6b5534';
  ctx.beginPath();
  ctx.moveTo(18, 0);
  ctx.lineTo(w, 0);
  ctx.lineTo(w, h);
  ctx.lineTo(18, h);
  ctx.lineTo(0, h / 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#2a1708';
  ctx.beginPath();
  ctx.arc(26, h / 2, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = typedFont(30);
  ctx.fillText(info.top, (w + 40) / 2, h * 0.32);
  scrawlText(ctx, info.price, (w + 40) / 2, h * 0.7, 46, '#2a1708');
  tex.needsUpdate = true;
}

/** A record's label (the centre of the disc) and its sleeve. */
function drawLabel(t, record) {
  const { ctx, canvas, tex } = t;
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#060606';
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
  ctx.fill();
  // Grooves.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
  for (let r = w * 0.2; r < w / 2; r += 5) {
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (!record) {
    tex.needsUpdate = true;
    return;
  }
  const [paper, ink] = inkFor(record.tune);
  ctx.fillStyle = paper;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w * 0.19, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = typedFont(15);
  ctx.fillText(record.name.toUpperCase(), w / 2, h / 2 - 16);
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 4, 0, Math.PI * 2);
  ctx.fill();
  tex.needsUpdate = true;
}

function box(w, h, d, material, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** An invisible pad: a finger needs more than the object (doc 9.10). */
function pad(w, h, d) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial());
  m.material.visible = false;
  return m;
}

export function createOracle({ materials, interaction, callbacks = {} }) {
  const group = new THREE.Group();
  group.name = 'oracle';
  const wood = materials.mahogany;
  const brass = materials.brass;
  const dark = materials.darkMetal;
  let locked = false;
  let level = 1;

  // ---- The booth -----------------------------------------------------------------
  group.add(box(PLINTH.w, PLINTH.h, PLINTH.d, wood, 0, PLINTH.h / 2, 0));
  group.add(box(PLINTH.w + 0.04, 0.03, PLINTH.d + 0.04, brass, 0, PLINTH.h + 0.015, 0));
  group.add(box(PLINTH.w + 0.06, 0.06, PLINTH.d + 0.06, dark, 0, 0.03, 0));
  // Panels on the plinth's front.
  for (const x of [-0.21, 0.21]) group.add(box(0.32, 0.5, 0.012, dark, x, 0.42, PLINTH.d / 2 + 0.004));
  // The case: posts, a roof, glass, and a velvet curtain behind her.
  for (const [x, z] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    group.add(box(0.05, CASE.y1 - CASE.y0, 0.05, wood, (x * (CASE.w - 0.05)) / 2, (CASE.y0 + CASE.y1) / 2, (z * (CASE.d - 0.05)) / 2));
  }
  group.add(box(CASE.w + 0.1, 0.08, CASE.d + 0.1, wood, 0, ROOF_Y - 0.04, 0));
  group.add(box(CASE.w + 0.14, 0.025, CASE.d + 0.14, brass, 0, ROOF_Y + 0.0125, 0));
  const velvet = new THREE.MeshStandardMaterial({ color: 0x3a0c10, roughness: 0.95 });
  group.add(box(CASE.w - 0.06, CASE.y1 - CASE.y0, 0.02, velvet, 0, (CASE.y0 + CASE.y1) / 2, -CASE.d / 2 + 0.04));
  // Barely there: a glint, never a haze over her.
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fb8ac, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.05, depthWrite: false });
  const front = new THREE.Mesh(new THREE.PlaneGeometry(CASE.w - 0.05, CASE.y1 - CASE.y0), glass);
  front.position.set(0, (CASE.y0 + CASE.y1) / 2, CASE.d / 2 - 0.02);
  group.add(front);
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(CASE.d - 0.05, CASE.y1 - CASE.y0), glass);
    side.rotation.y = (sx * Math.PI) / 2;
    side.position.set((sx * (CASE.w - 0.05)) / 2, (CASE.y0 + CASE.y1) / 2, 0);
    group.add(side);
  }

  // Her sign, on the roof.
  const sign = canvasTexture(768, 220);
  drawSign(sign);
  const signMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.84, 0.24),
    new THREE.MeshStandardMaterial({ map: sign.tex, emissiveMap: sign.tex, emissive: 0xffffff, emissiveIntensity: 0.34, roughness: 0.6 }),
  );
  signMesh.position.set(0, ROOF_Y + 0.15, 0.04);
  group.add(box(0.9, 0.29, 0.03, wood, 0, ROOF_Y + 0.15, 0.02), signMesh);

  // ---- Madame Zero ------------------------------------------------------------------
  // A carnival automaton: a porcelain face under an oxblood turban, a shawl of
  // green velvet, her arms reaching to a crystal ball. Green is the House's.
  const porcelain = new THREE.MeshStandardMaterial({ color: 0xe6d8bf, roughness: 0.28, metalness: 0.04 });
  const robe = new THREE.MeshStandardMaterial({ color: 0x123522, roughness: 0.85 });
  const scarf = new THREE.MeshStandardMaterial({ color: 0x5a1016, roughness: 0.75 });
  const zero = new THREE.Group();
  zero.position.set(0, CASE.y0, -0.06);
  group.add(zero);
  const V = (x, y) => new THREE.Vector2(x, y);
  // Shoulders broad and sloping, the shawl gathered at the neck.
  const torso = new THREE.Mesh(new THREE.LatheGeometry([V(0.17, 0), V(0.2, 0.12), V(0.22, 0.3), V(0.21, 0.4), V(0.14, 0.47), V(0.05, 0.51), V(0.035, 0.56)], 28), robe);
  torso.scale.z = 0.7;
  torso.castShadow = true;
  zero.add(torso);
  const necklace = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.007, 6, 24), brass);
  necklace.rotation.x = Math.PI / 2 - 0.35;
  necklace.position.set(0, 0.47, 0.025);
  zero.add(necklace);
  const head = new THREE.Group();
  head.position.set(0, 0.66, 0.0);
  zero.add(head);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.085, 28, 20), porcelain);
  face.scale.set(0.86, 1.18, 0.9);
  head.add(face);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.03, 8), porcelain);
  nose.rotation.x = Math.PI / 2 - 0.25;
  nose.position.set(0, -0.012, 0.08);
  head.add(nose);
  const lips = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 8), new THREE.MeshStandardMaterial({ color: 0x7a1820, roughness: 0.4 }));
  lips.scale.set(1.5, 0.45, 0.6);
  lips.position.set(0, -0.052, 0.07);
  head.add(lips);
  // The turban: a swollen crown of cloth over a wound band, a brooch in front.
  const turban = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 16), scarf);
  turban.scale.set(1.08, 0.78, 1.04);
  turban.position.y = 0.075;
  head.add(turban);
  for (const [y, r, tilt] of [
    [0.04, 0.083, 0.12],
    [0.07, 0.088, -0.1],
  ]) {
    const wind = new THREE.Mesh(new THREE.TorusGeometry(r, 0.02, 8, 28), scarf);
    wind.rotation.set(Math.PI / 2 + tilt, 0, 0);
    wind.position.y = y;
    head.add(wind);
  }
  const brooch = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.008, 16), brass);
  brooch.rotation.x = Math.PI / 2;
  brooch.position.set(0, 0.07, 0.103);
  head.add(brooch);
  const jewel = new THREE.Mesh(new THREE.OctahedronGeometry(0.013), new THREE.MeshStandardMaterial({ color: 0x2a8a52, emissive: 0x2a8a52, emissiveIntensity: 0.8, roughness: 0.2 }));
  jewel.position.set(0, 0.07, 0.11);
  head.add(jewel);
  // Her eyes sit in dark sockets, so the green reads.
  const socket = new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 0.9 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0a1a10, emissive: 0x45c27a, emissiveIntensity: EYE_GLOW });
  for (const sx of [-1, 1]) {
    const hollow = new THREE.Mesh(new THREE.SphereGeometry(0.017, 12, 8), socket);
    hollow.scale.set(1.3, 0.8, 0.5);
    hollow.position.set(sx * 0.03, 0.012, 0.066);
    head.add(hollow);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.008, 10, 8), eyeMat);
    eye.position.set(sx * 0.03, 0.012, 0.072);
    head.add(eye);
  }
  for (const sx of [-1, 1]) {
    const earring = new THREE.Mesh(new THREE.SphereGeometry(0.01, 10, 8), brass);
    earring.position.set(sx * 0.072, -0.035, 0.0);
    head.add(earring);
  }
  // The crystal ball on its brass stand, her hands over it.
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 24, 18),
    new THREE.MeshPhysicalMaterial({ color: 0xbfe8d2, roughness: 0.05, transparent: true, opacity: 0.3, emissive: 0x1d6b42, emissiveIntensity: 0.35 }),
  );
  ball.position.set(0, 0.14, 0.2);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), new THREE.MeshBasicMaterial({ color: 0x45c27a, transparent: true, opacity: 0.5 }));
  core.position.copy(ball.position);
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.07, 16), brass);
  stand.position.set(0, 0.035, 0.2);
  zero.add(ball, core, stand);
  const hands = [];
  for (const sx of [-1, 1]) {
    // An arm from the shoulder down to the hand, in the shawl's velvet.
    const shoulder = new THREE.Vector3(sx * 0.19, 0.38, 0.02);
    const wrist = new THREE.Vector3(sx * 0.085, 0.22, 0.19);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, shoulder.distanceTo(wrist), 10), robe);
    arm.position.copy(shoulder).lerp(wrist, 0.5);
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), shoulder.clone().sub(wrist).normalize());
    zero.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 8), porcelain);
    hand.scale.set(1.3, 0.55, 1.2);
    hand.position.set(sx * 0.07, 0.215, 0.2);
    zero.add(hand);
    hands.push(hand);
  }
  // One lamp in the top of the case lights her, her cards and the gramophone
  // beside her: every point light costs every material in the hall on a phone.
  const lamp = new THREE.PointLight(0xffd8a0, LIGHT, 3.4, 2);
  // In the case's front corner, off her face, so the porcelain is not blown out.
  lamp.position.set(-0.32, CASE.y1 - 0.06, 0.2);
  group.add(lamp);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffe2b0 }));
  bulb.position.copy(lamp.position);
  group.add(bulb);

  // ---- The slot and the easel ----------------------------------------------------------
  group.add(box(0.34, 0.03, 0.02, brass, SLOT.x, SLOT.y, SLOT.z - 0.002));
  group.add(box(0.3, 0.008, 0.024, new THREE.MeshBasicMaterial({ color: 0x000000 }), SLOT.x, SLOT.y, SLOT.z));
  // The easel's +y is the cards' faces: tilted up from the vertical by
  // EASEL.tilt, so they face the eye, standing back on a brass lip.
  const easel = new THREE.Group();
  easel.position.set(0, EASEL.y, EASEL.z);
  easel.rotation.x = Math.PI / 2 - EASEL.tilt;
  group.add(easel);
  // A brass lip the cards rest against, and a velvet board behind them.
  const lip = box(PLINTH.w - 0.04, 0.02, 0.03, brass, 0, 0.01, 0.01);
  easel.add(lip);
  const board = box(PLINTH.w - 0.06, 0.012, CARD.h + 0.04, velvet, 0, 0, -CARD.h / 2);
  easel.add(board);

  // The cards: each a thin box with a face and a back, laid on the easel.
  const cards = [];
  for (let i = 0; i < 3; i++) {
    const face = canvasTexture(CARD.px, Math.round((CARD.px * CARD.h) / CARD.w));
    const back = canvasTexture(CARD.px, Math.round((CARD.px * CARD.h) / CARD.w));
    const faceMat = new THREE.MeshStandardMaterial({ map: face.tex, emissiveMap: face.tex, emissive: 0xffffff, emissiveIntensity: 0.18, roughness: 0.7 });
    const backMat = new THREE.MeshStandardMaterial({ map: back.tex, roughness: 0.7 });
    const edge = new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 0.8 });
    // +y is the face once the card lies on the easel; the box's +y side.
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(CARD.w, 0.003, CARD.h), [edge, edge, faceMat, backMat, edge, edge]);
    mesh.userData.role = 'fortune-card';
    mesh.userData.card = i;
    mesh.castShadow = true;
    // A finger's pad: the card's share of the easel.
    const p = pad(CARD.w + CARD.gap, 0.02, CARD.h + 0.03);
    mesh.add(p);
    const holder = new THREE.Group(); // where the card rests on the easel
    holder.position.set(cardX(i), 0.008, -CARD.h / 2 + 0.01);
    easel.add(holder);
    const pivot = new THREE.Group(); // the card's flight, in the group's frame
    group.add(pivot);
    pivot.add(mesh);
    pivot.visible = false;
    cards.push({ i, mesh, holder, pivot, face, back, faceMat, key: '', hover: false, deal: -1, delay: 0, out: -1, flip: 0, flipTo: 0, shake: 0 });
  }

  // ---- The lever --------------------------------------------------------------------
  // A brass bracket holds it out from the plinth's side, clear of the cards.
  const leverBase = box(0.03, 0.14, 0.14, brass, PLINTH.w / 2 + 0.015, LEVER.y, LEVER.z);
  group.add(leverBase, box(LEVER.x - PLINTH.w / 2, 0.04, 0.05, brass, (LEVER.x + PLINTH.w / 2) / 2, LEVER.y, LEVER.z));
  const leverArm = new THREE.Group();
  leverArm.position.set(LEVER.x + 0.02, LEVER.y, LEVER.z);
  leverArm.rotation.x = LEVER.rest;
  group.add(leverArm);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 16), brass);
  hub.rotation.z = Math.PI / 2;
  leverArm.add(hub);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, LEVER.len, 12), brass);
  rod.position.y = LEVER.len / 2;
  rod.castShadow = true;
  leverArm.add(rod);
  // A red knob: the one thing on her booth that asks to be pulled.
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.048, 18, 14), new THREE.MeshStandardMaterial({ color: 0x8e1219, roughness: 0.25, metalness: 0.15, emissive: 0x5a0a10, emissiveIntensity: 0.35 }));
  knob.position.y = LEVER.len;
  knob.castShadow = true;
  leverArm.add(knob);
  knob.userData.role = 'lever';
  rod.userData.role = 'lever';
  // The pad runs the lever's length, as wide as a fingertip on a phone; the
  // cards stand in front of it, so where the two meet a tap finds the card.
  const leverPad = pad(0.34, LEVER.len + 0.14, 0.3);
  leverPad.position.set(0.09, LEVER.len / 2 + 0.03, 0);
  leverArm.add(leverPad);
  // Its tag: what the next pull costs.
  const leverTag = canvasTexture(320, 150);
  const leverTagMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.07), new THREE.MeshStandardMaterial({ map: leverTag.tex, emissiveMap: leverTag.tex, emissive: 0xffffff, emissiveIntensity: 0.3, transparent: true, roughness: 0.6 }));
  leverTagMesh.position.set(PLINTH.w / 2 - 0.1, LEVER.y - 0.17, PLINTH.d / 2 + 0.012);
  leverTagMesh.rotation.z = -0.05;
  leverTagMesh.userData.role = 'lever';
  group.add(leverTagMesh);
  let pullT = -1;

  // ---- The gramophone ------------------------------------------------------------------
  const gramo = new THREE.Group();
  gramo.position.set(GRAMO.x, 0, 0.1);
  gramo.rotation.y = deg(18);
  group.add(gramo);
  const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 24), wood);
  seat.position.y = GRAMO.seat;
  seat.castShadow = true;
  gramo.add(seat);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, GRAMO.seat, 8), wood);
    leg.position.set(Math.cos(a) * 0.15, GRAMO.seat / 2, Math.sin(a) * 0.15);
    leg.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12);
    gramo.add(leg);
  }
  const cabinetBox = box(0.32, 0.12, 0.3, wood, 0, GRAMO.seat + 0.08, 0);
  gramo.add(cabinetBox);
  gramo.add(box(0.33, 0.012, 0.31, brass, 0, GRAMO.seat + 0.145, 0));
  const label = canvasTexture(256, 256);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.125, 40), new THREE.MeshStandardMaterial({ map: label.tex, roughness: 0.35, metalness: 0.1 }));
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = GRAMO.seat + 0.153;
  gramo.add(disc);
  drawLabel(label, null);
  const tonearm = new THREE.Group();
  tonearm.position.set(0.13, GRAMO.seat + 0.16, -0.11);
  gramo.add(tonearm);
  const armRod = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.17, 8), brass);
  armRod.rotation.x = Math.PI / 2;
  armRod.position.z = 0.085;
  tonearm.add(armRod);
  const needleHead = box(0.03, 0.02, 0.03, brass, 0, -0.005, 0.17);
  tonearm.add(needleHead);
  // The horn rises from the back and flares toward the player.
  const hornPoints = [];
  for (let i = 0; i <= 16; i++) {
    const u = i / 16;
    hornPoints.push(new THREE.Vector2(0.01 + 0.15 * u ** 2.6, u * 0.34));
  }
  const hornMat = brass.clone();
  hornMat.side = THREE.DoubleSide;
  const horn = new THREE.Mesh(new THREE.LatheGeometry(hornPoints, 28), hornMat);
  // Turned to the booth's side, so it reads in profile from where you stand.
  horn.position.set(-0.08, GRAMO.seat + 0.14, -0.08);
  horn.rotation.x = deg(30);
  horn.rotation.z = deg(48);
  horn.castShadow = true;
  gramo.add(horn);
  const gramoPad = pad(0.42, 0.6, 0.42);
  gramoPad.position.y = GRAMO.seat + 0.28;
  gramo.add(gramoPad);
  for (const m of [cabinetBox, disc, horn, gramoPad]) m.userData.role = 'gramophone';

  // The crate under the stool, a sleeve standing for each record.
  const crate = new THREE.Group();
  crate.position.set(0, 0, 0.02);
  gramo.add(crate);
  const slat = new THREE.MeshStandardMaterial({ color: 0x5a3c22, roughness: 0.9 });
  for (const [w, h, d, x, y, z] of [
    [0.36, 0.2, 0.015, 0, 0.1, 0.13],
    [0.36, 0.2, 0.015, 0, 0.1, -0.13],
    [0.015, 0.2, 0.26, 0.175, 0.1, 0],
    [0.015, 0.2, 0.26, -0.175, 0.1, 0],
    [0.36, 0.015, 0.26, 0, 0.008, 0],
  ]) crate.add(box(w, h, d, slat, x, y, z));
  const crateFront = crate.children[0];
  const sleeves = [];
  const cratePad = pad(0.42, 0.34, 0.34);
  cratePad.position.y = 0.16;
  crate.add(cratePad);
  // The crate answers as the gramophone does: both open the crate's card.
  cratePad.userData.role = 'gramophone';
  crateFront.userData.role = 'gramophone';

  let crateKey = null;
  function syncCrate(view) {
    const ids = view.crate.map((r) => r.id).join(',');
    if (ids === crateKey) return;
    crateKey = ids;
    for (const s of sleeves) crate.remove(s);
    sleeves.length = 0;
    view.crate.forEach((r, i) => {
      const [paper] = inkFor(r.tune);
      const sleeve = box(0.006, 0.24, 0.24, new THREE.MeshStandardMaterial({ color: paper, roughness: 0.8 }), -0.15 + i * 0.03, 0.135, 0);
      sleeve.rotation.z = 0.08 - (i % 2) * 0.05;
      crate.add(sleeve);
      sleeves.push(sleeve);
    });
  }

  // ---- Pointer -----------------------------------------------------------------------
  const hover = (target, ev) => callbacks.onHover?.(target, ev);
  let leverHover = false;
  const leverHandler = {
    enabled: () => !locked,
    hover(hit, ev) {
      leverHover = true;
      hover({ kind: 'lever' }, ev);
    },
    leave() {
      leverHover = false;
      hover(null);
    },
    click: () => callbacks.onLever?.(),
  };
  for (const m of [knob, rod, leverPad, leverTagMesh]) interaction.add(m, leverHandler);
  for (const c of cards) {
    interaction.add(c.mesh, {
      enabled: () => !locked && c.pivot.visible && c.out < 0,
      hover(hit, ev) {
        c.hover = true;
        hover({ kind: 'card', card: c.i }, ev);
      },
      leave() {
        c.hover = false;
        hover(null);
      },
      click: () => callbacks.onCard?.(c.i),
    });
  }
  let gramoHover = false;
  const gramoHandler = {
    enabled: () => !locked,
    hover(hit, ev) {
      gramoHover = true;
      hover({ kind: 'gramophone' }, ev);
    },
    leave() {
      gramoHover = false;
      hover(null);
    },
    click: () => callbacks.onGramophone?.(),
  };
  for (const m of [cabinetBox, disc, horn, gramoPad, cratePad, crateFront]) interaction.add(m, gramoHandler);

  // ---- Sync --------------------------------------------------------------------------
  let dealKey = null; // which deal is on the easel: `${rerolls}:${cards}`
  let leverKey = '';
  let playing = null;
  let firstSync = true;

  function syncCards(oracle) {
    const key = oracle.dealt ? `${oracle.rerolls}:${oracle.cards.map((c) => c.id).join(',')}` : null;
    const fresh = key !== dealKey;
    dealKey = key;
    for (const c of cards) {
      const card = oracle.cards[c.i];
      if (!card) {
        c.pivot.visible = false;
        c.key = '';
        continue;
      }
      const faceKey = JSON.stringify(card);
      if (faceKey !== c.key) {
        c.key = faceKey;
        drawCardFace(c.face, card, 900 + c.i * 41);
        drawCardBack(c.back, card, 900 + c.i * 41);
      }
      if (fresh) {
        // A new deal slides out of the slot, one card after another.
        c.pivot.visible = true;
        c.out = -1;
        c.deal = firstSync ? 1 : 0;
        c.delay = c.i * DEAL_STAGGER;
        c.flip = c.flipTo = 0;
      }
      // Once one is taken it is gone, and the others turn their backs.
      const taken = oracle.taken !== null;
      if (card.taken && c.out < 0) c.out = firstSync ? 1 : 0;
      c.flipTo = taken && !card.taken ? 1 : 0;
      if (firstSync) c.flip = c.flipTo;
    }
  }

  /** view: { oracle: oracleView(state), gramophone: gramophoneView(state) } */
  function sync(view) {
    if (!view) return;
    syncCards(view.oracle);
    const o = view.oracle;
    const cost = format(o.rerollCost);
    let info = { top: 'DEAL AGAIN', price: `${cost} coin${cost === '1' ? '' : 's'}`, ok: o.canReroll };
    if (o.taken !== null) info = { top: 'THIS DEBT', price: 'taken', ok: false };
    else if (!o.dealt) info = { top: 'PULL', price: 'free', ok: true };
    const k = JSON.stringify(info);
    if (k !== leverKey) {
      leverKey = k;
      drawLeverTag(leverTag, info);
    }
    const g = view.gramophone;
    const id = g.playing?.id ?? null;
    if (id !== playing) {
      playing = id;
      drawLabel(label, g.playing);
    }
    syncCrate(g);
    firstSync = false;
  }

  // ---- Animation -------------------------------------------------------------------
  const tmpQ = new THREE.Quaternion();
  const tmpS = new THREE.Vector3();
  const restPos = new THREE.Vector3();
  const restQ = new THREE.Quaternion();
  const noQ = new THREE.Quaternion();
  const lift = new THREE.Vector3();
  // In the slot a card lies flat, face up, as it comes out under the glass.
  const slotQ = new THREE.Quaternion();
  // Turned over top to bottom, as a card is turned on a table.
  const flipQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  let flare = 0;
  let spinning = 0;
  let leverShake = 0;

  /** Her lever is pulled: it swings down and back, her eyes flare. */
  function pullAnim() {
    pullT = 0;
    flare = 1.4;
  }

  /** A card is taken: it lifts toward the glass and goes; her eyes flare. */
  function takeAnim(i) {
    const c = cards[i];
    if (!c) return;
    c.out = 0;
    flare = 2;
  }

  /** Refused: the card or the lever shakes. */
  function deny(target) {
    if (target?.kind === 'card' && cards[target.card]) cards[target.card].shake = 1;
    if (target?.kind === 'lever') leverShake = 1;
  }

  function update(dt, t = 0) {
    // Her idle: a slow sway, breathing, the ball's glow.
    flare = Math.max(0, flare - dt * 1.4);
    head.rotation.y = Math.sin(t * 0.37) * 0.12 + Math.sin(t * 1.3) * 0.02;
    head.rotation.x = -0.08 + Math.sin(t * 0.5) * 0.03 - flare * 0.06;
    torso.scale.y = 1 + Math.sin(t * 1.1) * 0.006;
    for (const [k, hand] of hands.entries()) hand.position.y = 0.215 + Math.sin(t * 0.9 + k * 1.7) * 0.006 + flare * 0.015;
    eyeMat.emissiveIntensity = EYE_GLOW * (0.75 + 0.25 * Math.sin(t * 2.1)) + flare * 2;
    core.material.opacity = 0.35 + 0.15 * Math.sin(t * 1.7) + flare * 0.3;
    lamp.intensity = LIGHT * level * (gramoHover && !locked ? 1.15 : 1);
    bulb.visible = level > 0.05;

    // The lever: down fast, back slow.
    if (pullT >= 0) {
      pullT += dt / PULL_TIME;
      const u = Math.min(1, pullT);
      const swing = u < 0.3 ? easeOut(u / 0.3) : 1 - easeInOut((u - 0.3) / 0.7);
      leverArm.rotation.x = LEVER.rest + (LEVER.pulled - LEVER.rest) * swing;
      if (pullT >= 1) pullT = -1;
    } else {
      leverShake = Math.max(0, leverShake - dt * 2.5);
      leverArm.rotation.x = LEVER.rest + Math.sin(leverShake * 30) * 0.06 * leverShake;
    }
    const leverLit = leverHover && !locked ? 0.55 : 0.3;
    leverTagMesh.material.emissiveIntensity += (leverLit - leverTagMesh.material.emissiveIntensity) * (1 - Math.exp(-dt * 12));

    // Cards: out of the slot onto the easel; a taken one lifts and fades.
    group.updateMatrixWorld();
    const groupQ = group.getWorldQuaternion(tmpQ).invert();
    for (const c of cards) {
      if (!c.pivot.visible) continue;
      // The rest pose, in the group's frame.
      c.holder.matrixWorld.decompose(restPos, restQ, tmpS);
      group.worldToLocal(restPos);
      restQ.premultiply(groupQ);
      if (c.deal < 1) {
        if (c.delay > 0) c.delay -= dt;
        else c.deal = Math.min(1, c.deal + dt / DEAL_TIME);
      }
      const d = easeOut(Math.max(0, c.deal));
      c.pivot.position.lerpVectors(SLOT, restPos, d);
      c.pivot.quaternion.slerpQuaternions(slotQ, restQ, d);
      c.pivot.scale.setScalar(0.35 + 0.65 * d);
      c.flip += (c.flipTo - c.flip) * (1 - Math.exp(-dt * 7));
      c.mesh.quaternion.slerpQuaternions(noQ, flipQ, c.flip);
      c.shake = Math.max(0, c.shake - dt * 2.5);
      c.mesh.position.x = Math.sin(c.shake * 32) * 0.008 * c.shake;
      c.mesh.position.y = c.hover && !locked && c.out < 0 ? 0.01 : 0;
      if (c.out >= 0) {
        c.out = Math.min(1, c.out + dt / 0.9);
        const u = easeInOut(c.out);
        c.pivot.position.add(lift.set(0, 0.45 * u, -0.25 * u));
        c.faceMat.emissiveIntensity = 0.18 + 1.2 * Math.sin(u * Math.PI);
        if (c.out >= 1) c.pivot.visible = false;
      } else {
        c.faceMat.emissiveIntensity = 0.18 + (c.hover && !locked ? 0.2 : 0);
      }
      c.pivot.scale.multiplyScalar(c.out >= 0 ? 1 - 0.6 * easeInOut(c.out) : 1);
    }

    // The record turns while it plays.
    spinning += ((playing ? 1 : 0) - spinning) * (1 - Math.exp(-dt * 2));
    disc.rotation.z -= dt * spinning * 3.5;
    tonearm.rotation.y = -0.35 + spinning * 0.45;
  }

  function setLocked(v) {
    locked = v;
    if (!v) return;
    const was = leverHover || gramoHover || cards.some((c) => c.hover);
    leverHover = gramoHover = false;
    for (const c of cards) c.hover = false;
    if (was) hover(null);
  }

  // ---- Where things are, for notes and tests -------------------------------------------
  function leverWorldPosition(out = new THREE.Vector3()) {
    group.updateMatrixWorld();
    return knob.localToWorld(out.set(0, 0.02, 0));
  }

  function cardWorldPosition(i, out = new THREE.Vector3()) {
    const c = cards[i];
    if (!c || !c.pivot.visible) return null;
    group.updateMatrixWorld();
    return c.mesh.localToWorld(out.set(0, 0.004, 0));
  }

  function gramophoneWorldPosition(out = new THREE.Vector3()) {
    group.updateMatrixWorld();
    return gramo.localToWorld(out.set(0, GRAMO.seat + 0.18, 0.1));
  }

  return {
    group,
    /** Where the first-person camera looks when turned to her (local). */
    focus: new THREE.Vector3(-0.2, 1.5, 0.2),
    sync,
    update,
    setLocked,
    pullAnim,
    takeAnim,
    deny,
    /** 0..1: the booth's share of the room's attention (lighting moods). */
    setLightLevel(x) {
      level = Math.max(0, x);
    },
    leverWorldPosition,
    cardWorldPosition,
    gramophoneWorldPosition,
  };
}
