import * as THREE from 'three';
import { createRadialTexture } from './textures.js';

// The Vault (design doc 7.1): an iron door at the back of the hall, set in
// a brick pier, with four brass padlocks on a bar across it. A padlock that
// has opened hangs from its hasp by the shackle; once all four are open and
// the Vault has opened, the door stands ajar on a sliver of light. A small
// lamp over it keeps it at the edge of the dark.

const DOOR = { w: 1.5, h: 2.5, d: 0.16 };

export function createVault() {
  const group = new THREE.Group();
  group.name = 'vault';
  const iron = new THREE.MeshStandardMaterial({ color: 0x4a4d50, metalness: 0.8, roughness: 0.5 });
  const brick = new THREE.MeshStandardMaterial({ color: 0x3a241c, roughness: 0.95 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc39a5c, metalness: 1, roughness: 0.35 });
  const rivet = new THREE.MeshStandardMaterial({ color: 0x45484a, metalness: 0.9, roughness: 0.4 });

  // The pier round the door.
  const pier = new THREE.Mesh(new THREE.BoxGeometry(DOOR.w + 0.9, DOOR.h + 0.6, 0.5), brick);
  pier.position.set(0, (DOOR.h + 0.6) / 2, -0.2);
  group.add(pier);
  const recess = new THREE.Mesh(new THREE.BoxGeometry(DOOR.w + 0.06, DOOR.h + 0.06, 0.05), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  recess.position.set(0, DOOR.h / 2 + 0.03, 0.06);
  group.add(recess);

  // The door hangs on its left edge, so it can stand ajar.
  const hinge = new THREE.Group();
  hinge.position.set(-DOOR.w / 2, 0, 0.12);
  group.add(hinge);
  const door = new THREE.Mesh(new THREE.BoxGeometry(DOOR.w, DOOR.h, DOOR.d), iron);
  door.position.set(DOOR.w / 2, DOOR.h / 2, 0);
  hinge.add(door);
  // Bands and rivets.
  for (const y of [0.35, 1.25, 2.15]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(DOOR.w + 0.02, 0.08, 0.03), iron);
    band.position.set(DOOR.w / 2, y, DOOR.d / 2 + 0.01);
    hinge.add(band);
    for (let k = 0; k < 6; k++) {
      const r = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), rivet);
      r.position.set(0.1 + (k * (DOOR.w - 0.2)) / 5, y, DOOR.d / 2 + 0.03);
      hinge.add(r);
    }
  }
  // A wheel handle, as on a safe.
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 8, 24), brass);
  wheel.position.set(DOOR.w * 0.72, 1.6, DOOR.d / 2 + 0.06);
  hinge.add(wheel);

  // The bar across the door, and four padlocks on it.
  const bar = new THREE.Mesh(new THREE.BoxGeometry(DOOR.w + 0.5, 0.07, 0.05), iron);
  bar.position.set(0, 1.05, 0.26);
  group.add(bar);
  const locks = [];
  for (let i = 0; i < 4; i++) {
    const lock = new THREE.Group();
    lock.position.set(-0.54 + i * 0.36, 1.05, 0.3);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.13, 0.06), brass);
    body.position.y = -0.11;
    const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 16, Math.PI), brass);
    shackle.position.y = -0.045;
    const keyhole = new THREE.Mesh(new THREE.CircleGeometry(0.014, 10), new THREE.MeshBasicMaterial({ color: 0x050403 }));
    keyhole.position.set(0, -0.12, 0.031);
    lock.add(body, shackle, keyhole);
    group.add(lock);
    locks.push({ lock, body, shackle, keyhole });
  }

  // A dim lamp over the door, its light a cone on the pier.
  const lamp = new THREE.SpotLight(0xffd9a8, 40, 10, THREE.MathUtils.degToRad(34), 0.7, 1.4);
  lamp.position.set(0, DOOR.h + 1.4, 1.6);
  lamp.target.position.set(0, 1.1, 0);
  group.add(lamp, lamp.target);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.14, 16, 1, true), iron);
  shade.position.copy(lamp.position);
  group.add(shade);
  // Light through the door when it stands ajar.
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.35, DOOR.h), new THREE.MeshBasicMaterial({ map: createRadialTexture([[0, 'rgba(255, 255, 255, 1)'], [1, 'rgba(255, 255, 255, 0)']]), color: 0xffe2b0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.position.set(DOOR.w / 2 - 0.12, DOOR.h / 2, 0.09);
  group.add(glow);

  let key = '';
  return {
    group,
    /** `locks` open (0–4); `open` once the Vault itself has opened. */
    sync({ locks: opened = 0, open = false }) {
      const next = `${opened}/${open}`;
      if (next === key) return;
      key = next;
      locks.forEach((l, i) => {
        const isOpen = i < opened;
        // An open padlock hangs off its hasp, tipped, its shackle sprung.
        l.lock.rotation.z = isOpen ? 0.5 * (i % 2 ? -1 : 1) : 0;
        l.lock.position.y = isOpen ? 0.98 : 1.05;
        l.shackle.position.y = isOpen ? -0.01 : -0.045;
      });
      hinge.rotation.y = open ? -0.5 : 0;
      glow.material.opacity = open ? 0.55 : 0;
    },
  };
}
