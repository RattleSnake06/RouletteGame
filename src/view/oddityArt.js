import * as THREE from 'three';
import { getRecord } from '../core/content/index.js';
import { paintChipFace } from '../ui/chipLook.js';
import { SANS } from '../ui/fonts.js';
import { mulberry32 } from './textures.js';

// The Cabinet's oddities (doc 5.11, 6.7): a wheel-maker's odds and ends, each
// painted on a small brass-framed plaque that sits on the compartment's
// velvet pad where a charm would. Sized and hung like a charm (talismanArt.js)
// so the compartment's rise, sink and flash work the same.

const SIZE = 0.064;
const DISC_Y = -0.0432; // the plaque's centre below the hang point, as a charm's disc
const DEPTH = 0.0045;
const REST_GLOW = 0.12;
const FLASH_GLOW = 1.2;
const PX = 256;

const faces = new Map();

const ground = (ctx, seed) => {
  const g = ctx.createRadialGradient(PX / 2, PX * 0.45, 10, PX / 2, PX / 2, PX * 0.75);
  g.addColorStop(0, '#2a1a14');
  g.addColorStop(1, '#0a0606');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, PX, PX);
  // A worn velvet nap.
  const r = mulberry32(seed);
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = r() < 0.5 ? `rgba(255, 230, 200, ${r() * 0.03})` : `rgba(0, 0, 0, ${r() * 0.12})`;
    ctx.fillRect(r() * PX, r() * PX, 1 + r() * 2, 1 + r() * 2);
  }
};
const lin = (ctx, x0, y0, x1, y1, stops) => {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  return g;
};
const GOLD = ['#fff0b8', '#e2b45a', '#9c6b1e'];
const STEEL = ['#e6e6e2', '#9a9a96', '#5a5a58'];
const WOOD = ['#8a5a32', '#5a3418', '#2e1a0c'];
const IRON = ['#5a5550', '#2e2a27', '#141210'];

