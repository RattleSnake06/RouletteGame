import * as THREE from 'three';

// Clay chips: cream with oxblood edge inserts. Each chip gets its own
// materials so it can glow on its own when it pays.

export const CHIP = { radius: 0.0225, height: 0.0075 };

const geometry = new THREE.CylinderGeometry(CHIP.radius, CHIP.radius, CHIP.height, 40);
let textures = null;

function makeTextures() {
  const top = document.createElement('canvas');
  top.width = top.height = 256;
  const ctx = top.getContext('2d');
  const c = 128;
  ctx.fillStyle = '#cdbf9f';
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#7a1418';
  for (let i = 0; i < 8; i++) {
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate((i / 8) * Math.PI * 2);
    ctx.fillRect(-14, -128, 28, 30);
    ctx.restore();
  }
  ctx.strokeStyle = '#7a1418';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(c, c, 82, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([6, 8]);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(c, c, 70, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#7a1418';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 92px Oswald, "Arial Narrow", sans-serif';
  ctx.fillText('1', c, c + 4);

  const side = document.createElement('canvas');
  side.width = 512;
  side.height = 32;
  const sctx = side.getContext('2d');
  sctx.fillStyle = '#cdbf9f';
  sctx.fillRect(0, 0, 512, 32);
  sctx.fillStyle = '#7a1418';
  for (let i = 0; i < 8; i++) sctx.fillRect(i * 64 + 18, 0, 28, 32);

  const t = new THREE.CanvasTexture(top);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.CanvasTexture(side);
  s.colorSpace = THREE.SRGBColorSpace;
  s.wrapS = THREE.RepeatWrapping;
  return { top: t, side: s };
}

export function createChipMesh() {
  textures ??= makeTextures();
  const params = { roughness: 0.7, emissive: 0xffd99a, emissiveIntensity: 0 };
  const side = new THREE.MeshStandardMaterial({ map: textures.side, ...params });
  const top = new THREE.MeshStandardMaterial({ map: textures.top, ...params });
  const mesh = new THREE.Mesh(geometry, [side, top, top]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.setGlow = (g) => {
    side.emissiveIntensity = g * 0.6;
    top.emissiveIntensity = g * 0.6;
  };
  return mesh;
}
