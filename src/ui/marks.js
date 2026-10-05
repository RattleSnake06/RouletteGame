// Procedural wall marks for the HUD (design doc 8.4): scratches, tallies, chalk
// loops and brush swipes. Each mark is generated from a seed, so the same mark
// always looks the same and the game ships no image files.
//
// A mark is a small self-contained SVG with its own roughening filter, used as
// an <img>. The browser rasterises it once and reuses the bitmap, so no SVG
// filter runs while the HUD animates (the Steam Deck budget).

export const INK = {
  bone: '#ede5d3',
  boneDim: '#b3a993',
  blood: '#dc2a33',
  bloodDeep: '#8e1219',
  brass: '#c49a52',
  soot: '#050404',
  green: '#45c27a',
};

/** Park–Miller: tiny, seedable, and plenty for the jitter in a scratch. */
export function rng(seed) {
  let s = Math.floor(Math.abs(seed)) % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** A stable seed from a string, so a mark for 'Space' always looks the same. */
export function seedOf(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % 2147483646 || 1;
}

const f = (n) => n.toFixed(1);
const PAD = 8; // room for the filters' displacement around every mark

const FILTERS = {
  // A scratch is a pale line with a dark groove beside it.
  gouge: `<filter id="m" x="-20%" y="-20%" width="140%" height="140%">
    <feTurbulence type="fractalNoise" baseFrequency="0.5" numOctaves="1" seed="4" result="g"/>
    <feDisplacementMap in="SourceGraphic" in2="g" scale="1.6" xChannelSelector="R" yChannelSelector="G" result="r"/>
    <feOffset in="SourceAlpha" dx="1.4" dy="1.6" result="o"/>
    <feFlood flood-color="#000" flood-opacity="0.9"/>
    <feComposite in2="o" operator="in" result="groove"/>
    <feMerge><feMergeNode in="groove"/><feMergeNode in="r"/></feMerge>
  </filter>`,
  // A loaded brush: ragged edges, bristle streaks running along the stroke.
  brush: `<filter id="m" x="-8%" y="-40%" width="116%" height="180%">
    <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="2" result="warp"/>
    <feDisplacementMap in="SourceGraphic" in2="warp" scale="9" xChannelSelector="R" yChannelSelector="G" result="rag"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.006 0.42" numOctaves="3" seed="8" result="bristle"/>
    <feColorMatrix in="bristle" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -4.2 0 0 0 3.05" result="dry"/>
    <feComposite in="rag" in2="dry" operator="in"/>
  </filter>`,
  // A soft smear of soot: the bed red text sits on over the lit felt or wheel.
  smear: `<filter id="m" x="-20%" y="-60%" width="140%" height="220%">
    <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="6" result="warp"/>
    <feDisplacementMap in="SourceGraphic" in2="warp" scale="14" xChannelSelector="R" yChannelSelector="G" result="rag"/>
    <feGaussianBlur in="rag" stdDeviation="11"/>
  </filter>`,
};

// `stretch` lets CSS squash the mark to any box (soft smears, dotted leaders).
function svg(w, h, filter, body, { stretch = false } = {}) {
  const W = Math.ceil(w + PAD * 2);
  const H = Math.ceil(h + PAD * 2);
  const fit = stretch ? ' preserveAspectRatio="none"' : '';
  return {
    w: W,
    h: H,
    markup:
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${-PAD} ${-PAD} ${W} ${H}"${fit}>` +
      `<defs>${FILTERS[filter] ?? ''}</defs><g${filter ? ' filter="url(#m)"' : ''}>${body}</g></svg>`,
  };
}

// ---- Strokes ------------------------------------------------------------------

/** A gouge: a tapered, slightly bowed, jittered polygon from (x1,y1) to (x2,y2). */
export function scratch(x1, y1, x2, y2, w, r, { bow = 0.05, n = 12 } = {}) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const b = (r() - 0.5) * len * bow * 2;
  const L = [];
  const R = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // Pressure builds fast, peaks early, trails off in a flick.
    const taper = Math.pow(Math.sin(Math.PI * (0.06 + 0.88 * t)), 0.45) * (1 - 0.4 * t);
    const ww = w * taper * (0.7 + 0.6 * r());
    const off = b * Math.sin(Math.PI * t) + (r() - 0.5) * w * 0.3;
    const cx = x1 + dx * t + nx * off;
    const cy = y1 + dy * t + ny * off;
    L.push([cx + (nx * ww) / 2, cy + (ny * ww) / 2]);
    R.push([cx - (nx * ww) / 2, cy - (ny * ww) / 2]);
  }
  const pts = [[x1 - ux * w * 0.4, y1 - uy * w * 0.4], ...L, [x2 + ux * w * 1.2, y2 + uy * w * 1.2], ...R.reverse()];
  return 'M' + pts.map((p) => `${f(p[0])},${f(p[1])}`).join('L') + 'Z';
}

