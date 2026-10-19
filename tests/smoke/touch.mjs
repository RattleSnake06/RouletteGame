// Touch-only playthrough (design doc 9.10, M1's bar): debt 1 played to its
// end on a landscape phone with nothing but touches, sent as real touch input
// through the DevTools protocol. Reading the run's state is allowed (to aim
// and to check); acting on it is not. At every station the layout must pass
// the same checks as `npm run layout`.
//
//   npm run touch
//   CHROME_PATH=/path/to/chrome npm run touch
//
// Software WebGL is slow, so this takes several minutes even with fast spins.

import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { MIN, ROLES, measure } from './measure.mjs';

const root = new URL('../..', import.meta.url).pathname;
const server = await createServer({ root, logLevel: 'error', server: { port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const url = server.resolvedUrls.local[0];

const W = 844;
const H = 390;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && problems.push(`console error: ${m.text()}`));

let step = 0;
function check(cond, what) {
  step += 1;
  if (!cond) throw new Error(`Step ${step} failed: ${what}`);
  console.log(`  ok ${step}  ${what}`);
}

const game = (fn, arg) => page.evaluate(fn, arg);
const frames = async (n = 2) => {
  for (let i = 0; i < n; i++) await game(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
};
const idle = () => page.waitForFunction(() => !window.__roulette.game.busy, null, { timeout: 600000, polling: 300 });
const still = async () => {
  await page.waitForFunction(() => !window.__roulette.director.tween, null, { timeout: 120000, polling: 200 });
  await frames(2);
};
const state = () =>
  game(() => {
    const g = window.__roulette.game;
    const s = g.state;
    return { phase: s.phase, debt: s.debt, round: s.round, coins: s.coins, deposited: s.deposited, tokens: s.tokens, spinsLeft: s.spinsLeft, placements: { ...s.placements }, rail: s.rail.length, view: g.view, zoom: g.feltZoom, menu: !!g.menuClose };
  });

// ---- Touches ------------------------------------------------------------------
const cdp = await ctx.newCDPSession(page);
const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(p.x), y: Math.round(p.y) }] });
const onScreen = (p) => p && p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H;
async function tap(p, what) {
  if (!onScreen(p)) throw new Error(`${what} is not on screen (${JSON.stringify(p)})`);
  await touch('touchStart', p);
  await frames(1);
  await touch('touchEnd', p);
  await frames(2);
}
/** Press, slide to `to` in a few moves, lift. */
async function slide(from, to) {
  await touch('touchStart', from);
  await frames(1);
  for (let k = 1; k <= 4; k++) await touch('touchMove', { x: from.x + ((to.x - from.x) * k) / 4, y: from.y + ((to.y - from.y) * k) / 4 });
  await frames(1);
  await touch('touchEnd', to);
  await frames(2);
}
/** The centre of a visible HUD or card element. */
async function element(selector, text) {
  const loc = text ? page.locator(selector, { hasText: text }).first() : page.locator(selector).first();
  await loc.waitFor({ state: 'visible', timeout: 60000 });
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
const tapElement = async (selector, text) => tap(await element(selector, text), text ?? selector);
const cardButton = (text) => tapElement('.modal-backdrop.show .modal-btn', text);

// ---- Where things are -----------------------------------------------------------
const roleAt = (where, role, pick) =>
  game(
    ({ where, role, pick }) => {
      const r = window.__roulette;
      const found = [];
      r[where].group.traverse((o) => o.isMesh && o.visible && o.userData.role === role && found.push(o));
      found.sort((a, b) => a.getWorldPosition(a.position.clone()).x - b.getWorldPosition(b.position.clone()).x);
      const o = pick === undefined ? found[0] : typeof pick === 'number' ? found[pick] : found.find((m) => m.userData.button === pick);
      return o ? r.game.screenPosition(o.getWorldPosition(o.position.clone())) : null;
    },
    { where, role, pick },
  );
const spot = (id) => game((id) => window.__roulette.game.screenPosition(window.__roulette.table.spotWorldPosition(id)), id);
const chip = (id) => game((id) => window.__roulette.game.screenPosition(window.__roulette.table.chipWorldPosition(id)), id);
const nightCard = async (id) => {
  const order = ['long', 'short', 'sitout'];
  return roleAt('table', 'night-card', order.indexOf(id));
};

/** The layout must pass here, as in `npm run layout`. */
async function layout(view, label) {
  await frames(4);
  const r = await game(measure, { view, roles: ROLES[view] ?? [], min: MIN });
  if (r.failures.length) console.log(r.failures.map((f) => `       ${f}`).join('\n'));
  check(!r.failures.length, `nothing covered or too small: ${label}`);
}

try {
  await page.goto(`${url}?seed=TOUCH-TEST`);
  await page.waitForFunction(() => window.__roulette?.game, null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  await still();
  check(await game(() => document.documentElement.classList.contains('touch')), 'a touch screen gets the touch layout');
  await layout('table', 'the table, first look');

  // Fast spins, from the menu button.
  await tapElement('.hud-menu');
  check((await state()).menu, 'the menu button opens the pause menu');
  await cardButton('Fast spins');
  check(await game(() => window.__roulette.game.settings.fast), 'Fast spins switched on by touch');
  await cardButton('Resume');
  check(!(await state()).menu, 'Resume closes it');

  let bought = false;
  for (let night = 1; night <= 3; night++) {
    // The night cards: the first tap leans in, the second chooses.
    await still();
    await tap(await nightCard('short'), 'the short night card');
    await still();
    check((await state()).zoom, `night ${night}: a tap on a card leans in to read them`);
    await layout('felt', `night ${night}, the cards up close`);
    await tap(await nightCard('short'), 'the short night card');
    let s = await state();
    check(s.phase === 'betting' && s.zoom, `night ${night}: the second tap chooses the short night`);

    if (night === 1) {
      await tap(await spot('red'), 'red');
      await tap(await spot('even'), 'even');
      s = await state();
      check(Object.values(s.placements).includes('red') && Object.values(s.placements).includes('even'), 'a tap on the close-up felt bets there');
      // Press on 17 and slide to the split with 20: the magnifier follows.
      await touch('touchStart', await spot('straight:17'));
      await frames(2);
      check(await game(() => document.querySelector('.hud-loupe').classList.contains('show')), 'a finger on the felt brings up the magnifier');
      await touch('touchMove', await spot('split:17-20'));
      await frames(2);
      check((await game(() => document.querySelector('.hud-loupe .label').textContent)).startsWith('Split 17'), 'the magnifier names the split under the finger');
      await touch('touchEnd', await spot('split:17-20'));
      await frames(2);
      check(Object.values((await state()).placements).includes('split:17-20'), 'lifting the finger bets on the split');
      // Tap a chip to pick it up, tap black to put it there.
      const red = Object.entries((await state()).placements).find(([, b]) => b === 'red')[0];
      await tap(await chip(red), 'the chip on red');
      check((await game(() => window.__roulette.game.selectedChip)) === red, 'a tap picks a chip up');
      await tap(await spot('black'), 'black');
      check((await state()).placements[red] === 'black', 'the next tap puts it on black');
      await layout('felt', 'betting up close');
    }

    // Spin with the SPIN button until the night is over.
    while ((await state()).phase === 'betting') {
      const before = (await state()).spinsLeft;
      await tapElement('.hud-spin');
      check(await game(() => window.__roulette.game.busy), `SPIN spins (night ${night}, ${before} left)`);
      await idle();
      await still();
    }
    check((await state()).phase === 'nightOver', `night ${night} is over`);
    await layout('table', `night ${night} over`);

    // A swipe across the floor turns to the Cage.
    await slide({ x: W * 0.06, y: H * 0.62 }, { x: W * 0.32, y: H * 0.6 });
    await still();
    check((await state()).view === 'cage', 'a swipe to the right turns to the Cage');
    await layout('cage', 'the Cage');
    if ((await state()).coins > 0) {
      const coins = (await state()).coins;
      await tap(await roleAt('cage', 'cage-button', 'bankAll'), 'Bank all');
      check((await state()).coins === 0 && (await state()).deposited >= coins, `Bank all banks ${coins} coins`);
    }
    await tapElement('.hud-nav-right');
    await still();
    check((await state()).view === 'table', 'the edge tab turns back to the table');

    // The end card ends the night (a card asks first if the Cage cannot be covered).
    await tap(await roleAt('table', 'end-card'), 'the end card');
    await frames(3);
    if (await game(() => !!document.querySelector('.modal-backdrop.show') && !document.querySelector('.modal-backdrop.show.paid'))) {
      await tapElement('.modal-backdrop.show .modal-btn.primary');
    }
    await frames(3);
    s = await state();
    check(night < 3 ? s.phase === 'roundStart' && s.round === night + 1 : s.phase === 'gameOver' || s.debt === 2, night < 3 ? `the end card ends night ${night}` : 'the Cage collects at the end of night 3');

    // Between nights, the Cabinet: a compartment's card, then Buy.
    if (night < 3 && !bought) {
      await tapElement('.hud-nav-right');
      await still();
      check((await state()).view === 'cabinet', 'the edge tab turns to the Cabinet');
      await layout('cabinet', 'the Cabinet');
      const rail = (await state()).rail;
      const slotPos = await game(() => window.__roulette.game.screenPosition(window.__roulette.cabinet.slotWorldPosition(0)));
      await tap(slotPos, 'the first compartment');
      check(await game(() => !!document.querySelector('.modal-backdrop.show')), 'a tap on a compartment opens its card, buying nothing');
      check((await state()).rail === rail, 'nothing was bought by the tap');
      const label = await game(() => document.querySelector('.modal-backdrop.show .modal-btn.primary').textContent);
      if ((await state()).tokens >= Number(label.match(/\d+/)[0])) {
        await cardButton('Buy');
        await frames(3);
        check((await state()).rail === rail + 1, 'Buy on its card hangs the talisman');
        bought = true;
      } else {
        await cardButton('Not now');
      }
      await tapElement('.hud-nav-left');
      await still();
      check((await state()).view === 'table', 'and back to the table');
    }
  }

  // Whatever the Cage decided, its card answers a tap.
  await page.waitForSelector('.modal-backdrop.show', { timeout: 60000 });
  await tapElement('.modal-backdrop.show .modal-btn.primary');
  await frames(3);
  const end = await state();
  check(end.phase === 'roundStart', `play goes on by touch (debt ${end.debt})`);
  check(!problems.length, 'no page or console errors');
  console.log('\nTouch playthrough passed.');
} catch (e) {
  console.log(e.message);
  for (const p of problems) console.log(p);
  const shot = `${tmpdir()}/touch-failure.png`;
  await page.screenshot({ path: shot }).catch(() => {});
  console.log(`Screenshot: ${shot}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
