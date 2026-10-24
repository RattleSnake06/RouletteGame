// The content tour: every card Madame Zero can deal, every oddity the
// Cabinet can sell and every talisman's note and Bell, each taken through
// the game's own flow once, from the same fresh run. Where the marathon
// samples at random, this misses nothing. Fails on any page error, console
// error or a flow that never finishes.
//
//   npm run tour

import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const root = new URL('../..', import.meta.url).pathname;
const server = await createServer({ root, logLevel: 'error', server: { port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 667, height: 375 } });
const problems = [];
let where = 'boot';
page.on('pageerror', (e) => problems.push(`${where}: page error: ${e.message} ${e.stack?.split('\n')[1]?.trim() ?? ''}`));
page.on('console', (m) => m.type() === 'error' && problems.push(`${where}: console error: ${m.text()}`));
await page.addInitScript(() => {
  if (sessionStorage.getItem('seeded')) return;
  sessionStorage.setItem('seeded', '1');
  localStorage.setItem('rien-ne-va-plus.settings', JSON.stringify({ quality: 'low', fast: true, tips: false }));
});
await page.goto(`${server.resolvedUrls.local[0]}?seed=TOUR-0001`);
await page.waitForFunction(() => window.__roulette?.game?.state, null, { timeout: 180000 });

const G = (fn, arg) => page.evaluate(fn, arg).catch((e) => {
  if (!/Execution context was destroyed|Target closed/.test(e.message)) problems.push(`${where}: threw: ${e.message.split('\n')[0]}`);
  return null;
});
const frames = (n = 2) => G((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
async function idle() {
  try {
    await page.waitForFunction(() => !window.__roulette.game.busy && !window.__roulette.director.tween, null, { timeout: 240000, polling: 250 });
  } catch {
    problems.push(`${where}: never finished`);
    await G(() => { window.__roulette.game.busy = false; });
  }
}
/** Presses the first button of each card that comes up (the choice, or the way out). */
async function closeCards() {
  for (let k = 0; k < 6; k++) {
    const open = await G(() => {
      const top = [...document.querySelectorAll('.modal-backdrop:not([inert])')].at(-1);
      if (!top) return false;
      const b = [...top.querySelectorAll('button')].filter((x) => x.offsetParent !== null);
      (b.find((x) => !/keep|never|neither|cancel|close|back/i.test(x.textContent)) ?? b[0])?.click();
      return true;
    });
    if (!open) return;
    await frames(3);
    await idle();
  }
}
/** Places wheel work on the first numbers that take it, as taps on the felt. */
async function placeWork() {
  for (let k = 0; k < 8; k++) {
    const more = await G(async () => {
      const g = window.__roulette.game;
      if (!g.picking) return false;
      const { pickView } = await import('/src/core/selectors.js');
      const v = pickView(g.state, g.picking.works, g.picking.chosen);
      if (!v) return false;
      if (v.bets) g.pickBet('red');
      else {
        const n = Object.keys(v.numbers).map(Number).find((x) => (Array.isArray(v.numbers[x]) ? v.numbers[x].length : v.numbers[x]));
        if (n === undefined) g.cancelPick();
        else if (v.work.op === 'stamp' && !g.picking.stamp) g.pickPocket(v.numbers[n][0].id);
        else g.pickBet(`straight:${n}`);
      }
      return true;
    });
    if (!more) return;
    await frames(3);
    await closeCards();
    await idle();
  }
  await G(() => window.__roulette.game.cancelPick());
}

// A run with plenty, on the first night, kept to come back to between items.
await G(() => { const g = window.__roulette.game; g.chooseByIndex(1); });
await idle();
await G(() => { const d = window.__roulette.debug; d.addCoins(1e6); d.addTokens(200); });
const fresh = await G(async () => (await import('/src/core/save.js')).serializeRun(window.__roulette.game.state));
const restore = () => G(async (json) => {
  const g = window.__roulette.game;
  g.cancelPick();
  g.state = (await import('/src/core/save.js')).deserializeRun(json);
  g.save();
  g.syncAll();
}, fresh);
const content = await G(async () => {
  const c = await import('/src/core/content/index.js');
  const { ODDITY_LIST } = await import('/src/core/content/oddities.js');
  return { fortunes: c.FORTUNES.map((f) => ({ id: f.id, kind: f.kind ?? (f.black ? 'black' : 'white') })), oddities: ODDITY_LIST.map((o) => ({ id: o.id, record: !!o.gives?.record })), talismans: c.TALISMANS.map((t) => ({ id: t.id, bell: !!t.bell })), records: c.RECORDS.map((r) => r.id) };
});

console.log(`tour: ${content.fortunes.length} cards, ${content.oddities.length} oddities, ${content.talismans.length} talismans`);

for (const f of content.fortunes) {
  where = `card ${f.id}`;
  await restore();
  await G(() => window.__roulette.game.turnTo('oracle'));
  await idle();
  // Her deal, with this card first.
  await G((f) => {
    const g = window.__roulette.game;
    g.state = { ...g.state, oracle: { debt: g.state.debt, kind: f.kind, cards: [f.id], rerolls: 0, taken: null } };
    g.syncAll();
    g.takeFortune(0);
  }, f);
  await frames(3);
  await idle();
  await closeCards();
  await placeWork();
}

for (const { id, record } of content.oddities) {
  where = `oddity ${id}`;
  await restore();
  await G(() => window.__roulette.game.turnTo('cabinet'));
  await idle();
  await G(({ id, record, records }) => {
    const g = window.__roulette.game;
    const slots = [...g.state.cabinet.slots];
    const offer = { kind: 'oddity', id, sold: false };
    if (record) offer.record = records.find((r) => !g.state.records.includes(r));
    slots[3] = offer;
    g.state = { ...g.state, cabinet: { ...g.state.cabinet, slots } };
    g.syncAll();
    g.buy(3);
  }, { id, record, records: content.records });
  await frames(3);
  await closeCards();
  await placeWork();
  await closeCards();
}

for (const t of content.talismans) {
  where = `talisman ${t.id}`;
  await restore();
  await G((id) => {
    const g = window.__roulette.game;
    window.__roulette.debug.grant(id);
    const inst = g.state.rail.at(-1);
    if (inst) g.openTalisman(inst.uid);
  }, t.id);
  await frames(3);
  await closeCards();
  if (t.bell) {
    await G(() => { const g = window.__roulette.game; const inst = g.state.rail.at(-1); if (inst) g.ringBell(inst.uid); });
    await frames(3);
    await idle();
    await closeCards();
    await placeWork();
  }
}

console.log(problems.length ? `\n${problems.length} problem(s):\n${[...new Set(problems)].join('\n')}` : 'tour: no problems');
await browser.close();
await server.close();
process.exitCode = problems.length ? 1 : 0;
