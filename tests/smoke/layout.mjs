// Phone layout check (design doc 9.10, decision 19): at three landscape phone
// sizes, with touch, every control must be reachable and none may cover
// another. For each station it checks that
//   - every HUD control is at least 44 px square and is what a tap at its
//     centre would hit (nothing lies on top of it), and no two overlap;
//   - every clickable object in the room (bet spots, cards, buttons, charms,
//     the Bell...) that is on screen is not covered by any HTML element.
// Objects in the room that act (buttons, cards, compartments, charms, the
// Bell) must also give a finger 44 px; ones that only show a note (the board,
// the plaques, the 666 counter, the chart) and the felt's bet spots, which the
// close-up and its magnifier serve, are listed as warnings when smaller.
//
//   npm run layout
//   CHROME_PATH=/path/to/chrome npm run layout

import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { MIN, ROLES, measure } from './measure.mjs';

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
      else if (view !== 'menu') r.game.turnTo(view);
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
    const r = window.__roulette;
    const g = r.game;
    // Charms on the rail, one with a Bell tag.
    r.debug.grant('wheel_of_fortune');
    r.debug.grant('red_ribbon');
    g.choosePackage('long');
    g.placeChip('c1', 'red');
    g.placeChip('c2', 'straight:17');
  });
  await at('felt close-up', 'felt');
  await at('cabinet', 'cabinet');
  await at('cage', 'cage');
  await at('Madame Zero', 'oracle');
  await at('Madame Zero, a deal', 'oracle', () => window.__roulette.game.pullLever());
  await at('a fortune card', 'oracle', () => window.__roulette.game.offerCard(0));
  await at('the gramophone', 'oracle', () => {
    document.querySelector('.modal-backdrop.show button')?.click();
    window.__roulette.game.takeFortune(0);
    window.__roulette.game.openCrate();
  });
  await at('Madame Zero, after a card', 'oracle', () => document.querySelector('.modal-backdrop.show button')?.click());
  await at('table, night over', 'table', () => {
    const g = window.__roulette.game;
    g.state = { ...g.state, spinsLeft: 0, phase: 'nightOver' };
    g.syncAll();
  });
  await at('pause menu', 'table', () => window.__roulette.game.toggleMenu());
  await at('a talisman card', 'table', () => {
    const r = window.__roulette;
    r.game.toggleMenu();
    r.game.openTalisman(r.game.state.rail[0].uid);
  });
  await at('main menu', 'menu', () => {
    document.querySelector('.modal-backdrop.show .modal-btn.primary')?.click();
    window.__roulette.game.showMainMenu({ cut: true });
  });
  await at('chip select', 'menu', () => {
    const g = window.__roulette.game;
    g.profile = { v: 1, unlocked: ['normal', 'clay', 'bone'], best: { normal: 4 } };
    g.openChipSelect();
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
