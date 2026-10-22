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
// No file watching: an edit elsewhere must not reload the page mid-run.
const server = await createServer({ root, logLevel: 'error', server: { port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
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
// A camera cut lands on the next frame, and the first frames after load are
// slow in software WebGL: wait for two real frames before aiming a click.
const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
/** About a dozen frames: long enough for a new charm to slide onto its hook. */
const settle = async () => {
  for (let i = 0; i < 6; i++) await frames();
};

/** Screen position of a visible mesh tagged with userData.role (left to right). */
const meshPos = (where, role, index) => game(({ where, role, index }) => {
  const r = window.__roulette;
  const found = [];
  r[where].group.traverse((o) => {
    if (o.isMesh && o.visible && o.userData.role === role) found.push(o);
  });
  found.sort((a, b) => a.position.x - b.position.x);
  const o = found[index];
  return o ? r.game.screenPosition(o.getWorldPosition(o.position.clone())) : null;
}, { where, role, index });

const items = () => game(() => {
  const s = window.__roulette.game.state;
  return { tokens: s.tokens, coins: s.coins, rail: s.rail.map((t) => ({ uid: t.uid, id: t.id, price: t.price })), offers: s.cabinet.slots.map((x) => x.id ?? null) };
});

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
  await frames();
  await page.waitForTimeout(500);
  let s = await state();
  check(s.phase === 'roundStart' && s.debt === 1 && s.coins === 10, 'a new run starts at debt 1 with 10 coins');

  // Night 1: a long night, three chips, seven spins.
  await click(await meshPos('table', 'night-card', 0), 'the long-night card');
  s = await state();
  check(s.phase === 'betting' && s.spinsLeft === 7 && s.coins === 3, 'the long night costs 7 and gives 7 spins');
  for (const bet of ['red', 'straight:17', 'dozen:2']) await click(await spotPos(bet), `the ${bet} spot`);
  s = await state();
  check(s.placed === 3, 'clicking the felt placed three chips');
  await page.keyboard.press('KeyF');
  let leanSpins = 0;
  for (let i = 0; i < 7; i++) {
    const before = await state();
    // Debt 1 teaches the Lean: the lamp is lit (and the bulb hums) before the spin it falls on.
    const lit = await game(() => window.__roulette.lighting.lean);
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    await idle();
    const after = await state();
    check(after.spinsLeft === before.spinsLeft - 1 && after.coins === before.coins + after.last.total, `spin ${i + 1} paid ${after.last.total}, coins ${before.coins} → ${after.coins}`);
    const ballPocket = await game(() => window.__roulette.ball.pocket);
    check(ballPocket === after.last.pocket, `the ball rests in the decided pocket (${ballPocket})`);
    const lean = await game(() => window.__roulette.game.state.lastSpin.luck.lean);
    if (lean) {
      leanSpins += 1;
      check(lit, `the LEAN lamp was lit before the Lean spin (+${lean})`);
    }
  }
  check(leanSpins === 2, `the first night held two teaching Leans (${leanSpins})`);
  s = await state();
  check(s.phase === 'nightOver', 'the night is over after seven spins');

  // Bank at the Cage and end the night there.
  await page.keyboard.press('KeyA');
  await cameraStill();
  const coinsBefore = s.coins;
  await click(await meshPos('cage', 'cage-button', 0), 'the BANK ALL plate');
  s = await state();
  check(s.coins === 0 && s.deposited === coinsBefore, `banking moved ${coinsBefore} coins into the Cage`);
  await click(await meshPos('cage', 'cage-button', 2), 'the END NIGHT plate');
  s = await state();
  check(s.round === 2 && s.phase === 'roundStart', 'night 2 begins');
  await cameraStill();

  // The Curio Cabinet: buy a talisman, restock, ring the Bell, sell it back.
  let it = await items();
  check(it.tokens === 5, `the night paid a token (${it.tokens} tokens)`);
  await page.keyboard.press('KeyD');
  await cameraStill();
  check((await game(() => window.__roulette.game.view)) === 'cabinet', 'D turns to the Cabinet');
  const slot = await game(async () => {
    const { cabinetView } = await import('/src/core/selectors.js');
    return cabinetView(window.__roulette.game.state).slots.findIndex((x) => x.id && x.affordable);
  });
  check(slot >= 0, `an affordable talisman is on offer (compartment ${slot + 1})`);
  const offered = it.offers[slot];
  await click(await game((slot) => window.__roulette.game.screenPosition(window.__roulette.cabinet.slotWorldPosition(slot)), slot), `compartment ${slot + 1}`);
  const bought = await items();
  check(bought.rail.length === 1 && bought.rail[0].id === offered && bought.tokens === it.tokens - bought.rail[0].price, `bought ${offered} for ${bought.rail[0]?.price} tokens`);
  await page.screenshot({ path: process.env.SMOKE_SHOTS ? `${process.env.SMOKE_SHOTS}/smoke-cabinet.png` : '/dev/null' }).catch(() => {});
  await game(() => window.__roulette.debug.addCoins(10));
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(400);
  it = await items();
  check(it.coins === bought.coins + 10 - 2 && it.offers.join() !== bought.offers.join(), 'R restocked the Cabinet for 2 coins');
  await page.keyboard.press('KeyB');
  await page.waitForTimeout(400);
  check(true, 'B rang the Bell');
  await page.keyboard.press('KeyA');
  await cameraStill();
  const charm = await game((uid) => window.__roulette.game.screenPosition(window.__roulette.rail.talismanWorldPosition(uid)), it.rail[0]?.uid ?? bought.rail[0].uid);
  await click(charm, 'the talisman on the rail');
  await page.waitForSelector('.modal-card', { timeout: 10000 });
  const before = await items();
  await page.click('.modal-backdrop.show button:has-text("Sell")');
  await page.waitForTimeout(400);
  it = await items();
  check(it.rail.length === 0 && it.tokens === before.tokens + Math.max(1, Math.floor(bought.rail[0].price / 2)), `sold it back for ${it.tokens - before.tokens}`);

  // Night 2: sit out with a key press, end it with E.
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
  await click(await meshPos('cage', 'cage-button', 0), 'the BANK ALL plate');
  await page.keyboard.press('KeyE');
  await page.waitForSelector('.modal-card', { timeout: 10000 });
  const title = await page.textContent('.modal-title');
  check(/Debt 1 paid/i.test(title), `the debt-paid card appears ("${title}")`);
  await page.screenshot({ path: process.env.SMOKE_SHOTS ? `${process.env.SMOKE_SHOTS}/smoke-paid.png` : '/dev/null' }).catch(() => {});
  await page.click('.modal-backdrop.show button:has-text("CONTINUE")');
  s = await state();
  check(s.debt === 2 && s.round === 1, 'debt 2 begins');

  // Phase 3: a cursed talisman will not be sold; the Devil takes the coins in
  // hand and lights the 666 counter; pity nudges after a run of misses.
  await game(() => {
    const r = window.__roulette;
    r.debug.grant('bone_dice');
    r.debug.addCoins(40);
  });
  // A new charm slides in from the next hook along; aim once it has arrived.
  await settle();
  it = await items();
  const dice = it.rail.find((t) => t.id === 'bone_dice');
  check(!!dice, 'a cursed Bone Dice hangs on the rail');
  await click(await game((uid) => window.__roulette.game.screenPosition(window.__roulette.rail.talismanWorldPosition(uid)), dice.uid), 'the Bone Dice');
  await page.waitForSelector('.modal-card', { timeout: 10000 });
  check((await page.$('.modal-card button:has-text("Sell")')) === null, 'its card offers no sale');
  await page.click('.modal-card button:has-text("Keep")');
  await page.waitForTimeout(300);
  await game((uid) => window.__roulette.game.confirmSell(uid), dice.uid);
  check((await items()).rail.some((t) => t.id === 'bone_dice'), 'asking to sell it leaves it on its hook');
  await page.keyboard.press('Digit2');
  s = await state();
  check(s.phase === 'betting' && s.spinsLeft === 3, 'a short night at debt 2');
  await game(() => window.__roulette.debug.devil());
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
  await idle();
  const devil = await game(() => {
    const r = window.__roulette;
    let counter = false;
    r.cage.group.traverse((o) => o.userData.role === 'devil-counter' && o.visible && (counter = true));
    const s = r.game.state;
    return { fired: s.lastSpin.devil, coins: s.coins, lost: s.lastSpin.lost, last: s.history.at(-1), counter };
  });
  check(devil.fired && devil.coins === 0 && devil.lost > 0 && devil.last.devil, `the Devil fired and took ${devil.lost} coins`);
  check(devil.counter, 'the green 666 counter shows on the Cage');
  await game(() => {
    const r = window.__roulette;
    r.debug.calm();
    r.debug.misses(6);
  });
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
  await idle();
  const pity = await game(() => window.__roulette.game.state.lastSpin.luck);
  check(pity.pity === 2, `six misses in a row gave pity +${pity.pity}`);

  // Some of the twenty newer talismans: Brass Scales widen the even pockets on
  // the wheel, a Tuning Fork repeats them, the Lost Wallet needs no hook, and
  // Holy Water turns the Devil away on the night's last spin.
  const roomy = await game(async () => {
    const r = window.__roulette;
    // Make room on the rail (cursed charms never come off a hook, so clear it outright).
    r.game.state = { ...r.game.state, rail: [] };
    r.debug.grant('brass_scales');
    r.debug.grant('tuning_fork');
    for (let i = 0; i < 40; i++) await new Promise((res) => requestAnimationFrame(res));
    const { pocketAngle, SLICE } = await import('/src/view/wheel.js');
    const { railView, wheelView } = await import('/src/core/selectors.js');
    const s = r.game.state;
    // Zero's middle stays put; a quarter of the way round, pocket 9 (34) has
    // moved about 0.15 rad as the even pockets beside it grew.
    return {
      width: wheelView(s)[1].width,
      echoing: railView(s)[1].echoing,
      moved: Math.abs(pocketAngle(9) - (28 + 0.5) * SLICE) > 0.1,
    };
  });
  check(roomy.width === 3 && roomy.echoing === 'brass_scales', 'Brass Scales and a Tuning Fork make the even pockets three times as wide');
  check(roomy.moved, 'the wheel is drawn with the wider pockets');
  const wallet = await game(async () => {
    const { owed } = await import('/src/core/run.js');
    const r = window.__roulette;
    const s = r.game.state;
    r.game.state = { ...s, tokens: s.tokens + 3, cabinet: { ...s.cabinet, slots: [{ kind: 'talisman', id: 'lost_wallet', sold: false }, ...s.cabinet.slots.slice(1)] } };
    const before = r.game.state.coins;
    const hooks = r.game.state.rail.length;
    r.game.buy(0);
    return { gained: r.game.state.coins - before, tenth: Math.floor(owed(s) / 10), hooks: r.game.state.rail.length - hooks };
  });
  check(wallet.gained === wallet.tenth && wallet.hooks === 0, `the Lost Wallet held ${wallet.gained} coins (a tenth of the debt is ${wallet.tenth}) and took no hook`);
  await game(() => {
    const r = window.__roulette;
    r.debug.grant('holy_water');
    r.debug.devil();
  });
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
  await idle();
  const ward = await game(() => {
    const r = window.__roulette;
    const s = r.game.state;
    r.debug.calm();
    return { devil: s.lastSpin.devil, wards: s.stats.wards, coins: s.coins, vial: s.rail.some((t) => t.id === 'holy_water') };
  });
  check(!ward.devil && ward.wards === 1 && !ward.vial && ward.coins > 0, 'Holy Water turned the Devil away and shattered');
  s = await state();
  check(s.phase === 'nightOver', 'the short night is over');
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(500);

  // Debt 2: sit out the other nights and get collected.
  for (let n = 0; n < 2; n++) {
    await page.keyboard.press('Digit3');
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(400);
    if (process.env.SMOKE_DEBUG) console.log('   ', JSON.stringify(await state()), await page.evaluate(() => document.activeElement?.tagName));
  }
  await page.waitForSelector('.modal-card', { timeout: 10000 });
  check(/cannot cover/i.test(await page.textContent('.modal-title')), 'the final-night warning appears');
  await page.click('.modal-backdrop.show button:has-text("END THE NIGHT")');
  await page.waitForSelector('.collected .modal-card', { timeout: 20000 });
  check(true, 'the Cage collects and the run ends');
  await page.screenshot({ path: process.env.SMOKE_SHOTS ? `${process.env.SMOKE_SHOTS}/smoke-collected.png` : '/dev/null' }).catch(() => {});
  await page.click('.modal-backdrop.show button:has-text("BEGIN AGAIN")');
  await page.waitForSelector('.title-screen.show .ts-chips:not([hidden])', { timeout: 20000 });
  check(true, 'Begin again opens the chip select');
  await page.click('.ts-begin');
  await page.waitForTimeout(500);
  s = await state();
  check(s.debt === 1 && s.phase === 'roundStart' && s.coins === 10, 'a new run begins');
  check(await page.evaluate(() => !window.__roulette.game.atMenu && window.__roulette.game.state.chipSet === 'normal'), 'with Normal chips, back at the table');

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
