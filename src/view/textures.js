import * as THREE from 'three';
import { BIG, fbm, hash, mulberry32, smooth, vnoise } from './noise.js';

// Everything in the scene is painted procedurally at load time, so the game
// ships without image assets. The noise lives in noise.js, and the floor in
// floor.js, painted off the main thread.

export { mulberry32 };

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function finishTexture(canvas, { srgb = true, repeat = true } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Dark mahogany for the outer drum. Grain runs along u (around the wheel).
// ---------------------------------------------------------------------------

export function createRimWoodTexture({ w = 2048, h = 512 } = {}) {
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const D = img.data;
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const warp = fbm(u * 10, v * 3, 3, 10, BIG, 3);
      const lines = vnoise(u * 18, v * 90 + warp * 9, 18, BIG, 5);
      const fine = vnoise(u * 900, v * 300, 900, BIG, 9);
      const fig = fbm(u * 6, v * 2, 3, 6, BIG, 13);
      const k = 0.35 + 0.65 * lines;
      const m = (0.8 + 0.35 * fig) * (0.94 + 0.12 * fine);
      const i = (y * w + x) * 4;
      D[i] = (44 + 58 * k) * m;
      D[i + 1] = (20 + 26 * k) * m;
      D[i + 2] = (11 + 14 * k) * m;
      D[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finishTexture(canvas);
}

// ---------------------------------------------------------------------------
// Rotor cone: a top-down disc of alternating wood wedges (marquetry),
// grain running outward along each wedge.
// ---------------------------------------------------------------------------

export function createConeTexture({ size = 1024, wedges = 8 } = {}) {
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const D = img.data;
  const c = size / 2;
  const wa = (Math.PI * 2) / wedges;
  const light = [186, 130, 78];
  const dark = [162, 108, 62];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - c) / c;
      const dy = (y - c) / c;
      const rho = Math.sqrt(dx * dx + dy * dy);
      const th = Math.atan2(dy, dx);
      const k = Math.floor((th + Math.PI) / wa);
      const thc = -Math.PI + (k + 0.5) * wa;
      const along = rho * Math.cos(th - thc);
      const across = rho * Math.sin(th - thc);
      const warp = fbm(along * 3 + k * 7, across * 14, 3, BIG, BIG, 71);
      const grain = vnoise(along * 5 + k * 17, across * 150 + warp * 10, BIG, BIG, 73);
      const fine = vnoise(x * 0.9, y * 0.9, BIG, BIG, 79);
      const fig = fbm(along * 2.5 + k, across * 4, 3, BIG, BIG, 83);
      const base = k % 2 === 0 ? light : dark;
      let m = (0.7 + 0.42 * grain) * (0.88 + 0.22 * fig) * (0.95 + 0.1 * fine);
      // Seams between wedges.
      const toEdge = Math.abs(Math.abs(th - thc) - wa / 2) * rho * c;
      if (toEdge < 1.4) m *= 0.35;
      else if (toEdge < 2.6) m *= 0.75;
      let R = base[0] * m;
      let G = base[1] * m;
      let B = base[2] * m;
      // Darker banding ring at the rim of the cone and around the turret.
      if (rho > 0.93) {
        const ring = 0.55 + 0.25 * vnoise(th * 60, rho * 40, BIG, BIG, 89);
        R = 96 * ring;
        G = 58 * ring;
        B = 32 * ring;
        if (rho > 0.985) R = G = B = 18;
      } else if (rho < 0.24) {
        const t = smooth(0.24, 0.17, rho);
        R *= 1 - 0.45 * t;
        G *= 1 - 0.45 * t;
        B *= 1 - 0.45 * t;
      }
      const i = (y * size + x) * 4;
      D[i] = R;
      D[i + 1] = G;
      D[i + 2] = B;
      D[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finishTexture(canvas, { repeat: false });
}

// ---------------------------------------------------------------------------
// Number ring: one long strip with a cell per pocket. Canvas top maps to the
// outer edge of the wheel, so digits read upright from outside the wheel
// (upside down at the near side, like a real wheel). A cell is
// { label, color, enh }: the pocket's paint stays its ground, so Red and
// Black stay readable, and an enhancement (doc 6.5) shows in its numeral,
// a frame or a mark.
// ---------------------------------------------------------------------------

// The strip stays inside a texture size every phone takes, however many pockets.
const MAX_STRIP = 8192;

/** Numeral fill and frame for each enhancement; null for a plain cell. */
const ENH_LOOK = {
  gilded: { ink: ['#ffe9a6', '#c8902f'], frame: '#e2b45a' },
  platinum: { ink: ['#ffffff', '#b9c2cc'], frame: '#e6ebf0', double: true },
  glass: { ink: ['#f2fbff', '#9fd6ef'], frame: 'rgba(200, 236, 255, 0.85)' },
  bone: { ink: ['#f4ecd8', '#cbbd97'], frame: '#e2d6b6' },
  ember: { ink: ['#ffe2a8', '#ff7a1c'], frame: '#ff8a2a', glow: 'rgba(255, 110, 20, 0.9)' },
  lucky: { ink: ['#f1ebdf', '#f1ebdf'], frame: '#4fae5d' },
  cursed: { ink: ['#c9f0a8', '#6f9c4e'], frame: '#56743b', glow: 'rgba(120, 200, 80, 0.6)' },
};

export function createNumberStripTexture(cells, { cellW = 192, h = 150 } = {}) {
  const n = cells.length;
  cellW = Math.min(cellW, Math.floor(MAX_STRIP / n));
  const canvas = makeCanvas(n * cellW, h);
  const ctx = canvas.getContext('2d');
  const colors = {
    red: ['#b3181d', '#7d0d11'],
    black: ['#1d1b1a', '#0b0a0a'],
    green: ['#1c7a43', '#0d4424'],
    blank: ['#3a3634', '#1c1a19'],
  };
  for (let i = 0; i < n; i++) {
    const x0 = i * cellW;
    const [c0, c1] = colors[cells[i].color] ?? colors.blank;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, c0);
    grad.addColorStop(1, c1);
    ctx.fillStyle = grad;
    ctx.fillRect(x0, 0, cellW, h);
    const enh = cells[i].enh;
    // A cursed pocket sickens from the edges in; glass catches the light in streaks.
    if (enh === 'cursed') {
      const v = ctx.createRadialGradient(x0 + cellW / 2, h / 2, 10, x0 + cellW / 2, h / 2, cellW * 0.75);
      v.addColorStop(0, 'rgba(60, 90, 30, 0)');
      v.addColorStop(1, 'rgba(30, 60, 10, 0.7)');
      ctx.fillStyle = v;
      ctx.fillRect(x0, 0, cellW, h);
    } else if (enh === 'glass') {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, 0, cellW, h);
      ctx.clip();
      for (const [dx, w, a] of [[0.15, 0.12, 0.28], [0.42, 0.05, 0.22], [0.7, 0.09, 0.18]]) {
        ctx.fillStyle = `rgba(210, 240, 255, ${a})`;
        ctx.beginPath();
        ctx.moveTo(x0 + cellW * dx, h);
        ctx.lineTo(x0 + cellW * (dx + w), h);
        ctx.lineTo(x0 + cellW * (dx + w + 0.3), 0);
        ctx.lineTo(x0 + cellW * (dx + 0.3), 0);
        ctx.fill();
      }
      ctx.restore();
    } else if (enh === 'ember') {
      const g = ctx.createLinearGradient(0, h * 0.4, 0, h);
      g.addColorStop(0, 'rgba(255, 90, 10, 0)');
      g.addColorStop(1, 'rgba(255, 110, 20, 0.75)');
      ctx.fillStyle = g;
      ctx.fillRect(x0, 0, cellW, h);
    } else if (enh === 'bone') {
      ctx.fillStyle = '#ddd1b1';
      ctx.fillRect(x0, 8, cellW, h * 0.13);
      ctx.fillStyle = 'rgba(80, 60, 30, 0.35)';
      for (let t = 1; t < 8; t++) ctx.fillRect(x0 + (cellW * t) / 8, 8, 2, h * 0.13);
    } else if (enh === 'house') {
      // The House's own pocket (House Edge, doc 7.2): no number, her green eye.
      const cx = x0 + cellW / 2;
      const cy = h * 0.5;
      ctx.strokeStyle = '#9ff0b8';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.min(cellW * 0.32, 40), h * 0.17, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#9ff0b8';
      ctx.beginPath();
      ctx.arc(cx, cy, h * 0.085, 0, Math.PI * 2);
      ctx.fill();
    } else if (cells[i].color === 'blank' || cells[i].color === null) {
      // A blank: scored where its number was.
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.lineWidth = 3;
      for (let t = -2; t < 6; t++) {
        ctx.beginPath();
        ctx.moveTo(x0 + t * 34, h);
        ctx.lineTo(x0 + t * 34 + 60, 0);
        ctx.stroke();
      }
    }
  }

  // Worn lacquer: faint speckles and scuffs.
  const rand = mulberry32(99);
  for (let k = 0; k < 9000; k++) {
    const a = rand() * 0.07;
    ctx.fillStyle = rand() < 0.5 ? `rgba(255,240,220,${a})` : `rgba(0,0,0,${a * 1.6})`;
    ctx.fillRect(rand() * canvas.width, rand() * h, 1 + rand() * 2.5, 1 + rand() * 1.5);
  }
  for (let k = 0; k < 260; k++) {
    ctx.strokeStyle = `rgba(255,235,210,${0.03 + rand() * 0.05})`;
    ctx.lineWidth = 0.6 + rand();
    const x = rand() * canvas.width;
    const y = rand() * h;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 70, y + (rand() - 0.5) * 18);
    ctx.stroke();
  }

  // Numbers.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.round(h * 0.6)}px Oswald, "Arial Narrow", Arial, sans-serif`;
  for (let i = 0; i < n; i++) {
    const cx = i * cellW + cellW / 2;
    const cy = h * 0.53;
    const look = ENH_LOOK[cells[i].enh];
    if (look) {
      // The enhancement's frame, inside the brass dividers.
      ctx.strokeStyle = look.frame;
      ctx.lineWidth = 7;
      ctx.strokeRect(i * cellW + 13, 15, cellW - 26, h - 30);
      if (look.double) {
        ctx.lineWidth = 3;
        ctx.strokeRect(i * cellW + 24, 26, cellW - 48, h - 52);
      }
      if (cells[i].enh === 'lucky') {
        // A horseshoe over the numeral, open end up.
        ctx.strokeStyle = look.frame;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(cx, 28, 13, 0.15 * Math.PI, 0.85 * Math.PI, false);
        ctx.stroke();
      }
    }
    if (!cells[i].label) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillText(cells[i].label, cx + 2, cy + 3);
    if (look) {
      const g = ctx.createLinearGradient(0, cy - h * 0.3, 0, cy + h * 0.3);
      g.addColorStop(0, look.ink[0]);
      g.addColorStop(1, look.ink[1]);
      ctx.fillStyle = g;
      if (look.glow) {
        ctx.shadowColor = look.glow;
        ctx.shadowBlur = 18;
      }
    } else ctx.fillStyle = '#f1ebdf';
    ctx.fillText(cells[i].label, cx, cy);
    ctx.shadowBlur = 0;
  }

  // Brass dividers and edge lines.
  for (let i = 0; i <= n; i++) {
    const x = i * cellW;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x - 4, 0, 8, h);
    ctx.fillStyle = '#c9ad74';
    ctx.fillRect(x - 2, 0, 4, h);
    ctx.fillStyle = 'rgba(255,240,200,0.5)';
    ctx.fillRect(x - 1, 0, 1, h);
  }
  ctx.fillStyle = '#c9ad74';
  ctx.fillRect(0, 0, canvas.width, 5);
  ctx.fillRect(0, h - 5, canvas.width, 5);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 5, canvas.width, 3);
  ctx.fillRect(0, h - 8, canvas.width, 3);

  const tex = finishTexture(canvas);
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/**
 * The pocket floors, a cell per pocket in the number strip's order: clear for
 * a plain pocket, its enhancement's metal or glow for an enhanced one, black
 * for a blank. Lit a little from within, so a built wheel reads in the dark.
 */
