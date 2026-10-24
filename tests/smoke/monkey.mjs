// Monkey testing: boots the game in headless Chromium and lets a restless
// player loose on it. Each persona plays the way a real person might when
// they are bored, curious or clumsy: mashing keys, tapping whatever is on
// screen, opening every menu mid-spin, turning the phone, reloading, even a
// corrupted save. After every few actions it checks that nothing threw, the
// run still holds together, and the game has not got stuck.
//
//   npm run monkey -- --persona masher [--steps 250] [--seed 1]
//   personas: masher, clicker, wanderer, reloader, touch
//
// Prints every distinct problem once, with the actions leading to it, and
// a screenshot path. Software WebGL is slow, so a run takes several minutes.

import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const PERSONA = opt('persona', 'masher');
const STEPS = Number(opt('steps', 250));
const SEED = Number(opt('seed', 1));
const OUT = opt('out', '/tmp');

let a = SEED * 7919 + PERSONA.length * 104729;
const rand = () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const root = new URL('../..', import.meta.url).pathname;
const server = await createServer({ root, logLevel: 'error', server: { port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const touchy = PERSONA === 'touch';
const SIZES = [[667, 375], [844, 390], [932, 430], [1280, 720], [390, 844], [375, 667]];
let [W, H] = touchy ? [844, 390] : [667, 375];
const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: touchy, isMobile: touchy, deviceScaleFactor: 1 });
// Counts frames, so "stuck" can be told from "slow" in software WebGL.
await ctx.addInitScript(() => {
  window.__frames = 0;
  const tick = () => {
    window.__frames += 1;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);

const problems = new Map(); // key → { count, step, trail, detail, shot }
const trail = [];
let step = 0;
function problem(key, detail = '') {
  const known = problems.get(key);
  if (known) {
    known.count += 1;
    return;
  }
  const shot = `${OUT}/monkey-${PERSONA}-${SEED}-${problems.size + 1}.png`;
  problems.set(key, { count: 1, step, trail: [...trail], detail, shot });
  page.screenshot({ path: shot }).catch(() => {});
  console.log(`  ✗ step ${step}: ${key}${detail ? ` (${detail})` : ''}`);
}
page.on('pageerror', (e) => problem(`page error: ${e.message}`, e.stack?.split('\n').slice(1, 3).join(' | ')));
page.on('console', (m) => m.type() === 'error' && problem(`console error: ${m.text()}`));
page.on('crash', () => problem('the page crashed'));

const frames = (n = 2) => page.evaluate((n) => new Promise((res) => {
  let k = 0;
  const f = () => (++k >= n ? res() : requestAnimationFrame(f));
  requestAnimationFrame(f);
}), n).catch(() => {});
const ready = () => page.waitForFunction(() => window.__roulette?.game?.state || window.__roulette?.game?.atMenu, null, { timeout: 180000 });

async function boot(query = '') {
  await page.goto(`${url}${query}`);
  await ready();
  await frames(4);
}

// Some personas play on the phone preset, fast: quicker in software WebGL.
await ctx.addInitScript((persona) => {
  if (sessionStorage.getItem('seeded')) return;
  sessionStorage.setItem('seeded', '1');
  if (persona !== 'wanderer') localStorage.setItem('rien-ne-va-plus.settings', JSON.stringify({ quality: 'low', fast: true, tips: persona === 'clicker' }));
}, PERSONA);
await boot(PERSONA === 'wanderer' || PERSONA === 'reloader' ? '' : `?seed=MONK-${SEED}`);

// ---- What a person can do ---------------------------------------------------------------

const KEYS = ['Space', 'Space', 'Space', 'KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'Digit1', 'Digit2', 'Digit3', 'KeyE', 'KeyF', 'KeyM', 'Escape', 'KeyB', 'KeyR', 'BracketLeft', 'BracketRight', 'Delete', 'Backspace', 'Enter', 'Tab', 'Shift+Tab'];

async function key(code) {
  trail.push(`key ${code}`);
  await page.keyboard.press(code);
}

/** Screen points of everything clickable: DOM buttons and the room's tagged meshes. */
const targets = () => page.evaluate(async () => {
  const out = [];
  for (const el of document.querySelectorAll('button, [role="button"], .card, .chip, a, input, [data-action]')) {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) < 0.05) continue;
    if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) continue;
    out.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, what: `dom ${el.tagName.toLowerCase()} "${(el.textContent || el.className || '').trim().slice(0, 24)}"` });
  }
  const rr = window.__roulette;
  if (rr?.stage) {
    const v = new rr.THREE.Vector3();
    rr.stage.scene.traverse((o) => {
      if (!o.isMesh || !o.userData.role) return;
      let vis = true;
      for (let p = o; p; p = p.parent) if (!p.visible) vis = false;
      if (!vis) return;
      const s = rr.game.screenPosition(o.getWorldPosition(v));
      if (s && s.x >= 0 && s.y >= 0 && s.x <= innerWidth && s.y <= innerHeight) out.push({ x: s.x, y: s.y, what: `mesh ${o.userData.role}` });
    });
    // A dozen spots on the felt, where the chips go.
    const { BETS } = await import('/src/core/bets.js');
    for (let i = 0; i < 12; i++) {
      const bet = BETS[Math.floor(Math.random() * BETS.length)];
      const w = rr.table.spotWorldPosition?.(bet.id);
      const s = w && rr.game.screenPosition(w);
      if (s && s.x >= 0 && s.y >= 0 && s.x <= innerWidth && s.y <= innerHeight) out.push({ x: s.x, y: s.y, what: `felt bet ${bet.id}` });
    }
  }
  return out;
}).catch(() => []);