/** A chalk loop: one and a bit turns, never closing cleanly. */
function loop(cx, cy, rx, ry, r, turns = 1.18) {
  const n = Math.round(40 * turns);
  const a0 = r() * Math.PI * 2;
  const tilt = (r() - 0.5) * 0.35;
  let d = '';
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = a0 + t * turns * Math.PI * 2;
    const k = 1 + (r() - 0.5) * 0.05 + 0.1 * (t - 0.5);
    const x0 = Math.cos(a) * rx * k;
    const y0 = Math.sin(a) * ry * k;
    const x = cx + x0 * Math.cos(tilt) - y0 * Math.sin(tilt);
    const y = cy + x0 * Math.sin(tilt) + y0 * Math.cos(tilt);
    d += (i ? 'L' : 'M') + `${f(x)},${f(y)}`;
  }
  return d;
}

/** A brush dragged left to right, running dry at the end. */
function swipe(w, h, r, { slope = -0.12 } = {}) {
  const n = 28;
  const top = [];
  const bot = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = t * w;
    const load = Math.min(1, t * 6) * (t > 0.7 ? 1 - (t - 0.7) * 2.2 : 1);
    const thick = h * (0.45 + 0.55 * load);
    const mid = h / 2 + (t - 0.5) * w * slope + Math.sin(t * 5.3 + r()) * h * 0.05;
    top.push([x, mid - thick / 2 + (r() - 0.5) * h * 0.1]);
    bot.push([x + (r() - 0.5) * 4, mid + thick / 2 + (r() - 0.5) * h * 0.14]);
  }
  return 'M' + [...top, ...bot.reverse()].map((p) => `${f(p[0])},${f(p[1])}`).join('L') + 'Z';
}

/** SVG path data for a swipe or a loop, for painting marks onto canvases too. */
export const swipePath = (w, h, seed, opts) => swipe(w, h, rng(seed), opts);
export const loopPath = (cx, cy, rx, ry, seed, turns) => loop(cx, cy, rx, ry, rng(seed), turns);

const path = (d, fill, extra = '') => `<path d="${d}" fill="${fill}"${extra}/>`;

// ---- Marks ----------------------------------------------------------------------

/**
 * A prisoner's tally for the night's spins: the spins still to come in gates of
 * five, the spent ones as ghost marks struck through in red.
 */
export function tally(left, total, seed, { color = INK.bone, h = 40, gap = 12, w = 4.4 } = {}) {
  const r = rng(seed);
  const spent = Math.max(0, total - left);
  const parts = [];
  let x = 4;
  for (let i = 0; i < left; i++) {
    if (i % 5 === 4) {
      // The fifth mark is the strike across the four before it.
      parts.push(path(scratch(x - gap * 4 - 4, h * 0.86, x - gap + 6, h * 0.12, w * 0.95, r, { bow: 0.04 }), color));
      x += gap * 0.9;
      continue;
    }
    const lean = (r() - 0.5) * 6;
    parts.push(path(scratch(x + lean * 0.4, h * (0.02 + r() * 0.06), x - lean * 0.4, h * (0.96 - r() * 0.06), w, r), color));
    x += gap;
  }
  if (left && spent) x += gap * 0.9;
  const sx0 = x;
  for (let i = 0; i < spent; i++) {
    const lean = (r() - 0.5) * 6;
    parts.push(path(scratch(x + lean * 0.4, h * (0.1 + r() * 0.06), x - lean * 0.4, h * (0.94 - r() * 0.06), w * 0.8, r), INK.bone, ' opacity="0.45"'));
    x += gap * 0.85;
  }
  if (spent) {
    // Used spins are crossed out, the way you cross out a day that's gone.
    parts.push(path(scratch(sx0 - 7, h * 0.72, x - gap * 0.85 + 9, h * 0.3, w * 0.85, r, { bow: 0.03 }), INK.blood));
  }
  return svg(Math.max(x + 6, 10), h, 'gouge', parts.join(''));
}

