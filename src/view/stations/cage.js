import * as THREE from 'three';
import { ECONOMY } from '../../core/economy.js';
import { format } from '../../core/num.js';
import { scrawlText, typedFont } from '../ink.js';

// The Cage: a brass teller's cage where coins are banked against the debt
// (design doc 5.1, 8.1). Local frame: +z faces the player.

const sans = (weight, px) => `${weight} ${px}px Oswald, "Arial Narrow", sans-serif`;

function makeCanvasTexture(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { canvas, ctx: canvas.getContext('2d'), tex };
}

/** Mechanical counter: cream digits on black tiles. */
function drawCounter(ctx, x, y, label, value, tiles, tileW, tileH) {
  ctx.fillStyle = '#c8a462';
  ctx.font = sans(500, 34);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(label, x, y - 14);
  const text = value.padStart(tiles, ' ').slice(-tiles);
  for (let i = 0; i < tiles; i++) {
    const tx = x + i * (tileW + 6);
    const g = ctx.createLinearGradient(0, y, 0, y + tileH);
    g.addColorStop(0, '#1d1a17');
    g.addColorStop(0.5, '#0b0a09');
    g.addColorStop(0.52, '#000');
    g.addColorStop(1, '#151210');
    ctx.fillStyle = g;
    ctx.fillRect(tx, y, tileW, tileH);
    ctx.fillStyle = '#efe6d1';
    ctx.font = sans(600, tileH * 0.78);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text[i] === ' ' ? '' : text[i], tx + tileW / 2, y + tileH / 2 + 3);
  }
}

