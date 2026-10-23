import * as THREE from 'three';
import { tableCell } from '../core/bets.js';
import { SANS } from '../ui/fonts.js';
import { mulberry32 } from './textures.js';

// The stats chalkboard (design doc 5.11, 8.1): a slate on an easel at the
// table's left, across from the results board. It chalks up the live chance
// of every number, laid out as on the felt, and of every colour, dozen,
// column and half, with the pockets wheel work has changed, so a heavily
// built wheel stays readable (doc 11). A number above its fair chance is
// chalked bright, one below it dim. It only shows: a tap opens its card.

const W = 1400;
const H = 900;
const BOARD = { w: 0.46, h: 0.3 };
const CHALK = { white: '#ece6da', red: '#ee8f88', green: '#93d6a2', dim: 'rgba(236, 230, 218, 0.38)', yellow: '#f1d98a' };
const ENH_CHALK = { gilded: '#f1d98a', platinum: '#ffffff', glass: '#a9dcf2', bone: '#e2d6b6', ember: '#ff9a4a', lucky: '#8fd19e', cursed: '#9fc47a' };

const pct = (p) => {
  const x = p * 100;
  return x >= 9.95 ? x.toFixed(0) : x.toFixed(1);
};

/** Text in chalk: the letters, then the slate showing through in specks and dry streaks. */
function chalk(ctx, text, x, y, px, color, seed, { align = 'center', weight = 500 } = {}) {
  ctx.save();
  ctx.font = `${weight} ${px}px ${SANS}`;
  const tw = ctx.measureText(text).width;
  const layer = document.createElement('canvas');
  layer.width = Math.ceil(tw + px * 0.6);
  layer.height = Math.ceil(px * 1.6);
  const l = layer.getContext('2d');
  l.font = ctx.font;
  l.textAlign = 'center';
  l.textBaseline = 'middle';
  l.fillStyle = color;
  l.fillText(text, layer.width / 2, layer.height / 2);
  const r = mulberry32(seed);
  l.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < (layer.width * layer.height) / 70; i++) {
    l.globalAlpha = 0.25 + r() * 0.6;
    l.fillRect(r() * layer.width, r() * layer.height, 1 + r() * 2.5, 1 + r() * 1.2);
  }
  const dx = align === 'left' ? 0 : align === 'right' ? -layer.width : -layer.width / 2;
  ctx.drawImage(layer, x + dx - (align === 'left' ? px * 0.3 : align === 'right' ? -px * 0.3 : 0), y - layer.height / 2);
  ctx.restore();
  return tw;
}

function slate(ctx) {
  ctx.fillStyle = '#1c2320';
  ctx.fillRect(0, 0, W, H);
  // Old chalk wiped and wiped again: clouds of grey, and a few ghost strokes.
  const r = mulberry32(31);
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = `rgba(220, 225, 215, ${0.012 + r() * 0.02})`;
    ctx.beginPath();
    ctx.ellipse(r() * W, r() * H, 60 + r() * 180, 20 + r() * 60, r() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = r() < 0.5 ? `rgba(255, 255, 255, ${r() * 0.04})` : `rgba(0, 0, 0, ${r() * 0.12})`;
    ctx.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2);
  }
}

