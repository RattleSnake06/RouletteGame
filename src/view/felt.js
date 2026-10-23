import * as THREE from 'three';
import { BETS, BET_KINDS, getBet, isSpecial, tableCell } from '../core/bets.js';
import { DOUBLE_ZERO, RED_NUMBERS, numberLabel } from '../core/wheel.js';

// The betting layout in "layout units" (one number cell = 1 unit). Zero sits
// on the player's left and numbers run away to the right in 12 streets; the
// far row holds 3, 6, 9… and the outside bets sit nearest the player.
//
//   x: 0 zero | 1–13 numbers | 13–14 "2 to 1" columns
//   y: 0–3 number rows (far → near) | 3–3.8 dozens | 3.8–4.6 even-money bets
//
// On the American wheel (doc 7.2) the zero's cell splits: 00 on the far
// half, beside 3, and 0 on the near half, beside 1, with 2 between them.
//
// Beyond the numbers, on the far side, runs the racetrack (Phase 7): a zone
// for each special bet, at y from TRACK.y0 to TRACK.y1 (negative: further
// from the player than row 0). Closed zones are drawn dark. Every neighbours
// bet shares the Neighbours zone and every finale the Finales zone: a tap
// there asks which number (game.js).

export const LAYOUT_W = 14;
export const LAYOUT_H = 4.6;
const MARGIN = 0.4;
// Tall enough for a finger in the phone's close-up.
export const TRACK = { y0: -1.45, y1: -0.15 };
// The layout's own top, past the racetrack: canvas y = (y + MARGIN + TOP) px.
const TOP = 1.55;
export const TRACK_ZONES = [
  { kind: 'neighbours', x0: 1, x1: 3.1, label: 'NEIGHBOURS' },
  { kind: 'finale', x0: 3.1, x1: 5, label: 'FINALES' },
  { kind: 'voisins', x0: 5, x1: 7.4, label: 'VOISINS' },
  { kind: 'tiers', x0: 7.4, x1: 9.4, label: 'TIERS' },
  { kind: 'orphelins', x0: 9.4, x1: 11.6, label: 'ORPHELINS' },
  { kind: 'jeuZero', x0: 11.6, x1: 13.2, label: 'JEU ZÉRO' },
  { kind: 'snake', x0: 13.2, x1: 14.4, label: 'SNAKE' },
];
const zoneOf = (kind) => TRACK_ZONES.find((z) => z.kind === kind);
const NUMBERS_BOTTOM = 3;
const DOZEN_BOTTOM = 3.8;

let doubleZero = false;

/** Centre of a number's cell in layout units. */
export function cellCenter(n) {
  if (n === 0) return { x: 0.5, y: doubleZero ? 2.25 : 1.5 };
  if (n === DOUBLE_ZERO) return { x: 0.5, y: 0.75 };
  const { col, row } = tableCell(n);
  return { x: 1.5 + col, y: 2.5 - row };
}

function cellRect(n) {
  if (n === 0) return doubleZero ? { x0: 0, y0: 1.5, x1: 1, y1: 3 } : { x0: 0, y0: 0, x1: 1, y1: 3 };
  if (n === DOUBLE_ZERO) return { x0: 0, y0: 0, x1: 1, y1: 1.5 };
  const c = cellCenter(n);
  return { x0: c.x - 0.5, y0: c.y - 0.5, x1: c.x + 0.5, y1: c.y + 0.5 };
}

const EVEN_MONEY_ORDER = ['low', 'even', 'red', 'black', 'odd', 'high'];

// The zero's splits sit on the line between its cell and the number's. With
// a 00, 0 touches 1 and 2, 00 touches 2 and 3, and 0–00 sits between them.
const ZERO_SPLITS = {
  single: { 'split:0-1': 2.5, 'split:0-2': 1.5, 'split:0-3': 0.5 },
  double: { 'split:0-1': 2.5, 'split:0-2': 1.75, 'split:2-37': 1.25, 'split:3-37': 0.5 },
};

