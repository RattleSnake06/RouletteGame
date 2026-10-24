// Sculpting from signed distance fields, the pure half (design doc 8.5): the people in the
// room (the figure, Madame Zero) are modelled as smooth-blended shapes, a
// distance function each, and turned into a mesh here, in the browser, so
// there are still no model files. A field is a function (x, y, z) → metres
// to the surface, negative inside; its gradient gives the normals, so the
// blends read as skin and cloth rather than stacked primitives.
//
// The mesher is naive surface nets on a grid: one vertex per cell the
// surface crosses, placed at the mean of the crossings and then pulled onto
// the surface, a quad per crossed grid edge. It samples finely only near the
// surface (a coarse pass finds where to look), which keeps a head at 2 mm
// cells to a few hundred thousand samples.

// ---- Distance primitives (all in metres) -------------------------------------------------

const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);

export function sphere(x, y, z, cx, cy, cz, r) {
  return len3(x - cx, y - cy, z - cz) - r;
}

/** An ellipsoid; the bound is close near the surface, which is all the mesher needs. */
export function ellipsoid(x, y, z, cx, cy, cz, rx, ry, rz) {
  const px = (x - cx) / rx;
  const py = (y - cy) / ry;
  const pz = (z - cz) / rz;
  const k0 = len3(px, py, pz);
  const k1 = len3(px / rx, py / ry, pz / rz);
  return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}

/** A capsule that tapers: from (a, ra) to (b, rb). */
export function cone(x, y, z, ax, ay, az, bx, by, bz, ra, rb) {
  const bax = bx - ax;
  const bay = by - ay;
  const baz = bz - az;
  const pax = x - ax;
  const pay = y - ay;
  const paz = z - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / l2));
  return len3(pax - bax * h, pay - bay * h, paz - baz * h) - (ra + (rb - ra) * h);
}

/** A flat-ended cylinder from a to b, radius r. */
export function cylinder(x, y, z, ax, ay, az, bx, by, bz, r) {
  const bax = bx - ax;
  const bay = by - ay;
  const baz = bz - az;
  const pax = x - ax;
  const pay = y - ay;
  const paz = z - az;
  const baba = bax * bax + bay * bay + baz * baz;
  const paba = pax * bax + pay * bay + paz * baz;
  const rx = len3(pax * baba - bax * paba, pay * baba - bay * paba, paz * baba - baz * paba) - r * baba;
  const ry = Math.abs(paba - baba * 0.5) - baba * 0.5;
  const x2 = rx * rx;
  const y2 = ry * ry * baba;
  const d = Math.max(rx, ry) < 0 ? -Math.min(x2, y2) : (rx > 0 ? x2 : 0) + (ry > 0 ? y2 : 0);
  return (Math.sign(d) * Math.sqrt(Math.abs(d))) / baba;
}

/** A box with rounded edges, axis-aligned, half sizes h and rounding r. */
export function box(x, y, z, cx, cy, cz, hx, hy, hz, r = 0) {
  const qx = Math.abs(x - cx) - hx + r;
  const qy = Math.abs(y - cy) - hy + r;
  const qz = Math.abs(z - cz) - hz + r;
  return len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
}

/** A ring in the plane through (cx, cy, cz) square to the y axis. */
export function torusY(x, y, z, cx, cy, cz, R, r) {
  const dx = x - cx;
  const dz = z - cz;
  const q = Math.sqrt(dx * dx + dz * dz) - R;
  const dy = y - cy;
  return Math.sqrt(q * q + dy * dy) - r;
}

// ---- Blends ----------------------------------------------------------------------------

/** A smooth union: k is how far (in metres) the two flow into each other. */
export function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** A smooth intersection, or with -b a smooth carve. */
export function smax(a, b, k) {
  return -smin(-a, -b, k);
}

