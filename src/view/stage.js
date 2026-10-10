import * as THREE from 'three';
import { createPostFX } from './fx/postfx.js';
import { createFigure } from './figure.js';
import { createEnvMap, createRoom } from './room.js';
import { createWheel } from './wheel.js';

// The hall: renderer, scene, post-processing, and where everything stands.
// Stations sit at the edge of the light around the player's spot at the
// wheel's front-left rim (design doc 8.1).

const deg = THREE.MathUtils.degToRad;
const hfovOf = (vfov, aspect) => 2 * Math.atan(Math.tan(vfov / 2) * aspect);
const vfovOf = (hfov, aspect) => 2 * Math.atan(Math.tan(hfov / 2) / aspect);

// Wide shot, matched to the reference image.
const REF_ASPECT = 1376 / 752;
const WIDE_FOV = 30;
const WIDE_POS = new THREE.Vector3(0.45, 6.75, 14.1);
const WIDE_TARGET = new THREE.Vector3(-1.6, -0.35, 0.9);
const WHEEL_FOCUS = new THREE.Vector3(0, 0.6, 0.6);

/** Where the player stands, which way they face, and where stations go. */
export function createLayout() {
  const player = new THREE.Vector3(-3.0, 0, 5.25);
  const facing = new THREE.Vector3(-player.x, 0, -player.z).normalize();
  const left = new THREE.Vector3(facing.z, 0, -facing.x);
  const up = new THREE.Vector3(0, 1, 0);
  const eye = player.clone().addScaledVector(up, 1.6).addScaledVector(facing, -0.25);
  // Yaw that turns an object's local +z toward a point.
  const yawToward = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);

  const tablePos = player.clone().addScaledVector(facing, 0.58);
  const tableYaw = yawToward(tablePos, player);
  const cagePos = player.clone().addScaledVector(left, 2.3).addScaledVector(facing, 0.75);
  const cageYaw = yawToward(cagePos, eye);
  // A low glass counter on the right: below the wheel's rim in the wide shot.
  const cabinetPos = player.clone().addScaledVector(left, -2.05).addScaledVector(facing, 0.05);
  const cabinetYaw = yawToward(cabinetPos, eye);
  return { player, facing, left, eye, tablePos, tableYaw, cagePos, cageYaw, cabinetPos, cabinetYaw };
}

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.84;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020303);
  scene.fog = new THREE.FogExp2(0x020303, 0.034);
  const camera = new THREE.PerspectiveCamera(WIDE_FOV, 1, 0.05, 200);

  const envMap = createEnvMap(renderer);
  const room = createRoom({ renderer });
  scene.add(room.group);
  const wheel = createWheel({ envMap });
  scene.add(wheel.group);

  const layout = createLayout();
  const figure = createFigure();
  figure.group.position.copy(layout.player);
  figure.group.rotation.y = Math.atan2(layout.facing.x, layout.facing.z);
  scene.add(figure.group);

  const post = createPostFX(renderer, scene, camera);

  // In first person the figure is you: hidden from the camera but still
  // casting its shadow.
  const figureMaterials = new Set();
  figure.group.traverse((o) => o.isMesh && figureMaterials.add(o.material));
  function setFigureGhost(ghost) {
    for (const m of figureMaterials) {
      m.colorWrite = !ghost;
      m.depthWrite = !ghost;
    }
  }

  /** Camera anchors for the current aspect ratio. */
  function anchorsFor(aspect, { table, cage, cabinet }) {
    // Wide: the reference composition, tightened around the wheel on narrow screens.
    const t = THREE.MathUtils.clamp((aspect - 0.75) / (REF_ASPECT - 0.75), 0, 1);
    const refH = hfovOf(deg(WIDE_FOV), REF_ASPECT);
    const wantH = THREE.MathUtils.lerp(deg(38), refH, t);
    let vfov = deg(WIDE_FOV);
    if (aspect < REF_ASPECT) vfov = Math.max(deg(WIDE_FOV), Math.min(deg(55), vfovOf(wantH, aspect)));
    const dolly = Math.max(1, Math.tan(wantH / 2) / Math.tan(hfovOf(vfov, aspect) / 2));
    const look = WHEEL_FOCUS.clone().lerp(WIDE_TARGET, t);
    const widePos = WIDE_POS.clone().sub(WIDE_TARGET).multiplyScalar(dolly).add(look);

    // First person: keep the felt's width in view on narrow screens.
    const eyeFov = (base, needH) => {
      const v = Math.max(deg(base), vfovOf(deg(needH), aspect));
      return THREE.MathUtils.radToDeg(Math.min(v, deg(80)));
    };
    const { eye, facing } = layout;
    // Look at a fixed point just past the felt. On narrow screens the field
    // of view hits its cap, so step back (and up a little) until the felt fits.
    const tableLook = eye.clone().addScaledVector(facing, 1.6).add(new THREE.Vector3(0, -0.88, 0));
    const tableFov = eyeFov(56, 88);
    const feltFit = 0.64 / Math.tan(hfovOf(deg(tableFov), aspect) / 2);
    const back = Math.max(0, feltFit - 0.83);
    const tableEye = eye.clone().addScaledVector(facing, -back).add(new THREE.Vector3(0, back * 0.45, 0));
    const cageLook = cage.group.localToWorld(cage.focus.clone());
    const anchors = {
      wide: { position: widePos, target: look, fov: THREE.MathUtils.radToDeg(vfov), kind: 'wide' },
      table: { position: tableEye, target: tableLook, fov: tableFov, kind: 'eye' },
      cage: { position: eye.clone(), target: cageLook, fov: eyeFov(50, 70), kind: 'eye' },
    };
    if (cabinet) {
      // Lean in over the counter so the price tags read on a small screen.
      cabinet.group.updateMatrixWorld();
      const cabinetLook = cabinet.group.localToWorld(cabinet.focus.clone());
      const lean = eye.clone().lerp(cabinetLook, 0.22);
      lean.y = eye.y - 0.05;
      anchors.cabinet = { position: lean, target: cabinetLook, fov: eyeFov(48, 66), kind: 'eye' };
    }
    return anchors;
  }

  return { renderer, scene, camera, envMap, room, wheel, figure, post, layout, setFigureGhost, anchorsFor };
}
