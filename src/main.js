import '@fontsource/oswald/latin-600.css';
import '@fontsource/im-fell-english/latin-400-italic.css';
import './style.css';
import * as THREE from 'three';
import { createEnvMap, createRoom } from './scene/room.js';
import { createWheel, DIM, POCKETS, SLICE, pocketAngle } from './scene/wheel.js';
import { createFigure } from './scene/figure.js';
import { createPostFX } from './postfx.js';
import { SpinController } from './spin.js';
import { WheelAudio } from './audio.js';

const canvas = document.getElementById('scene');
const hint = document.getElementById('hint');
const toast = document.getElementById('toast');

// Framing matched to the reference shot: low three-quarter view, wheel
// right of centre, the figure at its front-left.
const REF_ASPECT = 1376 / 752;
const BASE_FOV = 30;
const CAM_POS = new THREE.Vector3(0.45, 6.75, 14.1);
const CAM_TARGET = new THREE.Vector3(-1.6, -0.35, 0.9);
const WHEEL_FOCUS = new THREE.Vector3(0, 0.6, 0.6);
const FIGURE_POS = new THREE.Vector3(-3.0, 0, 5.25);

const deg = THREE.MathUtils.degToRad;
const hfovOf = (vfov, aspect) => 2 * Math.atan(Math.tan(vfov / 2) * aspect);
const vfovOf = (hfov, aspect) => 2 * Math.atan(Math.tan(hfov / 2) / aspect);