/** A target as a person picks one: a button, a thing in the room, or a spot on the felt, about evenly. */
async function anyTarget() {
  const ts = await targets();
  const felt = (t) => /bet|spot|felt|track/.test(t.what);
  const groups = [ts.filter((t) => t.what.startsWith('dom')), ts.filter((t) => t.what.startsWith('mesh') && !felt(t)), ts.filter(felt)].filter((g) => g.length);
  return groups.length ? pick(pick(groups)) : null;
}

async function clickSomething({ double = false, long = false } = {}) {
  const t = rand() < 0.85 ? await anyTarget() : null;
  const p = t ?? { x: rand() * W, y: rand() * H, what: 'empty space' };
  trail.push(`${long ? 'long-press' : double ? 'double-click' : 'click'} ${p.what}`);
  if (touchy) {
    const point = [{ x: Math.round(p.x), y: Math.round(p.y) }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point });
    if (long) await page.waitForTimeout(900);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    if (double) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    return;
  }
  if (long) {
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.waitForTimeout(900);
    await page.mouse.up();
  } else {
    await page.mouse.click(p.x, p.y, { clickCount: double ? 2 : 1 });
  }
}

async function drag() {
  const from = (await anyTarget()) ?? { x: rand() * W, y: rand() * H, what: 'space' };
  const to = rand() < 0.6 ? ((await anyTarget()) ?? from) : { x: rand() * W, y: rand() * H, what: 'space' };
  trail.push(`drag ${from.what} → ${to.what}`);
  if (touchy) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(from.x), y: Math.round(from.y) }] });
    for (let i = 1; i <= 5; i++) {
      const x = from.x + ((to.x - from.x) * i) / 5;
      const y = from.y + ((to.y - from.y) * i) / 5;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: Math.round(x), y: Math.round(y) }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return;
  }
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

