// End-to-end smoke test: boots the game in headless Chromium and plays a
// debt through real clicks and keys, then gets collected and starts again.
// Fails on any page error or console error.
//
//   npm run smoke                       (uses Playwright's Chromium)
//   CHROME_PATH=/path/to/chrome npm run smoke
//
// Software WebGL is slow (a few fps), so this takes a few minutes.

import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const root = new URL('../..', import.meta.url).pathname;
const server = await createServer({ root, logLevel: 'error', server: { port: 0, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 688, height: 376 } });
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
const state = () => game(() => {
  const s = window.__roulette.game.state;
  return { phase: s.phase, debt: s.debt, round: s.round, coins: s.coins, deposited: s.deposited, spinsLeft: s.spinsLeft, placed: Object.keys(s.placements).length, last: s.lastSpin && { total: s.lastSpin.total, pocket: s.lastSpin.pocketIndex } };
});
const idle = () => page.waitForFunction(() => !window.__roulette.game.busy, null, { timeout: 300000 });
const cameraStill = () => page.waitForFunction(() => !window.__roulette.director.tween, null, { timeout: 120000 });

/** Screen position of a mesh found by a predicate over the table or cage. */
const meshPos = (where, kind, index) => game(({ where, kind, index }) => {
  const r = window.__roulette;
  const found = [];
  r[where].group.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const g = o.geometry.parameters ?? {};
    if (kind === 'card' && o.geometry.type === 'PlaneGeometry' && g.width < 0.2) found.push(o);
    if (kind === 'plate' && o.geometry.type === 'BoxGeometry' && Math.abs(g.width - 0.34) < 1e-6) found.push(o);
  });
  found.sort((a, b) => a.position.x - b.position.x);
  const o = found[index];
  return o ? r.game.screenPosition(o.getWorldPosition(o.position.clone())) : null;
}, { where, kind, index });

const spotPos = (betId) => game(async (betId) => {
  const r = window.__roulette;
  const { SPOTS } = await import('/src/view/felt.js');
  let felt;
  r.table.group.traverse((o) => { if (o.isMesh && o.geometry.type === 'PlaneGeometry' && o.geometry.parameters.width > 1) felt ??= o; });
  const s = SPOTS.get(betId);
  const l = r.table.felt.toLocal(s.x, s.y);
  const v = felt.position.clone();
  v.x = l.x;
  v.z = felt.position.z + l.z;
  return r.game.screenPosition(r.table.group.localToWorld(v));
}, betId);

async function click(pos, what) {
  check(!!pos, `${what} is on screen`);
  await page.mouse.move(pos.x, pos.y);
  await page.waitForTimeout(250);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(400);
}

try {
  console.log(`Smoke test against ${url}`);
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${url}?seed=SMOKE-TEST`);
  await page.waitForFunction(() => window.__roulette, null, { timeout: 120000 });
  await page.waitForTimeout(1000);
  await game(() => {
    const r = window.__roulette;
    r.director.goTo('table', { cut: true });
    r.stage.setFigureGhost(true);
  });
  await page.waitForTimeout(1000);
  let s = await state();
  check(s.phase === 'roundStart' && s.debt === 1 && s.coins === 10, 'a new run starts at debt 1 with 10 coins');

  // Night 1: a long night, three chips, seven spins.
  await click(await meshPos('table', 'card', 0), 'the long-night card');
  s = await state();
  check(s.phase === 'betting' && s.spinsLeft === 7 && s.coins === 3, 'the long night costs 7 and gives 7 spins');
  for (const bet of ['red', 'straight:17', 'dozen:2']) await click(await spotPos(bet), `the ${bet} spot`);
  s = await state();
  check(s.placed === 3, 'clicking the felt placed three chips');
  await page.keyboard.press('KeyF');
  for (let i = 0; i < 7; i++) {
    const before = await state();
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    await idle();
    const after = await state();
    check(after.spinsLeft === before.spinsLeft - 1 && after.coins === before.coins + after.last.total, `spin ${i + 1} paid ${after.last.total}, coins ${before.coins} → ${after.coins}`);
    const ballPocket = await game(() => window.__roulette.ball.pocket);
    check(ballPocket === after.last.pocket, `the ball rests in the decided pocket (${ballPocket})`);
  }
  s = await state();
  check(s.phase === 'nightOver', 'the night is over after seven spins');

  // Bank at the Cage and end the night there.
  await page.keyboard.press('KeyA');
  await cameraStill();
  const coinsBefore = s.coins;
  await click(await meshPos('cage', 'plate', 0), 'the BANK ALL plate');
  s = await state();
  check(s.coins === 0 && s.deposited === coinsBefore, `banking moved ${coinsBefore} coins into the Cage`);
  await click(await meshPos('cage', 'plate', 2), 'the END NIGHT plate');
  s = await state();
  check(s.round === 2 && s.phase === 'roundStart', 'night 2 begins');

  // Night 2: sit out with a key press, end it with E.
  await page.keyboard.press('KeyD');
  await cameraStill();
  await page.keyboard.press('Digit3');
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(500);
  s = await state();
  check(s.round === 3 && s.phase === 'roundStart', 'sitting out night 2 moves to night 3');

  // Night 3: top up (no items exist yet to earn it), bank, and pay the debt.
  await game(() => window.__roulette.debug.addCoins(100));
  await page.keyboard.press('Digit3');
  await page.keyboard.press('KeyA');
  await cameraStill();
  await click(await meshPos('cage', 'plate', 0), 'the BANK ALL plate');
  await page.keyboard.press('KeyE');
  await page.waitForSelector('.modal-card', { timeout: 10000 });
  const title = await page.textContent('.modal-title');
  check(/Debt 1 paid/i.test(title), `the debt-paid card appears ("${title}")`);
  await page.screenshot({ path: process.env.SMOKE_SHOTS ? `${process.env.SMOKE_SHOTS}/smoke-paid.png` : '/dev/null' }).catch(() => {});
  await page.click('button:has-text("CONTINUE")');
  s = await state();
  check(s.debt === 2 && s.round === 1, 'debt 2 begins');

  // Debt 2: sit out every night and get collected.
  for (let n = 0; n < 3; n++) {
    await page.keyboard.press('Digit3');
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(400);
    if (process.env.SMOKE_DEBUG) console.log('   ', JSON.stringify(await state()), await page.evaluate(() => document.activeElement?.tagName));
  }
  await page.waitForSelector('.modal-card', { timeout: 10000 });
  check(/cannot cover/i.test(await page.textContent('.modal-title')), 'the final-night warning appears');
  await page.click('button:has-text("END THE NIGHT")');
  await page.waitForSelector('.collected .modal-card', { timeout: 20000 });
  check(true, 'the Cage collects and the run ends');
  await page.screenshot({ path: process.env.SMOKE_SHOTS ? `${process.env.SMOKE_SHOTS}/smoke-collected.png` : '/dev/null' }).catch(() => {});
  await page.click('button:has-text("BEGIN AGAIN")');
  await page.waitForTimeout(500);
  s = await state();
  check(s.debt === 1 && s.phase === 'roundStart' && s.coins === 10, 'a new run begins');

  check(problems.length === 0, `no page or console errors${problems.length ? `: ${problems.join('; ')}` : ''}`);
  console.log('Smoke test passed.');
} catch (e) {
  console.error(e.message);
  if (problems.length) console.error(problems.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
