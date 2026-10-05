import '@fontsource/oswald/latin-500.css';
import '@fontsource/oswald/latin-600.css';
import '@fontsource/im-fell-english/latin-400-italic.css';
import './style.css';
import * as THREE from 'three';
import { WheelAudio } from './audio/audio.js';
import { Game } from './game.js';
import { createInput } from './input/actions.js';
import { loadSettings, platform, saveSettings } from './platform/index.js';
import { createHud } from './ui/hud.js';
import { BallAnimator } from './view/ball.js';
import { CameraDirector } from './view/camera.js';
import { Interaction } from './view/interaction.js';
import { createStage } from './view/stage.js';
import { createCage } from './view/stations/cage.js';
import { createTable } from './view/stations/table.js';
import { DIM, SLICE, pocketAngle } from './view/wheel.js';
import { SpinController } from './view/wheelSpin.js';

// The bulb stutters on when the hall first appears.
function introPower(t) {
  if (t < 0.2) return 0;
  if (t < 0.27) return 0.8;
  if (t < 0.42) return 0.05;
  if (t < 0.48) return 0.6;
  if (t < 0.6) return 0.15;
  return Math.min(1, 0.85 + (t - 0.6) * 0.5);
}

async function init() {
  await Promise.all([
    document.fonts.load('600 64px Oswald'),
    document.fonts.load('500 64px Oswald'),
    document.fonts.load('italic 20px "IM Fell English"'),
  ]).catch(() => {});

  const canvas = document.getElementById('scene');
  const stage = createStage(canvas);
  const { scene, camera, renderer, post, wheel, room, layout } = stage;

  const settings = loadSettings({ muted: false, fast: false });
  const audio = new WheelAudio();
  audio.muted = settings.muted;
  const hud = createHud();
  const interaction = new Interaction(canvas, camera);
  const director = new CameraDirector(camera);
  director.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let game = null; // station callbacks fire only after boot

  const table = createTable({
    materials: wheel.materials,
    interaction,
    callbacks: {
      onClickBet: (betId) => game.onClickBet(betId),
      onPlace: (chipId, betId) => game.placeChip(chipId, betId),
      onRemove: (chipId) => game.removeChip(chipId),
      onChipClicked: (chipId) => game.state.placements[chipId] && game.removeChip(chipId),
      onChoose: (id) => game.choosePackage(id),
      onEndNight: () => game.requestEndNight(),
      onHoverBet: (betId, ev) => game.onHoverBet(betId, ev),
      onHoverMove: (ev) => game.onHoverMove(ev),
    },
  });
  table.group.position.copy(layout.tablePos);
  table.group.rotation.y = layout.tableYaw;
  scene.add(table.group);

  const cage = createCage({
    materials: wheel.materials,
    interaction,
    callbacks: {
      onBankAll: () => game.bankAll(),
      onBankKeep: () => game.bankKeep(),
      onEndNight: () => game.requestEndNight(),
    },
  });
  cage.group.position.copy(layout.cagePos);
  cage.group.rotation.y = layout.cageYaw;
  scene.add(cage.group);

  let ball = null;
  const spin = new SpinController({
    camera,
    dom: canvas,
    planeY: DIM.numberY,
    grabRadius: DIM.radius + 0.1,
    canGrab: (ev) => !interaction.consumed.has(ev) && game && !game.busy && !ball.flying,
    onGrab: () => audio.start(),
    onRelease: (v) => Math.abs(v) > 2.2 && game.requestSpin(),
  });
  // Green zero at the back of the wheel, as in the reference shot.
  spin.angle = THREE.MathUtils.degToRad(80) - pocketAngle(0);
  interaction.fallbackCursor = (ev) =>
    spin.dragging ? 'grabbing' : game && !game.busy && spin.grabbableAt(ev) ? 'grab' : 'default';

  ball = new BallAnimator({
    ball: wheel.ball,
    spin,
    onBounce: (s) => audio.bounce(s),
    onRoll: (level) => audio.roll(level),
  });

  game = new Game({ stage, table, cage, ball, spin, director, hud, audio, platform, settings });
  game.onSettingsChanged = saveSettings;

  // ---- Sizing and camera anchors ---------------------------------------------
  function resize() {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    const pr = Math.min(window.devicePixelRatio, 2);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    post.setSize(w, h, pr);
    room.setPixelRatio(pr);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    for (const [name, anchor] of Object.entries(stage.anchorsFor(w / h, { table, cage }))) {
      director.setAnchor(name, anchor);
    }
  }
  resize();
  new ResizeObserver(resize).observe(canvas);

  // ---- Input -----------------------------------------------------------------
  const input = createInput(window);
  // While a card is up (other than the pause menu), keys must not act on the
  // room behind it.
  const modalOpen = () => !!document.querySelector('.modal-backdrop:not([inert])');
  const play = (fn) => () => !modalOpen() && fn();
  input.on('spin', play(() => game.requestSpin()));
  input.on('turnLeft', play(() => game.turn(-1)));
  input.on('turnRight', play(() => game.turn(1)));
  input.on('choose1', play(() => game.chooseByIndex(0)));
  input.on('choose2', play(() => game.chooseByIndex(1)));
  input.on('choose3', play(() => game.chooseByIndex(2)));
  input.on('endNight', play(() => game.requestEndNight()));
  input.on('toggleFast', play(() => game.toggleFast()));
  input.on('toggleMute', () => game.toggleMute());
  input.on('menu', () => (game.menuClose || !modalOpen()) && game.toggleMenu());
  // Browsers only allow sound after a gesture.
  const wake = () => audio.start();
  window.addEventListener('pointerdown', wake);
  window.addEventListener('keydown', wake);
  hud.refs.navLeft.addEventListener('click', () => game.turn(-1));
  hud.refs.navRight.addEventListener('click', () => game.turn(1));

  // ---- Start -----------------------------------------------------------------
  game.boot();
  director.goTo('wide', { cut: true });
  stage.setFigureGhost(false);
  setTimeout(() => {
    if (director.current !== 'wide' || game.busy) return;
    director.goTo(game.view, {
      duration: 1.8,
      onProgress: (e) => e > 0.75 && stage.setFigureGhost(true),
    });
  }, 1700);
  setTimeout(() => hud.root.classList.add('show'), 1400);

  // ---- Loop ------------------------------------------------------------------
  const timer = new THREE.Timer();
  timer.connect(document);
  let lastPocket = Math.floor(spin.angle / SLICE);
  let power = 1;

  function tick() {
    // The timer reads its own clock: requestAnimationFrame's timestamp can
    // predate the timer's start and give a negative first delta.
    timer.update();
    const dt = Math.min(Math.max(timer.getDelta(), 0), 1 / 20);
    const t = timer.getElapsed();

    game.fastHeld = input.isHeld('spin');
    const sdt = dt * game.timeScale;
    spin.update(sdt);
    wheel.rotor.rotation.y = spin.angle;
    wheel.setSpeed(spin.speed);
    ball.update(sdt);

    // Pocket ticks when the player turns the wheel by hand; the ball's own
    // rattle takes over while it is in flight.
    const pocket = Math.floor(spin.angle / SLICE);
    if (pocket !== lastPocket) {
      if (!ball.flying) audio.tick(spin.speed);
      lastPocket = pocket;
    }
    audio.update(spin.speed);

    stage.figure.update(t);
    table.update(dt);
    cage.update(dt);
    hud.update(dt);

    power += (game.power - power) * (1 - Math.exp(-dt * 2.5));
    const level = room.update(t, dt, introPower(t) * power);
    wheel.lensMat.emissiveIntensity = 2.4 * level;

    if (director.current === 'wide') director.parallax.lerp(spin.pointer, 1 - Math.exp(-dt * 1.5));
    director.update(dt, t);

    const fade = Math.max(0, 1 - t / 1.4);
    post.render(t, fade * fade);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // Handy for debugging and for the smoke test.
  window.__roulette = { game, stage, spin, ball, table, cage, director, interaction };
  if (import.meta.env.DEV) {
    window.__roulette.debug = {
      /** Add coins to the hand, e.g. to try later debts before items exist. */
      addCoins(n) {
        game.state = { ...game.state, coins: game.state.coins + n };
        game.save();
        game.syncAll();
      },
    };
  }
}

init();
