// Phone layout check (design doc 9.10, decision 19): at three landscape phone
// sizes, with touch, every control must be reachable and none may cover
// another. For each station it checks that
//   - every HUD control is at least 44 px square and is what a tap at its
//     centre would hit (nothing lies on top of it), and no two overlap;
//   - every clickable object in the room (bet spots, cards, buttons, charms,
//     the Bell...) that is on screen is not covered by any HTML element.
// Objects in the room smaller than 44 px are listed as warnings: the felt's
// close-up and magnifier are what make those reachable.
//
//   npm run layout
//   CHROME_PATH=/path/to/chrome npm run layout

import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const root = new URL('../..', import.meta.url).pathname;
const server = await createServer({ root, logLevel: 'error', server: { port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

// Landscape phones: a small one (iPhone SE), a common one, a large one.
const SIZES = [
  { name: 'small', width: 667, height: 375 },
  { name: 'medium', width: 844, height: 390 },
  { name: 'large', width: 932, height: 430 },
];
const MIN = 44;

// Which room objects belong to which station's view.
const ROLES = {
  table: ['night-card', 'end-card', 'board', 'bell', 'bell-tag', 'plaque', 'talisman-mesh'],
  felt: [],
  cage: ['cage-button', 'devil-counter'],
  cabinet: ['compartment', 'crank', 'chart'],
};

/** Everything a tap could hit in this view, measured in the page. */
async function measure({ view, roles, min }) {
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
  const cards = [...document.querySelectorAll('.modal-backdrop.show')];
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
    targets.push({ what: o.userData.role, x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
  });
  // Bet spots: points on the felt, sized by the gap to the nearest other spot.
  if ((view === 'table' || view === 'felt') && r.game.state.phase === 'betting' && !cards.length) {
    const { SPOTS } = await import('/src/view/felt.js');
    const spots = [...SPOTS.keys()].map((id) => ({ id, ...project(r.table.spotWorldPosition(id)) }));
    for (const s of spots) {
      let gap = Infinity;
      for (const o of spots) if (o !== s) gap = Math.min(gap, Math.hypot(o.x - s.x, o.y - s.y));
      targets.push({ what: `spot ${s.id}`, x: s.x, y: s.y, w: gap, h: gap });
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
  let small = 0;
  for (const t of targets) {
    if (t.x < 0 || t.y < 0 || t.x > W || t.y > H) continue;
    const top = document.elementFromPoint(t.x, t.y);
    if (top !== canvas) failures.push(`covered ${t.what} at ${Math.round(t.x)},${Math.round(t.y)} by ${top ? name(top) : 'nothing'}`);
    for (const el of painted) {
      const b = el.getBoundingClientRect();
      if (t.x >= b.left && t.x <= b.right && t.y >= b.top && t.y <= b.bottom) failures.push(`hidden ${t.what} at ${Math.round(t.x)},${Math.round(t.y)} under ${name(el)}`);
    }
    if (Math.min(t.w, t.h) < min) small += 1;
  }
  if (small) warnings.push(`${small} of ${targets.length} room targets under ${min} px`);
  return { failures, warnings, controls: controls.length, targets: targets.length };
}

let failed = 0;
const problems = [];
for (const size of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${size.name}: page error: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`${size.name}: console error: ${m.text()}`));
  const game = (fn, arg) => page.evaluate(fn, arg);
  const frames = async (n = 2) => {
    for (let i = 0; i < n; i++) await game(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
  };
  await page.goto(`${url}?seed=LAYOUT-01`);
  await page.waitForFunction(() => window.__roulette?.game, null, { timeout: 120000 });
  await frames(3);

  const at = async (label, view, setup) => {
    if (setup) await game(setup);
    await game((view) => {
      const r = window.__roulette;
      if (view === 'felt') r.game.zoomFelt(true);
      else r.game.turnTo(view);
      r.director.goTo(view, { cut: true });
    }, view);
    // Notes and toasts fade on drawn frames; give the HUD a few.
    await frames(6);
    const result = await game(measure, { view, roles: ROLES[view] ?? [], min: MIN });
    const tag = `${size.name} ${size.width}×${size.height} · ${label}`;
    console.log(`${result.failures.length ? 'FAIL' : 'ok  '} ${tag}: ${result.controls} controls, ${result.targets} room targets${result.warnings.length ? ` (${result.warnings.join('; ')})` : ''}`);
    for (const f of result.failures) console.log(`       ${f}`);
    failed += result.failures.length;
  };

  await at('table, choosing a night', 'table');
  await at('table, betting', 'table', () => {
    const g = window.__roulette.game;
    g.choosePackage('long');
    g.placeChip('c1', 'red');
    g.placeChip('c2', 'straight:17');
  });
  await at('felt close-up', 'felt');
  await at('cabinet', 'cabinet');
  await at('cage', 'cage');
  await at('table, night over', 'table', () => {
    const g = window.__roulette.game;
    g.state = { ...g.state, spinsLeft: 0, phase: 'nightOver' };
    g.syncAll();
  });
  await at('pause menu', 'table', () => window.__roulette.game.toggleMenu());
  await at('a talisman card', 'table', () => {
    const r = window.__roulette;
    r.game.toggleMenu();
    r.debug.grant('wheel_of_fortune');
    r.debug.grant('red_ribbon');
    r.game.openTalisman(r.game.state.rail[0].uid);
  });
  await ctx.close();
}

await browser.close();
await server.close();
for (const p of problems) console.log(p);
if (failed || problems.length) {
  console.log(`\nLayout check failed: ${failed} problem${failed === 1 ? '' : 's'}${problems.length ? `, ${problems.length} page error(s)` : ''}.`);
  process.exit(1);
}
console.log('\nLayout check passed.');
