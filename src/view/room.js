import * as THREE from 'three';
import { createFloorTextures, createRadialTexture, createWallTexture } from './textures.js';

export const LIGHT_POS = new THREE.Vector3(2.4, 14, 0.2);
export const LIGHT_TARGET = new THREE.Vector3(-0.7, 0, 3.0);

// A tiny dark "studio" rendered into a PMREM so polished metal has a single
// bright source to reflect. Applied per material, never to the whole scene,
// so it adds no ambient light to the room.
export function createEnvMap(renderer) {
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x020303);
  const glow = (color, intensity) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) });

  const overhead = new THREE.Mesh(new THREE.CircleGeometry(2.2, 48), glow(0xfff4e6, 12));
  overhead.position.copy(LIGHT_POS).normalize().multiplyScalar(9);
  overhead.lookAt(0, 0, 0);
  env.add(overhead);

  const floorBounce = new THREE.Mesh(new THREE.CircleGeometry(9, 48), glow(0x6a6e6a, 0.25));
  floorBounce.rotation.x = -Math.PI / 2;
  floorBounce.position.y = -3;
  env.add(floorBounce);

  const warm = new THREE.Mesh(new THREE.PlaneGeometry(6, 2), glow(0x8a5a36, 0.35));
  warm.position.set(-8, 1, 3);
  warm.lookAt(0, 0, 0);
  env.add(warm);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.035);
  pmrem.dispose();
  return rt.texture;
}

const beamVertex = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying float vAlong;
  uniform float uLength;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vAlong = -position.y / uLength;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const beamFragment = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying float vAlong;
  uniform float uIntensity;
  uniform float uTime;
  uniform vec3 uColor;
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    vec3 V = normalize(cameraPosition - vWorldPos);
    float facing = abs(dot(normalize(vWorldNormal), V));
    float core = pow(facing, 2.5);
    float fadeTop = smoothstep(0.0, 0.35, vAlong);
    float fadeFloor = smoothstep(1.2, 4.0, vWorldPos.y);
    float haze = 0.65 + 0.35 * n(vec2(vWorldPos.x * 0.6 + uTime * 0.05, vWorldPos.y * 0.35 - uTime * 0.08));
    float a = core * fadeTop * fadeFloor * haze * uIntensity;
    gl_FragColor = vec4(uColor * a, 1.0);
  }
