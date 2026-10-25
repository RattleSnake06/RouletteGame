// The Google Play graphics (store/PLAY.md), rendered from the game itself in
// headless Chromium: eight phone screenshots at 1920×1080 (a 960×540 phone
// screen at twice the pixels), the 1024×500 feature graphic and the 512 px
// icon, drawn from the launcher icon's own vector paths. They land in
// store/out/, which is not kept: run this again after the game changes.
//
//   npm run store-art
//   CHROME_PATH=/path/to/chrome npm run store-art
//
// Software WebGL is slow (a frame can take seconds at this size), so every
// scene is set up through the dev build's page hooks with the camera cut,
// and given frames to settle before its picture.

import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const root = new URL('..', import.meta.url).pathname;
const out = new URL('./out/', import.meta.url).pathname;
fs.mkdirSync(out, { recursive: true });
const only = process.argv.slice(2);
const wanted = (name) => !only.length || only.some((o) => name.startsWith(o));
// A group of pictures is opened when any of them is wanted.
const section = (prefix) => !only.length || only.some((o) => o.startsWith(prefix) || prefix.startsWith(o));

const server = await createServer({ root, logLevel: 'error', server: { port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const problems = [];

/** A page on a fresh profile, at a phone's size, the game booted on a seeded run. */
async function openGame(width, height, scale) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`console error: ${m.text()}`));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('store-art')) return;
    sessionStorage.setItem('store-art', '1');
    localStorage.clear();
    localStorage.setItem('rien-ne-va-plus.settings', JSON.stringify({ quality: 'high', tips: false, fast: false }));
  });
  await page.goto(`${url}?seed=HALL-0666`);
  await page.waitForFunction(() => window.__roulette?.game?.state, null, { timeout: 300000 });
  const G = (fn, arg) => page.evaluate(fn, arg);
  const frames = (n) => G((n) => new Promise((r) => {
    let k = 0;
    const f = () => (++k >= n ? r() : requestAnimationFrame(f));
    requestAnimationFrame(f);
  }), n);
  // The sculpted people arrive a little after the room: wait for their full meshes.
  await page.waitForFunction(() => {
    const full = (g) => {
      let ok = false;
      g?.traverse((o) => { if (o.isMesh && o.visible && (o.geometry?.index?.count ?? 0) > 60000) ok = true; });
      return ok;
    };
    const s = window.__roulette.stage;
    return full(s.figure?.group) && full(s.scene.getObjectByName('madame-zero'));
  }, null, { timeout: 600000, polling: 2000 }).catch(() => problems.push('the sculpted people never arrived in full'));
  // The phone app starts on Low, which has no bloom, and in these stills
  // bloom washes the lamp-lit felt and its chips out: the pictures keep
  // High's resolution and shadows and leave bloom off.
  await G(() => {
    window.__roulette.stage.post.bloom.enabled = false;
  });
  return { ctx, page, G, frames };
}

async function shot(page, frames, name, settle = 10, type = 'jpeg') {
  await frames(settle);
  const path = `${out}${name}.${type === 'png' ? 'png' : 'jpg'}`;
  // A frame of the full room at this size can take a minute in software WebGL.
  await page.screenshot({ path, type, timeout: 600000, ...(type === 'jpeg' ? { quality: 92 } : {}) });
  console.log(`  ${name}`);
}

const cut = (G, view) => G((view) => {
  const r = window.__roulette;
  if (view !== 'menu' && view !== 'wide') r.game.turnTo(view);
  r.director.goTo(view, { cut: true });
}, view);