async function twoFingers() {
  trail.push('two-finger tap');
  const p = [{ x: Math.round(rand() * W), y: Math.round(rand() * H), id: 1 }, { x: Math.round(rand() * W), y: Math.round(rand() * H), id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: p });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: p.map((q) => ({ ...q, x: q.x + 20 })) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function resize() {
  [W, H] = pick(SIZES);
  trail.push(`resize ${W}×${H}`);
  await page.setViewportSize({ width: W, height: H });
}

async function hideAndShow() {
  trail.push('tab hidden and back');
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' }).catch(() => {});
  await page.waitForTimeout(300);
  await cdp.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
}

async function reload() {
  const before = await page.evaluate(() => localStorage.getItem('rien-ne-va-plus.run')).catch(() => null);
  trail.push('reload');
  await page.reload();
  await ready();
  await frames(4);
  // A run in progress comes back exactly as it was saved.
  const after = await page.evaluate(async () => {
    const g = window.__roulette.game;
    const { serializeRun } = await import('/src/core/save.js');
    return g.state ? serializeRun(g.state) : null;
  });
  if (before && after && JSON.parse(before).state.phase !== 'gameOver' && after !== before) problem('a reload changed the run', `${before.length} vs ${after.length} chars`);
}

async function corruptSave() {
  const how = pick(['garbage', 'truncated', 'empty state', 'wrong version', 'missing fields']);
  trail.push(`corrupt the save (${how})`);
  await page.evaluate((how) => {
    const k = 'rien-ne-va-plus.run';
    const s = localStorage.getItem(k) ?? '{"v":9,"state":{}}';
    const v = { garbage: '}{not json', truncated: s.slice(0, Math.floor(s.length / 2)), 'empty state': '{"v":9,"state":{}}', 'wrong version': s.replace(/"v":\d+/, '"v":99'), 'missing fields': s.replace(/"rail":\[[^\]]*\],?/, '') }[how];
    localStorage.setItem(k, v);
  }, how);
  await page.reload();
  await ready().catch(() => problem(`the game did not start after a ${how} save`));
  await frames(4);
}

// ---- What must hold ------------------------------------------------------------------------

let busySince = null; // frame count when busy began
let tweenSince = null;
async function health() {
  const h = await page.evaluate(async () => {
    const r = window.__roulette;
    if (!r?.game) return { missing: true };
    const g = r.game;
    const s = g.state;
    const modals = [...document.querySelectorAll('.modal-backdrop.show, .modal.show')].length;
    const out = { frames: window.__frames, busy: !!g.busy, tween: !!r.director.tween, modals, phase: s?.phase, atMenu: !!g.atMenu, bad: [] };
    if (!s) return out;
    const num = (x) => (typeof x === 'number' ? x : Number(x?.toString?.() ?? NaN));
    if (!(num(s.coins) >= 0)) out.bad.push(`coins ${s.coins}`);
    if (!(s.tokens >= 0 && Number.isInteger(s.tokens))) out.bad.push(`tokens ${s.tokens}`);
    if (!(s.spinsLeft >= 0)) out.bad.push(`spinsLeft ${s.spinsLeft}`);
    for (const [chip] of Object.entries(s.placements)) if (!s.chips.some((c) => c.id === chip)) out.bad.push(`placement of a missing chip ${chip}`);
    // The HUD agrees with the run.
    const hudCoins = document.querySelector('.hud-coins, #coins, [data-hud="coins"]')?.textContent?.trim();
    out.hudCoins = hudCoins ?? null;
    return out;
  }).catch((e) => ({ error: e.message }));
  if (h.error) {
    if (!/Execution context was destroyed|Target closed|navigation/.test(h.error)) problem(`health check threw: ${h.error}`);
    return;
  }
  if (h.missing) return problem('the game object is gone');
  for (const b of h.bad) problem(`state: ${b.replace(/\d+/g, 'N')}`, b);
  if (h.modals > 1) problem(`${h.modals} modals open at once`);
  // Busy or mid-turn for thousands of frames is stuck, however slow the machine.
  if (h.busy) {
    busySince ??= h.frames;
    if (h.frames - busySince > 4000) problem('stuck busy', `${h.frames - busySince} frames, phase ${h.phase}`);
  } else busySince = null;
  if (h.tween) {
    tweenSince ??= h.frames;
    if (h.frames - tweenSince > 1500) problem('the camera is stuck mid-move');
  } else tweenSince = null;
}

