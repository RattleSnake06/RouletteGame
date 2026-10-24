import * as THREE from 'three';
import { STAGES, meshShape } from './sculptCore.js';

// The sculpted people (design doc 8.5): a shape's fields are meshed once and
// shared by every copy (the figure, the figures in the dark). The meshing is
// done in a worker (sculptWorker.js), coarsest first (STAGES: far, preview,
// full), all kept in IndexedDB so a later launch only reads them. The meshes
// exist from the start, empty, and take each geometry as it arrives; a
// distant copy stops at a coarser one.

const models = new Map(); // name → { stages: { far, preview, full }, listeners }
const RANK = Object.fromEntries(STAGES.map((s, i) => [s.name, i]));
const EMPTY = new THREE.BufferGeometry();

function toGeometries(meshed) {
  const parts = {};
  for (const part of meshed) {
    const position = new THREE.BufferAttribute(part.positions, 3);
    const normal = new THREE.BufferAttribute(part.normals, 3, true);
    const color = new THREE.BufferAttribute(part.colors, 3, true);
    const uv = part.uvs ? new THREE.BufferAttribute(part.uvs, 2) : null;
    const byLabel = {};
    for (const [label, index] of Object.entries(part.groups)) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', position);
      g.setAttribute('normal', normal);
      g.setAttribute('color', color);
      if (uv) g.setAttribute('uv', uv);
      g.setIndex(new THREE.BufferAttribute(index, 1));
      g.computeBoundingSphere();
      byLabel[label] = g;
    }
    parts[part.name] = byLabel;
  }
  return parts;
}

function arrive(model, stage, meshed) {
  model.stages[stage] = toGeometries(meshed);
  for (const fn of model.listeners) fn(stage, model.stages[stage]);
}

function start(name, shape, model) {
  const onMainThread = () => {
    const next = (i) => setTimeout(() => {
      arrive(model, STAGES[i].name, meshShape(shape, STAGES[i].quality));
      if (i + 1 < STAGES.length) next(i + 1);
    }, 0);
    next(0);
  };
  if (typeof Worker === 'undefined') return onMainThread();
  let worker;
  try {
    worker = new Worker(new URL('./sculptWorker.js', import.meta.url), { type: 'module' });
  } catch {
    return onMainThread();
  }
  worker.onmessage = ({ data }) => {
    if (data.error) {
      worker.terminate();
      onMainThread();
      return;
    }
    if (data.done) worker.terminate();
    else arrive(model, data.stage, data.parts);
  };
  worker.onerror = (e) => {
    e.preventDefault?.();
    worker.terminate();
    onMainThread();
  };
  // In development a shape changes without its version moving: mesh afresh.
  worker.postMessage({ name, key: `sculpt-${name}-v${shape.version}`, cache: !import.meta.env?.DEV });
}

/** A sculpted shape's geometries, as they arrive: one meshing for every copy. */
export function sculpted(name, shape) {
  let model = models.get(name);
  if (!model) {
    model = { shape, stages: {}, listeners: new Set() };
    models.set(name, model);
    start(name, shape, model);
  }
  return model;
}

// Draws nothing; the shadow proxies cast with it.
const SHADOW_ONLY = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });

/**
 * Meshes for one part of a sculpted shape, a material each
 * (`materials[label]`, else `materials.default`), added to `parent`. They
 * fill in as the meshing arrives, each stopping at its `lod` ('far',
 * 'preview' or 'full'). A full-detail part casts its shadow from the preview
 * instead, through an unseen proxy (userData.shadowProxy), which costs the
 * shadow maps a tenth.
 */
export function addPart(parent, model, partName, materials, { lod = 'full', castShadow = true, receiveShadow = true } = {}) {
  const part = model.shape.parts.find((p) => p.name === partName);
  const proxy = castShadow && lod === 'full';
  const meshes = {};
  const shadows = {};
  for (const label of part.labels) {
    const mesh = new THREE.Mesh(EMPTY, materials[label] ?? materials.default);
    mesh.castShadow = castShadow && !proxy;
    mesh.receiveShadow = receiveShadow;
    mesh.name = `${partName}:${label}`;
    mesh.visible = false;
    parent.add(mesh);
    meshes[label] = mesh;
    if (proxy) {
      const shadow = new THREE.Mesh(EMPTY, SHADOW_ONLY);
      shadow.castShadow = true;
      shadow.visible = false;
      shadow.userData.shadowProxy = true;
      parent.add(shadow);
      shadows[label] = shadow;
    }
  }
  // Each set takes the finest stage it has room for, as they arrive.
  const sets = [{ meshes, top: RANK[lod], at: -1 }, { meshes: shadows, top: RANK.preview, at: -1 }];
  const fill = (stage, parts) => {
    const r = RANK[stage];
    for (const set of sets) {
      if (r > set.top || r < set.at) continue;
      set.at = r;
      for (const [label, mesh] of Object.entries(set.meshes)) {
        const geometry = parts[partName]?.[label];
        mesh.geometry = geometry ?? EMPTY;
        mesh.visible = !!geometry;
      }
    }
  };
  for (const { name } of STAGES) if (model.stages[name]) fill(name, model.stages[name]);
  model.listeners.add(fill);
  return meshes;
}
