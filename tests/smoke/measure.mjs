// What a tap could hit at one station, measured in the page (doc 9.10). Shared
// by the layout check (layout.mjs) and the touch-only playthrough (touch.mjs).
// It runs inside the page through page.evaluate, so it must not reach outside
// itself.

// Which room objects belong to which station's view.
export const ROLES = {
  table: ['night-card', 'end-card', 'board', 'chalkboard', 'bell', 'bell-tag', 'plaque', 'talisman-mesh'],
  felt: [],
  cage: ['cage-button', 'devil-counter'],
  cabinet: ['compartment', 'crank', 'chart'],
  oracle: ['lever', 'fortune-card', 'gramophone'],
};

export const MIN = 44;

/** Everything a tap could hit in this view, measured in the page. */
export async function measure({ view, roles, min }) {
  const READ_ONLY = ['board', 'plaque', 'devil-counter', 'chart'];
  const r = window.__roulette;
  const canvas = document.getElementById('scene');
  const W = window.innerWidth;
  const H = window.innerHeight;
  const name = (el) => {
    const label = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    return `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}${label ? ` "${label}"` : ''}`;
  };
  const shown = (el) => {
    const b = el.getBoundingClientRect();
    if (b.width < 1 || b.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.pointerEvents !== 'none' && Number(cs.opacity) > 0.05;
  };
  const failures = [];
  const warnings = [];

  // HTML controls. A card (the pause menu, a modal) blocks the room on
  // purpose: then only its own controls count.
  // The main menu covers the room the same way (doc 7.5).
  const cards = [...document.querySelectorAll('.title-screen.show, .modal-backdrop.show')];
  const scope = cards.length ? cards[cards.length - 1] : document;
  const controls = [...scope.querySelectorAll('button, [role=button], a[href], input, select')].filter(shown);
  for (const el of controls) {
    const b = el.getBoundingClientRect();
    if (b.width < min - 0.5 || b.height < min - 0.5) failures.push(`small control ${name(el)}: ${Math.round(b.width)}×${Math.round(b.height)}`);
    if (b.left < -0.5 || b.top < -0.5 || b.right > W + 0.5 || b.bottom > H + 0.5) failures.push(`off screen ${name(el)}`);
    const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    if (top && top !== el && !el.contains(top)) failures.push(`covered control ${name(el)} by ${name(top)}`);
  }
  for (let i = 0; i < controls.length; i++) {
    for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i].getBoundingClientRect();
      const b = controls[j].getBoundingClientRect();
      const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ix > 0.5 && iy > 0.5 && !controls[i].contains(controls[j]) && !controls[j].contains(controls[i])) failures.push(`overlap ${name(controls[i])} and ${name(controls[j])}`);
    }
  }

  // Objects in the room: project each one's box and test its centre.
  const THREE = r.THREE;
  const cam = r.stage.camera;
  const project = (v) => {
    const p = v.clone().project(cam);
    return { x: ((p.x + 1) / 2) * W, y: ((1 - p.y) / 2) * H, behind: p.z > 1 };
  };
  const targets = [];
  const visibleInWorld = (o) => {
    for (let n = o; n; n = n.parent) if (!n.visible) return false;
    return true;
  };
  if (!cards.length) r.stage.scene.traverse((o) => {
    if (!o.isMesh || !roles.includes(o.userData.role) || !visibleInWorld(o)) return;
    const box = new THREE.Box3().setFromObject(o);
    if (box.isEmpty()) return;
    const corners = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(project(new THREE.Vector3(x, y, z)));
    if (corners.some((c) => c.behind)) return;
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    targets.push({ what: o.userData.role, mesh: o, x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 });
  });
  // The real tap area: how far from the centre a tap still reaches the same
  // object, by the game's own picking (a box's projection overstates it).
  // Raw picking: a disabled button still has its size.
  const answer = (x, y) => {
    for (const h of r.interaction.ray({ clientX: x, clientY: y }).intersectObjects(r.interaction.targets, true)) {
      if (h.object.visible && h.object.userData.interact) return h.object.userData.interact;
    }
    return null;
  };
  // A finger's pad in front of a target, belonging to the same talisman (a
  // charm's pad over its Bell tag), serves it: on touch the tag opens the
  // talisman's card, as the pad does.
  const padOf = (x, y) => {
    for (const h of r.interaction.ray({ clientX: x, clientY: y }).intersectObjects(r.interaction.targets, true)) {
      if (!h.object.visible || !h.object.userData.interact) continue;
      return h.object.userData.touchOnly ? h.object : null;
    }
    return null;
  };
  for (let i = targets.length - 1; i >= 0; i--) {
    const t = targets[i];
    // The tag and the charm hang from the same pivot.
    const pad = t.what === 'bell-tag' ? padOf(t.x, t.y) : null;
    if (pad && pad.parent?.parent === t.mesh.parent) targets.splice(i, 1);
  }
  for (const t of targets) {
    const own = answer(t.x, t.y);
    if (!own || own !== t.mesh.userData.interact) {
      t.w = t.h = 0;
      t.blocked = true;
      continue;
    }
    const reach = (dx, dy) => {
      let k = 1;
      while (k < 200 && answer(t.x + dx * k, t.y + dy * k) === own) k += 1;
      return k - 1;
    };
    t.w = reach(-1, 0) + reach(1, 0) + 1;
    t.h = reach(0, -1) + reach(0, 1) + 1;
  }
  // One object, one target: its parts (a charm's disc, ring and lug) share a
  // handler, so keep the part that gives the most room.
  const byHandler = new Map();
  for (const t of targets) {
    const k = t.mesh.userData.interact;
    const best = byHandler.get(k);
    if (!best || Math.min(t.w, t.h) > Math.min(best.w, best.h)) byHandler.set(k, t);
  }
  targets.splice(0, targets.length, ...byHandler.values());
  // Bet spots: points on the felt, sized by the gap to the nearest other spot.
  if ((view === 'table' || view === 'felt') && r.game.state.phase === 'betting' && !cards.length) {
    const { SPOTS } = await import('/src/view/felt.js');
    const spots = [...SPOTS.keys()].map((id) => ({ id, ...project(r.table.spotWorldPosition(id)) }));
    for (const s of spots) {
      let gap = Infinity;
      for (const o of spots) if (o !== s) gap = Math.min(gap, Math.hypot(o.x - s.x, o.y - s.y));
      targets.push({ what: `spot ${s.id}`, x: s.x, y: s.y, w: gap, h: gap });
      // A spot must answer to the felt (or a chip on it), never to a charm's pad.
      const hit = r.interaction.pick({ clientX: s.x, clientY: s.y })?.hit.object;
      let charm = false;
      for (let o = hit; o; o = o.parent) if (o.name?.startsWith('talisman:')) charm = true;
      if (charm && s.x >= 0 && s.y >= 0 && s.x <= W && s.y <= H) failures.push(`spot ${s.id} at ${Math.round(s.x)},${Math.round(s.y)} answers to a talisman`);
    }
  }
  // HUD text that stays on screen (the clusters, the hint) lets taps through,
  // but drawn over a control it still hides it. Passing lines (toasts, the
  // flavour line, popups, notes) are left out.
  const PASSING = ['hud-toast', 'hud-flavor', 'hud-payout', 'hud-popups', 'hud-note'];
  const painted = [...document.querySelectorAll('.hud > *')].filter((el) => {
    if (PASSING.some((c) => el.classList.contains(c)) || el.matches('button')) return false;
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return b.width > 1 && b.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  });
  // HUD text drawn over a control hides it too (a card covers the HUD).
  for (const el of cards.length ? [] : controls) {
    const b = el.getBoundingClientRect();
    for (const p of painted) {
      if (p.contains(el)) continue;
      const q = p.getBoundingClientRect();
      const ix = Math.min(b.right, q.right) - Math.max(b.left, q.left);
      const iy = Math.min(b.bottom, q.bottom) - Math.max(b.top, q.top);
      if (ix > 0.5 && iy > 0.5) failures.push(`hidden control ${name(el)} under ${name(p)}`);
    }
  }
  const small = [];
  for (const t of targets) {
    if (t.x < 0 || t.y < 0 || t.x > W || t.y > H) continue;
    const top = document.elementFromPoint(t.x, t.y);
    if (top !== canvas) failures.push(`covered ${t.what} at ${Math.round(t.x)},${Math.round(t.y)} by ${top ? name(top) : 'nothing'}`);
    for (const el of painted) {
      const b = el.getBoundingClientRect();
      if (t.x >= b.left && t.x <= b.right && t.y >= b.top && t.y <= b.bottom) failures.push(`hidden ${t.what} at ${Math.round(t.x)},${Math.round(t.y)} under ${name(el)}`);
    }
    if (Math.min(t.w, t.h) < min) small.push(t);
  }
  if (small.length) {
    // Bet spots are named as a count: inside bets sit half a cell apart by design.
    const spots = small.filter((t) => t.what.startsWith('spot '));
    const others = small.filter((t) => !t.what.startsWith('spot '));
    if (spots.length) warnings.push(`${spots.length} bet spots under ${min} px apart`);
    for (const t of others) {
      const text = t.blocked ? `${t.what} behind another object` : `${t.what} ${Math.round(t.w)}×${Math.round(t.h)}`;
      if (READ_ONLY.includes(t.what)) warnings.push(text);
      else failures.push(`small ${text}`);
    }
  }
  return { failures, warnings, controls: controls.length, targets: targets.length };
}