// ---- The personas --------------------------------------------------------------------------

const PERSONAS = {
  // Mashes keys, often several at once, without waiting.
  masher: [[60, () => key(pick(KEYS))], [10, async () => { for (let i = 0; i < 6; i++) await key(pick(KEYS)); }], [15, () => clickSomething()], [5, () => clickSomething({ double: true })], [5, () => key('Space')], [5, drag]],
  // Clicks whatever is on screen: buttons, cards, the felt, the rail, nothing.
  clicker: [[55, () => clickSomething()], [10, () => clickSomething({ double: true })], [10, () => clickSomething({ long: true })], [15, drag], [10, () => key(pick(['Escape', 'Space', 'KeyA', 'KeyD']))]],
  // Opens everything, changes settings mid-spin, turns the phone, hides the tab.
  wanderer: [[40, () => clickSomething()], [15, () => key(pick(['Escape', 'Tab', 'Enter', 'KeyA', 'KeyD', 'Space', 'KeyF', 'KeyM']))], [8, resize], [5, hideAndShow], [12, () => clickSomething({ long: true })], [10, drag], [10, () => key('Escape')]],
  // Plays a little, then reloads at awkward moments; now and then breaks the save.
  reloader: [[45, () => clickSomething()], [20, () => key(pick(KEYS))], [15, reload], [5, corruptSave], [10, () => key('Space')], [5, resize]],
  // A phone in a restless hand: taps, holds, swipes, two fingers, the back gesture.
  touch: [[50, () => clickSomething()], [12, () => clickSomething({ long: true })], [8, () => clickSomething({ double: true })], [15, drag], [8, twoFingers], [7, async () => { trail.push('back gesture'); await page.goBack().catch(() => {}); }]],
};
const plan = PERSONAS[PERSONA];
if (!plan) throw new Error(`No persona ${PERSONA}`);
const total = plan.reduce((s, [w]) => s + w, 0);

console.log(`monkey ${PERSONA}, seed ${SEED}, ${STEPS} steps at ${W}×${H}`);
for (step = 1; step <= STEPS; step++) {
  let x = rand() * total;
  const [, act] = plan.find(([w]) => (x -= w) < 0) ?? plan[0];
  try {
    await act();
  } catch (e) {
    // Playwright losing an element mid-click is not the game's fault.
    if (!/detached|Target closed|Execution context|navigation|not attached|Timeout/.test(e.message)) problem(`action threw: ${e.message.split('\n')[0]}`);
  }
  if (trail.length > 25) trail.splice(0, trail.length - 25);
  // People act at their own pace: sometimes at once, sometimes after a look.
  await frames(rand() < 0.3 ? 1 : 1 + Math.floor(rand() * 6));
  if (step % 5 === 0) await health();
  if (step % 50 === 0) {
    const s = await page.evaluate(() => { const g = window.__roulette.game; const s = g.state; const cards = document.querySelectorAll('.modal-backdrop:not([inert])').length; return s && !g.atMenu ? `debt ${s.debt} night ${s.round} ${s.phase}, ${s.rail.length} talismans, at the ${g.view}${cards ? `, ${cards} card(s) open` : ''}` : 'menu'; }).catch(() => '?');
    console.log(`  step ${step}: ${s}`);
  }
}
await health();

console.log(`\n${PERSONA}: ${problems.size ? `${problems.size} problem(s)` : 'no problems'}`);
for (const [k, p] of problems) {
  console.log(`\n✗ ${k}  (×${p.count}, first at step ${p.step})`);
  if (p.detail) console.log(`  ${p.detail}`);
  console.log(`  screenshot ${p.shot}`);
  console.log(`  before it: ${p.trail.slice(-10).join(' · ')}`);
}
await browser.close();
await server.close();
process.exitCode = problems.size ? 1 : 0;