export const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
/** 0 below e0, 1 above e1, smooth between. */
export function smooth(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

// ---- Noise, for folds, strands and grain --------------------------------------------------

function hash3(ix, iy, iz, seed) {
  let h = (Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(iz, 0x1b873593) ^ seed) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [-1, 1], one lattice cell per unit. */
export function noise3(x, y, z, seed = 1) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  let fx = x - xi;
  let fy = y - yi;
  let fz = z - zi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);
  const a = hash3(xi, yi, zi, seed);
  const b = hash3(xi + 1, yi, zi, seed);
  const c = hash3(xi, yi + 1, zi, seed);
  const d = hash3(xi + 1, yi + 1, zi, seed);
  const e = hash3(xi, yi, zi + 1, seed);
  const f = hash3(xi + 1, yi, zi + 1, seed);
  const g = hash3(xi, yi + 1, zi + 1, seed);
  const h = hash3(xi + 1, yi + 1, zi + 1, seed);
  const x00 = a + (b - a) * fx;
  const x10 = c + (d - c) * fx;
  const x01 = e + (f - e) * fx;
  const x11 = g + (h - g) * fx;
  const y0 = x00 + (x10 - x00) * fy;
  const y1 = x01 + (x11 - x01) * fy;
  return (y0 + (y1 - y0) * fz) * 2 - 1;
}

// ---- Detail ------------------------------------------------------------------------------

/**
 * The meshes made of each shape, coarsest (and quickest) first: `quality`
 * scales the shape's cells. Distant copies keep a coarser one.
 */
export const STAGES = [
  { name: 'far', quality: 4 },
  { name: 'preview', quality: 3 },
  { name: 'full', quality: 1 },
];

// ---- The mesher ------------------------------------------------------------------------

const CORNERS = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];
const EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

/**
 * Meshes the field `f` inside [min, max] at cell size `cell`. Returns plain
 * arrays (positions, normals, indices) so it could run in a worker too.
 */
