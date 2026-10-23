import * as THREE from 'three';
import { SANS } from '../ui/fonts.js';
import { mulberry32 } from './textures.js';

// The Almanac on the table (design doc 7.4): a leather book lying at the
// table's near edge, between the Bell and the chip tray, its title tooled in
// gold. A tap opens it (the Almanac card, ui/almanac.js).

const W = 320;
const H = 420;
const BOOK = { w: 0.13, h: 0.028, d: 0.17 };

function paintCover(ctx) {
  ctx.fillStyle = '#3b2216';
  ctx.fillRect(0, 0, W, H);
  // Worn leather: blotches and scuffs.
  const r = mulberry32(71);
  for (let i = 0; i < 1800; i++) {
    ctx.fillStyle = r() < 0.5 ? `rgba(0, 0, 0, ${r() * 0.12})` : `rgba(160, 110, 70, ${r() * 0.06})`;
    ctx.fillRect(r() * W, r() * H, 2 + r() * 6, 2 + r() * 6);
  }
  const edge = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.7);
  edge.addColorStop(0, 'rgba(0, 0, 0, 0)');
  edge.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, W, H);
  // A tooled gold frame and the title.
  ctx.strokeStyle = '#c99a4c';
  ctx.lineWidth = 4;
  ctx.strokeRect(24, 24, W - 48, H - 48);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(34, 34, W - 68, H - 68);
  ctx.fillStyle = '#d8ad5e';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 34px ${SANS}`;
  ctx.fillText('THE', W / 2, H * 0.38);
  ctx.font = `600 52px ${SANS}`;
  ctx.fillText('ALMANAC', W / 2, H * 0.5);
  ctx.beginPath();
  ctx.arc(W / 2, H * 0.68, 22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(W / 2, H * 0.68, 6, 0, Math.PI * 2);
  ctx.fill();
}

/** The book, in the table's frame. `onOpen` is a tap; `onHover(on, ev)` the pointer over it. */
export function createAlmanacBook({ interaction, onOpen, onHover, enabled = () => true }) {
  const group = new THREE.Group();
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  paintCover(canvas.getContext('2d'));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const leather = new THREE.MeshStandardMaterial({ color: 0x3b2216, roughness: 0.85 });
  const pages = new THREE.MeshStandardMaterial({ color: 0xd9cdb0, roughness: 0.95 });
  const cover = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, metalness: 0.05 });
  // Sides: leather spine on the left, page edges on the other three.
  const book = new THREE.Mesh(new THREE.BoxGeometry(BOOK.w, BOOK.h, BOOK.d), [leather, pages, cover, leather, pages, pages]);
  book.position.y = BOOK.h / 2;
  book.castShadow = true;
  book.receiveShadow = true;
  book.userData.role = 'almanac';
  group.add(book);
  interaction?.add(book, {
    enabled,
    click: () => onOpen?.(),
    hover: (hit, ev) => onHover?.(true, ev),
    leave: () => onHover?.(false),
  });
  return {
    group,
    mesh: book,
    worldPosition(out = new THREE.Vector3()) {
      return book.getWorldPosition(out);
    },
  };
}