/**
 * Where each bet's chip sits. Inside bets between cells are points (with a
 * small hit radius); straight-ups and outside bets are boxes. Bets with 00
 * have spots only on the American wheel; the zero's splits follow it.
 */
function buildSpots() {
  const spots = new Map();
  const avg = (ns) => {
    const cs = ns.map(cellCenter);
    return { x: cs.reduce((a, c) => a + c.x, 0) / cs.length, y: cs.reduce((a, c) => a + c.y, 0) / cs.length };
  };
  const zeroSplits = ZERO_SPLITS[doubleZero ? 'double' : 'single'];
  for (const bet of BETS) {
    const ns = bet.numbers;
    if (!doubleZero && ns.includes(DOUBLE_ZERO)) continue;
    if (isSpecial(bet.kind)) {
      // A racetrack zone: every bet of the kind sits on it.
      const z = zoneOf(bet.kind);
      const rect = { x0: z.x0, y0: TRACK.y0, x1: z.x1, y1: TRACK.y1 };
      spots.set(bet.id, { type: 'box', x: (z.x0 + z.x1) / 2, y: (TRACK.y0 + TRACK.y1) / 2, rect, track: true });
      continue;
    }
    switch (bet.kind) {
      case 'straight': {
        const r = cellRect(ns[0]);
        spots.set(bet.id, { type: 'box', ...cellCenter(ns[0]), rect: r });
        break;
      }
      case 'split':
        if (bet.id === 'split:0-37') spots.set(bet.id, { type: 'point', x: 0.5, y: 1.5 });
        else if (bet.id in ZERO_SPLITS.single || bet.id in ZERO_SPLITS.double) {
          if (bet.id in zeroSplits) spots.set(bet.id, { type: 'point', x: 1, y: zeroSplits[bet.id] });
        } else spots.set(bet.id, { type: 'point', ...avg(ns) });
        break;
      case 'corner':
        spots.set(bet.id, { type: 'point', ...avg(ns) });
        break;
      case 'street':
        spots.set(bet.id, { type: 'point', x: cellCenter(ns[0]).x, y: NUMBERS_BOTTOM });
        break;
      case 'sixLine':
        spots.set(bet.id, { type: 'point', x: cellCenter(ns[0]).x + 0.5, y: NUMBERS_BOTTOM });
        break;
      case 'firstFour':
        spots.set(bet.id, { type: 'point', x: 1, y: NUMBERS_BOTTOM });
        break;
      case 'dozen': {
        const d = Number(bet.id.split(':')[1]) - 1;
        const rect = { x0: 1 + 4 * d, y0: NUMBERS_BOTTOM, x1: 5 + 4 * d, y1: DOZEN_BOTTOM };
        spots.set(bet.id, { type: 'box', x: (rect.x0 + rect.x1) / 2, y: (rect.y0 + rect.y1) / 2, rect });
        break;
      }
      case 'column': {
        const row = Number(bet.id.split(':')[1]) - 1;
        const rect = { x0: 13, y0: 2 - row, x1: 14, y1: 3 - row };
        spots.set(bet.id, { type: 'box', x: 13.5, y: 2.5 - row, rect });
        break;
      }
      default: {
        const i = EVEN_MONEY_ORDER.indexOf(bet.kind);
        const rect = { x0: 1 + 2 * i, y0: DOZEN_BOTTOM, x1: 3 + 2 * i, y1: LAYOUT_H };
        spots.set(bet.id, { type: 'box', x: (rect.x0 + rect.x1) / 2, y: (rect.y0 + rect.y1) / 2, rect });
      }
    }
  }
  return spots;
}

export let SPOTS = buildSpots();
let POINT_SPOTS = [...SPOTS].filter(([, s]) => s.type === 'point');
let BOX_SPOTS = [...SPOTS].filter(([, s]) => s.type === 'box');

