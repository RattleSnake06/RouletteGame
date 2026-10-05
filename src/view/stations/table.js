import * as THREE from 'three';
import { PACKAGES } from '../../core/economy.js';
import { format } from '../../core/num.js';
import { canAfford, costOf } from '../../core/run.js';
import { CHIP, createChipMesh } from '../chips.js';
import { FeltCanvas, SPOTS, betAt, numbersFor } from '../felt.js';

// The Table: a baize lectern at the wheel's rim where the player stands
// (design doc 8.1). Local frame: +z points at the player, x to their right,
// y up from the floor. Holds the felt, the chips and their tray, the night
// cards and the results marquee.

const TOP_Y = 0.95;
const FELT_Y = TOP_Y + 0.002;
const FELT_Z = -0.035;
const TRAY = { x0: 0.27, z: 0.262, step: 0.052 };
const CARD = { w: 0.17, h: 0.24 };
const CARD_ORDER = ['long', 'short', 'sitout'];

function paperCard(draw) {
  const canvas = document.createElement('canvas');
  canvas.width = 360;
  canvas.height = 508;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#b9ab8c';
  ctx.fillRect(0, 0, 360, 508);
  // Foxing and grime so the card looks handled.
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(${90 + Math.random() * 40}, ${60 + Math.random() * 30}, 30, ${Math.random() * 0.05})`;
    ctx.fillRect(Math.random() * 360, Math.random() * 508, 2 + Math.random() * 6, 2 + Math.random() * 6);
  }
  ctx.strokeStyle = '#6e1216';
  ctx.lineWidth = 6;
  ctx.strokeRect(14, 14, 332, 480);
  ctx.lineWidth = 2;
  ctx.strokeRect(24, 24, 312, 460);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  draw(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

const INK = '#2a1410';
const OX = '#6e1216';
const serif = (px) => `italic ${px}px "IM Fell English", Georgia, serif`;
const sans = (weight, px) => `${weight} ${px}px Oswald, "Arial Narrow", sans-serif`;

function drawNightCard(ctx, { id, cost, affordable, key }) {
  const pkg = PACKAGES[id];
  ctx.fillStyle = OX;
  ctx.font = sans(600, 46);
  ctx.fillText(pkg.name.toUpperCase(), 180, 92);
  ctx.fillStyle = INK;
  ctx.font = sans(600, 132);
  ctx.fillText(String(pkg.spins), 180, 222);
  ctx.font = sans(500, 34);
  ctx.fillText(pkg.spins === 1 ? 'SPIN' : 'SPINS', 180, 306);
  ctx.font = serif(30);
  const bonus = id === 'short' ? '+1 token' : id === 'sitout' ? '+3 tokens when the debt is paid' : 'the most spins';
  wrapText(ctx, bonus, 180, 362, 280, 34);
  ctx.font = sans(600, 40);
  ctx.fillStyle = OX;
  ctx.fillText(cost === 0 ? 'FREE' : `COSTS ${cost}`, 180, 440);
  ctx.fillStyle = 'rgba(42,20,16,0.6)';
  ctx.font = sans(500, 24);
  ctx.fillText(`[${key}]`, 312, 52);
  if (!affordable) {
    ctx.fillStyle = 'rgba(30, 20, 15, 0.55)';
    ctx.fillRect(0, 0, 360, 508);
    ctx.fillStyle = '#f0e6d0';
    ctx.font = sans(600, 34);
    ctx.fillText('NOT ENOUGH', 180, 236);
    ctx.fillText('COINS', 180, 276);
  }
}

function drawEndCard(ctx, { line }) {
  ctx.fillStyle = OX;
  ctx.font = sans(600, 56);
  ctx.fillText('END THE', 180, 150);
  ctx.fillText('NIGHT', 180, 212);
  ctx.fillStyle = INK;
  ctx.font = serif(30);
  wrapText(ctx, line, 180, 300, 280, 36);
  ctx.fillStyle = 'rgba(42,20,16,0.6)';
  ctx.font = sans(500, 24);
  ctx.fillText('[E]', 312, 52);
}

function wrapText(ctx, text, x, y, maxW, lineH) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineH));
}

function drawMarquee(ctx, history, w, h) {
  ctx.fillStyle = '#0c0a09';
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#8a7a5c';
  ctx.font = sans(500, 26);
  ctx.fillText('LAST NUMBERS', w / 2, 34);
  ctx.fillStyle = 'rgba(138,122,92,0.4)';
  ctx.fillRect(24, 58, w - 48, 2);
  const recent = history.slice(-11).reverse();
  let y = 104;
  recent.forEach((r, i) => {
    const size = i === 0 ? 76 : 50;
    const x = r.color === 'green' ? w / 2 : r.color === 'red' ? w * 0.72 : w * 0.28;
    const color = r.color === 'green' ? '#45c27a' : r.color === 'red' ? '#e2393f' : '#ece5d6';
    ctx.font = sans(600, size);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = i === 0 ? 18 : 8;
    ctx.globalAlpha = i === 0 ? 1 : Math.max(0.35, 0.9 - i * 0.06);
    ctx.fillText(String(r.number), x, y);
    y += i === 0 ? 86 : 58;
  });
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

export function createTable({ materials, interaction, callbacks }) {
  const group = new THREE.Group();
  group.name = 'table';
  const felt = new FeltCanvas();
  const { w: feltW, h: feltH } = felt.size;

  // ---- Furniture ----------------------------------------------------------
  const wood = materials.mahogany;
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.26, 0.06, 0.64), wood);
  top.position.set(0, TOP_Y - 0.03, 0);
  const apron = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.12, 0.54), wood);
  apron.position.set(0, TOP_Y - 0.12, 0);
  for (const m of [top, apron]) {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  const legGeo = new THREE.CylinderGeometry(0.026, 0.02, TOP_Y - 0.06, 12);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, wood);
      leg.position.set(sx * 0.55, (TOP_Y - 0.06) / 2, sz * 0.24);
      leg.castShadow = true;
      group.add(leg);
    }
  }
  const leather = new THREE.MeshStandardMaterial({ color: 0x2a1a14, roughness: 0.55 });
  const rail = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 1.18, 6, 16), leather);
  rail.rotation.z = Math.PI / 2;
  rail.position.set(0, TOP_Y + 0.012, 0.31);
  rail.castShadow = true;
  group.add(rail);

  // Chip tray at the near right.
  const trayMat = new THREE.MeshStandardMaterial({ color: 0x1a110d, roughness: 0.7 });
  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.012, 0.066), trayMat);
  tray.position.set(TRAY.x0 + 0.13, TOP_Y + 0.006, TRAY.z);
  tray.receiveShadow = true;
  group.add(tray);
  for (const dz of [-0.036, 0.036]) {
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.018, 0.006), materials.brass);
    lip.position.set(TRAY.x0 + 0.13, TOP_Y + 0.009, TRAY.z + dz);
    group.add(lip);
  }

  // ---- Felt ---------------------------------------------------------------
  const feltMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(feltW, feltH),
    new THREE.MeshStandardMaterial({ map: felt.texture, roughness: 0.95 }),
  );
  feltMesh.rotation.x = -Math.PI / 2;
  feltMesh.position.set(0, FELT_Y, FELT_Z);
  feltMesh.receiveShadow = true;
  group.add(feltMesh);
  const overlay = new THREE.Mesh(
    new THREE.PlaneGeometry(feltW, feltH),
    new THREE.MeshBasicMaterial({ map: felt.overlayTexture, transparent: true, depthWrite: false, toneMapped: false }),
  );
  overlay.rotation.x = -Math.PI / 2;
  overlay.position.set(0, FELT_Y + 0.0005, FELT_Z);
  overlay.renderOrder = 2;
  group.add(overlay);

  // ---- Results marquee ----------------------------------------------------
  const marqueeCanvas = document.createElement('canvas');
  marqueeCanvas.width = 300;
  marqueeCanvas.height = 760;
  const marqueeTex = new THREE.CanvasTexture(marqueeCanvas);
  marqueeTex.colorSpace = THREE.SRGBColorSpace;
  const marquee = new THREE.Group();
  const board = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.5), new THREE.MeshBasicMaterial({ map: marqueeTex }));
  board.position.z = 0.011;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.235, 0.535, 0.02), wood);
  frame.castShadow = true;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.9, 10), materials.brass);
  post.position.y = -0.6;
  marquee.add(board, frame, post);
  marquee.position.set(0.84, 1.14, -0.52);
  marquee.rotation.y = -0.62;
  group.add(marquee);
  const marqueeLight = new THREE.PointLight(0xff5040, 0.25, 0.9, 2);
  marqueeLight.position.set(0.76, 1.14, -0.4);
  group.add(marqueeLight);

  function updateMarquee(history) {
    drawMarquee(marqueeCanvas.getContext('2d'), history, marqueeCanvas.width, marqueeCanvas.height);
    marqueeTex.needsUpdate = true;
  }
  updateMarquee([]);

  // ---- Hanging lamp -------------------------------------------------------
  // A lone shade on a long cord over the felt: the only warm light at the
  // table. Out of frame in first person, visible over the figure in the wide shot.
  const LAMP_Y = 1.78;
  const lampGroup = new THREE.Group();
  lampGroup.position.set(0, LAMP_Y, 0.02);
  const shadeMat = new THREE.MeshStandardMaterial({ color: 0x1a1612, metalness: 0.6, roughness: 0.45, side: THREE.DoubleSide });
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.19, 0.15, 24, 1, true), shadeMat);
  shade.castShadow = false;
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff0d0, emissive: 0xffc985, emissiveIntensity: 3 });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), bulbMat);
  bulb.position.y = -0.06;
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 6, 6), shadeMat);
  cord.position.y = 3.07; // reaches up into the dark
  lampGroup.add(shade, bulb, cord);
  group.add(lampGroup);

  const LAMP_INTENSITY = 4.2;
  const lamp = new THREE.SpotLight(0xffd6a0, LAMP_INTENSITY, 2.6, THREE.MathUtils.degToRad(40), 0.6, 2);
  lamp.position.set(0, LAMP_Y - 0.07, 0.02);
  lamp.target.position.set(0, TOP_Y, 0.09);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(1024, 1024);
  lamp.shadow.camera.near = 0.2;
  lamp.shadow.camera.far = 3;
  lamp.shadow.bias = -0.0004;
  lamp.shadow.radius = 4;
  group.add(lamp, lamp.target);
  let lampLevel = 1;

  /** 0..1: how bright the hanging lamp burns (it fades while the ball flies). */
  function setLampLevel(level) {
    lampLevel = level;
  }

  // ---- Coordinate helpers -------------------------------------------------
  const feltPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -FELT_Y);
  const tmp = new THREE.Vector3();

  /** Layout units under a pointer event, or null if it misses the felt plane. */
  function layoutAt(ev, inter) {
    const ray = inter.ray(ev).ray;
    group.updateMatrixWorld();
    const worldPlane = feltPlane.clone().applyMatrix4(group.matrixWorld);
    if (!ray.intersectPlane(worldPlane, tmp)) return null;
    group.worldToLocal(tmp);
    return felt.toLayout(tmp.x, tmp.z - FELT_Z);
  }

  function spotLocal(betId) {
    const s = SPOTS.get(betId);
    const p = felt.toLocal(s.x, s.y);
    return new THREE.Vector3(p.x, FELT_Y, p.z + FELT_Z);
  }

  // ---- Highlights ---------------------------------------------------------
  let hoverBet = null;
  let resultNumber = null;
  let resultTimer = 0;
  function redrawHighlight() {
    felt.highlight({
      numbers: hoverBet ? numbersFor(hoverBet) : [],
      spotId: hoverBet,
      result: resultNumber,
    });
  }
  function setHoverBet(betId, ev) {
    if (betId === hoverBet) return;
    hoverBet = betId;
    redrawHighlight();
    callbacks.onHoverBet?.(betId, ev);
  }
  function flashResult(number) {
    resultNumber = number;
    resultTimer = 3.5;
    redrawHighlight();
  }

  // ---- Chips --------------------------------------------------------------
  let locked = false;
  const chips = new Map(); // id → { mesh, target, glow }
  let dragging = null;

  function chipHandler(id) {
    return {
      enabled: () => !locked,
      cursor: 'grab',
      down(hit, ev) {
        dragging = { id, x: ev.clientX, y: ev.clientY, moved: false, bet: null };
        return true;
      },
      drag(ev, inter) {
        if (!dragging) return;
        if (!dragging.moved && Math.hypot(ev.clientX - dragging.x, ev.clientY - dragging.y) > 5) dragging.moved = true;
        if (!dragging.moved) return;
        inter.dom.style.cursor = 'grabbing';
        const at = layoutAt(ev, inter);
        const c = chips.get(id);
        if (!at) return;
        const bet = betAt(at.x, at.y);
        dragging.bet = bet;
        setHoverBet(bet, ev);
        callbacks.onHoverMove?.(ev);
        if (bet) c.target.copy(spotLocal(bet)).add(new THREE.Vector3(0, 0.03, 0));
        else {
          const p = felt.toLocal(at.x, at.y);
          c.target.set(p.x, FELT_Y + 0.04, p.z + FELT_Z);
        }
      },
      up() {
        const d = dragging;
        dragging = null;
        setHoverBet(null);
        if (!d) return;
        if (!d.moved) {
          callbacks.onChipClicked?.(id);
        } else if (d.bet) {
          callbacks.onPlace?.(id, d.bet);
        } else {
          callbacks.onRemove?.(id);
        }
        callbacks.onDragEnd?.();
      },
    };
  }

  /** Put every chip where the run state says it is. */
  function syncChips(state) {
    for (const chip of state.chips) {
      if (!chips.has(chip.id)) {
        const mesh = createChipMesh();
        group.add(mesh);
        interaction.add(mesh, chipHandler(chip.id));
        const target = new THREE.Vector3(TRAY.x0, TOP_Y + 0.02, TRAY.z);
        mesh.position.copy(target);
        chips.set(chip.id, { mesh, target, glow: 0 });
      }
    }
    const stacks = new Map();
    let trayIndex = 0;
    for (const chip of state.chips) {
      const c = chips.get(chip.id);
      const betId = state.placements[chip.id];
      if (betId) {
        const n = stacks.get(betId) ?? 0;
        stacks.set(betId, n + 1);
        c.target.copy(spotLocal(betId)).add(new THREE.Vector3(0, CHIP.height / 2 + n * CHIP.height, 0));
      } else {
        c.target.set(TRAY.x0 + trayIndex * TRAY.step, TOP_Y + 0.012 + CHIP.height / 2, TRAY.z);
        trayIndex += 1;
      }
    }
  }

  function chipWorldPosition(id, out = new THREE.Vector3()) {
    const c = chips.get(id);
    return c ? c.mesh.getWorldPosition(out) : null;
  }

  function glowChip(id) {
    const c = chips.get(id);
    if (c) c.glow = 1.6;
  }

  interaction.add(feltMesh, {
    enabled: () => !locked && !dragging,
    hover(hit, ev) {
      const p = felt.toLayout(...localXZ(hit.point));
      setHoverBet(betAt(p.x, p.y), ev);
      callbacks.onHoverMove?.(ev);
    },
    leave() {
      setHoverBet(null);
    },
    click(hit) {
      const p = felt.toLayout(...localXZ(hit.point));
      const bet = betAt(p.x, p.y);
      if (bet) callbacks.onClickBet?.(bet);
    },
  });

  function localXZ(worldPoint) {
    const p = group.worldToLocal(worldPoint.clone());
    return [p.x, p.z - FELT_Z];
  }

  // ---- Night cards ----------------------------------------------------------
  const cards = new Map(); // id → { mesh, material, base, hover, shown }
  const cardGeo = new THREE.PlaneGeometry(CARD.w, CARD.h);

  function makeCardMesh(id, onClick, isEnabled) {
    const material = new THREE.MeshStandardMaterial({ roughness: 0.95, transparent: true, opacity: 0 });
    const mesh = new THREE.Mesh(cardGeo, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.visible = false;
    group.add(mesh);
    const card = { mesh, material, base: new THREE.Vector3(), hover: false, shown: false, t: 0 };
    interaction.add(mesh, {
      enabled: () => card.shown && !locked && isEnabled(),
      hover() {
        card.hover = true;
      },
      leave() {
        card.hover = false;
      },
      click: onClick,
    });
    cards.set(id, card);
    return card;
  }

  CARD_ORDER.forEach((id, i) => {
    const card = makeCardMesh(id, () => callbacks.onChoose?.(id), () => card.affordable);
    card.base.set((i - 1) * 0.2, FELT_Y + 0.025, FELT_Z + 0.005);
  });
  const endCard = makeCardMesh('end', () => callbacks.onEndNight?.(), () => true);
  endCard.base.set(0, FELT_Y + 0.025, FELT_Z + 0.005);

  function setCardTexture(card, tex) {
    card.material.map?.dispose();
    card.material.map = tex;
    card.material.needsUpdate = true;
  }

  function showCard(card) {
    if (!card.shown) card.t = 0;
    card.shown = true;
    card.mesh.visible = true;
  }

  function hideCard(card) {
    card.shown = false;
    card.hover = false;
  }

  function showPackages(state) {
    CARD_ORDER.forEach((id, i) => {
      const card = cards.get(id);
      card.affordable = canAfford(state, id);
      setCardTexture(
        card,
        paperCard((ctx) =>
          drawNightCard(ctx, { id, cost: format(costOf(state, id)), affordable: card.affordable, key: i + 1 }),
        ),
      );
      showCard(card);
    });
  }

  function hidePackages() {
    for (const id of CARD_ORDER) hideCard(cards.get(id));
  }

  function showEndCard(line) {
    setCardTexture(endCard, paperCard((ctx) => drawEndCard(ctx, { line })));
    showCard(endCard);
  }

  function hideEndCard() {
    hideCard(endCard);
  }

  // ---- Per-frame ----------------------------------------------------------
  function update(dt, t = 0) {
    // An old bulb never burns quite steady.
    const waver = 1 + Math.sin(t * 7.3) * 0.015 + Math.sin(t * 17.1) * 0.01;
    lamp.intensity = LAMP_INTENSITY * lampLevel * waver;
    bulbMat.emissiveIntensity = 0.3 + 2.7 * lampLevel * waver;
    const k = 1 - Math.exp(-dt * 16);
    for (const c of chips.values()) {
      c.mesh.position.lerp(c.target, k);
      if (c.glow > 0) {
        c.glow = Math.max(0, c.glow - dt * 1.4);
        c.mesh.userData.setGlow(Math.min(1, c.glow));
      }
    }
    for (const card of cards.values()) {
      card.t = Math.min(1, card.t + dt * 3);
      const lift = card.hover ? 0.014 : 0;
      const targetY = card.base.y + lift;
      const appear = card.shown ? card.t : 0;
      card.material.opacity += ((card.shown ? 1 : 0) - card.material.opacity) * (1 - Math.exp(-dt * 10));
      card.mesh.position.set(card.base.x, targetY, card.base.z + (1 - appear) * 0.06);
      card.mesh.rotation.z = card.hover ? 0.03 : 0;
      if (!card.shown && card.material.opacity < 0.02) card.mesh.visible = false;
    }
    if (resultTimer > 0) {
      resultTimer -= dt;
      if (resultTimer <= 0) {
        resultNumber = null;
        redrawHighlight();
      }
    }
  }

  function setLocked(v) {
    locked = v;
    if (v) setHoverBet(null);
  }

  return {
    group,
    felt,
    syncChips,
    chipWorldPosition,
    glowChip,
    flashResult,
    updateMarquee,
    showPackages,
    hidePackages,
    showEndCard,
    hideEndCard,
    setLocked,
    setLampLevel,
    update,
    get isDragging() {
      return !!dragging;
    },
  };
}