/** A coin stack, scratched: two lower rims and the top coin whole. */
export function coinGlyph(size, seed = 3) {
  const r = rng(seed);
  const c = size / 2;
  const rx = size * 0.42;
  const ry = size * 0.17;
  let body = `<g fill="none" stroke="${INK.bone}" stroke-linecap="round">`;
  for (const [dy, o] of [
    [size * 0.3, 0.7],
    [size * 0.15, 0.85],
  ]) {
    let d = '';
    for (let i = 0; i <= 14; i++) {
      const a = (i / 14) * Math.PI;
      d += (i ? 'L' : 'M') + `${f(c + Math.cos(a) * rx * (1 + (r() - 0.5) * 0.04))},${f(c - size * 0.08 + dy + Math.sin(a) * ry)}`;
    }
    body += `<path d="${d}" stroke-width="${f(size * 0.075)}" opacity="${o}"/>`;
  }
  body += `<path d="${loop(c, c - size * 0.08, rx, ry, r, 1.12)}" stroke-width="${f(size * 0.08)}"/>`;
  body += `<path d="${loop(c, c - size * 0.08, rx * 0.45, ry * 0.42, r, 1.0)}" stroke-width="${f(size * 0.05)}" opacity="0.6"/></g>`;
  return svg(size, size, 'gouge', body);
}

/** A token: a hexagon scratched in six strokes that overshoot their corners. */
export function hexGlyph(size, seed = 5) {
  const r = rng(seed);
  const c = size / 2;
  const R = size * 0.44;
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    pts.push([c + Math.cos(a) * R + (r() - 0.5) * 1.5, c + Math.sin(a) * R + (r() - 0.5) * 1.5]);
  }
  let body = '';
  for (let i = 0; i < 6; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % 6];
    const ex = (x2 - x1) * 0.12;
    const ey = (y2 - y1) * 0.12;
    body += path(scratch(x1 - ex, y1 - ey, x2 + ex, y2 + ey, size * 0.1, r, { bow: 0.02, n: 6 }), INK.brass);
  }
  body += path(scratch(c - R * 0.2, c - R * 0.35, c + R * 0.15, c + R * 0.38, size * 0.07, r, { n: 5 }), INK.brass, ' opacity="0.7"');
  return svg(size, size, 'gouge', body);
}

/** A swipe of paint behind a value. */
export function swipeMark(w, h, seed = 7, color = INK.bloodDeep, opts) {
  return svg(w, h, 'brush', path(swipe(w, h, rng(seed), opts), color));
}

/** A smear of soot, wider than it is tall: a bed for words over bright things. */
export function smearMark(w, h, seed = 11) {
  const r = rng(seed);
  let body = '';
  // Strokes kept well inside the box, so the blur fades out before the edges.
  for (let i = 0; i < 3; i++) {
    const inset = w * 0.06 + i * h * 0.14;
    const sh = h * (0.5 - i * 0.08);
    body += path(swipe(w - inset * 2, sh, r, { slope: -0.02 }), INK.soot, ` opacity="${0.6 + i * 0.18}" transform="translate(${f(inset)} ${f((h - sh) / 2)})"`);
  }
  return svg(w, h, 'smear', body, { stretch: true });
}

/** A single long scratch: rules, underlines, strikes and leaders. */
export function lineMark(w, h, seed = 9, color = INK.bone, width = 3, opts = {}) {
  const r = rng(seed);
  const y0 = opts.y0 ?? h / 2;
  const y1 = opts.y1 ?? h / 2;
  let body = path(scratch(2, y0, w - 4, y1, width, r, { bow: opts.bow ?? 0.01, n: 24 }), color, ` opacity="${opts.o ?? 1}"`);
  if (opts.double) body += path(scratch(10, y0 + 4, w - 30, y1 + 3, width * 0.45, r, { bow: 0.01, n: 18 }), color, ' opacity="0.45"');
  return svg(w, h, 'gouge', body, { stretch: opts.stretch });
}