/** The felt for a wheel with a 00 (the American) or without: its spots are rebuilt. */
function layoutFor(withDoubleZero) {
  if (withDoubleZero === doubleZero) return false;
  doubleZero = withDoubleZero;
  SPOTS = buildSpots();
  POINT_SPOTS = [...SPOTS].filter(([, s]) => s.type === 'point');
  BOX_SPOTS = [...SPOTS].filter(([, s]) => s.type === 'box');
  return true;
}
const POINT_RADIUS = 0.2;

/** The bet under a point on the layout, or null. */
export function betAt(x, y) {
  let best = null;
  let bestD = POINT_RADIUS;
  for (const [id, s] of POINT_SPOTS) {
    const d = Math.hypot(x - s.x, y - s.y);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  if (best) return best;
  for (const [id, s] of BOX_SPOTS) {
    const r = s.rect;
    if (x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1) return id;
  }
  return null;
}

/** "Split 17–20 · pays 18×" for tooltips. */
export function describeBet(betId) {
  const bet = getBet(betId);
  return { title: bet.label, odds: BET_KINDS[bet.kind].odds };
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

const COLORS = {
  felt: '#5a1a1d',
  feltDark: '#2e0b0d',
  line: '#e0cc98',
  ink: '#f3ecdc',
  red: '#b3181d',
  black: '#141212',
  green: '#1c7a43',
};
// The felt's mark for each pocket enhancement (doc 6.5), as on the wheel.
const ENH_DOT = {
  gilded: '#e2b45a',
  platinum: '#eef2f6',
  glass: '#a9dcf2',
  bone: '#e2d6b6',
  ember: '#ff7a1c',
  lucky: '#4fae5d',
  cursed: '#6f9c4e',
};

export class FeltCanvas {
  constructor({ width = 2048 } = {}) {
    this.px = width / (LAYOUT_W + 2 * MARGIN);
    this.width = width;
    this.height = Math.round((LAYOUT_H + TOP + 2 * MARGIN) * this.px);
    // Smaller than before the racetrack (0.075), so the felt still fits the table.
    this.metersPerUnit = 0.068;
    this.trackOpen = new Set();

    // The felt and its lines are drawn once; the numbers follow the wheel
    // (doc 5.4): its paint, "×2" for a number with two pockets, a struck-out
    // number no pocket carries, a mark for each enhancement.
    this.ground = document.createElement('canvas');
    this.ground.width = this.width;
    this.ground.height = this.height;
    this._drawBase(this.ground.getContext('2d'));
    this.base = document.createElement('canvas');
    this.base.width = this.width;
    this.base.height = this.height;
    this.numbersKey = null;
    this.setNumbers(null);

    this.texture = new THREE.CanvasTexture(this.base);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;

    // Highlights live on a second, transparent layer so hovering never
    // re-uploads the full felt.
    this.overlay = document.createElement('canvas');
    this.overlay.width = this.width / 2;
    this.overlay.height = Math.round(this.height / 2);
    this.overlayTexture = new THREE.CanvasTexture(this.overlay);
    this.overlayTexture.colorSpace = THREE.SRGBColorSpace;
  }

  /** Felt size in metres (including the margin and the racetrack). */
  get size() {
    return {
      w: (LAYOUT_W + 2 * MARGIN) * this.metersPerUnit,
      h: (LAYOUT_H + TOP + 2 * MARGIN) * this.metersPerUnit,
    };
  }

  /** Layout units → felt-local metres (x right, z toward the player). */
  toLocal(x, y) {
    return { x: (x - LAYOUT_W / 2) * this.metersPerUnit, z: (y - (LAYOUT_H - TOP) / 2) * this.metersPerUnit };
  }

  /** Felt-local metres → layout units. */
  toLayout(x, z) {
    return { x: x / this.metersPerUnit + LAYOUT_W / 2, y: z / this.metersPerUnit + (LAYOUT_H - TOP) / 2 };
  }

  /** Layout units → pixels on the felt's canvas. */
  toCanvas(x, y) {
    return { x: this._u(x), y: this._u(y + TOP) };
  }

  _u(v) {
    return (v + MARGIN) * this.px;
  }

  _drawBase(ctx) {
    const { width: W, height: H, px } = this;
    const u = (v) => this._u(v);

    // Felt: a dark wine ground with a faint nap and darker edges.
    ctx.fillStyle = COLORS.felt;
    ctx.fillRect(0, 0, W, H);
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    let seed = 1234567;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < d.length; i += 4) {
      const n = (rnd() - 0.5) * 18;
      d[i] += n;
      d[i + 1] += n * 0.5;
      d[i + 2] += n * 0.5;
    }
    ctx.putImageData(img, 0, 0);
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.6);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(10,0,0,0.45)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
    // Everything below is drawn in layout units with the racetrack above row 0.
    ctx.save();
    ctx.translate(0, TOP * px);

    const lw = Math.max(2, px * 0.03);
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';

    // Zero: a pointed cell, as on a real table; split at its point for a 00.
    ctx.beginPath();
    ctx.moveTo(u(1), u(0));
    ctx.lineTo(u(0.35), u(0));
    ctx.lineTo(u(0), u(1.5));
    ctx.lineTo(u(0.35), u(3));
    ctx.lineTo(u(1), u(3));
    ctx.stroke();
    if (doubleZero) this._line(ctx, u(0), u(1.5), u(1), u(1.5));

    // Number grid, columns and outside boxes.
    for (let c = 0; c <= 13; c++) this._line(ctx, u(1 + c), u(0), u(1 + c), u(3));
    for (let r = 0; r <= 3; r++) this._line(ctx, u(1), u(r), u(14), u(r));
    this._line(ctx, u(14), u(0), u(14), u(3));
    this._line(ctx, u(1), u(DOZEN_BOTTOM), u(13), u(DOZEN_BOTTOM));
    this._line(ctx, u(1), u(LAYOUT_H), u(13), u(LAYOUT_H));
    for (let k = 0; k <= 3; k++) this._line(ctx, u(1 + 4 * k), u(3), u(1 + 4 * k), u(DOZEN_BOTTOM));
    for (let k = 0; k <= 6; k++) this._line(ctx, u(1 + 2 * k), u(DOZEN_BOTTOM), u(1 + 2 * k), u(LAYOUT_H));

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // "2 to 1" on each column box, turned to read along the box.
    ctx.font = `500 ${Math.round(px * 0.26)}px Oswald, "Arial Narrow", sans-serif`;
    ctx.fillStyle = COLORS.line;
    for (let r = 0; r < 3; r++) {
      ctx.save();
      ctx.translate(u(13.5), u(2.5 - r));
      ctx.rotate(-Math.PI / 2);
      ctx.fillText('2 to 1', 0, 0);
      ctx.restore();
    }

    ctx.font = `500 ${Math.round(px * 0.32)}px Oswald, "Arial Narrow", sans-serif`;
    ['1st 12', '2nd 12', '3rd 12'].forEach((t, i) => ctx.fillText(t, u(3 + 4 * i), u(3.42)));

    const labels = { low: '1–18', even: 'EVEN', odd: 'ODD', high: '19–36' };
    EVEN_MONEY_ORDER.forEach((kind, i) => {
      const cx = u(2 + 2 * i);
      const cy = u(4.22);
      if (kind === 'red' || kind === 'black') {
        this._diamond(ctx, cx, cy, px * 0.62, px * 0.34, kind === 'red' ? COLORS.red : COLORS.black);
      } else {
        ctx.fillStyle = COLORS.line;
        ctx.fillText(labels[kind], cx, cy);
      }
    });

    // A double rule round the whole layout, the racetrack inside it.
    ctx.lineWidth = lw * 0.6;
    ctx.strokeRect(u(-0.2), u(TRACK.y0 - 0.2), u(LAYOUT_W + 0.2) - u(-0.2), u(LAYOUT_H + 0.2) - u(TRACK.y0 - 0.2));
    ctx.restore();
  }

  /**
   * The racetrack: an oval band of zones, each lettered with its bet. A
   * closed zone (nothing in the run opens it) sinks into the dark.
   */
  _drawTrack(ctx) {
    const { px } = this;
    const u = (v) => this._u(v);
    const lw = Math.max(2, px * 0.03);
    const y0 = u(TRACK.y0);
    const y1 = u(TRACK.y1);
    const h = y1 - y0;
    ctx.save();
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.roundRect(u(TRACK_ZONES[0].x0), y0, u(TRACK_ZONES.at(-1).x1) - u(TRACK_ZONES[0].x0), h, h / 2);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    TRACK_ZONES.forEach((z, i) => {
      const open = this.trackOpen.has(z.kind);
      const x0 = u(z.x0);
      const x1 = u(z.x1);
      if (i) this._line(ctx, x0, y0, x0, y1);
      if (!open) {
        // Closed: dark, with a brass crosshatch over the name.
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(u(TRACK_ZONES[0].x0), y0, u(TRACK_ZONES.at(-1).x1) - u(TRACK_ZONES[0].x0), h, h / 2);
        ctx.clip();
        ctx.fillStyle = 'rgba(8, 3, 3, 0.55)';
        ctx.fillRect(x0, y0, x1 - x0, h);
        ctx.strokeStyle = 'rgba(224, 204, 152, 0.12)';
        ctx.lineWidth = Math.max(1, px * 0.012);
        for (let t = x0 - h; t < x1; t += px * 0.18) this._line(ctx, t, y1, t + h, y0);
        ctx.restore();
      }
      ctx.font = `600 ${Math.round(px * (z.label.length > 8 ? 0.26 : 0.3))}px Oswald, "Arial Narrow", sans-serif`;
      ctx.fillStyle = open ? COLORS.ink : 'rgba(224, 204, 152, 0.35)';
      ctx.fillText(z.label, (x0 + x1) / 2, (y0 + y1) / 2 - (open ? px * 0.1 : 0));
      if (open) {
        ctx.font = `500 ${Math.round(px * 0.2)}px Oswald, "Arial Narrow", sans-serif`;
        ctx.fillStyle = COLORS.line;
        const odds = z.kind === 'finale' ? '9–12' : String(BET_KINDS[z.kind].odds);
        ctx.fillText(`pays ${odds}`, (x0 + x1) / 2, (y0 + y1) / 2 + px * 0.24);
      }
    });
    ctx.restore();
  }

  /** The special bets open this run (a set of kinds): the racetrack lights them. */
  setTrack(open) {
    const next = new Set(open);
    if ([...next].sort().join() === [...this.trackOpen].sort().join()) return false;
    this.trackOpen = next;
    this.numbersKey = null;
    this.setNumbers(this.lastNumbers ?? null);
    return true;
  }

  /**
   * Redraws the numbers for the wheel as it is (selectors' numbersView
   * `numbers`: each with the pockets that carry it), or the House's own
   * wheel for null. Does nothing when nothing on the felt would change.
   */
  setNumbers(numbers) {
    const list = numbers ?? Array.from({ length: 37 }, (_, n) => ({ number: n, pockets: [{ color: n === 0 ? 'green' : RED_NUMBERS.has(n) ? 'red' : 'black', enh: null }] }));
    // A 00 among the numbers (the American wheel) splits the zero's cell.
    if (layoutFor(list.length > DOUBLE_ZERO)) {
      this._drawBase(this.ground.getContext('2d'));
      this.numbersKey = null;
    }
    this.lastNumbers = numbers;
    const key = JSON.stringify(list.map((x) => x.pockets.map((p) => [p.color, p.enh])));
    if (key === this.numbersKey) return false;
    this.numbersKey = key;
    const ctx = this.base.getContext('2d');
    ctx.drawImage(this.ground, 0, 0);
    const px = this.px;
    const u = (v) => this._u(v);
    ctx.save();
    ctx.translate(0, TOP * px);
    this._drawTrack(ctx);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const { number: n, pockets } of list) {
      const c = cellCenter(n);
      const zero = n === 0 || n === DOUBLE_ZERO;
      const bw = (zero ? 0.62 : 0.66) * px;
      const bh = (zero ? (doubleZero ? 0.9 : 1.0) : 0.62) * px;
      const x = u(c.x);
      const y = u(c.y);
      ctx.font = `600 ${Math.round(px * 0.4)}px Oswald, "Arial Narrow", sans-serif`;
      if (!pockets.length) {
        // No pocket reads this number any more: a ghost of the badge, struck out.
        ctx.save();
        ctx.strokeStyle = 'rgba(224, 204, 152, 0.35)';
        ctx.lineWidth = Math.max(2, px * 0.025);
        ctx.setLineDash([px * 0.06, px * 0.05]);
        ctx.beginPath();
        ctx.roundRect(x - bw / 2, y - bh / 2, bw, bh, Math.min(bw, bh) * 0.32);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(243, 236, 220, 0.3)';
        ctx.fillText(numberLabel(n), x, y + px * 0.02);
        ctx.strokeStyle = 'rgba(224, 204, 152, 0.6)';
        ctx.beginPath();
        ctx.moveTo(x - bw * 0.42, y + bh * 0.3);
        ctx.lineTo(x + bw * 0.42, y - bh * 0.3);
        ctx.stroke();
        ctx.restore();
        continue;
      }
      // The badge in its paint; split down the middle when its pockets differ.
      const colors = [...new Set(pockets.map((p) => p.color))];
      this._badge(ctx, x, y, bw, bh, COLORS[colors[0]] ?? COLORS.black, COLORS[colors[1]] ?? null);
      ctx.fillStyle = COLORS.ink;
      ctx.fillText(numberLabel(n), x, y + px * 0.02);
      if (pockets.length > 1) {
        ctx.font = `600 ${Math.round(px * 0.2)}px Oswald, "Arial Narrow", sans-serif`;
        ctx.fillStyle = COLORS.line;
        ctx.fillText(`×${pockets.length}`, x + px * 0.32, y - (zero ? bh * 0.6 : px * 0.36));
      }
      // A dot for each enhanced pocket, along the cell's foot.
      const marks = pockets.map((p) => p.enh).filter((e) => ENH_DOT[e]);
      marks.forEach((e, i) => {
        const dx = (i - (marks.length - 1) / 2) * px * 0.15;
        const dy = zero ? bh * 0.6 : px * 0.39;
        ctx.save();
        ctx.fillStyle = ENH_DOT[e];
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.lineWidth = px * 0.015;
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, px * 0.055, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      });
    }
    ctx.restore();
    if (this.texture) this.texture.needsUpdate = true;
    return true;
  }

  _line(ctx, x0, y0, x1, y1) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  _badge(ctx, cx, cy, w, h, fill, second = null) {
    const r = Math.min(w, h) * 0.32;
    ctx.save();
    ctx.fillStyle = fill;
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = h * 0.08;
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, cy - h / 2, w, h, r);
    ctx.fill();
    if (second) {
      ctx.shadowBlur = 0;
      ctx.clip();
      ctx.fillStyle = second;
      ctx.fillRect(cx, cy - h / 2, w / 2, h);
    }
    ctx.restore();
  }

  _diamond(ctx, cx, cy, w, h, fill) {
    ctx.save();
    ctx.fillStyle = fill;
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = Math.max(2, this.px * 0.02);
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, cy);
    ctx.lineTo(cx, cy - h / 2);
    ctx.lineTo(cx + w / 2, cy);
    ctx.lineTo(cx, cy + h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Light up the numbers a bet covers (hover) and/or a landed number (result).
   * `numbers` is a list of numbers; `spot` optionally marks the chip position.
   */
  highlight({ numbers = [], spotId = null, result = null, foreseen = null, pick = null } = {}) {
    const ctx = this.overlay.getContext('2d');
    const s = 0.5; // overlay is half resolution
    const u = (v) => this._u(v) * s;
    const px = this.px * s;
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    ctx.save();
    ctx.translate(0, TOP * px);
    if (pick && !pick.all) {
      // Choosing where wheel work goes: the felt sinks into the dark but for
      // the numbers it can act on; the ones already chosen wear a bone ring.
      ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
      ctx.fillRect(0, -TOP * px, this.overlay.width, this.overlay.height);
      ctx.strokeStyle = 'rgba(243, 223, 176, 0.9)';
      ctx.lineWidth = Math.max(1.5, px * 0.04);
      for (const n of pick.valid) {
        const r = cellRect(n);
        ctx.clearRect(u(r.x0), u(r.y0), (r.x1 - r.x0) * px, (r.y1 - r.y0) * px);
        ctx.strokeRect(u(r.x0) + 2, u(r.y0) + 2, (r.x1 - r.x0) * px - 4, (r.y1 - r.y0) * px - 4);
      }
      ctx.save();
      ctx.strokeStyle = 'rgba(237, 229, 211, 1)';
      ctx.lineWidth = px * 0.07;
      for (const n of pick.chosen ?? []) {
        const c = cellCenter(n);
        ctx.beginPath();
        ctx.arc(u(c.x), u(c.y), px * 0.42, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.fillStyle = 'rgba(255, 236, 190, 0.22)';
    ctx.strokeStyle = 'rgba(255, 236, 190, 0.85)';
    ctx.lineWidth = Math.max(1.5, px * 0.035);
    for (const n of numbers) {
      const r = cellRect(n);
      ctx.fillRect(u(r.x0), u(r.y0), (r.x1 - r.x0) * px, (r.y1 - r.y0) * px);
      ctx.strokeRect(u(r.x0) + 1, u(r.y0) + 1, (r.x1 - r.x0) * px - 2, (r.y1 - r.y0) * px - 2);
    }
    if (spotId) {
      const sp = SPOTS.get(spotId);
      if (sp.type === 'box' && !numbers.length) {
        const r = sp.rect;
        ctx.fillRect(u(r.x0), u(r.y0), (r.x1 - r.x0) * px, (r.y1 - r.y0) * px);
      }
    }
    if (foreseen !== null) {
      // The Glass Eye's number: a slow bone ring with an eye drawn above it.
      const r = cellRect(foreseen);
      const cx = u((r.x0 + r.x1) / 2);
      const cy = u((r.y0 + r.y1) / 2);
      const rad = Math.min((r.x1 - r.x0) * px, (r.y1 - r.y0) * px) * 0.62;
      ctx.save();
      ctx.strokeStyle = 'rgba(237, 229, 211, 0.95)';
      ctx.lineWidth = px * 0.07;
      ctx.setLineDash([px * 0.18, px * 0.1]);
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = px * 0.05;
      ctx.beginPath();
      ctx.ellipse(cx, cy - rad * 1.25, rad * 0.55, rad * 0.28, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(196, 154, 82, 1)';
      ctx.beginPath();
      ctx.arc(cx, cy - rad * 1.25, rad * 0.16, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    if (result !== null) {
      const r = cellRect(result);
      ctx.save();
      ctx.shadowColor = 'rgba(255, 230, 160, 1)';
      ctx.shadowBlur = px * 0.5;
      ctx.strokeStyle = 'rgba(255, 244, 214, 1)';
      ctx.lineWidth = px * 0.08;
      ctx.strokeRect(u(r.x0) + 2, u(r.y0) + 2, (r.x1 - r.x0) * px - 4, (r.y1 - r.y0) * px - 4);
      ctx.restore();
    }
    ctx.restore();
    this.overlayTexture.needsUpdate = true;
  }
}

/**
 * Numbers to light up when a bet is hovered. Colour bets light the numbers
 * painted their colour (`numbers`: selectors' numbersView), as the paint
 * decides what they win.
 */
export function numbersFor(betId, numbers = null) {
  const bet = getBet(betId);
  const color = BET_KINDS[bet.kind].color;
  if (!color || !numbers) return bet.numbers;
  return numbers.filter((x) => x.pockets.some((p) => p.color === color)).map((x) => x.number);
}
