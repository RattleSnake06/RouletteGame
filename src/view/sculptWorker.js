import { STAGES, meshShape } from './sculptCore.js';
import { SHAPES } from './shapes/index.js';

// Meshes a sculpted shape off the main thread (sculpt.js) and keeps it in
// IndexedDB, beside the floor's textures, so a later launch only reads it.
// Answers with { stage, parts } (typed arrays, transferred) for each of
// STAGES in turn, coarsest first, then { done } once it is kept (so the page
// does not end the worker mid-write), or with { error }.

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

async function keep(key, value) {
  try {
    const db = await openDb();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      // Older versions of the same shape are no use now.
      const prefix = key.slice(0, key.lastIndexOf('-v') + 2);
      const keys = store.getAllKeys();
      keys.onsuccess = () => {
        for (const k of keys.result) if (typeof k === 'string' && k.startsWith(prefix) && k !== key) store.delete(k);
      };
      store.put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
      tx.onabort = resolve;
    });
  } catch {
    // No storage: the next launch meshes it again.
  }
}

const buffers = (parts) => parts.flatMap((p) => [p.positions.buffer, p.normals.buffer, p.colors.buffer, ...(p.uvs ? [p.uvs.buffer] : []), ...Object.values(p.groups).map((g) => g.buffer)]);

// A copy for posting, so what is kept is not detached by the transfer.
const copy = (parts) => parts.map((p) => ({ ...p, positions: p.positions.slice(), normals: p.normals.slice(), colors: p.colors.slice(), uvs: p.uvs?.slice() ?? null, groups: Object.fromEntries(Object.entries(p.groups).map(([k, v]) => [k, v.slice()])) }));

self.onmessage = async ({ data: { name, key, cache = true } }) => {
  try {
    const shape = SHAPES[name];
    const kept = cache ? await cached(key) : null;
    if (kept && STAGES.every((s) => kept[s.name])) {
      for (const { name: stage } of STAGES) self.postMessage({ stage, parts: kept[stage] }, buffers(kept[stage]));
      self.postMessage({ done: true });
      return;
    }
    const made = {};
    for (const { name: stage, quality } of STAGES) {
      made[stage] = meshShape(shape, quality);
      const out = copy(made[stage]);
      self.postMessage({ stage, parts: out }, buffers(out));
    }
    if (cache) await keep(key, made);
    self.postMessage({ done: true });
  } catch (e) {
    self.postMessage({ error: String(e) });
  }
};