/** A chalk loop around a word. */
export function loopMark(w, h, seed = 13, color = INK.blood, width = 2.6) {
  const d = loop(w / 2, h / 2, w / 2 - 3, h / 2 - 3, rng(seed));
  return svg(w, h, 'gouge', `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`);
}

/** An arrow gouged into the wall. */
export function arrowMark(w, h, seed = 17, dir = 'left') {
  const r = rng(seed);
  const y = h / 2;
  let body =
    path(scratch(w - 4, y + 2, 8, y - 1, 4, r, { bow: 0.03, n: 16 }), INK.bone) +
    path(scratch(26, y - h * 0.42, 6, y - 1, 3.6, r, { n: 6 }), INK.bone) +
    path(scratch(28, y + h * 0.44, 6, y + 1, 3.6, r, { n: 6 }), INK.bone);
  if (dir === 'right') body = `<g transform="translate(${w} 0) scale(-1 1)">${body}</g>`;
  return svg(w, h, 'gouge', body);
}

/** A ledger leader: a run of short nicks. */
export function dotsMark(w, h, seed = 81) {
  const r = rng(seed);
  let body = '';
  for (let x = 4; x < w - 4; x += 9 + r() * 4) {
    const y = h * 0.6 + (r() - 0.5) * 2;
    body += path(scratch(x, y + 1, x + 3 + r() * 2, y - 1, 1.8, r, { n: 3 }), INK.boneDim, ' opacity="0.6"');
  }
  return svg(w, h, null, body, { stretch: true });
}

/** Faint old marks on the wall: someone else's count. Decoration only. */
export function oldTallies(w, h, seed, groups) {
  const r = rng(seed);
  let body = '';
  for (const [gx, gy, n, s = 1] of groups) {
    // Each run was scratched on a different day: its own size, slant and weight.
    let g = '';
    const mh = 34 * s * (0.8 + r() * 0.4);
    const gap = 10 * s;
    let x = gx;
    for (let i = 0; i < n; i++) {
      if (i % 5 === 4) {
        g += path(scratch(x - gap * 4 - 4, gy + mh * 0.85, x - gap + 5, gy + mh * 0.15, 3 * s, r), INK.bone);
        x += gap * 1.8;
        continue;
      }
      const lean = (r() - 0.5) * 5;
      g += path(scratch(x + lean, gy, x - lean, gy + mh, 3 * s, r), INK.bone);
      x += gap;
    }
    body += `<g transform="rotate(${f((r() - 0.5) * 7)} ${gx} ${gy})" opacity="${f(0.55 + r() * 0.45)}">${g}</g>`;
  }
  return svg(w, h, null, body);
}

// ---- DOM ------------------------------------------------------------------------

const urlCache = new Map();

/** Data URL for a mark; identical marks share one string (and one bitmap). */
export function markUrl(mark) {
  let url = urlCache.get(mark.markup);
  if (!url) {
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(mark.markup)}`;
    if (urlCache.size > 200) urlCache.clear();
    urlCache.set(mark.markup, url);
  }
  return url;
}

/**
 * An <img> for a mark. `scale` maps the mark's design pixels to ems of the
 * element's font size, so marks grow with the text they sit beside.
 */
export function markImg(mark, className = '', scale = 0.01) {
  const img = document.createElement('img');
  img.className = `mark ${className}`.trim();
  img.alt = '';
  img.draggable = false;
  img.setAttribute('aria-hidden', 'true');
  setMark(img, mark, scale);
  return img;
}

/**
 * Swap a mark once its new image is decoded, so a resized swipe never blinks
 * out for a frame. The latest request wins.
 */
export function swapMark(img, mark, scale = 0.01) {
  const url = markUrl(mark);
  img.dataset.pending = url;
  const next = new Image();
  next.src = url;
  const apply = () => img.dataset.pending === url && setMark(img, mark, scale);
  next.decode().then(apply, apply);
}

/** Point an existing mark <img> at a new mark. */
export function setMark(img, mark, scale = 0.01) {
  img.src = markUrl(mark);
  img.style.width = `${(mark.w * scale).toFixed(3)}em`;
  img.style.height = `${(mark.h * scale).toFixed(3)}em`;
  // Marks carry PAD design pixels of bleed for their filters; pull it back in
  // so the visible stroke lines up with the layout.
  img.style.margin = `${(-PAD * scale).toFixed(3)}em`;
}
