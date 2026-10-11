import * as THREE from 'three';

// Luck you can see (design doc 5.6, 8.3). Every Nudge hop throws sparks off
// the ball: a Lean's are warm, pity's cold and blue-white (so the two are
// never confused), a talisman's brass. When the Devil fires, the number under
// the ball burns away to a green "666".
//
// Colours run past 1 so the bloom pass catches them; the blending is
// additive, so a spark fades by darkening to nothing.

const KINDS = {
  lean: new THREE.Color(2.6, 1.35, 0.4),
  pity: new THREE.Color(0.85, 1.55, 2.8),
  charm: new THREE.Color(2.1, 1.6, 0.7),
  devil: new THREE.Color(0.45, 2.7, 1.15),
};
const MAX = 480;
const FLASHES = 8;

function dotTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The burned "666": green lettering with a glow, on a transparent canvas. */
function burnTexture(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 170px Oswald, "Arial Narrow", sans-serif';
  ctx.shadowColor = '#45c27a';
  ctx.shadowBlur = 40;
  ctx.fillStyle = '#7dffb0';
  ctx.fillText(text, 256, 132);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#e6ffef';
  ctx.fillText(text, 256, 132);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createSparks(scene) {
  const dot = dotTexture();
  const positions = new Float32Array(MAX * 3);
  const colors = new Float32Array(MAX * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      size: 0.075,
      map: dot,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  );
  points.frustumCulled = false;
  points.renderOrder = 6;
  points.raycast = () => {};
  scene.add(points);

  const parts = Array.from({ length: MAX }, () => ({ life: 0, max: 1, v: new THREE.Vector3(), c: new THREE.Color() }));
  let next = 0;
  let alive = 0;

  // A short bright flash where the ball lands, one per hop.
  const flashes = Array.from({ length: FLASHES }, () => {
    const mat = new THREE.SpriteMaterial({ map: dot, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0 });
    const sprite = new THREE.Sprite(mat);
    sprite.visible = false;
    sprite.raycast = () => {};
    sprite.renderOrder = 6;
    scene.add(sprite);
    return { sprite, mat, life: 0 };
  });
  let nextFlash = 0;

  // The Devil's mark, reused.
  const burnMat = new THREE.SpriteMaterial({ map: burnTexture('666'), transparent: true, depthWrite: false, opacity: 0, toneMapped: false });
  burnMat.color.setRGB(1.6, 1.6, 1.6);
  const burn = new THREE.Sprite(burnMat);
  burn.visible = false;
  burn.raycast = () => {};
  burn.renderOrder = 7;
  burn.scale.set(1.3, 0.65, 1);
  scene.add(burn);
  const burnState = { t: -1, base: new THREE.Vector3() };

  /** Sparks thrown off a point, in one kind's colour. */
  function burst(at, kind = 'lean', { count = 16, speed = 1.5 } = {}) {
    const base = KINDS[kind] ?? KINDS.lean;
    for (let i = 0; i < count; i++) {
      const idx = next;
      const p = parts[idx];
      next = (next + 1) % MAX;
      p.life = p.max = 0.3 + Math.random() * 0.35;
      positions[idx * 3] = at.x;
      positions[idx * 3 + 1] = at.y + 0.05;
      positions[idx * 3 + 2] = at.z;
      p.v.set(Math.random() - 0.5, 0.5 + Math.random(), Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random()));
      p.c.copy(base).multiplyScalar(0.7 + Math.random() * 0.5);
    }
    alive = MAX;
    const f = flashes[nextFlash];
    nextFlash = (nextFlash + 1) % FLASHES;
    f.sprite.position.copy(at);
    f.sprite.position.y += 0.06;
    f.sprite.scale.setScalar(0.55);
    f.mat.color.copy(base);
    f.mat.opacity = 1;
    f.sprite.visible = true;
    f.life = 0.18;
  }

  /** The number under the ball burns away to 666. */
  function burnAt(at) {
    burnState.base.copy(at);
    burnState.t = 0;
    burn.visible = true;
    burst(at, 'devil', { count: 40, speed: 2.2 });
  }

  function update(dt) {
    if (alive > 0) {
      let any = false;
      for (let i = 0; i < MAX; i++) {
        const p = parts[i];
        if (p.life <= 0) continue;
        p.life -= dt;
        p.v.y -= 3 * dt;
        positions[i * 3] += p.v.x * dt;
        positions[i * 3 + 1] += p.v.y * dt;
        positions[i * 3 + 2] += p.v.z * dt;
        const k = p.life > 0 ? (p.life / p.max) ** 1.4 : 0;
        colors[i * 3] = p.c.r * k;
        colors[i * 3 + 1] = p.c.g * k;
        colors[i * 3 + 2] = p.c.b * k;
        any = true;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
      if (!any) alive = 0;
    }
    for (const f of flashes) {
      if (!f.sprite.visible) continue;
      f.life -= dt;
      f.mat.opacity = Math.max(0, f.life / 0.18);
      f.sprite.scale.setScalar(0.55 + (0.18 - f.life) * 1.6);
      if (f.life <= 0) f.sprite.visible = false;
    }
    if (burnState.t >= 0) {
      burnState.t += dt;
      const t = burnState.t;
      // In fast, held for a breath, then it smoulders out.
      const opacity = t < 0.25 ? t / 0.25 : t < 2.2 ? 1 - 0.15 * Math.sin(t * 23) * Math.sin(t * 7) : Math.max(0, 1 - (t - 2.2) / 0.9);
      burnMat.opacity = opacity;
      burn.position.copy(burnState.base);
      burn.position.y += 0.45 + t * 0.06;
      if (t > 3.1) {
        burnState.t = -1;
        burn.visible = false;
      }
    }
  }

  return { burst, burnAt, update };
}
