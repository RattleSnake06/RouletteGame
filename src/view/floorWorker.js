import { paintFloor } from './floorPaint.js';

// Paints the floor off the main thread (floor.js) and keeps it in IndexedDB,
// so a later launch only decodes it. Answers with two ImageBitmaps, flipped
// for upload as a canvas would be, or { error }.

const DB = 'rien-ne-va-plus';
const STORE = 'textures';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function cached(key) {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Resolves once the write has committed: the worker closes straight after. */
async function keep(key, value) {
  try {
    const db = await openDb();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
      tx.onabort = resolve;
    });
  } catch {
    // Storage blocked or full: the floor is painted again next time.
  }
}

const flipped = (source) => createImageBitmap(source, { imageOrientation: 'flipY' });

self.onmessage = async ({ data: { size, rows, key } }) => {
  try {
    const hit = await cached(key);
    if (hit) {
      const [color, height] = await Promise.all([flipped(hit.color), flipped(hit.height)]);
      self.postMessage({ color, height }, [color, height]);
      self.close();
      return;
    }
    const canvases = paintFloor({ size, rows, makeCanvas: (w, h) => new OffscreenCanvas(w, h) });
    const [color, height] = await Promise.all([flipped(canvases.color), flipped(canvases.height)]);
    self.postMessage({ color, height }, [color, height]);
    // Encoded after the answer, so the floor is never kept waiting for it.
    const [colorBlob, heightBlob] = await Promise.all([
      canvases.color.convertToBlob({ type: 'image/webp', quality: 0.92 }),
      canvases.height.convertToBlob({ type: 'image/webp', quality: 0.92 }),
    ]);
    await keep(key, { color: colorBlob, height: heightBlob });
    self.close();
  } catch (e) {
    self.postMessage({ error: String(e?.message ?? e) });
    self.close();
  }
};