/** A blade-and-handle tool lying corner to corner (the chisel, the file). */
function tool(ctx, { blade, handle, hatch = false, tip = 'flat' }) {
  ctx.save();
  ctx.translate(PX / 2, PX / 2);
  ctx.rotate(-Math.PI / 4);
  ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = lin(ctx, 0, -14, 0, 14, handle);
  ctx.beginPath();
  ctx.roundRect(22, -15, 92, 30, 12);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = lin(ctx, 0, -10, 0, 10, ['#d8b070', '#8a6a30']);
  ctx.fillRect(14, -11, 10, 22);
  ctx.fillStyle = lin(ctx, 0, -9, 0, 9, blade);
  ctx.beginPath();
  if (tip === 'flat') {
    ctx.moveTo(14, -8);
    ctx.lineTo(-96, -9);
    ctx.lineTo(-106, 0);
    ctx.lineTo(-96, 9);
    ctx.lineTo(14, 8);
  } else {
    ctx.moveTo(14, -7);
    ctx.lineTo(-110, -3);
    ctx.lineTo(-110, 3);
    ctx.lineTo(14, 7);
  }
  ctx.closePath();
  ctx.fill();
  if (hatch) {
    ctx.strokeStyle = 'rgba(30, 30, 30, 0.55)';
    ctx.lineWidth = 1.2;
    for (let x = -104; x < 10; x += 5) {
      ctx.beginPath();
      ctx.moveTo(x, -6);
      ctx.lineTo(x + 5, 6);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** A pot of lacquer with its brush. */
function lacquer(ctx, paint) {
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
  ctx.shadowBlur = 14;
  ctx.fillStyle = lin(ctx, 70, 0, 186, 0, ['#3a2a1c', '#7a5a38', '#3a2a1c']);
  ctx.beginPath();
  ctx.moveTo(72, 120);
  ctx.lineTo(80, 206);
  ctx.quadraticCurveTo(128, 222, 176, 206);
  ctx.lineTo(184, 120);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = lin(ctx, 0, 108, 0, 132, paint);
  ctx.beginPath();
  ctx.ellipse(128, 120, 56, 15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.beginPath();
  ctx.ellipse(110, 116, 18, 4, -0.1, 0, Math.PI * 2);
  ctx.fill();
  // The brush, standing in the pot, its bristles wet with the paint.
  ctx.translate(150, 112);
  ctx.rotate(0.45);
  ctx.fillStyle = lin(ctx, -6, 0, 6, 0, WOOD);
  ctx.fillRect(-6, -96, 12, 80);
  ctx.fillStyle = lin(ctx, -7, 0, 7, 0, ['#c9a66a', '#7a5a2a']);
  ctx.fillRect(-7, -18, 14, 12);
  ctx.fillStyle = paint[1];
  ctx.beginPath();
  ctx.moveTo(-7, -6);
  ctx.lineTo(7, -6);
  ctx.lineTo(4, 14);
  ctx.lineTo(-4, 14);
  ctx.fill();
  ctx.restore();
}

/** A chip of this material, lying on the velvet, as the tray shows it. */
function chip(ctx, material) {
  const face = document.createElement('canvas');
  face.width = face.height = 256;
  paintChipFace(face.getContext('2d'), 256, material, '1');
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.arc(128, 132, 84, 0, Math.PI * 2);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();
  ctx.drawImage(face, 44, 48, 168, 168);
}

const PAINTERS = {
  house_chip: (ctx) => chip(ctx, 'normal'),
  clay_chip: (ctx) => chip(ctx, 'clay'),
  bone_chip: (ctx) => chip(ctx, 'bone'),
  glass_chip: (ctx) => chip(ctx, 'glass'),
  gold_chip: (ctx) => chip(ctx, 'gold'),
  odds_plate(ctx) {
    // A brass plate stamped with new odds.
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 12;
    ctx.fillStyle = lin(ctx, 40, 60, 216, 196, ['#f3d48a', '#c39a5c', '#7a5a28']);
    ctx.beginPath();
    ctx.roundRect(40, 66, 176, 124, 10);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#2a1a0c';
    for (const [x, y] of [[54, 80], [202, 80], [54, 176], [202, 176]]) {
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 30px ${SANS}`;
    ctx.fillText('ODDS', 128, 96);
    ctx.font = `600 46px ${SANS}`;
    ctx.fillText('36 → 45', 128, 148);
    ctx.restore();
  },
  record_sleeve(ctx, record) {
    // A record half out of its sleeve, its name on the sleeve.
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#0c0b0b';
    ctx.beginPath();
    ctx.arc(150, 112, 78, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    for (let r = 30; r < 76; r += 6) {
      ctx.beginPath();
      ctx.arc(150, 112, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = '#a3161a';
    ctx.beginPath();
    ctx.arc(150, 112, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = lin(ctx, 30, 70, 170, 230, ['#d8c9a8', '#a8946e', '#6a5a3e']);
    ctx.fillRect(28, 76, 150, 150);
    ctx.fillStyle = '#2a1c10';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 20px ${SANS}`;
    const words = (getRecord(record)?.name ?? 'A RECORD').toUpperCase().split(' ');
    words.forEach((w, i) => ctx.fillText(w, 103, 140 + (i - (words.length - 1) / 2) * 24));
    ctx.restore();
  },
  gold_leaf(ctx) {
    // A booklet of gold leaf, three sheets fanned out of it.
    ctx.save();
    ctx.translate(128, 140);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 14;
    ctx.fillStyle = lin(ctx, -70, 0, 70, 0, ['#3a1418', '#6a2a2a', '#3a1418']);
    ctx.fillRect(-70, -10, 140, 72);
    ctx.shadowBlur = 0;
    for (const [a, dy] of [[-0.35, -18], [-0.08, -26], [0.22, -20]]) {
      ctx.save();
      ctx.rotate(a);
      ctx.translate(0, dy);
      ctx.fillStyle = lin(ctx, -50, -50, 50, 30, GOLD);
      ctx.beginPath();
      ctx.moveTo(-46, 10);
      ctx.quadraticCurveTo(-40, -60, -2, -64);
      ctx.quadraticCurveTo(40, -60, 46, 10);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(120, 80, 20, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  },
  brass_shim(ctx) {
    // A thin brass wedge, two screw holes through it.
    ctx.save();
    ctx.translate(128, 128);
    ctx.rotate(-0.3);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 12;
    ctx.fillStyle = lin(ctx, 0, -40, 0, 40, ['#f3d48a', '#c39a5c', '#7a5a28']);
    ctx.beginPath();
    ctx.moveTo(-96, -12);
    ctx.lineTo(96, -40);
    ctx.lineTo(96, 40);
    ctx.lineTo(-96, 12);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    for (const x of [-30, 50]) {
      ctx.fillStyle = '#1a100a';
      ctx.beginPath();
      ctx.arc(x, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 240, 200, 0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  },
  jewellers_file(ctx) {
    tool(ctx, { blade: STEEL, handle: WOOD, hatch: true, tip: 'point' });
  },
  red_lacquer(ctx) {
    lacquer(ctx, ['#e2393f', '#a3161a', '#5a0a0c']);
  },
  black_lacquer(ctx) {
    lacquer(ctx, ['#4a4442', '#141212', '#050505']);
  },
  casting_mould(ctx) {
    // Two halves of an iron mould, open on a pocket-shaped hollow.
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 12;
    for (const [x, flip] of [[44, 1], [136, -1]]) {
      ctx.fillStyle = lin(ctx, x, 70, x + 76, 190, IRON);
      ctx.fillRect(x, 70, 76, 120);
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = lin(ctx, 0, 90, 0, 170, ['#ffcf7a', '#e2843a', '#7a2a0a']);
    for (const x of [82, 174]) {
      ctx.beginPath();
      ctx.moveTo(x - 20, 92);
      ctx.lineTo(x + 20, 92);
      ctx.lineTo(x + 12, 168);
      ctx.lineTo(x - 12, 168);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#c39a5c';
    ctx.fillRect(118, 120, 20, 14);
    ctx.restore();
  },
  chisel(ctx) {
    tool(ctx, { blade: STEEL, handle: WOOD, tip: 'flat' });
  },
  horseshoe_nail(ctx) {
    // A horseshoe, open end up, and one of its nails beside it.
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 12;
    ctx.strokeStyle = lin(ctx, 60, 60, 200, 200, STEEL);
    ctx.lineWidth = 26;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(120, 112, 56, 0.1 * Math.PI, 0.9 * Math.PI, true);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#1a1412';
    for (let i = 0; i < 6; i++) {
      const a = Math.PI * (0.18 + (i / 5) * 0.64) + Math.PI;
      ctx.beginPath();
      ctx.arc(120 + Math.cos(a) * 56, 112 - Math.sin(a) * -56, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.translate(196, 150);
    ctx.rotate(0.35);
    ctx.fillStyle = lin(ctx, -6, 0, 6, 0, STEEL);
    ctx.beginPath();
    ctx.moveTo(-9, -40);
    ctx.lineTo(9, -40);
    ctx.lineTo(4, -32);
    ctx.lineTo(2, 44);
    ctx.lineTo(-2, 44);
    ctx.lineTo(-4, -32);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  },
  glass_pane(ctx) {
    // A pane of clear glass, its edge catching the lamp.
    ctx.save();
    ctx.translate(128, 128);
    ctx.rotate(0.12);
    ctx.fillStyle = 'rgba(170, 220, 245, 0.22)';
    ctx.fillRect(-72, -84, 144, 168);
    ctx.strokeStyle = 'rgba(210, 240, 255, 0.85)';
    ctx.lineWidth = 3;
    ctx.strokeRect(-72, -84, 144, 168);
    ctx.fillStyle = 'rgba(235, 250, 255, 0.45)';
    ctx.beginPath();
    ctx.moveTo(-60, 70);
    ctx.lineTo(-40, 70);
    ctx.lineTo(30, -76);
    ctx.lineTo(10, -76);
    ctx.fill();
    ctx.fillStyle = 'rgba(235, 250, 255, 0.25)';
    ctx.beginPath();
    ctx.moveTo(-20, 76);
    ctx.lineTo(-12, 76);
    ctx.lineTo(56, -70);
    ctx.lineTo(48, -70);
    ctx.fill();
    ctx.restore();
  },
  bone_inlay(ctx) {
    // A curved slip of bone, scored across for inlaying.
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 12;
    ctx.fillStyle = lin(ctx, 60, 80, 200, 180, ['#f4ecd8', '#ddd1b1', '#a8987a']);
    ctx.beginPath();
    ctx.arc(128, 210, 120, 1.15 * Math.PI, 1.85 * Math.PI);
    ctx.arc(128, 210, 86, 1.85 * Math.PI, 1.15 * Math.PI, true);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(90, 70, 40, 0.55)';
    ctx.lineWidth = 2;
    for (let i = 1; i < 9; i++) {
      const a = Math.PI * (1.15 + (i / 9) * 0.7);
      ctx.beginPath();
      ctx.moveTo(128 + Math.cos(a) * 88, 210 + Math.sin(a) * 88);
      ctx.lineTo(128 + Math.cos(a) * 118, 210 + Math.sin(a) * 118);
      ctx.stroke();
    }
    ctx.restore();
  },
  ember(ctx) {
    // A live coal in a brass dish, glowing.
    ctx.save();
    const glow = ctx.createRadialGradient(128, 130, 4, 128, 130, 110);
    glow.addColorStop(0, 'rgba(255, 140, 40, 0.65)');
    glow.addColorStop(1, 'rgba(255, 80, 10, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, PX, PX);
    ctx.fillStyle = lin(ctx, 40, 0, 216, 0, ['#7a5a28', '#e2b45a', '#7a5a28']);
    ctx.beginPath();
    ctx.ellipse(128, 176, 86, 26, 0, 0, Math.PI);
    ctx.fill();
    ctx.fillStyle = lin(ctx, 0, 100, 0, 176, ['#ffe2a8', '#ff7a1c', '#8a1a04']);
    ctx.beginPath();
    ctx.moveTo(72, 176);
    ctx.quadraticCurveTo(80, 112, 128, 104);
    ctx.quadraticCurveTo(178, 112, 184, 176);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(40, 10, 0, 0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(100, 150);
    ctx.lineTo(126, 132);
    ctx.lineTo(150, 156);
    ctx.stroke();
    ctx.restore();
  },
};

/** The painted face of an oddity, cached per id ("record_sleeve:nocturne" names its record). */
export function oddityFaceTexture(id) {
  if (faces.has(id)) return faces.get(id);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PX;
  const ctx = canvas.getContext('2d');
  const [base, extra] = id.split(':');
  ground(ctx, id.length * 97);
  (PAINTERS[base] ?? PAINTERS.chisel)(ctx, extra);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  faces.set(id, tex);
  return tex;
}

/** A plaque for the oddity `id`, hung like a charm, with setGlow for the Cabinet's flash. */
export function buildOddityMesh(id, { brass } = {}) {
  const group = new THREE.Group();
  group.name = `oddity:${id}`;
  const frameMat = (brass ?? new THREE.MeshStandardMaterial({ color: 0xc39a5c, metalness: 1, roughness: 0.35 })).clone();
  frameMat.emissive = new THREE.Color(0xffb46a);
  frameMat.emissiveIntensity = 0;
  const tex = oddityFaceTexture(id);
  const faceMat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: REST_GLOW, roughness: 0.6 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(SIZE + 0.007, SIZE + 0.007, DEPTH), frameMat);
  frame.position.y = DISC_Y;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), faceMat);
  face.position.set(0, DISC_Y, DEPTH / 2 + 0.0004);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0052, 0.0013, 8, 24), frameMat);
  ring.position.y = DISC_Y + SIZE / 2 + 0.008;
  for (const m of [frame, face, ring]) {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  group.userData = {
    id,
    setGlow(x) {
      const glow = Math.max(0, Math.min(1.5, x || 0));
      faceMat.emissiveIntensity = REST_GLOW + glow * FLASH_GLOW;
      frameMat.emissiveIntensity = glow * 0.9;
    },
  };
  return group;
}
