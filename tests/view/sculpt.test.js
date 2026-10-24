import { describe, expect, it } from 'vitest';
import { meshShape, sphere, surfaceNets } from '../../src/view/sculptCore.js';
import { figureShape } from '../../src/view/shapes/figureShape.js';
import { zeroShape } from '../../src/view/shapes/zeroShape.js';

const R = 0.1;
const ball = (x, y, z) => sphere(x, y, z, 0, 0, 0, R);
const BOX = [[-0.15, -0.15, -0.15], [0.15, 0.15, 0.15]];

describe('surface nets', () => {
  const { positions, normals, indices } = surfaceNets(ball, ...BOX, 0.01);

  it('puts every vertex on the surface', () => {
    for (let i = 0; i < positions.length; i += 3) {
      expect(Math.abs(Math.hypot(positions[i], positions[i + 1], positions[i + 2]) - R)).toBeLessThan(0.0005);
    }
  });

  it('winds every triangle outward', () => {
    for (let t = 0; t < indices.length; t += 3) {
      const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]].map((i) => positions.slice(i * 3, i * 3 + 3));
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      expect(n[0] * a[0] + n[1] * a[1] + n[2] * a[2]).toBeGreaterThan(0);
    }
  });

  it('takes normals from the field', () => {
    for (let i = 0; i < positions.length; i += 3) {
      const len = Math.hypot(positions[i], positions[i + 1], positions[i + 2]);
      const dot = (normals[i] * positions[i] + normals[i + 1] * positions[i + 1] + normals[i + 2] * positions[i + 2]) / len;
      expect(dot).toBeGreaterThan(0.99);
    }
  });
});

describe('meshShape', () => {
  // Two materials, the boundary at y 0.02: a clean cut, not a sawtooth.
  const shape = { parts: [{ name: 'ball', labels: ['top', 'bottom'], field: ball, label: (x, y) => (y > 0.02 ? 'top' : 'bottom'), min: BOX[0], max: BOX[1], cell: 0.01 }] };
  const [part] = meshShape(shape, 1);
  const P = part.positions;

  it('cuts triangles along the boundary between materials', () => {
    for (const [name, side] of [['top', 1], ['bottom', -1]]) {
      const tris = part.groups[name];
      expect(tris.length).toBeGreaterThan(0);
      for (let t = 0; t < tris.length; t += 3) {
        const cy = (P[tris[t] * 3 + 1] + P[tris[t + 1] * 3 + 1] + P[tris[t + 2] * 3 + 1]) / 3;
        expect((cy - 0.02) * side).toBeGreaterThan(-0.0005);
      }
    }
  });

  it('bakes a colour for every vertex and packs it small', () => {
    expect(part.colors).toBeInstanceOf(Uint8Array);
    expect(part.colors.length).toBe(P.length);
    expect(part.normals).toBeInstanceOf(Int16Array);
    // A ball on its own has no creases to shade.
    expect(Math.min(...part.colors)).toBeGreaterThan(200);
  });
});

describe('the sculpted people', () => {
  for (const [name, shape] of [['figure', figureShape], ['Madame Zero', zeroShape]]) {
    it(`${name}: every part meshes, every triangle has a declared material`, () => {
      const parts = meshShape(shape, 3);
      for (const part of parts) {
        const declared = shape.parts.find((p) => p.name === part.name).labels;
        expect(Object.keys(part.groups).length).toBeGreaterThan(0);
        for (const label of Object.keys(part.groups)) expect(declared).toContain(label);
      }
    });
  }
});