export function createCage({ materials, interaction, callbacks }) {
  const group = new THREE.Group();
  group.name = 'cage';
  const wood = materials.mahogany;
  const brass = materials.brass;

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.24, 1.0, 0.52), wood);
  body.position.y = 0.5;
  const ledge = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.04, 0.6), materials.darkMetal);
  ledge.position.y = 1.02;
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.82, 0.04), new THREE.MeshStandardMaterial({ color: 0x15100d, roughness: 0.9 }));
  back.position.set(0, 1.45, -0.2);
  for (const m of [body, ledge, back]) {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }

  // Bars, leaving a teller's window in the middle.
  const barGeo = new THREE.CylinderGeometry(0.008, 0.008, 1, 8);
  for (let i = 0; i <= 16; i++) {
    const x = -0.6 + i * 0.075;
    const inWindow = Math.abs(x) < 0.2;
    const y0 = inWindow ? 1.42 : 1.04;
    const bar = new THREE.Mesh(barGeo, brass);
    bar.scale.y = 1.86 - y0;
    bar.position.set(x, (y0 + 1.86) / 2, 0.24);
    bar.castShadow = true;
    group.add(bar);
  }
  for (const [y, w] of [[1.86, 1.24], [1.42, 0.42], [1.05, 1.24]]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.025, 0.03), brass);
    rail.position.set(0, y, 0.24);
    group.add(rail);
  }

  // Sign with the counters, above the bars.
  const sign = makeCanvasTexture(1024, 440);
  // Backlit, so it reads in the dark like an old cashier's board.
  const signMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 0.473),
    new THREE.MeshStandardMaterial({ map: sign.tex, emissiveMap: sign.tex, emissive: 0xffffff, emissiveIntensity: 0.32, roughness: 0.6 }),
  );
  signMesh.position.set(0, 2.1, 0.26);
  const signFrame = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.53, 0.04), wood);
  signFrame.position.set(0, 2.1, 0.235);
  group.add(signFrame, signMesh);

  // A banker's lamp: green, because the Cage belongs to the House.
  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.11, 0.08, 20, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x1d5a35, emissive: 0x0e3a20, emissiveIntensity: 0.6, roughness: 0.4, side: THREE.DoubleSide }),
  );
  shade.position.set(-0.42, 1.25, 0.05);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 8), brass);
  stem.position.set(-0.42, 1.13, 0.05);
  group.add(shade, stem);
  const LAMP = 2.2;
  const lamp = new THREE.PointLight(0xffe2b0, LAMP, 3.2, 2);
  lamp.position.set(-0.42, 1.19, 0.12);
  group.add(lamp);

  // ---- Buttons: brass plates on the counter front --------------------------
  let locked = false;
  const buttons = [];
  function makeButton(id, x, onClick) {
    const t = makeCanvasTexture(512, 180);
    // The label glows faintly so it reads at the edge of the light.
    const mat = new THREE.MeshStandardMaterial({ map: t.tex, emissiveMap: t.tex, emissive: 0xffffff, emissiveIntensity: 0.2, metalness: 0.4, roughness: 0.45 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.02), [brass, brass, brass, brass, mat, brass]);
    mesh.position.set(x, 0.85, 0.27);
    mesh.userData.role = 'cage-button';
    mesh.userData.button = id;
    group.add(mesh);
    const button = { id, mesh, mat, t, enabled: false, hover: false, label: '', sub: '' };
    interaction.add(mesh, {
      enabled: () => !locked && button.enabled,
      hover: () => (button.hover = true),
      leave: () => (button.hover = false),
      click: onClick,
    });
    buttons.push(button);
    return button;
  }
  const bankAll = makeButton('bankAll', -0.4, () => callbacks.onBankAll?.());
  const bankKeep = makeButton('bankKeep', 0, () => callbacks.onBankKeep?.());
  const endNight = makeButton('endNight', 0.4, () => callbacks.onEndNight?.());

  function drawButton(b) {
    const { ctx, canvas, tex } = b.t;
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    g.addColorStop(0, b.enabled ? '#c9a15a' : '#6e5a3a');
    g.addColorStop(1, b.enabled ? '#8a6630' : '#45382a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(40,24,10,0.7)';
    ctx.lineWidth = 8;
    ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
    ctx.fillStyle = b.enabled ? '#2a1708' : 'rgba(30,20,10,0.6)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = sans(600, 58);
    ctx.fillText(b.label, canvas.width / 2, b.sub ? 70 : 92);
    if (b.sub) {
      ctx.font = sans(500, 34);
      ctx.fillText(b.sub, canvas.width / 2, 128);
    }
    tex.needsUpdate = true;
  }

  function sync({ owed, deposited, coins, canBank, round, keep, canEnd, endLabel, rate = ECONOMY.interestRate }) {
    const { ctx, canvas, tex } = sign;
    ctx.fillStyle = '#1b120d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#a8864c';
    ctx.lineWidth = 6;
    ctx.strokeRect(14, 14, canvas.width - 28, canvas.height - 28);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    scrawlText(ctx, 'The Cage', canvas.width / 2, 84, 50, '#d9b878');
    drawCounter(ctx, 60, 160, 'OWED', format(owed), 7, 56, 80);
    drawCounter(ctx, 560, 160, 'BANKED', format(deposited), 7, 56, 80);
    drawCounter(ctx, 60, 330, 'NIGHT', `${round}/${ECONOMY.roundsPerDebt}`, 3, 56, 80);
    ctx.fillStyle = '#b89a66';
    ctx.font = typedFont(30);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    // The live rate: talismans (Pawn Ticket) can raise it.
    ctx.fillText(`Banked coins earn ${Math.round(rate * 100)}%`, 340, 360);
    ctx.fillText('at the end of each night.', 340, 400);
    tex.needsUpdate = true;

    bankAll.enabled = canBank;
    bankAll.label = 'BANK ALL';
    bankAll.sub = `${format(coins)} coins`;
    bankKeep.enabled = keep !== null;
    bankKeep.label = 'BANK, KEEP';
    bankKeep.sub = keep !== null ? `${format(keep)} for tomorrow` : 'nothing to keep';
    endNight.enabled = canEnd;
    endNight.label = 'END NIGHT';
    endNight.sub = endLabel;
    for (const b of buttons) drawButton(b);
  }

  function update(dt) {
    for (const b of buttons) {
      const target = b.hover && b.enabled && !locked ? 0.55 : 0.2;
      b.mat.emissiveIntensity += (target - b.mat.emissiveIntensity) * (1 - Math.exp(-dt * 12));
    }
  }

  return {
    group,
    sync,
    update,
    setLocked(v) {
      locked = v;
    },
    /** 0..1: the lamp's share of the room's attention (lighting moods). */
    setLightLevel(x) {
      lamp.intensity = LAMP * x;
    },
    /** Where the first-person camera looks when turned to the Cage (local). */
    focus: new THREE.Vector3(0, 1.45, 0.2),
  };
}
