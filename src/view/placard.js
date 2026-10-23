import * as THREE from 'three';
import { SANS } from '../ui/fonts.js';
import { mulberry32 } from './textures.js';

// The payout placard (design doc 5.11): a small card in a brass frame,
// standing at the felt's right edge, giving what each kind of bet pays now.
// A kind raised a level (doc 5.3) is printed in gold, with a tally of its
// level beside it. It only shows: a tap opens its card.

const W = 520;
const H = 700;
const CARD = { w: 0.15, h: 0.2 };
const SHORT = { straight: 'Straight', split: 'Split', street: 'Street', corner: 'Corner', firstFour: 'First Four', sixLine: 'Six Line', dozen: 'Dozen', column: 'Column', red: 'Red', black: 'Black', odd: 'Odd', even: 'Even', low: '1–18', high: '19–36', neighbours: 'Neighbours', finale: 'Finale', jeuZero: 'Jeu Zéro', orphelins: 'Orphelins', tiers: 'Tiers', snake: 'Snake', voisins: 'Voisins' };
const fmt = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(2).replace(/0$/, ''));

function paint(ctx, levels) {
  // Old ivory card, foxed at the edges.
  ctx.fillStyle = '#e6dcc4';
  ctx.fillRect(0, 0, W, H);
  const r = mulberry32(77);
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = `rgba(90, 60, 30, ${r() * 0.06})`;
    ctx.fillRect(r() * W, r() * H, 1 + r() * 3, 1 + r() * 3);
  }
  const edge = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
  edge.addColorStop(0, 'rgba(120, 80, 40, 0)');
  edge.addColorStop(1, 'rgba(120, 80, 40, 0.35)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#3a2a1a';
  ctx.lineWidth = 4;
  ctx.strokeRect(22, 22, W - 44, H - 44);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(32, 32, W - 64, H - 64);

  ctx.fillStyle = '#2a1c10';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 52px ${SANS}`;
  ctx.fillText('THE ODDS', W / 2, 84);
  ctx.font = `500 22px ${SANS}`;
  ctx.fillText('PAID PER UNIT OF CHIP', W / 2, 122);
  ctx.fillRect(70, 146, W - 140, 2);

  const rows = levels.length;
  const top = 178;
  const step = (H - 60 - top) / rows;
  // With the racetrack open (Phase 7) the rows run small.
  const size = Math.min(30, step * 0.78);
  levels.forEach((k, i) => {
    const y = top + step * (i + 0.5);
    const up = k.level > 1;
    ctx.textAlign = 'left';
    ctx.font = `500 ${size}px ${SANS}`;
    ctx.fillStyle = up ? '#7a4a0c' : '#2a1c10';
    ctx.fillText(SHORT[k.kind] ?? k.name, 64, y);
    ctx.textAlign = 'right';
    ctx.font = `600 ${size * 1.13}px ${SANS}`;
    ctx.fillStyle = up ? '#a8660e' : '#2a1c10';
    ctx.fillText(k.kind === 'finale' ? `${fmt(k.odds)}–${fmt((k.odds * 4) / 3)}` : fmt(k.odds), W - 64, y);
    if (up) {
      // The level, tallied: one stroke for each level above the first.
      ctx.strokeStyle = '#a8660e';
      ctx.lineWidth = 3;
      const marks = Math.min(6, k.level - 1);
      for (let m = 0; m < marks; m++) {
        const x = W - 170 - m * 10;
        ctx.beginPath();
        ctx.moveTo(x, y - 12);
        ctx.lineTo(x - 3, y + 12);
        ctx.stroke();
      }
    }
    ctx.fillStyle = 'rgba(42, 28, 16, 0.18)';
    ctx.fillRect(64, y + step / 2 - 1, W - 128, 1);
  });
}

/** The placard, in the table's frame. `onOpen` is a tap (its card); `onHover(on, ev)` the pointer over it. */
export function createPlacard({ materials, interaction, onOpen, onHover, enabled = () => true }) {
  const group = new THREE.Group();
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const faceMat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.8 });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(CARD.w, CARD.h), faceMat);
  face.position.z = 0.004;
  face.userData.role = 'placard';
  const brass = (materials?.brass ?? new THREE.MeshStandardMaterial({ color: 0xc39a5c, metalness: 1, roughness: 0.3 })).clone();
  brass.emissive = new THREE.Color(0xffb46a);
  brass.emissiveIntensity = 0;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(CARD.w + 0.012, CARD.h + 0.012, 0.006), brass);
  // A brass foot behind, so it stands tilted back on the table.
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.12, 0.006), brass);
  foot.position.set(0, -0.04, -0.04);
  foot.rotation.x = 0.7;
  for (const m of [frame, foot, face]) {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  interaction?.add(face, {
    enabled,
    click: () => onOpen?.(),
    hover: (hit, ev) => onHover?.(true, ev),
    leave: () => onHover?.(false),
  });

  let key = '';
  let flash = 0;
  return {
    group,
    face,
    sync(levels) {
      const next = JSON.stringify(levels);
      if (next === key) return;
      key = next;
      paint(canvas.getContext('2d'), levels);
      tex.needsUpdate = true;
    },
    /** A level was raised: the frame flashes. */
    pulse() {
      flash = 1;
    },
    update(dt) {
      if (flash <= 0) return;
      flash = Math.max(0, flash - dt * 1.2);
      brass.emissiveIntensity = flash * 1.4;
      faceMat.emissiveIntensity = 0.35 + flash * 0.6;
    },
    worldPosition(out = new THREE.Vector3()) {
      return face.getWorldPosition(out);
    },
  };
}
