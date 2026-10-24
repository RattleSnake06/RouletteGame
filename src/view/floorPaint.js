import { fbm, mulberry32, smooth, vnoise } from './noise.js';

// The floor (design doc 8.1): old boards with grey paint worn away along the
// grain, tiling seamlessly, painted as a colour map and a height map. The
// heaviest texture in the game, so it is painted off the main thread
// (floor.js, floorWorker.js); `makeCanvas(w, h)` gives a canvas or an
// OffscreenCanvas, whichever the caller has.

export function paintFloor({ size = 2048, rows = 28, makeCanvas }) {
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

  return { color: colorCanvas, height: heightCanvas };
}