export function createPocketFloorTexture(cells, { cellW = 64, h = 32 } = {}) {
  const n = cells.length;
  const canvas = makeCanvas(n * cellW, h);
  const ctx = canvas.getContext('2d');
  const FLOOR = {
    gilded: ['#f0c766', '#9c6b1e'],
    platinum: ['#f4f7fa', '#a9b2bc'],
    glass: ['rgba(190, 232, 255, 0.75)', 'rgba(120, 190, 230, 0.55)'],
    bone: ['#efe5cb', '#b9a77b'],
    ember: ['#ffb347', '#e0400a'],
    lucky: ['#5fbf6a', '#245d2c'],
    cursed: ['#3f5f26', '#141f0b'],
    blank: ['#0e0d0c', '#050505'],
    house: ['#2a9a58', '#0d4424'],
  };
  for (let i = 0; i < n; i++) {
    const look = FLOOR[cells[i].enh] ?? (cells[i].color === 'blank' ? FLOOR.blank : null);
    if (!look) continue;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, look[0]);
    g.addColorStop(1, look[1]);
    ctx.fillStyle = g;
    // A sliver short of the cell, so the frets keep their edge.
    ctx.fillRect(i * cellW + 2, 0, cellW - 4, h);
  }
  const tex = finishTexture(canvas);
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// The same strip smeared along u, i.e. around the wheel: a cheap stand-in
// for motion blur, faded in over the sharp ring as the rotor speeds up.
export function createMotionBlurredStrip(sharp, cellCount, { spread = 1.6, taps = 28 } = {}) {
  const src = sharp.image;
  const w = src.width;
  const h = src.height;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const cellW = w / cellCount;
  ctx.globalAlpha = 1 / taps;
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < taps; k++) {
    const dx = ((k / (taps - 1)) - 0.5) * spread * cellW;
    for (const wrap of [-w, 0, w]) ctx.drawImage(src, dx + wrap, 0);
  }
  const tex = finishTexture(canvas);
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// ---------------------------------------------------------------------------
// Back wall: tall dark boards.
// ---------------------------------------------------------------------------

export function createWallTexture({ w = 1024, h = 1024, boards = 12 } = {}) {
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const D = img.data;
  const bw = w / boards;
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const b = Math.floor(x / bw);
      const bx = x - b * bw;
      const u = x / w;
      const grain = vnoise(u * boards * 20 + b * 3.1, v * 6 + b * 1.7, boards * 20, 6, 101);
      const blotch = fbm(u * 4, v * 4, 3, 4, 4, 103);
      const tone = 0.75 + 0.5 * hash(b, 7, 107);
      let m = tone * (0.7 + 0.4 * grain) * (0.7 + 0.5 * blotch);
      if (bx < 3) m *= 0.25;
      else if (bx < 6) m *= 0.6;
      const i = (y * w + x) * 4;
      D[i] = 40 * m;
      D[i + 1] = 38 * m;
      D[i + 2] = 34 * m;
      D[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finishTexture(canvas);
}

// Soft radial blob used for contact shadows and the light pool.
export function createRadialTexture(stops) {
  const s = 256;
  const canvas = makeCanvas(s, s);
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return finishTexture(canvas, { repeat: false });
}
