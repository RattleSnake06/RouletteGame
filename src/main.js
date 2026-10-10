import './style.css';
import * as THREE from 'three';
import { WheelAudio } from './audio/audio.js';
import { Game } from './game.js';
import { createInput } from './input/actions.js';
import { loadSettings, platform, saveSettings } from './platform/index.js';
import { loadFonts } from './ui/fonts.js';
import { createHud } from './ui/hud.js';
import { add } from './core/num.js';
import { grantTalisman } from './core/run.js';
import { BallAnimator } from './view/ball.js';
import { createBell } from './view/bell.js';
import { CameraDirector } from './view/camera.js';
import { Interaction } from './view/interaction.js';
import { LightingDirector } from './view/lighting.js';
import { createRail } from './view/rail.js';
import { createStage } from './view/stage.js';
import { createCabinet } from './view/stations/cabinet.js';
import { createCage } from './view/stations/cage.js';
import { createTable } from './view/stations/table.js';
import { buildTalismanMesh } from './view/talismanArt.js';
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
  await loadFonts();

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

  // Talismans: the rail and the Bell live on the table; the Cabinet stands
  // on the player's right.
  const makeCharm = (id) => buildTalismanMesh(id, { brass: wheel.materials.brass });
  const onHoverItem = (target, ev) => game?.onHoverItem(target, ev);
  const rail = createRail({
    materials: wheel.materials,
    interaction,
    makeCharm,
    callbacks: {
      onSelect: (uid) => game.openTalisman(uid),
      onMove: (uid, to) => game.moveTalisman(uid, to),
      onRing: (uid) => game.ringBell(uid),
      onHover: onHoverItem,
    },
  });
  table.group.add(rail.group);
  const bell = createBell({
    materials: wheel.materials,
    interaction,
    callbacks: { onRing: () => game.ringBell(), onHover: onHoverItem },
  });
  table.group.add(bell.group);

  const cabinet = createCabinet({
    materials: wheel.materials,
    interaction,
    makeCharm,
    callbacks: {
      onBuy: (slot) => game.buy(slot),
      onRestock: () => game.restock(),
      onHover: onHoverItem,
    },
  });
  cabinet.group.position.copy(layout.cabinetPos);
  cabinet.group.rotation.y = layout.cabinetYaw;
  scene.add(cabinet.group);

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

  const lighting = new LightingDirector('intro');
  game = new Game({ stage, table, cage, rail, bell, cabinet, ball, spin, director, hud, audio, platform, settings, lighting });
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
    for (const [name, anchor] of Object.entries(stage.anchorsFor(w / h, { table, cage, cabinet }))) {
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
  input.on('ringBell', play(() => game.ringBell()));
  input.on('restock', play(() => game.restock()));
  input.on('focusNext', play(() => game.focusStep(1)));
  input.on('focusPrev', play(() => game.focusStep(-1)));
  input.on('activate', play(() => game.activate()));
  input.on('moveLeft', play(() => game.moveFocused(-1)));
  input.on('moveRight', play(() => game.moveFocused(1)));
  input.on('sell', play(() => game.sellFocused()));
  input.on('toggleMute', () => game.toggleMute());
  input.on('menu', () => (game.menuClose || !modalOpen()) && game.toggleMenu());
  // Browsers only allow sound after a gesture.
  const wake = () => audio.start();
  window.addEventListener('pointerdown', wake);
  window.addEventListener('keydown', wake);
  // A clicked arrow must not keep focus: with three stations it stays on
  // screen, and a focused button would swallow Space and the game keys.
  for (const [btn, dir] of [
    [hud.refs.navLeft, -1],
    [hud.refs.navRight, 1],
  ]) {
    btn.addEventListener('pointerdown', (e) => e.preventDefault());
    btn.addEventListener('click', (e) => {
      e.currentTarget.blur();
      if (!modalOpen()) game.turn(dir);
    });
  }

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
    // The establishing shot shows the wheel lit; at the table it sinks into the dark.
    lighting.set(game.view);
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
    table.update(dt, t);
    rail.update(dt, t);
    bell.update(dt, t);
    cage.update(dt);
    cabinet.update(dt, t);
    hud.update(dt);

    power += (game.power - power) * (1 - Math.exp(-dt * 2.5));
    const light = lighting.update(dt);
    const hall = introPower(t) * power;
    const level = room.update(t, dt, hall, light.wheel);
    wheel.setLightLevel(level);
    table.setLampLevel(light.lamp * hall);
    rail.setLightLevel(light.rail * hall);
    cage.setLightLevel(light.cage * hall);
    cabinet.setLightLevel(light.cabinet * hall);
    // The turret's cap keeps a faint glint even when the bulb is low.
    wheel.lensMat.emissiveIntensity = 2.4 * Math.max(level, 0.16 * hall);

    if (director.current === 'wide') director.parallax.lerp(spin.pointer, 1 - Math.exp(-dt * 1.5));
    director.update(dt, t);

    const fade = Math.max(0, 1 - t / 1.4);
    post.render(t, fade * fade);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // Handy for debugging and for the smoke test.
  window.__roulette = { game, stage, spin, ball, table, cage, rail, bell, cabinet, director, interaction, lighting };
  if (import.meta.env.DEV) {
    window.__roulette.debug = {
      /** Add coins to the hand, e.g. to try later debts before items exist. */
      addCoins(n) {
        game.state = { ...game.state, coins: add(game.state.coins, n) };
        game.save();
        game.syncAll();
      },
      addTokens(n) {
        game.state = { ...game.state, tokens: game.state.tokens + n };
        game.save();
        game.syncAll();
      },
      /** Hang a talisman without paying for it, e.g. grant('glass_eye'). */
      grant(id) {
        if (game.state.rail.length >= game.state.railHooks) return console.warn('The rail is full.');
        game.state = grantTalisman(game.state, id);
        game.save();
        game.syncAll();
      },
    };
  }
}

init();
