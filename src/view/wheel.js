import * as THREE from 'three';
import {
  createConeTexture,
  createMotionBlurredStrip,
  createNumberStripTexture,
  createRimWoodTexture,
} from './textures.js';
import { EUROPEAN_ORDER, defaultColor } from '../core/wheel.js';

// Pocket order and colours come from the rules (core/wheel.js); this module
// only turns them into geometry. Phase 5 rebuilds it from live pocket data.
export const WHEEL_ORDER = EUROPEAN_ORDER;
export const POCKETS = WHEEL_ORDER.length;
export const SLICE = (Math.PI * 2) / POCKETS;
export const colorOf = defaultColor;

// Angles are measured counter-clockwise seen from above, in the rotor's
// local frame: angle a sits at (cos a, -sin a) in (x, z). rotation.y adds to it.
export function pocketAngle(orderIndex) {
  return (((POCKETS - orderIndex) % POCKETS) + 0.5) * SLICE;
}

export const DIM = {
  radius: 4.0,
  numberOuter: 3.62,
  numberInner: 3.2,
  numberY: 0.315,
  pocketOuter: 3.2,
  pocketInner: 2.8,
  pocketY: 0.25,
  coneEdgeY: 0.315,
  coneTopY: 0.47,
  ballRadius: 0.115,
  // Where the ball rests in a pocket, and where it orbits on the track.
  ballRestRadius: 3.03,
  trackRadius: 3.63,
  trackY: 0.44,
};

const P = (r, y) => new THREE.Vector2(r, y);
// The drum profile was drawn 0.64 m tall; squash it to sit lower.
const DRUM_SCALE = 0.64;
const D = (r, y) => P(r, y * DRUM_SCALE);

// LatheGeometry spaces v evenly per profile point; respace it by arc length
// so textures do not stretch on short profile segments.
function lathe(points, segments = 256) {
  const geo = new THREE.LatheGeometry(points, segments);
  const lens = [0];
  for (let j = 1; j < points.length; j++) lens.push(lens[j - 1] + points[j].distanceTo(points[j - 1]));
  const total = lens[lens.length - 1];
  const uv = geo.attributes.uv;
  for (let i = 0; i <= segments; i++) {
    for (let j = 0; j < points.length; j++) uv.setY(i * points.length + j, lens[j] / total);
  }
  return geo;
}