export function surfaceNets(f, min, max, cell) {
  const nx = Math.ceil((max[0] - min[0]) / cell) + 1;
  const ny = Math.ceil((max[1] - min[1]) / cell) + 1;
  const nz = Math.ceil((max[2] - min[2]) / cell) + 1;
  const sxy = nx * ny;
  const vals = new Float32Array(nx * ny * nz);
  const at = (i, j, k) => i + j * nx + k * sxy;

  // A coarse pass every B samples finds the blocks the surface can reach;
  // only those are sampled finely, the rest take the coarse values.
  const B = 4;
  const cx = Math.ceil((nx - 1) / B) + 1;
  const cy = Math.ceil((ny - 1) / B) + 1;
  const cz = Math.ceil((nz - 1) / B) + 1;
  const coarse = new Float32Array(cx * cy * cz);
  for (let k = 0; k < cz; k++) {
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        coarse[i + j * cx + k * cx * cy] = f(min[0] + i * B * cell, min[1] + j * B * cell, min[2] + k * B * cell);
      }
    }
  }
  // A block holds the surface only if a corner lies within half its diagonal
  // of it; the margin covers fields that are not exact distances (blends,
  // folds).
  const reach = B * cell * 1.3;
  const cxy = cx * cy;
  const done = new Uint8Array(nx * ny * nz);
  for (let k = 0; k < cz - 1; k++) {
    for (let j = 0; j < cy - 1; j++) {
      for (let i = 0; i < cx - 1; i++) {
        const c0 = i + j * cx + k * cxy;
        let lo = Math.abs(coarse[c0]);
        lo = Math.min(lo, Math.abs(coarse[c0 + 1]), Math.abs(coarse[c0 + cx]), Math.abs(coarse[c0 + cx + 1]));
        lo = Math.min(lo, Math.abs(coarse[c0 + cxy]), Math.abs(coarse[c0 + cxy + 1]), Math.abs(coarse[c0 + cxy + cx]), Math.abs(coarse[c0 + cxy + cx + 1]));
        const near = lo < reach;
        const far = coarse[c0];
        const k1 = Math.min(nz - 1, (k + 1) * B);
        const j1 = Math.min(ny - 1, (j + 1) * B);
        const i1 = Math.min(nx - 1, (i + 1) * B);
        for (let fk = k * B; fk <= k1; fk++) {
          const z = min[2] + fk * cell;
          for (let fj = j * B; fj <= j1; fj++) {
            const y = min[1] + fj * cell;
            let id = at(i * B, fj, fk);
            for (let fi = i * B; fi <= i1; fi++, id++) {
              if (done[id] === 2) continue;
              if (near) {
                vals[id] = f(min[0] + fi * cell, y, z);
                done[id] = 2;
              } else if (!done[id]) {
                // Far from the surface, the whole block shares one sign.
                vals[id] = far;
                done[id] = 1;
              }
            }
          }
        }
      }
    }
  }

  // One vertex per crossed cell.
  const cellIndex = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cidx = (i, j, k) => i + j * (nx - 1) + k * (nx - 1) * (ny - 1);
  const pos = [];
  const corner = new Float32Array(8);
  const offs = CORNERS.map(([dx, dy, dz]) => dx + dy * nx + dz * sxy);
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        const base = at(i, j, k);
        for (let c = 0; c < 8; c++) {
          corner[c] = vals[base + offs[c]];
          if (corner[c] < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let n = 0;
        for (let ei = 0; ei < 12; ei++) {
          const a = EDGES[ei][0];
          const b = EDGES[ei][1];
          const va = corner[a];
          const vb = corner[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          const A = CORNERS[a];
          const Bc = CORNERS[b];
          sx += A[0] + (Bc[0] - A[0]) * t;
          sy += A[1] + (Bc[1] - A[1]) * t;
          sz += A[2] + (Bc[2] - A[2]) * t;
          n++;
        }
        cellIndex[cidx(i, j, k)] = pos.length / 3;
        pos.push(min[0] + (i + sx / n) * cell, min[1] + (j + sy / n) * cell, min[2] + (k + sz / n) * cell);
      }
    }
  }

  // A quad for every crossed grid edge, between the four cells round it.
  const idx = [];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, d, c, a, c, b);
    else idx.push(a, b, c, a, c, d);
  };
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const v0 = vals[at(i, j, k)] < 0;
        if (j > 0 && k > 0 && v0 !== vals[at(i + 1, j, k)] < 0) {
          quad(cellIndex[cidx(i, j - 1, k - 1)], cellIndex[cidx(i, j, k - 1)], cellIndex[cidx(i, j, k)], cellIndex[cidx(i, j - 1, k)], !v0);
        }
        if (i > 0 && k > 0 && v0 !== vals[at(i, j + 1, k)] < 0) {
          quad(cellIndex[cidx(i - 1, j, k - 1)], cellIndex[cidx(i - 1, j, k)], cellIndex[cidx(i, j, k)], cellIndex[cidx(i, j, k - 1)], !v0);
        }
        if (i > 0 && j > 0 && v0 !== vals[at(i, j, k + 1)] < 0) {
          quad(cellIndex[cidx(i - 1, j - 1, k)], cellIndex[cidx(i, j - 1, k)], cellIndex[cidx(i, j, k)], cellIndex[cidx(i - 1, j, k)], !v0);
        }
      }
    }
  }

  // Pull each vertex onto the surface, and take its normal from the field.
  const positions = new Float32Array(pos);
  const normals = new Float32Array(pos.length);
  const e = cell * 0.5;
  for (let v = 0; v < positions.length; v += 3) {
    let x = positions[v];
    let y = positions[v + 1];
    let z = positions[v + 2];
    let gx = 0;
    let gy = 0;
    let gz = 0;
    for (let step = 0; step < 1; step++) {
      const d = f(x, y, z);
      gx = f(x + e, y, z) - f(x - e, y, z);
      gy = f(x, y + e, z) - f(x, y - e, z);
      gz = f(x, y, z + e) - f(x, y, z - e);
      const g2 = (gx * gx + gy * gy + gz * gz) / (4 * e * e);
      if (g2 < 1e-12) break;
      const s = d / g2 / (2 * e);
      // Never further than half a cell: thin parts stay where the net put them.
      const mx = Math.max(-cell * 0.5, Math.min(cell * 0.5, gx * s));
      const my = Math.max(-cell * 0.5, Math.min(cell * 0.5, gy * s));
      const mz = Math.max(-cell * 0.5, Math.min(cell * 0.5, gz * s));
      x -= mx;
      y -= my;
      z -= mz;
    }
    positions[v] = x;
    positions[v + 1] = y;
    positions[v + 2] = z;
    const gl = Math.hypot(gx, gy, gz) || 1;
    normals[v] = gx / gl;
    normals[v + 1] = gy / gl;
    normals[v + 2] = gz / gl;
  }
  return { positions, normals, indices: new Uint32Array(idx) };
}

