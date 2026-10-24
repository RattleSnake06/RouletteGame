import * as THREE from 'three';
import { paintFloor } from './floorPaint.js';

// The floor's textures (design doc 8.1, 9.10): the heaviest painting in the
// game, so it is done in a worker while the game boots (floorWorker.js) and
// kept for later launches. Until it arrives the floor is a plain dark brown.
// Without workers or OffscreenCanvas it is painted on the main thread, just
// after the first frame.

// Raised whenever paintFloor changes, so an old cached floor is not used.
const FLOOR_VERSION = 1;

function plain(rgb) {
  const c = document.createElement('canvas');
  c.width = c.height = 4;
  const ctx = c.getContext('2d');
  ctx.fillStyle = rgb;
  ctx.fillRect(0, 0, 4, 4);
  return c;
}

/** The floor's colour and bump maps: placeholders now, the boards when painted. `onReady` follows. */
export function createFloorTextures({ size = 2048, rows = 28, onReady } = {}) {
  const map = new THREE.CanvasTexture(plain('rgb(44, 40, 36)'));
  map.colorSpace = THREE.SRGBColorSpace;
  const bump = new THREE.CanvasTexture(plain('rgb(120, 120, 120)'));
  for (const t of [map, bump]) t.wrapS = t.wrapT = THREE.RepeatWrapping;

  // A bitmap from the worker is already flipped; a canvas is flipped on upload.
  const fill = (color, height, bitmaps) => {
    for (const [t, image] of [
      [map, color],
      [bump, height],
    ]) {
      t.image = image;
      t.flipY = !bitmaps;
      t.needsUpdate = true;
    }
    onReady?.();
  };
  const onMainThread = () =>
    setTimeout(() => {
      const makeCanvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
      const { color, height } = paintFloor({ size, rows, makeCanvas });
      fill(color, height, false);
    }, 0);

  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    onMainThread();
    return { map, bump };
  }
  let worker;
  try {
    worker = new Worker(new URL('./floorWorker.js', import.meta.url), { type: 'module' });
  } catch {
    onMainThread();
    return { map, bump };
  }
  // The worker closes itself once it has kept the floor for next time.
  worker.onmessage = ({ data }) => {
    if (data.error) onMainThread();
    else fill(data.color, data.height, true);
  };
  worker.onerror = (e) => {
    e.preventDefault?.();
    worker.terminate();
    onMainThread();
  };
  worker.postMessage({ size, rows, key: `floor-v${FLOOR_VERSION}-${size}` });
  return { map, bump };
}