`;

const dustVertex = /* glsl */ `
  attribute float aSeed;
  attribute float aSize;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform vec3 uLightPos;
  uniform vec3 uLightDir;
  uniform float uCosOuter;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    float t = uTime * (0.25 + aSeed * 0.35);
    p.x += sin(t * 0.7 + aSeed * 40.0) * 0.6;
    p.z += cos(t * 0.6 + aSeed * 23.0) * 0.6;
    p.y += sin(t * 0.4 + aSeed * 11.0) * 0.5;
    vec3 toP = normalize(p - uLightPos);
    float inCone = smoothstep(uCosOuter, uCosOuter + 0.04, dot(toP, uLightDir));
    float twinkle = 0.55 + 0.45 * sin(uTime * (1.0 + aSeed * 2.0) + aSeed * 60.0);
    vAlpha = inCone * twinkle;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_PointSize = aSize * uPixelRatio * (24.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const dustFragment = /* glsl */ `
  varying float vAlpha;
  uniform float uIntensity;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d) * vAlpha * uIntensity;
    gl_FragColor = vec4(vec3(1.0, 0.95, 0.85) * a, 1.0);
  }
`;

export function createRoom({ renderer }) {
  const room = new THREE.Group();
  room.name = 'room';

  // ---- Floor ------------------------------------------------------------
  const floorSize = 70;
  const tileMeters = 9.2;
  const { map, bump } = createFloorTextures();
  for (const t of [map, bump]) {
    t.repeat.set(floorSize / tileMeters, floorSize / tileMeters);
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  }
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(floorSize, floorSize),
    new THREE.MeshStandardMaterial({
      map,
      bumpMap: bump,
      bumpScale: 2.2,
      roughness: 0.88,
      metalness: 0,
      color: 0xffffff,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.rotation.z = 0.62; // boards run diagonally across the frame
  floor.receiveShadow = true;
  room.add(floor);

  // Soft contact darkening under the wheel and the large drop shadow that
  // falls toward the front-left.
  const blob = (size, x, z, opacity, stops) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({
        map: createRadialTexture(stops),
        transparent: true,
        depthWrite: false,
        opacity,
        color: 0x000000,
      }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.004, z);
    m.renderOrder = 1;
    room.add(m);
    return m;
  };
  const shadowStops = [
    [0.0, 'rgba(255,255,255,1)'],
    [0.62, 'rgba(255,255,255,1)'],
    [0.82, 'rgba(255,255,255,0.45)'],
    [1.0, 'rgba(255,255,255,0)'],
  ];
  blob(11.8, -0.75, 1.05, 0.88, shadowStops);
  blob(9.2, 0, 0, 0.6, [
    [0.0, 'rgba(255,255,255,1)'],
    [0.86, 'rgba(255,255,255,1)'],
    [1.0, 'rgba(255,255,255,0)'],
  ]);

  // ---- Walls --------------------------------------------------------------
  const wallTex = createWallTexture();
  wallTex.repeat.set(6, 1);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95, color: 0x9aa09c });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(70, 16), wallMat);
  back.position.set(0, 8, -15);
  back.receiveShadow = true;
  room.add(back);
  const left = new THREE.Mesh(new THREE.PlaneGeometry(70, 16), wallMat);
  left.position.set(-19, 8, 0);
  left.rotation.y = Math.PI / 2;
  room.add(left);
  const right = new THREE.Mesh(new THREE.PlaneGeometry(70, 16), wallMat);
  right.position.set(19, 8, 0);
  right.rotation.y = -Math.PI / 2;
  room.add(right);

  // ---- Lights -------------------------------------------------------------
  const key = new THREE.SpotLight(0xf3efe6, 1550, 0, THREE.MathUtils.degToRad(24), 0.45, 2);
  key.position.copy(LIGHT_POS);
  key.target.position.copy(LIGHT_TARGET);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 6;
  key.shadow.camera.far = 30;
  key.shadow.bias = -0.00015;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 3;
  room.add(key, key.target);

  // A wide, faint halo around the main pool so the edge falls off into the dark.
  const halo = new THREE.SpotLight(0xd9e2e0, 70, 0, THREE.MathUtils.degToRad(34), 1, 2);
  halo.position.copy(LIGHT_POS);
  halo.target.position.copy(LIGHT_TARGET);
  room.add(halo, halo.target);

  // A whisper of light on the far boards so the room has walls.
  const wallWash = new THREE.SpotLight(0x8fa3a3, 110, 0, THREE.MathUtils.degToRad(38), 1, 2);
  wallWash.position.set(1, 13, 3);
  wallWash.target.position.set(-7, 2, -15);
  room.add(wallWash, wallWash.target);

  // Barely-there cool fill so the darkness keeps some shape.
  const fill = new THREE.HemisphereLight(0x3a4a4c, 0x0b0d0d, 0.13);
  room.add(fill);

  // ---- Light shaft ----------------------------------------------------------
  const dir = LIGHT_TARGET.clone().sub(LIGHT_POS).normalize();
  const beamLen = LIGHT_POS.distanceTo(LIGHT_TARGET) * 1.05;
  const beamAngle = THREE.MathUtils.degToRad(21);
  const beamGeo = new THREE.ConeGeometry(Math.tan(beamAngle) * beamLen, beamLen, 72, 1, true);
  beamGeo.translate(0, -beamLen / 2, 0);
  const beamMat = new THREE.ShaderMaterial({
    vertexShader: beamVertex,
    fragmentShader: beamFragment,
    uniforms: {
      uLength: { value: beamLen },
      uIntensity: { value: 0.11 },
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0xfff6ea) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.copy(LIGHT_POS);
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
  beam.renderOrder = 2;
  room.add(beam);

  // ---- Dust motes drifting in the light ------------------------------------
  const COUNT = 500;
  const positions = new Float32Array(COUNT * 3);
  const seeds = new Float32Array(COUNT);
  const sizes = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    const y = 0.4 + Math.random() * 6.5;
    const along = (LIGHT_POS.y - y) / LIGHT_POS.y;
    const cx = THREE.MathUtils.lerp(LIGHT_POS.x, LIGHT_TARGET.x, along);
    const cz = THREE.MathUtils.lerp(LIGHT_POS.z, LIGHT_TARGET.z, along);
    const rad = Math.sqrt(Math.random()) * (0.8 + along * 4.5);
    const a = Math.random() * Math.PI * 2;
    positions[i * 3] = cx + Math.cos(a) * rad;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = cz + Math.sin(a) * rad;
    seeds[i] = Math.random();
    sizes[i] = 0.5 + Math.random() * Math.random() * 1.6;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  dustGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  const dustMat = new THREE.ShaderMaterial({
    vertexShader: dustVertex,
    fragmentShader: dustFragment,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: renderer.getPixelRatio() },
      uLightPos: { value: LIGHT_POS.clone() },
      uLightDir: { value: dir.clone() },
      uCosOuter: { value: Math.cos(THREE.MathUtils.degToRad(17)) },
      uIntensity: { value: 0.4 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  room.add(dust);

  // ---- Flicker ----------------------------------------------------------------
  const baseKey = key.intensity;
  const baseHalo = halo.intensity;
  const baseBeam = beamMat.uniforms.uIntensity.value;
  const baseWash = wallWash.intensity;
  const baseFill = fill.intensity;
  let nextGlitch = 6 + Math.random() * 10;
  let glitchT = -1;

  /**
   * `power` dims the whole hall (the bulb stuttering on, the Cage collecting);
   * `wheel` is how much light the wheel's bulb gives right now, low while the
   * player is at the table and full while the ball is in flight.
   * Returns the bulb's current level so other glowing bits can follow.
   */
  function update(t, dt, power = 1, wheel = 1) {
    beamMat.uniforms.uTime.value = t;
    dustMat.uniforms.uTime.value = t;
    let level = 1 + Math.sin(t * 9.1) * 0.008 + Math.sin(t * 23.7) * 0.006;
    if (glitchT < 0 && t > nextGlitch) glitchT = 0;
    if (glitchT >= 0) {
      glitchT += dt;
      // A short stutter of the old bulb.
      const k = glitchT;
      if (k < 0.06) level *= 0.55;
      else if (k < 0.1) level *= 1.0;
      else if (k < 0.16) level *= 0.7;
      else if (k < 0.5) level *= 0.92 + 0.08 * Math.min(1, (k - 0.16) / 0.34);
      else {
        glitchT = -1;
        nextGlitch = t + 7 + Math.random() * 14;
      }
    }
    level *= power * wheel;
    key.intensity = baseKey * level;
    halo.intensity = baseHalo * level;
    // The shaft and the dust only show in a strong light; at a glow they vanish.
    const haze = level * level;
    beamMat.uniforms.uIntensity.value = baseBeam * haze;
    dustMat.uniforms.uIntensity.value = 0.4 * haze;
    wallWash.intensity = baseWash * power * (0.2 + 0.8 * wheel);
    fill.intensity = baseFill * power * (0.3 + 0.7 * wheel);
    return level;
  }

  function setPixelRatio(pr) {
    dustMat.uniforms.uPixelRatio.value = pr;
  }

  return { group: room, key, update, setPixelRatio };
}