/**
 * Sorts a mesh's triangles by material, `label(x, y, z)` naming the material
 * at a point. A triangle whose corners disagree is cut along the line where
 * the label changes (found by bisecting its edges), so a brace's edge or a
 * hairline is a clean curve rather than a sawtooth of whole triangles.
 * `attrs` are the per-vertex arrays ({ data, size, unit }), positions first;
 * new vertices on the cuts are blended from both ends (`unit` ones are
 * renormalised, for normals).
 */
function splitByLabel(attrs, indices, label) {
  const P = attrs[0].data;
  const n0 = P.length / 3;
  const names = new Array(n0);
  for (let v = 0; v < n0; v++) names[v] = label(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);

  const blend = (ws) => {
    for (const { data, size, unit } of attrs) {
      let len = 0;
      const start = data.length;
      for (let c = 0; c < size; c++) {
        let x = 0;
        for (const [v, w] of ws) x += data[v * size + c] * w;
        data.push(x);
        len += x * x;
      }
      if (unit) {
        len = Math.sqrt(len) || 1;
        for (let c = 0; c < size; c++) data[start + c] /= len;
      }
    }
    return P.length / 3 - 1;
  };
  // Where along a→b the label stops being a's; shared by both triangles on the edge.
  const cut = new Map();
  const edgePoint = (a, b) => {
    const key = a < b ? a * n0 + b : b * n0 + a;
    const known = cut.get(key);
    if (known !== undefined) return known;
    const la = names[a];
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 6; i++) {
      const m = (lo + hi) / 2;
      const s = 1 - m;
      const l = label(P[a * 3] * s + P[b * 3] * m, P[a * 3 + 1] * s + P[b * 3 + 1] * m, P[a * 3 + 2] * s + P[b * 3 + 2] * m);
      if (l === la) lo = m;
      else hi = m;
    }
    const t = (lo + hi) / 2;
    const v = blend([[a, 1 - t], [b, t]]);
    cut.set(key, v);
    return v;
  };

  const buckets = {};
  const tri = (name, a, b, c) => (buckets[name] ??= []).push(a, b, c);
  for (let t = 0; t < indices.length; t += 3) {
    let i0 = indices[t];
    let i1 = indices[t + 1];
    let i2 = indices[t + 2];
    const l0 = names[i0];
    const l1 = names[i1];
    const l2 = names[i2];
    if (l0 === l1 && l1 === l2) {
      tri(l0, i0, i1, i2);
      continue;
    }
    if (l0 !== l1 && l1 !== l2 && l0 !== l2) {
      // Three materials meet: each corner keeps the quad toward the middle.
      const m01 = edgePoint(i0, i1);
      const m12 = edgePoint(i1, i2);
      const m20 = edgePoint(i2, i0);
      const c = blend([[i0, 1 / 3], [i1, 1 / 3], [i2, 1 / 3]]);
      tri(l0, i0, m01, c);
      tri(l0, i0, c, m20);
      tri(l1, i1, m12, c);
      tri(l1, i1, c, m01);
      tri(l2, i2, m20, c);
      tri(l2, i2, c, m12);
      continue;
    }
    // Two materials: turn the triangle so the odd corner comes first,
    // keeping its winding.
    if (l1 !== l0 && l1 !== l2) [i0, i1, i2] = [i1, i2, i0];
    else if (l2 !== l0 && l2 !== l1) [i0, i1, i2] = [i2, i0, i1];
    const m1 = edgePoint(i0, i1);
    const m2 = edgePoint(i0, i2);
    tri(names[i0], i0, m1, m2);
    tri(names[i1], m1, i1, i2);
    tri(names[i1], m1, i2, m2);
  }
  const groups = {};
  for (const [name, list] of Object.entries(buckets)) groups[name] = new Uint32Array(list);
  return groups;
}