/** Paints the board for statsView(state) (or the House's own wheel before a run is drawn). */
function paint(ctx, stats) {
  slate(ctx);
  ctx.strokeStyle = 'rgba(236, 230, 218, 0.28)';
  ctx.lineWidth = 3;
  chalk(ctx, 'THE WHEEL TONIGHT', 40, 62, 54, CHALK.white, 1, { align: 'left', weight: 600 });
  const changed = stats.pockets !== stats.plainPockets ? ` (of ${stats.plainPockets})` : '';
  chalk(ctx, `${stats.pockets} POCKETS${changed}`, W - 40, 62, 40, CHALK.white, 2, { align: 'right' });

  // The numbers, laid out as on the felt: zero on the left, three rows of twelve.
  const x0 = 140;
  const y0 = 112;
  const cw = (W - 40 - x0) / 12;
  const ch = 118;
  const cell = (n) => {
    if (n === 0) return { x: 40, y: y0, w: x0 - 52, h: ch * 3 };
    const { col, row } = tableCell(n);
    return { x: x0 + col * cw, y: y0 + (2 - row) * ch, w: cw, h: ch };
  };
  for (const v of stats.numbers) {
    const c = cell(v.number);
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    ctx.strokeRect(c.x + 4, c.y + 4, c.w - 8, c.h - 8);
    if (!v.count) {
      chalk(ctx, String(v.number), cx, cy - 18, 40, CHALK.dim, 100 + v.number);
      ctx.save();
      ctx.strokeStyle = CHALK.dim;
      ctx.beginPath();
      ctx.moveTo(c.x + 16, cy + 30);
      ctx.lineTo(c.x + c.w - 16, cy - 40);
      ctx.stroke();
      ctx.restore();
      continue;
    }
    const color = v.colors.length > 1 ? CHALK.yellow : v.colors[0] === 'red' ? CHALK.red : v.colors[0] === 'green' ? CHALK.green : CHALK.white;
    chalk(ctx, String(v.number), cx, cy - 20, 44, color, 100 + v.number, { weight: 600 });
    // Above its fair chance it is chalked bright and underlined; below, dim.
    const ratio = v.chance / stats.fair;
    const shade = ratio > 1.02 ? CHALK.yellow : ratio < 0.98 ? CHALK.dim : CHALK.white;
    chalk(ctx, pct(v.chance), cx, cy + 26, 34, shade, 200 + v.number);
    if (ratio > 1.02) {
      ctx.save();
      ctx.strokeStyle = CHALK.yellow;
      ctx.beginPath();
      ctx.moveTo(cx - 26, cy + 48);
      ctx.lineTo(cx + 26, cy + 46);
      ctx.stroke();
      ctx.restore();
    }
    if (v.count > 1) chalk(ctx, `×${v.count}`, c.x + c.w - 12, c.y + 22, 22, CHALK.white, 300 + v.number, { align: 'right' });
    v.enh.forEach((e, i) => {
      ctx.save();
      ctx.fillStyle = ENH_CHALK[e] ?? CHALK.white;
      ctx.beginPath();
      ctx.arc(c.x + 18 + i * 16, c.y + 20, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  // The outside bets, as chances.
  let y = y0 + ch * 3 + 56;
  const line = (text, seed, color = CHALK.white) => {
    chalk(ctx, text, 40, y, 38, color, seed, { align: 'left' });
    y += 58;
  };
  const c = stats.colors;
  line(`RED ${pct(c.red)}%   BLACK ${pct(c.black)}%   ZERO ${pct(c.green)}%${stats.blanks ? `   BLANK ${pct(c.blank)}%` : ''}`, 401);
  line(`DOZENS ${stats.dozens.map(pct).join('% · ')}%   COLUMNS ${stats.columns.map(pct).join('% · ')}%`, 402);
  line(`1–18 ${pct(stats.halves.low)}%   19–36 ${pct(stats.halves.high)}%   ODD ${pct(stats.halves.odd)}%   EVEN ${pct(stats.halves.even)}%`, 403);
  // The pockets wheel work has changed, by what was done to them.
  const groups = new Map();
  for (const e of stats.enhanced) {
    if (e.enh === 'blank') continue;
    groups.set(e.name, [...(groups.get(e.name) ?? []), e.number]);
  }
  const done = [...groups].map(([name, ns]) => `${name.toUpperCase()} ${ns.join(' ')}`);
  if (done.length) line(done.join('   '), 404, CHALK.yellow);
  else line(`EVERY NUMBER ${pct(stats.fair)}% ON THE HOUSE'S OWN WHEEL`, 404, CHALK.dim);
}

/**
 * The chalkboard on its easel, in the table's frame. `onOpen` is a tap (its
 * card); `onHover(on, ev)` is the pointer over it (its note).
 */
export function createChalkboard({ materials, interaction, onOpen, onHover, enabled = () => true }) {
  const group = new THREE.Group();
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(BOARD.w, BOARD.h),
    // Lit a little from within, as the results board is, so it reads in the dark.
    new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.95 }),
  );
  face.position.z = 0.008;
  face.userData.role = 'chalkboard';
  const wood = materials?.mahogany ?? new THREE.MeshStandardMaterial({ color: 0x3a2214, roughness: 0.7 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(BOARD.w + 0.03, BOARD.h + 0.03, 0.014), wood);
  // The easel: two legs splayed under it and a third behind.
  // The legs reach the floor from a board standing `height` above it.
  const legGeo = new THREE.BoxGeometry(0.018, 1.26, 0.018);
  const legs = [-1, 1].map((side) => {
    const leg = new THREE.Mesh(legGeo, wood);
    leg.position.set(side * (BOARD.w / 2 - 0.04), -0.53, -0.01);
    leg.rotation.z = side * 0.06;
    return leg;
  });
  const back = new THREE.Mesh(legGeo, wood);
  back.position.set(0, -0.53, -0.16);
  back.rotation.x = -0.25;
  const ledge = new THREE.Mesh(new THREE.BoxGeometry(BOARD.w + 0.02, 0.012, 0.04), wood);
  ledge.position.set(0, -BOARD.h / 2 - 0.02, 0.012);
  for (const m of [frame, ...legs, back, ledge, face]) {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  // A small lamp of its own, so the chalk catches some light.
  const lamp = new THREE.PointLight(0xffe2b0, 0.22, 0.9, 2);
  lamp.position.set(0, 0.2, 0.3);
  group.add(lamp);

  interaction?.add(face, {
    enabled,
    click: () => onOpen?.(),
    hover: (hit, ev) => onHover?.(true, ev),
    leave: () => onHover?.(false),
  });

  let key = '';
  function sync(stats) {
    const next = JSON.stringify(stats);
    if (next === key) return;
    key = next;
    paint(canvas.getContext('2d'), stats);
    tex.needsUpdate = true;
  }

  return {
    group,
    face,
    sync,
    worldPosition(out = new THREE.Vector3()) {
      return face.getWorldPosition(out);
    },
  };
}
