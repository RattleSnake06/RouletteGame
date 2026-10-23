import * as THREE from 'three';
import { createFigure } from './figure.js';

// The figures in the dark (design doc 7.3): every run that ended without
// stepping out of the light stands at its edge, facing the wheel, dark as
// soot. The newest stand nearest the light; older ones further out and
// fainter. They keep to the far side of the wheel and its flanks, away from
// the stations and out of the wide shot's line to the wheel.

// Where each figure stands, newest first: an angle round the wheel (radians,
// from +x toward +z) and how far out.
const SLOTS = [200, 250, 300, 338, 226, 276, 320, 14, 186, 262, 356, 32].map((deg, i) => ({
  angle: THREE.MathUtils.degToRad(deg),
  radius: 5.5 + (i % 4) * 0.35 + Math.floor(i / 4) * 0.45,
}));

/** The figures group: `sync(figures)` stands the profile's standing figures (oldest first). */
export function createFigures() {
  const group = new THREE.Group();
  group.name = 'figures';
  // One soot material per age, so older figures fade without a material each.
  const soot = Array.from({ length: SLOTS.length }, (_, i) => new THREE.MeshStandardMaterial({
    color: 0x2b2724,
    emissive: 0x2e2822,
    roughness: 0.92,
    transparent: true,
    opacity: Math.max(0.35, 1 - i * 0.055),
  }));
  const bodies = [];
  let key = '';

  function make(i) {
    const f = createFigure();
    f.group.traverse((o) => {
      if (!o.isMesh) return;
      o.material = soot[i];
      o.castShadow = false;
      o.receiveShadow = false;
    });
    return f;
  }

  return {
    group,
    sync(figures) {
      const next = figures.map((f) => `${f.n}:${f.stranger ? 's' : ''}`).join(',');
      if (next === key) return;
      key = next;
      for (const b of bodies) group.remove(b.group);
      bodies.length = 0;
      // Newest first takes the nearest slots.
      [...figures].reverse().slice(0, SLOTS.length).forEach((f, i) => {
        const body = make(i);
        const slot = SLOTS[i];
        body.group.position.set(Math.cos(slot.angle) * slot.radius, 0, Math.sin(slot.angle) * slot.radius);
        // Facing the wheel's centre, each a little off true, as people stand.
        const jitter = (((f.n * 7919) % 100) / 100 - 0.5) * 0.5;
        body.group.rotation.y = Math.atan2(-body.group.position.x, -body.group.position.z) + jitter;
        const s = f.stranger ? 1.06 : 0.96 + ((f.n * 31) % 9) / 100;
        body.group.scale.setScalar(s);
        body.phase = f.n * 1.7;
        group.add(body.group);
        bodies.push(body);
      });
    },
    /** They breathe, barely. */
    update(t) {
      for (const b of bodies) b.update(t * 0.6 + b.phase);
    },
    get count() {
      return bodies.length;
    },
  };
}
