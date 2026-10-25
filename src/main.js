import './style.css';
import * as THREE from 'three';
import { WheelAudio } from './audio/audio.js';
import { Game } from './game.js';
import { createInput } from './input/actions.js';
import { createSwipe, isTouchScreen } from './input/touch.js';
import { loadSettings, platform, saveSettings } from './platform/index.js';
import { loadFonts } from './ui/fonts.js';
import { createHud } from './ui/hud.js';
import { createMainMenu } from './ui/menu.js';
import { deserializeProfile } from './core/meta.js';
import { add } from './core/num.js';
import { copyRun, grantTalisman } from './core/run.js';
import { doWork, workRefusal } from './core/wheelwork.js';
import { BallAnimator } from './view/ball.js';
import { createBell } from './view/bell.js';
import { createFigures } from './view/figures.js';
import { createVault } from './view/vault.js';
import { CameraDirector } from './view/camera.js';
import { Interaction } from './view/interaction.js';
import { LightingDirector } from './view/lighting.js';
import { createRail } from './view/rail.js';
import { createStage } from './view/stage.js';
import { createCabinet } from './view/stations/cabinet.js';
import { createCage } from './view/stations/cage.js';
import { createOracle } from './view/stations/oracle.js';
import { createSparks } from './view/fx/sparks.js';
import { DEVIL } from './core/devil.js';
import { createTable } from './view/stations/table.js';
import { buildOddityMesh } from './view/oddityArt.js';
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
  // The phone app reads its saves from native storage before anything else (doc 9.10).
  await platform.ready?.();
  await loadFonts();
  // Touch screens get touch hints, bigger targets and no key caps (doc 9.10).
  const touch = isTouchScreen();
  document.documentElement.classList.toggle('touch', touch);

  // Text, levels, graphics and the crunch filter are Phase 8's (doc 8.7, 9.10).
  // The phone app starts on the phone preset (Low); the player can raise it.
  const settings = loadSettings({ muted: false, fast: false, flashes: true, music: 1, effects: 1, text: 'normal', quality: platform.native ? 'low' : 'high', crunch: false, tips: true, haptics: true });
  const canvas = document.getElementById('scene');
  // The phone preset paints the floor at half size (a change shows from the next launch).
  const stage = createStage(canvas, { floorPixels: settings.quality === 'low' ? 1024 : 2048 });
  const { scene, camera, renderer, post, wheel, room, layout } = stage;
  const audio = new WheelAudio();
  audio.muted = settings.muted;
  audio.setLevels({ music: settings.music, effects: settings.effects });
  document.documentElement.classList.toggle('text-large', settings.text === 'large');
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
      onChipClicked: (chipId) => game.onChipTapped(chipId),
      onClickFelt: () => game.touch && game.zoomFelt(true),
      canAim: () => game.feltZoom && !game.busy,
      onAim: (aim) => game.onAim(aim),
      // On a phone the first tap leans in to read the cards; the next chooses.
      onChoose: (id) => (game.touch && !game.feltZoom ? game.zoomFelt(true) : game.choosePackage(id)),
      onEndNight: () => game.requestEndNight(),
      onHoverBet: (betId, ev) => game.onHoverBet(betId, ev),
      onHoverBoard: (on, ev) => game?.onHoverItem(on ? { kind: 'board' } : null, ev),
      onChalkboard: () => game.openChalkboard(),
      onPlacard: () => game.openPlacard(),
      onAlmanac: () => game.openAlmanac(),
      onHoverAlmanac: (on, ev) => game?.onHoverItem(on ? { kind: 'almanac' } : null, ev),
      onHoverPlacard: (on, ev) => game?.onHoverItem(on ? { kind: 'placard' } : null, ev),
      onHoverChalkboard: (on, ev) => game?.onHoverItem(on ? { kind: 'chalkboard' } : null, ev),
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
      onHoverDevil: (on, ev) => game?.onHoverItem(on ? { kind: 'devil' } : null, ev),
    },
  });
  cage.group.position.copy(layout.cagePos);
  cage.group.rotation.y = layout.cageYaw;
  scene.add(cage.group);

  // Talismans: the rail and the Bell live on the table; the Cabinet stands
  // on the player's right.
  const makeCharm = (id) => buildTalismanMesh(id, { brass: wheel.materials.brass });
  const makeOddity = (id) => buildOddityMesh(id, { brass: wheel.materials.brass });
  const onHoverItem = (target, ev) => game?.onHoverItem(target, ev);
  const rail = createRail({
    materials: wheel.materials,
    interaction,
    makeCharm,
    callbacks: {
      onSelect: (uid) => game.openTalisman(uid),
      onMove: (uid, to) => game.moveTalisman(uid, to),
      // On a touch screen a tag opens the talisman's card, where Ring is a button.
      onRing: (uid) => (game.touch ? game.openTalisman(uid) : game.ringBell(uid)),
      onHover: onHoverItem,
    },
  });
  table.group.add(rail.group);
  const bell = createBell({
    materials: wheel.materials,
    interaction,
    callbacks: { onRing: () => (game.touch ? game.offerRing() : game.ringBell()), onHover: onHoverItem },
  });
  table.group.add(bell.group);

  const cabinet = createCabinet({
    materials: wheel.materials,
    interaction,
    makeCharm,
    makeOddity,
    callbacks: {
      onBuy: (slot) => (game.touch ? game.offerSlot(slot) : game.buy(slot)),
      onRestock: () => (game.touch ? game.offerRestock() : game.restock()),
      onHover: onHoverItem,
    },
  });
  cabinet.group.position.copy(layout.cabinetPos);
  cabinet.group.rotation.y = layout.cabinetYaw;
  scene.add(cabinet.group);

  // Madame Zero and the gramophone, left of the Cage. On a touch screen a
  // tap opens a card's own card, with Take (doc 9.10).
  const oracle = createOracle({
    materials: wheel.materials,
    interaction,
    callbacks: {
      onLever: () => (game.touch ? game.offerLever() : game.pullLever()),
      onCard: (i) => (game.touch ? game.offerCard(i) : game.takeFortune(i)),
      onGramophone: () => game.openCrate(),
      onHover: onHoverItem,
    },
  });
  oracle.group.position.copy(layout.oraclePos);
  oracle.group.rotation.y = layout.oracleYaw;
  scene.add(oracle.group);

  let ball = null;
  const spin = new SpinController({
    camera,
    dom: canvas,
    planeY: DIM.numberY,
    grabRadius: DIM.radius + 0.1,
    canGrab: (ev) => !interaction.consumed.has(ev) && game && !game.busy && !game.atMenu && !ball.flying,
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
  // The balls multi-ball talismans throw: quieter, so three do not deafen.
  const extraBalls = wheel.extraBalls.map((mesh) => new BallAnimator({ ball: mesh, spin, onBounce: (s) => audio.bounce(s * 0.4) }));

  // The meta in the room (doc 7.1, 7.3): the Vault at the back of the hall,
  // behind the wheel, and the figures at the edge of the light.
  const vault = createVault();
  vault.group.position.set(1.2, 0, -7.6);
  vault.group.rotation.y = Math.atan2(-1.2, 7.6);
  scene.add(vault.group);
  const figures = createFigures();
  scene.add(figures.group);

  const lighting = new LightingDirector('intro');
  lighting.flashes = settings.flashes !== false;
  const sparks = createSparks(scene);
  sparks.flashes = lighting.flashes;
  // The main menu and chip select (doc 7.5); what is unlocked lives in the profile.
  const menu = createMainMenu({
    onContinue: () => game.continueRun(),
    onPlay: () => game.playFromMenu(),
    onInfo: () => game.openGuide(),
    onVault: () => game.openVault(),
    onAlmanac: () => game.openAlmanac(),
    onSettings: () => game.openSettings(),
    onWheel: () => game.chooseWheel(),
    onEdge: () => game.chooseEdge(),
    onGoal: () => game.chooseGoal(),
    onBegin: (id) => game.beginRun(id),
    onBack: () => game.menuBack(),
  });
  const profile = deserializeProfile(platform.load('profile'));
  game = new Game({ stage, table, cage, rail, bell, cabinet, oracle, ball, spin, director, hud, audio, platform, settings, lighting, sparks, touch, menu, profile, vault, figures, extraBalls });
  game.onSettingsChanged = saveSettings;
  game.onGraphicsChanged = applyGraphics;

  // ---- Sizing, graphics quality and camera anchors -----------------------------
  // Graphics quality (Settings, doc 9.10): Low is the phone preset, at one
  // pixel per CSS pixel with no shadows and no bloom.
  const QUALITY = {
    high: { pixelRatio: 2, shadows: true, bloom: true },
    medium: { pixelRatio: 1.5, shadows: true, bloom: true },
    low: { pixelRatio: 1, shadows: false, bloom: false },
  };
  const quality = () => QUALITY[(game?.settings ?? settings).quality] ?? QUALITY.high;

  /** Puts the quality and the crunch filter in force, after a change in Settings. */
  function applyGraphics() {
    const q = quality();
    if (renderer.shadowMap.enabled !== q.shadows) {
      renderer.shadowMap.enabled = q.shadows;
      // Every material compiled with (or without) shadows is rebuilt.
      scene.traverse((o) => {
        for (const m of [o.material].flat()) if (m) m.needsUpdate = true;
      });
    }
    post.bloom.enabled = q.bloom;
    post.film.uniforms.uCrunch.value = (game?.settings ?? settings).crunch ? 1 : 0;
    resize();
  }

  function resize() {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    const pr = Math.min(window.devicePixelRatio, quality().pixelRatio);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    post.setSize(w, h, pr);
    // The crunch filter's blocks stay about 3 CSS pixels whatever the density.
    post.film.uniforms.uPixel.value = Math.max(2, Math.round(3 * pr));
    room.setPixelRatio(pr);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    for (const [name, anchor] of Object.entries(stage.anchorsFor(w / h, { table, cage, cabinet, oracle }))) {
      director.setAnchor(name, anchor);
    }
  }
  applyGraphics();
  new ResizeObserver(resize).observe(canvas);

  // A tap on nothing closes an open note (touch has no pointer to leave it).
  interaction.onMiss = () => {
    game.clearFocus();
    game.clearNote();
  };

  // ---- Input -----------------------------------------------------------------
  const input = createInput(window);
  // While a card is up (other than the pause menu), keys must not act on the
  // room behind it.
  const modalOpen = () => !!document.querySelector('.modal-backdrop:not([inert])');
  const play = (fn) => () => !modalOpen() && !game.atMenu && fn();
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
  input.on('menu', () => !game.atMenu && (game.menuClose || !modalOpen()) && game.toggleMenu());
  // Touch (doc 9.10): a swipe across empty space turns; the menu button and
  // the Android back button open the menu.
  createSwipe(canvas, {
    ignore: (ev) => interaction.consumed.has(ev) || interaction.captured || !!game?.busy || !!game?.atMenu || spin.grabbableAt(ev),
    onSwipe: (dir) => input.emit(dir < 0 ? 'turnLeft' : 'turnRight'),
  });
  // The SPIN button acts like Space: a press spins, and holding it spins fast.
  const spinBtn = hud.refs.spinBtn;
  spinBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!modalOpen()) input.press('spin');
    // Kept while the finger slides off the button, so the hold is not lost.
    try {
      spinBtn.setPointerCapture(e.pointerId);
    } catch {
      // No such pointer any more: the release still arrives as pointerup.
    }
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) spinBtn.addEventListener(type, () => input.release('spin'));
  // Enter or Space on the focused button (no pointer): a plain spin.
  spinBtn.addEventListener('click', (e) => e.detail === 0 && !modalOpen() && input.emit('spin'));
  hud.refs.menu.addEventListener('click', (e) => {
    e.currentTarget.blur();
    input.emit('menu');
  });
  hud.refs.back.addEventListener('click', (e) => {
    e.currentTarget.blur();
    game.zoomFelt(false);
  });
  // Back leaves the felt close-up first, then opens the menu. It returns
  // false only on the main menu, where the phone app goes to the background.
  platform.onBack?.(() => {
    if ((modalOpen() && !game.menuClose) || game.back()) return true;
    if (game.atMenu) return false;
    input.emit('menu');
    return true;
  });
  // The phone app in the background: the run is saved and the sound stops (doc 9.10).
  platform.onPause?.(() => {
    game.save();
    game.saveProfile();
    audio.suspend();
  });
  platform.onResume?.(() => audio.resume());
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
  // The game opens on the main menu. A ?seed= link goes straight to the table
  // (for testing and sharing a seed), as it always has.
  game.boot();
  director.goTo('wide', { cut: true });
  if (!new URLSearchParams(window.location.search).get('seed')) game.showMainMenu({ cut: true });
  setTimeout(() => {
    if (director.current !== 'wide' || game.busy) return;
    director.goTo(game.view, { duration: 1.8 });
    // The establishing shot shows the wheel lit; at the table it sinks into the dark.
    lighting.set(game.view);
  }, 1700);
  setTimeout(() => !game.atMenu && hud.root.classList.add('show'), 1400);

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
    wheel.update(dt);
    ball.update(sdt);
    for (const extra of extraBalls) if (extra.ball.visible) extra.update(sdt);

    // Pocket ticks when the player turns the wheel by hand; the ball's own
    // rattle takes over while it is in flight.
    const pocket = Math.floor(spin.angle / SLICE);
    if (pocket !== lastPocket) {
      if (!ball.flying) audio.tick(spin.speed);
      lastPocket = pocket;
    }
    audio.update(spin.speed);

    stage.figure.update(t);
    figures.update(t);
    table.update(dt, t);
    rail.update(dt, t);
    bell.update(dt, t);
    cage.update(dt);
    cabinet.update(dt, t);
    oracle.update(dt, t, camera.position);
    sparks.update(dt);
    hud.update(dt);

    power += (game.power - power) * (1 - Math.exp(-dt * 2.5));
    const light = lighting.update(dt);
    // Flashing lights off (doc 8.7): the hall fades up instead of stuttering on.
    const flashes = game.settings.flashes !== false;
    const hall = (flashes ? introPower(t) : Math.min(1, Math.max(0, (t - 0.2) / 0.8))) * power;
    // The Devil's blackout takes the whole hall down with the bulb.
    const level = room.update(t, dt, hall * light.all, light.wheel, flashes);
    table.setBlackout(light.all);
    wheel.setLightLevel(level);
    table.setLampLevel(light.lamp * hall);
    rail.setLightLevel(light.rail * hall);
    cage.setLightLevel(light.cage * hall);
    cabinet.setLightLevel(light.cabinet * hall);
    oracle.setLightLevel(light.oracle * hall);
    // The turret's cap keeps a faint glint even when the bulb is low.
    wheel.lensMat.emissiveIntensity = 2.4 * Math.max(level, 0.16 * hall * light.all);

    if (director.current === 'wide') director.parallax.lerp(spin.pointer, 1 - Math.exp(-dt * 1.5));
    director.update(dt, t);
    // Your own figure shows only where the camera has it in the shot (camera.js).
    stage.setFigureGhost(!director.seesFigure());

    const fade = Math.max(0, 1 - t / 1.4);
    post.render(t, fade * fade);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // Handy for debugging and for the smoke test.
  window.__roulette = { game, stage, spin, ball, table, cage, rail, bell, cabinet, oracle, menu, director, interaction, lighting, sparks, vault, figures, THREE };
  if (import.meta.env.DEV) {
    const tunedDevil = { ...DEVIL };
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
      /** Hang a talisman without paying for it, e.g. grant('glass_eye') or grant('bone_dice'). */
      grant(id) {
        if (game.state.rail.length >= game.state.railHooks) return console.warn('The rail is full.');
        game.state = grantTalisman(game.state, id);
        game.save();
        game.syncAll();
      },
      /** A Lean of this strength on the next spin, announced now. */
      lean(strength = 5) {
        const s = game.state;
        game.state = { ...s, leans: { ...s.leans, debt: [...s.leans.debt, { at: s.debtSpins + 1, strength }] } };
        game.save();
        game.syncAll();
      },
      /** Misses in a row so far, to try pity. */
      misses(n) {
        game.state = { ...game.state, missStreak: n };
        game.save();
        game.syncAll();
      },
      /** The Devil fires on every throw until calm() (dev build only: it bends the rules). */
      devil() {
        // A base no Salt Cellar or Evil Eye can bring under the cap.
        Object.assign(DEVIL, { liveFrom: 1, base: 1e6, cap: 1 });
        game.syncAll();
      },
      calm() {
        Object.assign(DEVIL, tunedDevil);
        game.syncAll();
      },
      /**
       * Wheel work for nothing, on the pocket(s) with number `n` (the first
       * one it can act on): work('gild', 17), work('enhance', 9, { enh: 'glass' }),
       * work('paint', 2, { color: 'red' }), work('duplicate', 0), work('remove', 5),
       * work('widen', 17) (every pocket with it), work('stamp', 32, { number: 17 }).
       */
      work(op, n, extra = {}) {
        const s = copyRun(game.state);
        const on = op === 'widen' || op === 'narrow' ? 'number' : 'pocket';
        const w = { op, on, ...extra };
        const pocket = s.wheel.pockets.find((p) => p.number === n && (on === 'number' || !workRefusal(s, w, op === 'stamp' ? { pocket: p.id, number: extra.number } : p.id)));
        const target = on === 'number' ? n : op === 'stamp' ? { pocket: pocket?.id, number: extra.number } : pocket?.id;
        const why = workRefusal(s, w, target);
        if (why) return console.warn(why);
        doWork(s, w, target, () => {}, { kind: 'debug' });
        game.state = s;
        game.save();
        game.syncAll();
      },
    };
  }
}

init();
