import * as THREE from 'three';
import { addPart, sculpted } from './sculpt.js';
import { figureShape } from './shapes/figureShape.js';

// The lone figure dwarfed by the wheel (design doc 8.1): sculpted from
// distance fields (shapes/figureShape.js), not stacked primitives. Local +z
// is the direction they face. `lod: 'far'` keeps the coarsest mesh, for the
// figures standing far off in the dark.
export function createFigure({ lod = 'full' } = {}) {
  const root = new THREE.Group();
  root.name = 'figure';
  const model = sculpted('figure', figureShape);

  // Every material takes the sculpt's vertex colours: the shading baked into
  // the creases, and the stubble and shadows on the face. The emissive terms
  // stand in for light bouncing up off the floor, which keeps the side away
  // from the bulb from going black.
  const v = { vertexColors: true };
  const shirt = new THREE.MeshPhysicalMaterial({ ...v, color: 0xd6cfbf, emissive: 0x1c1b19, roughness: 0.88, sheen: 0.4, sheenColor: 0xfff6e6, sheenRoughness: 0.75 });
  const trousers = new THREE.MeshPhysicalMaterial({ ...v, color: 0x283044, emissive: 0x090c14, roughness: 0.9, sheen: 0.55, sheenColor: 0x707a98, sheenRoughness: 0.65 });
  const braces = new THREE.MeshPhysicalMaterial({ ...v, color: 0x5e161b, emissive: 0x130405, roughness: 0.6, sheen: 0.3, sheenColor: 0xa04048 });
  const tie = new THREE.MeshPhysicalMaterial({ ...v, color: 0x2a2026, emissive: 0x050304, roughness: 0.45, sheen: 0.8, sheenColor: 0x5a5260, sheenRoughness: 0.3 });
  const skin = new THREE.MeshPhysicalMaterial({ ...v, color: 0xb38670, emissive: 0x1e140e, roughness: 0.6, sheen: 0.3, sheenColor: 0xffc8a8, sheenRoughness: 0.45 });
  const lips = new THREE.MeshPhysicalMaterial({ ...v, color: 0x8c4e47, emissive: 0x1a0d0b, roughness: 0.42 });
  const hair = new THREE.MeshPhysicalMaterial({ ...v, color: 0x17110e, emissive: 0x040302, roughness: 0.42, sheen: 0.7, sheenColor: 0x8a6c52, sheenRoughness: 0.3 });
  const shoes = new THREE.MeshPhysicalMaterial({ ...v, color: 0x16100c, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.2 });
  const sole = new THREE.MeshStandardMaterial({ ...v, color: 0x0a0807, roughness: 0.8 });
  const eye = new THREE.MeshPhysicalMaterial({ ...v, color: 0xd8d0c4, roughness: 0.15, clearcoat: 1 });
  const iris = new THREE.MeshPhysicalMaterial({ ...v, color: 0x6e5034, roughness: 0.1, clearcoat: 1 });
  const pupil = new THREE.MeshPhysicalMaterial({ ...v, color: 0x050404, roughness: 0.1, clearcoat: 1 });

  const opts = { lod };
  addPart(root, model, 'lower', { trousers, braces }, opts);
  addPart(root, model, 'shoes', { shoes, sole }, opts);

  // The upper body pivots at the hips so it can breathe and sway, and the
  // head on the neck. The sculpt is in the figure's own frame, so each
  // pivot's meshes sit back by the pivot's position.
  const HIP_Y = 0.92;
  const upper = new THREE.Group();
  upper.position.y = HIP_Y;
  root.add(upper);
  const body = new THREE.Group();
  body.position.y = -HIP_Y;
  upper.add(body);
  addPart(body, model, 'upper', { shirt, braces, skin }, opts);
  addPart(body, model, 'collar', { shirt, tie }, opts);

  const NECK = new THREE.Vector3(0, 1.56, -0.008);
  const neck = new THREE.Group();
  neck.position.copy(NECK);
  body.add(neck);
  const head = new THREE.Group();
  head.position.copy(NECK).negate();
  neck.add(head);
  addPart(head, model, 'head', { skin, hair, eye, iris, pupil, lips }, opts);

  function update(t) {
    const breath = Math.sin(t * 1.6);
    upper.scale.set(1 + breath * 0.004, 1 + breath * 0.003, 1 + breath * 0.006);
    upper.rotation.z = Math.sin(t * 0.37) * 0.012;
    upper.rotation.x = 0.02 + Math.sin(t * 0.29 + 1.3) * 0.01;
    // Eyes on the wheel, now and then glancing aside.
    neck.rotation.x = 0.1 + Math.sin(t * 0.23) * 0.025;
    neck.rotation.y = Math.sin(t * 0.17 + 0.6) * 0.06 + Math.sin(t * 0.61) * 0.015;
  }

  return { group: root, update };
}
