import * as THREE from 'three';

import { lookOf, paintChipEdge, paintChipFace } from '../ui/chipLook.js';

// Chips on the felt, in their material's look (ui/chipLook.js). Each chip
// gets its own materials so it can glow on its own when it pays.

export const CHIP = { radius: 0.0225, height: 0.0075 };

const geometry = new THREE.CylinderGeometry(CHIP.radius, CHIP.radius, CHIP.height, 40);
// Chip faces carry the chip's value: one top texture per material and value, shared.
const tops = new Map();
const sides = new Map();

function topTexture(material, label) {
  const key = `${material}:${label}`;
  let t = tops.get(key);
  if (t) return t;
  const top = document.createElement('canvas');
  top.width = top.height = 256;
  paintChipFace(top.getContext('2d'), 256, material, label);
  t = new THREE.CanvasTexture(top);
  t.colorSpace = THREE.SRGBColorSpace;
  tops.set(key, t);
  return t;
}

function sideTexture(material) {
  let t = sides.get(material);
  if (t) return t;
  const side = document.createElement('canvas');
  side.width = 512;
  side.height = 32;
  paintChipEdge(side.getContext('2d'), 512, 32, material);
  t = new THREE.CanvasTexture(side);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  sides.set(material, t);
  return t;
}

export function createChipMesh(material = 'normal') {
  const params = { ...lookOf(material).surface, emissive: 0xffd99a, emissiveIntensity: 0 };
  const side = new THREE.MeshStandardMaterial({ map: sideTexture(material), ...params });
  const top = new THREE.MeshStandardMaterial({ map: topTexture(material, '1'), ...params });
  const mesh = new THREE.Mesh(geometry, [side, top, top]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.setGlow = (g) => {
    side.emissiveIntensity = g * 0.6;
    top.emissiveIntensity = g * 0.6;
  };
  let shown = '1';
  /** Shows the chip's value (Matchbook raises it for the night). */
  mesh.userData.setValue = (v) => {
    const label = String(v);
    if (label === shown) return;
    shown = label;
    top.map = topTexture(material, label);
    top.needsUpdate = true;
  };
  /** Its own materials go with it (textures and geometry are shared). */
  mesh.userData.dispose = () => {
    side.dispose();
    top.dispose();
  };
  return mesh;
}
