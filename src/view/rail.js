import * as THREE from 'three';
import { format } from '../core/num.js';
import { SANS } from '../ui/fonts.js';
import { INK, scrawlText, typedFont } from './ink.js';

// The talisman rail (design doc 5.8, 8.1): a low brass back rail on the
// table with six hooks. Talismans hang left to right, which is the order they
// act in. Drag one along the rail to reorder it; click it for its card. Bell
// actives carry a brass tag (charges, or what the pig holds); click the tag to
// ring the Bell at that talisman. The STAKE and ODDS plaques are riveted to
// the rail's posts.
//
// Coordinates are table-local (the rail is a child of the table group):
// +z toward the player, y up from the floor, the table top at y 0.95.

const POST_X = 0.6;
const RAIL_Z = -0.3;
const BAR_Y = 1.13;
const HOOK_Y = BAR_Y - 0.012;
const HOOK_STEP = 0.16;
const HOOKS = 6;
const hookX = (i) => (i - (HOOKS - 1) / 2) * HOOK_STEP;

function canvasTexture(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { canvas, ctx: canvas.getContext('2d'), tex };
}

/** Engraved brass plate: "STAKE ×1". Casino hardware, so Oswald. */
function drawPlaque(t, label, value, lit) {
  const { ctx, canvas, tex } = t;
  const { width: w, height: h } = canvas;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#b58e4c');
  g.addColorStop(1, '#6f5228');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(40, 24, 10, 0.75)';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, w - 12, h - 12);
  for (const [x, y] of [
    [16, 16],
    [w - 16, 16],
    [16, h - 16],
    [w - 16, h - 16],
  ]) {
    ctx.fillStyle = '#3a2812';
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = lit ? '#fff0c8' : '#2a1708';
  ctx.font = `600 ${Math.round(h * 0.36)}px ${SANS}`;
  ctx.fillText(label, w * 0.36, h * 0.54);
  ctx.font = `600 ${Math.round(h * 0.5)}px ${SANS}`;
  ctx.fillText(`×${value}`, w * 0.76, h * 0.55);
  tex.needsUpdate = true;
}

/** The tag under a Bell active: charge pips, or the pig's coins. */
function drawTag(t, info) {
  const { ctx, canvas, tex } = t;
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = info.usable ? '#c49a52' : '#6b5534';
  ctx.beginPath();
  ctx.moveTo(10, h / 2);
  ctx.lineTo(34, 6);
  ctx.lineTo(w - 8, 6);
  ctx.lineTo(w - 8, h - 6);
  ctx.lineTo(34, h - 6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#1a1008';
  ctx.beginPath();
  ctx.arc(26, h / 2, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (info.pips !== null) {
    for (let i = 0; i < info.max; i++) {
      ctx.fillStyle = i < info.pips ? '#2a1708' : 'rgba(42, 23, 8, 0.25)';
      ctx.beginPath();
      ctx.arc(62 + i * 34, h / 2, 11, 0, Math.PI * 2);
      ctx.fill();
    }
    if (info.armed) {
      ctx.fillStyle = INK.bloodDeep;
      ctx.font = typedFont(26);
      ctx.fillText('armed', w - 70, h / 2 + 2);
    }
  } else {
    scrawlText(ctx, info.text, (w + 34) / 2, h / 2 + 4, 40, '#2a1708');
  }
  tex.needsUpdate = true;
}

export function createRail({ materials, interaction, makeCharm, callbacks = {} }) {
  const group = new THREE.Group();
  group.name = 'rail';
  const brass = materials.brass;
  const TOP = 0.95;

  // ---- Brass work ------------------------------------------------------------
  const postGeo = new THREE.CylinderGeometry(0.009, 0.012, BAR_Y - TOP + 0.02, 12);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, brass);
    post.position.set(sx * POST_X, (BAR_Y + TOP) / 2, RAIL_Z);
    post.castShadow = true;
    group.add(post);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.01, 16), brass);
    foot.position.set(sx * POST_X, TOP + 0.005, RAIL_Z);
    group.add(foot);
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 8), brass);
    finial.position.set(sx * POST_X, BAR_Y + 0.012, RAIL_Z);
    group.add(finial);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0065, POST_X * 2, 10), brass);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, BAR_Y, RAIL_Z);
  bar.castShadow = true;
  group.add(bar);
  const hookGeo = new THREE.TorusGeometry(0.008, 0.0018, 6, 12, Math.PI * 1.4);
  for (let i = 0; i < HOOKS; i++) {
    const hook = new THREE.Mesh(hookGeo, brass);
    hook.position.set(hookX(i), BAR_Y - 0.006, RAIL_Z + 0.004);
    hook.rotation.set(0, Math.PI / 2, Math.PI * 0.8);
    group.add(hook);
  }

  // The table lamp's cone misses the outer hooks: a warm fill just for the rail.
  const LIGHT = 0.9;
  const light = new THREE.PointLight(0xffc98a, LIGHT, 1.4, 2);
  light.position.set(0, BAR_Y + 0.18, RAIL_Z + 0.28);
  group.add(light);
  let lightLevel = 1;

  // ---- Plaques ---------------------------------------------------------------
  const plaques = {};
  for (const [key, label, sx] of [
    ['stake', 'STAKE', -1],
    ['odds', 'ODDS', 1],
  ]) {
    const t = canvasTexture(256, 112);
    const mat = new THREE.MeshStandardMaterial({ map: t.tex, metalness: 0.55, roughness: 0.45, emissive: 0xffd9a0, emissiveIntensity: 0 });
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.05, 0.004), [brass, brass, brass, brass, mat, brass]);
    plate.position.set(sx * (POST_X - 0.068), TOP + 0.075, RAIL_Z + 0.014);
    plate.rotation.y = -sx * 0.18;
    plate.userData.role = 'plaque';
    plate.userData.plaque = key;
    group.add(plate);
    plaques[key] = { t, mat, mesh: plate, label, value: null, lit: 0 };
    interaction.add(plate, {
      cursor: 'help',
      hover: (hit, ev) => callbacks.onHover?.({ kind: 'plaque', plaque: key }, ev),
      leave: () => callbacks.onHover?.(null),
    });
  }

  /** What the plaques read: the factors at rest, or a line's during payout. */
  function setPlaques({ stake = 1, oddsMult = 1 } = {}, lit = false) {
    for (const [key, value] of [
      ['stake', stake],
      ['odds', oddsMult],
    ]) {
      const p = plaques[key];
      const shown = `${value}`;
      if (p.value === shown && !lit) continue;
      p.value = shown;
      drawPlaque(p.t, p.label, shown, false);
      if (lit) p.lit = 1;
    }
  }
  setPlaques();

  // ---- Talismans -------------------------------------------------------------
  const items = new Map(); // uid → { pivot, charm, tag, x, swing, vel, glow, id, dragging }
  let order = [];
  let locked = false;
  let drag = null;
  const railPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -RAIL_Z);
  const tmp = new THREE.Vector3();

  function railXAt(ev, inter) {
    const ray = inter.ray(ev).ray;
    group.updateMatrixWorld();
    const plane = railPlane.clone().applyMatrix4(group.matrixWorld);
    if (!ray.intersectPlane(plane, tmp)) return null;
    return group.worldToLocal(tmp).x;
  }

  function nearestHook(x, count) {
    let best = 0;
    for (let i = 0; i < count; i++) if (Math.abs(hookX(i) - x) < Math.abs(hookX(best) - x)) best = i;
    return best;
  }

  function makeItem(view) {
    const pivot = new THREE.Group();
    pivot.position.set(hookX(order.length), HOOK_Y, RAIL_Z + 0.006);
    const charm = makeCharm(view.id);
    pivot.add(charm);
    group.add(pivot);
    const item = { pivot, charm, tag: null, x: pivot.position.x, swing: (Math.random() - 0.5) * 0.2, vel: 0, glow: 0, id: view.id, lift: 0 };
    interaction.add(charm, {
      enabled: () => !locked,
      cursor: 'grab',
      hover: (hit, ev) => callbacks.onHover?.({ kind: 'talisman', uid: view.uid }, ev),
      leave: () => callbacks.onHover?.(null),
      down(hit, ev) {
        drag = { uid: view.uid, x0: ev.clientX, moved: false, to: order.indexOf(view.uid) };
        return true;
      },
      drag(ev, inter) {
        if (!drag) return;
        if (!drag.moved && Math.abs(ev.clientX - drag.x0) > 6) drag.moved = true;
        if (!drag.moved) return;
        inter.dom.style.cursor = 'grabbing';
        const x = railXAt(ev, inter);
        if (x === null) return;
        item.dragX = THREE.MathUtils.clamp(x, hookX(0) - 0.04, hookX(order.length - 1) + 0.04);
        drag.to = nearestHook(x, order.length);
      },
      up() {
        const d = drag;
        drag = null;
        item.dragX = null;
        if (!d) return;
        if (!d.moved) callbacks.onSelect?.(view.uid);
        else if (d.to !== order.indexOf(view.uid)) callbacks.onMove?.(view.uid, d.to);
      },
    });
    items.set(view.uid, item);
    return item;
  }

  function syncTag(item, view) {
    if (!view.active) {
      if (item.tag) {
        item.pivot.remove(item.tag.mesh);
        item.tag = null;
      }
      return;
    }
    if (!item.tag) {
      const t = canvasTexture(256, 72);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.017), new THREE.MeshStandardMaterial({ map: t.tex, transparent: true, roughness: 0.5, metalness: 0.4 }));
      mesh.position.set(0.012, -0.09, 0.004);
      mesh.rotation.z = -0.12;
      mesh.userData.role = 'bell-tag';
      item.pivot.add(mesh);
      item.tag = { t, mesh, key: '' };
      interaction.add(mesh, {
        enabled: () => !locked,
        hover: (hit, ev) => callbacks.onHover?.({ kind: 'tag', uid: view.uid }, ev),
        leave: () => callbacks.onHover?.(null),
        click: () => callbacks.onRing?.(item.uid),
      });
    }
    item.uid = view.uid;
    const info = view.maxCharges
      ? { pips: view.charges ?? 0, max: view.maxCharges, usable: view.usable, armed: /armed/.test(view.status ?? '') }
      : { pips: null, text: format(view.data?.value ?? 0), usable: view.usable };
    const key = JSON.stringify(info);
    if (key !== item.tag.key) {
      item.tag.key = key;
      drawTag(item.tag.t, info);
    }
  }

  /** Hang what the run's rail holds, in order. */
  function sync(views) {
    const keep = new Set(views.map((v) => v.uid));
    for (const [uid, item] of items) {
      if (keep.has(uid)) continue;
      interaction.remove(item.charm);
      if (item.tag) interaction.remove(item.tag.mesh);
      group.remove(item.pivot);
      items.delete(uid);
    }
    order = views.map((v) => v.uid);
    views.forEach((v, i) => {
      const item = items.get(v.uid) ?? makeItem(v);
      item.uid = v.uid;
      item.x = hookX(i);
      item.charm.userData.setFace?.(v.copying ?? v.id);
      item.charm.userData.setDim?.(v.dim);
      syncTag(item, v);
    });
  }

  /** A talisman acting: a kick on its hook and a flash. */
  function pulse(uid, strength = 1) {
    const item = items.get(uid);
    if (!item) return;
    item.vel += (Math.random() < 0.5 ? -1 : 1) * 2.4 * strength;
    item.glow = Math.max(item.glow, 1.2 * strength);
  }

  function lift(uid, on) {
    const item = items.get(uid);
    if (item) item.lifted = on;
  }

  function update(dt, t) {
    for (const item of items.values()) {
      // A damped pendulum, with a little idle sway from the room's draught.
      const k = 18;
      const idle = Math.sin(t * 0.9 + item.x * 9) * 0.015;
      item.vel += (-k * (item.swing - idle) - 3.2 * item.vel) * dt;
      item.swing += item.vel * dt;
      item.pivot.rotation.z = item.swing;
      const targetX = item.dragX ?? item.x;
      item.pivot.position.x += (targetX - item.pivot.position.x) * (1 - Math.exp(-dt * 14));
      const liftY = item.lifted ? 0.012 : 0;
      item.lift += (liftY - item.lift) * (1 - Math.exp(-dt * 12));
      item.pivot.position.y = HOOK_Y + item.lift;
      item.glow = Math.max(0, item.glow - dt * 2.2);
      item.charm.userData.setGlow?.(item.glow);
    }
    for (const p of Object.values(plaques)) {
      p.lit = Math.max(0, p.lit - dt * 1.5);
      p.mat.emissiveIntensity = p.lit * 0.45;
    }
    light.intensity = LIGHT * lightLevel;
  }

  const world = (obj, out) => obj.getWorldPosition(out);

  return {
    group,
    sync,
    pulse,
    lift,
    setPlaques,
    update,
    setLocked(v) {
      locked = v;
    },
    setLightLevel(x) {
      lightLevel = x;
    },
    talismanWorldPosition(uid, out = new THREE.Vector3()) {
      const item = items.get(uid);
      return item ? world(item.charm, out).add(new THREE.Vector3(0, -0.04, 0)) : null;
    },
    tagWorldPosition(uid, out = new THREE.Vector3()) {
      const item = items.get(uid);
      return item?.tag ? world(item.tag.mesh, out) : null;
    },
    plaqueWorldPosition(key, out = new THREE.Vector3()) {
      return world(plaques[key].mesh, out);
    },
    get order() {
      return order;
    },
  };
}