// Ambient occlusion from the field: step out along the normal and see how
// much nearer the surface is than the step (a fold, an armpit, a nostril).
const AO_STEPS = [0.005, 0.012, 0.022, 0.036, 0.056];
const AO_WEIGHTS = [1, 0.8, 0.6, 0.42, 0.28];

function occlusion(f, x, y, z, nx, ny, nz, strength) {
  let occ = 0;
  for (let i = 0; i < AO_STEPS.length; i++) {
    const h = AO_STEPS[i];
    const d = f(x + nx * h, y + ny * h, z + nz * h);
    occ += AO_WEIGHTS[i] * Math.max(0, h - d) / h;
  }
  return Math.max(0.3, 1 - strength * occ);
}

/**
 * Meshes every part of a shape and sorts its triangles by material (a part
 * without a `label` is all its one label). Each vertex gets a colour, multiplied into
 * its material's: the occlusion baked from the field (`part.ao` scales it,
 * `part.occluder` adds the neighbouring parts' shapes) times
 * `part.tint(x, y, z)` if the part has one (stubble, a flush, tired eyes).
 * `quality` scales the cells (1 is the shape's own; a quick preview might
 * use 3). Returns plain typed arrays, ready to post from a worker.
 */
export function meshShape(shape, quality = 1) {
  return shape.parts.map((part) => {
    const mesh = surfaceNets(part.field, part.min, part.max, part.cell * quality);
    const n = mesh.positions.length / 3;
    const P = Array.from(mesh.positions);
    const N = Array.from(mesh.normals);
    const C = new Array(n * 3);
    const occluder = part.occluder;
    const field = occluder ? (x, y, z) => Math.min(part.field(x, y, z), occluder(x, y, z)) : part.field;
    const strength = part.ao ?? 0.3;
    for (let v = 0; v < n; v++) {
      const x = P[v * 3];
      const y = P[v * 3 + 1];
      const z = P[v * 3 + 2];
      const ao = strength > 0 ? occlusion(field, x, y, z, N[v * 3], N[v * 3 + 1], N[v * 3 + 2], strength) : 1;
      const t = part.tint?.(x, y, z);
      C[v * 3] = ao * (t ? t[0] : 1);
      C[v * 3 + 1] = ao * (t ? t[1] : 1);
      C[v * 3 + 2] = ao * (t ? t[2] : 1);
    }
    const attrs = [{ data: P, size: 3 }, { data: N, size: 3, unit: true }, { data: C, size: 3 }];
    let U = null;
    if (part.uv) {
      U = new Array(n * 2);
      for (let v = 0; v < n; v++) {
        const [a, b] = part.uv(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
        U[v * 2] = a;
        U[v * 2 + 1] = b;
      }
      attrs.push({ data: U, size: 2 });
    }
    const groups = part.label ? splitByLabel(attrs, mesh.indices, part.label) : { [part.labels?.[0] ?? 'all']: mesh.indices };
    // Compact for keeping and for the GPU: normals and colours as normalised
    // integers, indices in 16 bits when the vertices allow.
    const count = P.length / 3;
    const Index = count < 65536 ? Uint16Array : Uint32Array;
    for (const k of Object.keys(groups)) groups[k] = Index.from(groups[k]);
    return {
      name: part.name,
      positions: new Float32Array(P),
      normals: Int16Array.from(N, (x) => Math.round(Math.max(-1, Math.min(1, x)) * 32767)),
      colors: Uint8Array.from(C, (x) => Math.round(Math.max(0, Math.min(1, x)) * 255)),
      uvs: U ? new Float32Array(U) : null,
      groups,
    };
  });
}