// ---- The phone screenshots ---------------------------------------------------------
if (section('phone')) {
  const { ctx, page, G, frames } = await openGame(960, 540, 2);

  if (wanted('phone-1')) {
    // The main menu: the title in the dark, Madame Zero awake in her booth.
    await G(() => window.__roulette.game.showMainMenu({ cut: true }));
    await shot(page, frames, 'phone-1', 14);
  }

  // A run under way: a long night, six charms on the rail, chips on the felt
  // and the House about to lean.
  await G(() => {
    const r = window.__roulette;
    const g = r.game;
    if (g.atMenu) g.leaveMenu();
    g.chooseByIndex(0);
    for (const id of ['four_leaf_clover', 'twin_mirrors', 'horseshoe', 'red_ribbon', 'glass_eye', 'the_pyre']) r.debug.grant(id);
    r.debug.addCoins(318);
    r.debug.addTokens(9);
    g.placeChip('c1', 'red');
    g.placeChip('c2', 'straight:17');
    g.placeChip('c3', 'dozen:2');
    r.debug.lean(4);
  });
  if (wanted('phone-2')) {
    await cut(G, 'table');
    // The charms slide onto their hooks a step a frame.
    await shot(page, frames, 'phone-2', 24);
  }

  if (wanted('phone-3')) {
    // The wide shot while the ball runs.
    await G(() => window.__roulette.game.requestSpin());
    await page.waitForFunction(() => window.__roulette.director.current === 'wide' && !window.__roulette.director.tween, null, { timeout: 300000, polling: 500 });
    await shot(page, frames, 'phone-3', 6);
    await page.waitForFunction(() => !window.__roulette.game.busy, null, { timeout: 600000, polling: 1000 });
  }

  if (wanted('phone-4')) {
    // Madame Zero deals her three cards.
    await cut(G, 'oracle');
    await frames(4);
    await G(() => window.__roulette.game.pullLever());
    await page.waitForFunction(() => !window.__roulette.game.busy, null, { timeout: 300000, polling: 500 });
    await shot(page, frames, 'phone-4', 16);
  }

  if (wanted('phone-5')) {
    // The Curio Cabinet, stocked with rare things.
    await G(() => {
      const g = window.__roulette.game;
      const s = g.state;
      const slots = [
        { kind: 'talisman', id: 'golden_ball', sold: false },
        { kind: 'talisman', id: 'tuning_fork', sold: false, engraving: 'keen' },
        { kind: 'talisman', id: 'black_cat', sold: false },
        { kind: 'oddity', id: 'gold_leaf', sold: false },
      ];
      g.state = { ...s, cabinet: { ...s.cabinet, slots } };
      g.syncAll();
    });
    await cut(G, 'cabinet');
    await shot(page, frames, 'phone-5', 14);
  }

  if (wanted('phone-6')) {
    // The felt close-up with the racetrack open, chips on it.
    await G(() => {
      const r = window.__roulette;
      const g = r.game;
      g.state = { ...g.state, boons: [...g.state.boons, { uid: 'b-store', id: 'neighbours_talk', data: {} }] };
      if (g.state.rail.length >= g.state.railHooks) g.state = { ...g.state, railHooks: g.state.railHooks + 1 };
      r.debug.grant('croupiers_glove');
      g.syncAll();
      g.placeChip('c1', 'voisins');
      g.placeChip('c3', 'split:17-20');
    });
    await cut(G, 'table');
    await G(() => window.__roulette.game.zoomFelt(true));
    await G(() => window.__roulette.director.goTo('felt', { cut: true }));
    await shot(page, frames, 'phone-6', 12);
    await G(() => window.__roulette.game.zoomFelt(false));
  }

  if (wanted('phone-7')) {
    // The Vault, three compartments open on what their locks opened.
    await G(() => {
      const g = window.__roulette.game;
      g.profile = { ...g.profile, locks: 3, vaultSeen: 3, edge: 2, unlocked: ['normal', 'clay', 'bone', 'glass'] };
      g.showMainMenu({ cut: true });
      g.openVault();
    });
    await shot(page, frames, 'phone-7', 14);
    await G(() => window.__roulette.game.vaultScreen?.close());
  }

  if (wanted('phone-8')) {
    // The chip select: every set and starting wheel open.
    await G(() => {
      const g = window.__roulette.game;
      g.profile = { ...g.profile, unlocked: ['normal', 'clay', 'bone', 'glass', 'gold'], best: { normal: 6, clay: 4, bone: 5, glass: 4, gold: 2 }, locks: 4, vault: true, edge: 3 };
      g.openChipSelect();
    });
    await shot(page, frames, 'phone-8', 12);
  }
  await ctx.close();
}

// ---- The feature graphic -----------------------------------------------------------
if (wanted('feature')) {
  // The main menu at the banner's own size, its buttons hidden: the title on
  // the left in the dark, Madame Zero on the right.
  const { ctx, page, G, frames } = await openGame(1024, 500, 1);
  await page.addStyleTag({ content: '.ts-menu, .ts-whisper { visibility: hidden !important; }' });
  await G(() => window.__roulette.game.showMainMenu({ cut: true }));
  await shot(page, frames, 'feature-1024x500', 16);
  await ctx.close();
}

// ---- The icon ----------------------------------------------------------------------
if (wanted('icon')) {
  // The launcher icon's paths, on a full square: Play rounds the corners itself.
  const xml = fs.readFileSync(`${root}android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml`, 'utf8');
  const paths = [...xml.matchAll(/fillColor="#FF([0-9A-F]{6})" android:pathData="([^"]+)"/g)].map(([, c, d]) => `<path fill="#${c}" d="${d}"/>`).join('');
  // The wheel fills the square to about four fifths of its width.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="512" height="512"><rect width="108" height="108" fill="#0B0909"/><g transform="translate(54 54) scale(1.6) translate(-54 -54)">${paths}</g></svg>`;
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
  await page.setContent(`<style>html,body{margin:0;background:#0B0909}</style>${svg}`);
  await page.screenshot({ path: `${out}icon-512.png`, type: 'png' });
  console.log('  icon-512');
  await page.close();
}

await browser.close();
await server.close();
if (problems.length) console.log(`\n${problems.length} problem(s):\n${[...new Set(problems)].join('\n')}`);
console.log(`\nStore art in ${out}`);
