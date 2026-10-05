import * as THREE from 'three';

// Everything in the scene is painted procedurally at load time, so the game
// ships without image assets.

// ---------------------------------------------------------------------------
// Noise helpers
// ---------------------------------------------------------------------------

export function mulberry32(seed) {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(ix, iy, seed) {
  let h = (Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ seed) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// Value noise, periodic with period (px, py) in lattice units.
function vnoise(x, y, px, py, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let fx = x - xi;
  let fy = y - yi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const x0 = ((xi % px) + px) % px;
  const y0 = ((yi % py) + py) % py;
  const x1 = (x0 + 1) % px;
  const y1 = (y0 + 1) % py;
  const a = hash(x0, y0, seed);
  const b = hash(x1, y0, seed);
  const c = hash(x0, y1, seed);
  const d = hash(x1, y1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function fbm(x, y, octaves, px, py, seed) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise(x, y, px, py, seed + o * 1013);
    norm += amp;
    x *= 2;
    y *= 2;
    px *= 2;
    py *= 2;
    amp *= 0.5;
  }
  return sum / norm;
}

const BIG = 1 << 20; // "period" for noise that does not need to tile

function smooth(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

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
// Floor: old boards with grey paint worn away along the grain.
// Tiles seamlessly. Returns a colour map and a bump map.
// ---------------------------------------------------------------------------

export function createFloorTextures({ size = 2048, rows = 28 } = {}) {
  const PH = size / rows;
  const rand = mulberry32(1337);

  // Each row of boards is split into a few planks with staggered joints.
  const rowData = [];
  for (let r = 0; r < rows; r++) {
    const start = Math.floor(rand() * size);
    const joints = [start];
    let p = start;
    for (;;) {
      p += Math.floor(size * (0.24 + rand() * 0.32));
      if (p > start + size - size * 0.16) break;
      joints.push(p);
    }
    const map = new Uint8Array(size);
    const planks = [];
    for (let k = 0; k < joints.length; k++) {
      const a = joints[k];
      const b = k + 1 < joints.length ? joints[k + 1] : start + size;
      planks.push({
        tone: rand(),
        paint: rand(),
        offU: rand() * 64,
        offV: rand() * 64,
      });
      for (let x = a; x < b; x++) map[x % size] = k;
    }
    rowData.push({ map, planks, joints: joints.map((j) => j % size) });
  }

  // Low-frequency grime is smooth, so evaluate it on a coarse grid.
  const GS = 128;
  const grimeGrid = new Float32Array(GS * GS);
  for (let gy = 0; gy < GS; gy++) {
    for (let gx = 0; gx < GS; gx++) {
      grimeGrid[gy * GS + gx] = fbm((gx / GS) * 5, (gy / GS) * 5, 4, 5, 5, 41);
    }
  }
  const grimeAt = (u, v) => {
    const fx = u * GS;
    const fy = v * GS;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const i00 = grimeGrid[(y0 % GS) * GS + (x0 % GS)];
    const i10 = grimeGrid[(y0 % GS) * GS + ((x0 + 1) % GS)];
    const i01 = grimeGrid[((y0 + 1) % GS) * GS + (x0 % GS)];
    const i11 = grimeGrid[((y0 + 1) % GS) * GS + ((x0 + 1) % GS)];
    return i00 + (i10 - i00) * tx + (i01 - i00) * ty + (i00 - i10 - i01 + i11) * tx * ty;
  };

  const colorCanvas = makeCanvas(size, size);
  const heightCanvas = makeCanvas(size, size);
  const cctx = colorCanvas.getContext('2d');
  const hctx = heightCanvas.getContext('2d');
  const cimg = cctx.createImageData(size, size);
  const himg = hctx.createImageData(size, size);
  const C = cimg.data;
  const H = himg.data;

  const gv = rows * 26; // grain lines per texture height
  const pv = rows * 3; // paint patches per texture height

  for (let y = 0; y < size; y++) {
    const r = Math.floor(y / PH);
    const row = rowData[r];
    const py = y - r * PH;
    const vy = py / PH;
    const v = y / size;
    const edge = Math.min(vy, 1 - vy);
    const edgeWear = 0.3 * (1 - smooth(0, 0.2, edge));
    for (let x = 0; x < size; x++) {
      const pl = row.planks[row.map[x]];
      const u = x / size;
      const warp = vnoise(u * 6 + pl.offU, v * rows * 2 + pl.offV, 6, rows * 2, 11);
      const grain = vnoise(u * 9 + pl.offU, v * gv + warp * 7, 9, gv, 23);
      const fine = vnoise(u * 700, v * 700, 700, 700, 31);
      const paintN = fbm(u * 20 + pl.offU, v * pv + pl.offV, 4, 20, pv, 53);
      const chip = fbm(u * 56 + pl.offU, v * rows * 9 + pl.offV, 3, 56, rows * 9, 61);
      const crack = vnoise(u * 26 + pl.offU, v * gv * 2 + warp * 11, 26, gv * 2, 67);
      const grime = grimeAt(u, v);

      // Bare, weathered wood.
      const t = pl.tone;
      const gl = 0.68 + 0.55 * grain + (fine - 0.5) * 0.14;
      let R = (46 + 22 * t) * gl;
      let G = (42 + 18 * t) * gl;
      let B = (37 + 14 * t) * gl;
      let h = 95 + grain * 40;

      // Remains of grey paint: ragged chips, worn back along the grain and
      // at the board edges, with hairline cracks following the grain.
      const pval =
        paintN + (pl.paint - 0.5) * 0.3 - edgeWear + (grain - 0.5) * 0.16 + (chip - 0.5) * 0.26;
      const th = 0.37;
      const cracked = crack > 0.8 && pval < th + 0.12;
      if (pval > th && !cracked) {
        const e = smooth(th, th + 0.025, pval);
        const dirt = (0.8 + 0.32 * chip) * (0.86 + 0.14 * crack);
        const pn = (0.86 + 0.14 * fine + (grain - 0.5) * 0.12) * (0.72 + 0.28 * e) * dirt;
        R = 172 * pn;
        G = 175 * pn;
        B = 169 * pn;
        h = 170 + e * 25;
      } else {
        const e = smooth(th - 0.05, th, pval);
        const d = 1 - 0.3 * e;
        R *= d;
        G *= d;
        B *= d;
      }

      const gm = 0.62 + 0.55 * grime;
      R *= gm;
      G *= gm;
      B *= gm;

      // Gaps between boards.
      if (py < 2.5) {
        R = G = B = 7;
        h = 0;
      } else if (py < 5.5) {
        R *= 0.55;
        G *= 0.55;
        B *= 0.55;
        h *= 0.6;
      } else if (py > PH - 3) {
        R *= 0.75;
        G *= 0.75;
        B *= 0.75;
        h *= 0.85;
      }

      const i = (y * size + x) * 4;
      C[i] = R;
      C[i + 1] = G;
      C[i + 2] = B;
      C[i + 3] = 255;
      H[i] = H[i + 1] = H[i + 2] = h;
      H[i + 3] = 255;
    }
  }
  cctx.putImageData(cimg, 0, 0);
  hctx.putImageData(himg, 0, 0);

  // Butt joints and nail heads.
  const drawWrapped = (fn, x) => {
    fn(x);
    if (x < 24) fn(x + size);
    if (x > size - 24) fn(x - size);
  };
  for (let r = 0; r < rows; r++) {
    const y0 = r * PH;
    for (const j of rowData[r].joints) {
      drawWrapped((x) => {
        cctx.fillStyle = 'rgb(8,7,6)';
        cctx.fillRect(x - 1.2, y0, 2.4, PH);
        hctx.fillStyle = '#000';
        hctx.fillRect(x - 1.2, y0, 2.4, PH);
        for (const side of [-1, 1]) {
          for (const fy of [0.3, 0.72]) {
            const nx = x + side * 9;
            const ny = y0 + PH * fy;
            cctx.fillStyle = 'rgb(22,20,18)';
            cctx.beginPath();
            cctx.arc(nx, ny, 2.6, 0, Math.PI * 2);
            cctx.fill();
            cctx.fillStyle = 'rgba(160,150,135,0.35)';
            cctx.beginPath();
            cctx.arc(nx - 0.6, ny - 0.6, 1.0, 0, Math.PI * 2);
            cctx.fill();
            hctx.fillStyle = '#444';
            hctx.beginPath();
            hctx.arc(nx, ny, 2.6, 0, Math.PI * 2);
            hctx.fill();
          }
        }
      }, j);
    }
  }

  return {
    map: finishTexture(colorCanvas),
    bump: finishTexture(heightCanvas, { srgb: false }),
  };
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
// (upside down at the near side, like a real wheel).
// ---------------------------------------------------------------------------

export function createNumberStripTexture(cells, { cellW = 192, h = 150 } = {}) {
  const n = cells.length;
  const canvas = makeCanvas(n * cellW, h);
  const ctx = canvas.getContext('2d');
  const colors = {
    red: ['#b3181d', '#7d0d11'],
    black: ['#1d1b1a', '#0b0a0a'],
    green: ['#1c7a43', '#0d4424'],
  };
  for (let i = 0; i < n; i++) {
    const x0 = i * cellW;
    const [c0, c1] = colors[cells[i].color];
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, c0);
    grad.addColorStop(1, c1);
    ctx.fillStyle = grad;
    ctx.fillRect(x0, 0, cellW, h);
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
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillText(cells[i].label, cx + 2, cy + 3);
    ctx.fillStyle = '#f1ebdf';
    ctx.fillText(cells[i].label, cx, cy);
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
