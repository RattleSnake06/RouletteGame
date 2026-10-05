import * as THREE from 'three';

// The lone figure dwarfed by the wheel. Local +z is the direction they face.
export function createFigure() {
  const root = new THREE.Group();
  root.name = 'figure';

  // The emissive terms stand in for light bouncing up off the bright floor,
  // which keeps the side facing away from the bulb from going black.
  const shirt = new THREE.MeshStandardMaterial({ color: 0xd8d4ca, emissive: 0x3a3936, roughness: 0.92 });
  const jeans = new THREE.MeshStandardMaterial({ color: 0x34405a, emissive: 0x0b0f18, roughness: 0.88 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xa87b60, emissive: 0x1c130d, roughness: 0.7 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x1b1410, emissive: 0x050403, roughness: 0.95 });
  const shoes = new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.55 });

  const add = (parent, geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  // Legs and shoes.
  const legGeo = new THREE.CapsuleGeometry(0.075, 0.72, 6, 14);
  const shoeGeo = new THREE.BoxGeometry(0.11, 0.075, 0.27);
  shoeGeo.translate(0, 0, 0.04);
  for (const s of [-1, 1]) {
    const leg = add(root, legGeo, jeans, s * 0.095, 0.5, 0);
    leg.rotation.z = s * 0.025;
    add(root, shoeGeo, shoes, s * 0.1, 0.0375, 0.0);
  }

  // Upper body pivots at the hips so it can breathe and sway.
  const upper = new THREE.Group();
  upper.position.y = 0.9;
  root.add(upper);

  const torso = add(upper, new THREE.CapsuleGeometry(0.16, 0.32, 8, 16), shirt, 0, 0.29, 0);
  torso.scale.set(1.1, 1, 0.68);
  const belt = add(upper, new THREE.CylinderGeometry(0.17, 0.165, 0.06, 20), jeans, 0, 0.02, 0);
  belt.scale.set(0.98, 1, 0.72);

  const armGeo = new THREE.CapsuleGeometry(0.05, 0.5, 6, 12);
  const handGeo = new THREE.SphereGeometry(0.048, 12, 10);
  for (const s of [-1, 1]) {
    const arm = add(upper, armGeo, shirt, s * 0.215, 0.24, -0.01);
    arm.rotation.z = s * 0.07;
    add(upper, handGeo, skin, s * 0.235, -0.08, 0.0);
  }

  add(upper, new THREE.CylinderGeometry(0.048, 0.055, 0.12, 12), skin, 0, 0.6, 0);
  const head = add(upper, new THREE.SphereGeometry(0.102, 24, 18), skin, 0, 0.73, 0.01);
  head.scale.set(0.95, 1.12, 1.0);
  const hairMesh = add(upper, new THREE.SphereGeometry(0.108, 24, 18), hair, 0, 0.758, -0.012);
  hairMesh.scale.set(0.98, 1.0, 1.02);

  function update(t) {
    const breath = Math.sin(t * 1.6);
    torso.scale.y = 1 + breath * 0.012;
    upper.rotation.z = Math.sin(t * 0.37) * 0.012;
    upper.rotation.x = 0.02 + Math.sin(t * 0.29 + 1.3) * 0.01;
  }

  return { group: root, update };
}