// Flat (or slightly sloped) annulus with u running around the wheel and
// v from inner (0) to outer (1) edge.
function ringStrip(rIn, rOut, yIn, yOut, segments) {
  const pos = [];
  const uvs = [];
  const idx = [];
  for (let s = 0; s <= segments; s++) {
    const a = (s / segments) * Math.PI * 2;
    const c = Math.cos(a);
    const sn = -Math.sin(a);
    pos.push(rIn * c, yIn, rIn * sn, rOut * c, yOut, rOut * sn);
    uvs.push(s / segments, 0, s / segments, 1);
  }
  for (let s = 0; s < segments; s++) {
    const a = s * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    idx.push(a, b, d, a, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function shadowed(mesh, cast = true, receive = true) {
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

export function createWheel({ envMap }) {
  const wheel = new THREE.Group();
  wheel.name = 'wheel';

  // ---- Materials --------------------------------------------------------
  const rimTex = createRimWoodTexture();
  rimTex.repeat.set(9, 1);
  const mahogany = new THREE.MeshPhysicalMaterial({
    map: rimTex,
    bumpMap: rimTex,
    bumpScale: 0.6,
    roughness: 0.48,
    clearcoat: 0.55,
    clearcoatRoughness: 0.32,
  });
  const brass = new THREE.MeshStandardMaterial({
    color: 0xc39a5c,
    metalness: 1,
    roughness: 0.3,
    envMap,
    envMapIntensity: 1.2,
  });
  const darkMetal = new THREE.MeshStandardMaterial({
    color: 0x3a312b,
    metalness: 0.85,
    roughness: 0.34,
    envMap,
    envMapIntensity: 1.0,
  });
  const silver = new THREE.MeshStandardMaterial({
    color: 0xa8a39a,
    metalness: 1,
    roughness: 0.52,
    envMap,
    envMapIntensity: 0.6,
  });
  const pocketMetal = new THREE.MeshStandardMaterial({
    color: 0x8f8f8b,
    metalness: 0.7,
    roughness: 0.42,
    envMap,
    envMapIntensity: 0.9,
  });

  // ---- Stator: the big wooden drum and its rim (does not spin) ----------
  const stator = shadowed(
    new THREE.Mesh(
      lathe([
        D(4.07, 0.0),
        D(4.07, 0.03),
        D(4.05, 0.05),
        D(4.0, 0.065),
        D(3.99, 0.1),
        D(3.99, 0.46),
        D(4.0, 0.49),
        D(4.025, 0.52),
        D(4.04, 0.555),
        D(4.035, 0.59),
        D(4.01, 0.615),
        D(3.97, 0.632),
        D(3.9, 0.638),
        D(3.82, 0.636),
        D(3.785, 0.628),
        D(3.765, 0.612),
        D(3.755, 0.592),
        D(3.72, 0.565),
        D(3.67, 0.532),
        D(3.635, 0.512),
        D(3.6, 0.497),
      ]),
      mahogany,
    ),
  );
  wheel.add(stator);

  // ---- Rotor: everything that spins ------------------------------------
  const rotor = new THREE.Group();
  rotor.name = 'rotor';
  wheel.add(rotor);

  // Number ring.
  const cells = new Array(POCKETS);
  for (let i = 0; i < POCKETS; i++) {
    const n = WHEEL_ORDER[i];
    const cell = (POCKETS - i) % POCKETS;
    cells[cell] = { label: String(n), color: colorOf(n) };
  }
  const numberTex = createNumberStripTexture(cells);
  const numberMat = new THREE.MeshPhysicalMaterial({
    map: numberTex,
    roughness: 0.4,
    clearcoat: 0.6,
    clearcoatRoughness: 0.28,
  });
  const numberGeo = ringStrip(DIM.numberInner, DIM.numberOuter, DIM.numberY, DIM.numberY - 0.004, POCKETS * 8);
  rotor.add(shadowed(new THREE.Mesh(numberGeo, numberMat), false));

  // Smeared copy laid over the numbers; fades in with speed (motion blur).
  const blurMat = new THREE.MeshPhysicalMaterial({
    map: createMotionBlurredStrip(numberTex, POCKETS),
    roughness: 0.4,
    clearcoat: 0.6,
    clearcoatRoughness: 0.28,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const blurRing = new THREE.Mesh(numberGeo, blurMat);
  blurRing.receiveShadow = true;
  blurRing.visible = false;
  rotor.add(blurRing);

  // Edge beads around the number ring.
  const bead = (r, y, tube, mat) => {
    const m = shadowed(new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 256), mat));
    m.rotation.x = Math.PI / 2;
    m.position.y = y;
    return m;
  };
  rotor.add(bead(DIM.numberOuter, DIM.numberY - 0.002, 0.014, brass));
  rotor.add(bead(DIM.numberInner, DIM.numberY + 0.002, 0.012, brass));

  // Pockets: recessed metal channel with frets between the numbers.
  rotor.add(
    shadowed(
      new THREE.Mesh(ringStrip(DIM.pocketInner, DIM.pocketOuter, DIM.pocketY, DIM.pocketY, POCKETS * 4), pocketMetal),
      false,
    ),
  );
  const wallH = DIM.numberY - DIM.pocketY;
  const outerWall = shadowed(
    new THREE.Mesh(
      new THREE.CylinderGeometry(DIM.pocketOuter, DIM.pocketOuter, wallH, POCKETS * 4, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x2a2624, roughness: 0.6, side: THREE.BackSide }),
    ),
    false,
  );
  outerWall.position.y = DIM.pocketY + wallH / 2;
  rotor.add(outerWall);
  const innerWall = shadowed(
    new THREE.Mesh(
      new THREE.CylinderGeometry(DIM.pocketInner, DIM.pocketInner, wallH + 0.02, POCKETS * 4, 1, true),
      darkMetal,
    ),
  );
  innerWall.position.y = DIM.pocketY + (wallH + 0.02) / 2;
  rotor.add(innerWall);
  rotor.add(bead(DIM.pocketInner, DIM.numberY + 0.02, 0.022, brass));

  const fretLen = DIM.pocketOuter - DIM.pocketInner - 0.02;
  const fretGeo = new THREE.BoxGeometry(fretLen, 0.085, 0.03);
  fretGeo.translate(0, 0.0425, 0);
  const frets = shadowed(new THREE.InstancedMesh(fretGeo, silver, POCKETS));
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const rMid = (DIM.pocketOuter + DIM.pocketInner) / 2;
  for (let c = 0; c < POCKETS; c++) {
    const a = c * SLICE;
    q.setFromAxisAngle(yAxis, a);
    m4.compose(new THREE.Vector3(rMid * Math.cos(a), DIM.pocketY, -rMid * Math.sin(a)), q, new THREE.Vector3(1, 1, 1));
    frets.setMatrixAt(c, m4);
  }
  rotor.add(frets);

  // Cone: inlaid wood, rising gently to the turret.
  const coneR = DIM.pocketInner - 0.01;
  const coneGeo = new THREE.RingGeometry(0.001, coneR, 160, 16);
  coneGeo.rotateX(-Math.PI / 2);
  const cp = coneGeo.attributes.position;
  for (let i = 0; i < cp.count; i++) {
    const r = Math.hypot(cp.getX(i), cp.getZ(i));
    const t = r / coneR;
    cp.setY(i, DIM.coneEdgeY + (DIM.coneTopY - DIM.coneEdgeY) * (1 - t) * (1 - 0.25 * t));
  }
  coneGeo.computeVertexNormals();
  const cone = shadowed(
    new THREE.Mesh(
      coneGeo,
      new THREE.MeshPhysicalMaterial({
        map: createConeTexture(),
        roughness: 0.5,
        clearcoat: 0.5,
        clearcoatRoughness: 0.35,
      }),
    ),
    false,
  );
  rotor.add(cone);

  // ---- Turret -----------------------------------------------------------
  const turret = new THREE.Group();
  turret.position.y = DIM.coneTopY - 0.015;
  turret.scale.set(1.06, 0.9, 1.06);
  rotor.add(turret);

  const part = (pts, mat, seg = 96) => turret.add(shadowed(new THREE.Mesh(lathe(pts, seg), mat)));

  // Flange and bell.
  part(
    [
      P(0.6, 0.0),
      P(0.6, 0.035),
      P(0.585, 0.055),
      P(0.54, 0.07),
      P(0.47, 0.078),
      P(0.45, 0.095),
      P(0.41, 0.14),
      P(0.34, 0.23),
      P(0.27, 0.36),
      P(0.21, 0.52),
      P(0.165, 0.7),
      P(0.135, 0.88),
      P(0.118, 1.0),
      P(0.112, 1.05),
    ],
    darkMetal,
  );
  // Brass trim ring on the flange.
  const flangeRing = shadowed(new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.022, 10, 96), brass));
  flangeRing.rotation.x = Math.PI / 2;
  flangeRing.position.y = 0.04;
  turret.add(flangeRing);
  // Collar.
  part(
    [P(0.105, 1.03), P(0.15, 1.05), P(0.168, 1.09), P(0.168, 1.12), P(0.148, 1.15), P(0.1, 1.165), P(0.085, 1.18)],
    brass,
  );
  // Neck.
  part([P(0.088, 1.17), P(0.08, 1.24), P(0.08, 1.3)], darkMetal);
  // Hub that carries the arms.
  part(
    [P(0.08, 1.29), P(0.135, 1.305), P(0.17, 1.34), P(0.175, 1.38), P(0.168, 1.42), P(0.13, 1.455), P(0.07, 1.47)],
    brass,
  );
  // Stem.
  part([P(0.068, 1.465), P(0.06, 1.52), P(0.06, 1.58)], silver);
  // Cap.
  part(
    [
      P(0.06, 1.57),
      P(0.1, 1.59),
      P(0.17, 1.625),
      P(0.225, 1.665),
      P(0.245, 1.7),
      P(0.245, 1.745),
      P(0.232, 1.772),
      P(0.2, 1.788),
    ],
    brass,
  );
  // Glowing lens on top, catching the spotlight.
  const lensMat = new THREE.MeshStandardMaterial({
    color: 0xfff6e0,
    emissive: 0xfff1d6,
    emissiveIntensity: 2.4,
    roughness: 0.2,
  });
  const lens = new THREE.Mesh(lathe([P(0.2, 1.786), P(0.17, 1.8), P(0.1, 1.812), P(0.0, 1.816)], 96), lensMat);
  turret.add(lens);

  // Arms with knobbed ends.
  const armY = 1.38;
  const armGeo = new THREE.CylinderGeometry(0.034, 0.056, 0.78, 16);
  armGeo.rotateZ(-Math.PI / 2);
  armGeo.translate(0.15 + 0.39, 0, 0);
  const knobGeo = new THREE.SphereGeometry(0.068, 20, 14);
  const tipGeo = new THREE.CylinderGeometry(0.022, 0.03, 0.12, 14);
  const tipCapGeo = new THREE.SphereGeometry(0.038, 18, 12);
  for (let k = 0; k < 4; k++) {
    const arm = new THREE.Group();
    arm.rotation.y = Math.PI / 4 + (k * Math.PI) / 2;
    arm.position.y = armY;
    const rod = shadowed(new THREE.Mesh(armGeo, silver));
    rod.rotation.z = 0.06;
    arm.add(rod);
    const end = new THREE.Group();
    end.position.set(0.93, 0.055, 0);
    end.add(shadowed(new THREE.Mesh(knobGeo, silver)));
    const tip = shadowed(new THREE.Mesh(tipGeo, silver));
    tip.position.y = 0.07;
    end.add(tip);
    const tipCap = shadowed(new THREE.Mesh(tipCapGeo, brass));
    tipCap.position.y = 0.14;
    end.add(tipCap);
    arm.add(end);
    turret.add(arm);
  }

  // ---- Ball: positioned every frame by view/ball.js, in the wheel's frame --
  const ball = shadowed(
    new THREE.Mesh(
      new THREE.SphereGeometry(DIM.ballRadius, 32, 24),
      new THREE.MeshPhysicalMaterial({
        color: 0xeeeeea,
        roughness: 0.12,
        metalness: 0.15,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        envMap,
        envMapIntensity: 1.5,
      }),
    ),
  );
  wheel.add(ball);

  // Blend toward the smeared numbers as the rotor speeds up (rad/s).
  function setSpeed(speed) {
    const t = THREE.MathUtils.smoothstep(speed, 1.5, 7);
    blurMat.opacity = t;
    blurRing.visible = t > 0.001;
  }

  // Polished metal reflects its surroundings whatever the lights do, so its
  // reflections dim with the wheel's bulb or the wheel never sinks into the dark.
  const reflective = [brass, darkMetal, silver, pocketMetal, ball.material].map((m) => [m, m.envMapIntensity]);
  function setLightLevel(level) {
    const k = 0.12 + 0.88 * Math.min(1, level);
    for (const [m, base] of reflective) m.envMapIntensity = base * k;
  }

  return {
    group: wheel,
    rotor,
    ball,
    lensMat,
    setSpeed,
    setLightLevel,
    // Stations get their own copies, so dimming the wheel never dims them.
    materials: { mahogany, brass: brass.clone(), darkMetal: darkMetal.clone(), silver: silver.clone() },
  };
}