async function init() {
  await Promise.all([
    document.fonts.load('600 64px Oswald'),
    document.fonts.load('italic 20px "IM Fell English"'),
  ]).catch(() => {});

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  let pixelRatio = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020303);
  scene.fog = new THREE.FogExp2(0x030505, 0.028);

  const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 200);

  const envMap = createEnvMap(renderer);
  const room = createRoom({ renderer });
  scene.add(room.group);

  const wheel = createWheel({ envMap });
  scene.add(wheel.group);

  const figure = createFigure();
  figure.group.position.copy(FIGURE_POS);
  figure.group.rotation.y = Math.atan2(-FIGURE_POS.x, -FIGURE_POS.z) + 0.12;
  scene.add(figure.group);

  // Starting pose from the reference: green zero at the back, ball resting
  // on the right-hand side.
  const startAngle = deg(80) - pocketAngle(0);
  const ballWorld = deg(-12);
  let ballIndex = 0;
  let best = Infinity;
  for (let i = 0; i < POCKETS; i++) {
    let d = pocketAngle(i) + startAngle - ballWorld;
    d = Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
    if (d < best) {
      best = d;
      ballIndex = i;
    }
  }
  wheel.setBallPocket(ballIndex);

  const post = createPostFX(renderer, scene, camera);
  const audio = new WheelAudio();

  let hintDismissed = false;
  const spin = new SpinController({
    camera,
    dom: canvas,
    planeY: DIM.numberY,
    grabRadius: DIM.radius + 0.1,
    onGrab: () => audio.start(),
    onRelease: (v) => {
      if (!hintDismissed && Math.abs(v) > 1.5) {
        hintDismissed = true;
        hint.classList.remove('show');
      }
    },
  });
  spin.angle = startAngle;

  // ---- Camera framing ---------------------------------------------------
  const camBase = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  function frame() {
    const w = Math.max(1, canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, canvas.clientHeight || window.innerHeight);
    const aspect = w / h;
    // Wide screens get the reference composition; narrower ones tighten
    // around the wheel so it stays big enough to grab.
    const t = THREE.MathUtils.clamp((aspect - 0.75) / (REF_ASPECT - 0.75), 0, 1);
    const refH = hfovOf(deg(BASE_FOV), REF_ASPECT);
    const wantH = THREE.MathUtils.lerp(deg(38), refH, t);
    let vfov = deg(BASE_FOV);
    if (aspect < REF_ASPECT) vfov = Math.max(deg(BASE_FOV), Math.min(deg(55), vfovOf(wantH, aspect)));
    const dolly = Math.max(1, Math.tan(wantH / 2) / Math.tan(hfovOf(vfov, aspect) / 2));
    camLook.copy(WHEEL_FOCUS).lerp(CAM_TARGET, t);
    camBase.copy(CAM_POS).sub(CAM_TARGET).multiplyScalar(dolly).add(camLook);
    camera.fov = THREE.MathUtils.radToDeg(vfov);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();

    pixelRatio = Math.min(window.devicePixelRatio, 2);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);
    post.setSize(w, h, pixelRatio);
    room.setPixelRatio(pixelRatio);
  }
  frame();
  new ResizeObserver(frame).observe(canvas);

  // ---- Keys -------------------------------------------------------------
  let toastTimer = 0;
  window.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M') {
      const muted = audio.toggleMute();
      toast.textContent = muted ? 'sound off' : 'sound on';
      toast.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove('show'), 1400);
    }
  });

  // ---- Loop -------------------------------------------------------------
  const timer = new THREE.Timer();
  timer.connect(document);
  const parallax = new THREE.Vector2();
  let lastPocket = Math.floor(spin.angle / SLICE);
  let prevVelocity = 0;
  let ballBounce = 0;
  let ballBounceV = 0;

  // The bulb stutters on when the scene first appears.
  function introPower(t) {
    if (t < 0.2) return 0;
    if (t < 0.27) return 0.8;
    if (t < 0.42) return 0.05;
    if (t < 0.48) return 0.6;
    if (t < 0.6) return 0.15;
    return Math.min(1, 0.85 + (t - 0.6) * 0.5);
  }

  function tick(now) {
    timer.update(now);
    const dt = Math.min(timer.getDelta(), 1 / 20);
    const t = timer.getElapsed();

    spin.update(dt);
    wheel.rotor.rotation.y = spin.angle;
    wheel.setSpeed(spin.speed);

    // Pocket ticks.
    const pocket = Math.floor(spin.angle / SLICE);
    if (pocket !== lastPocket) {
      audio.tick(spin.speed);
      lastPocket = pocket;
    }
    audio.update(spin.speed);

    // The ball rattles in its pocket when the wheel jolts.
    const accel = (spin.velocity - prevVelocity) / Math.max(dt, 1e-4);
    prevVelocity = spin.velocity;
    ballBounceV += (Math.min(Math.abs(accel) * 0.054, 15) + spin.speed * 0.036 * (Math.random() - 0.3)) * dt;
    ballBounceV -= ballBounce * 600 * dt;
    ballBounceV *= Math.exp(-dt * 9);
    ballBounce = Math.max(0, ballBounce + ballBounceV * dt);
    if (ballBounce === 0 && ballBounceV < 0) ballBounceV *= -0.35;
    wheel.ball.position.y = DIM.pocketY + DIM.ballRadius + Math.min(ballBounce, 0.05);

    figure.update(t);

    const power = introPower(t);
    const level = room.update(t, dt, power);
    wheel.lensMat.emissiveIntensity = 2.4 * level;

    // Slow handheld drift plus a hint of parallax from the cursor.
    if (!spin.dragging) parallax.lerp(spin.pointer, 1 - Math.exp(-dt * 1.5));
    camera.position.set(
      camBase.x + Math.sin(t * 0.21) * 0.06 + parallax.x * 0.35,
      camBase.y + Math.sin(t * 0.17 + 1.1) * 0.04 + parallax.y * 0.18,
      camBase.z,
    );
    camera.lookAt(camLook);

    const fade = Math.max(0, 1 - t / 1.4);
    post.render(t, fade * fade);
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
  setTimeout(() => {
    if (!hintDismissed) hint.classList.add('show');
  }, 2000);

  // Handy for debugging from the console.
  window.__roulette = { scene, camera, renderer, spin, wheel, room, post };
}

init();
