// The marathon: a long, legal but random run through everything the game
// can show. It hangs every talisman in turn (the dev build's debug.grant),
// spins with chips spread over every kind of bet, rings the Bell, buys from
// the Cabinet, takes Madame Zero's cards, plays every record and answers
// whatever card or picker comes up, so each item's playback, charm, note
// and sound runs at least once. Fails on any page error, console error or a
// sequence that never finishes.
//
//   npm run marathon -- [--nights 30] [--seed 1]
//
// Software WebGL is slow: allow half an hour for the default length.

import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const NIGHTS = Number(opt('nights', 30));
const SEED = Number(opt('seed', 1));
const OUT = opt('out', '/tmp');

const root = new URL('../..', import.meta.url).pathname;
const server = await createServer({ root, logLevel: 'error', server: { port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 667, height: 375 } });
const problems = new Map();
let where = 'boot';
const problem = (key, detail = '') => {
  if (problems.has(key)) return void (problems.get(key).count += 1);
  const shot = `${OUT}/marathon-${SEED}-${problems.size + 1}.png`;
  problems.set(key, { count: 1, where, detail, shot });
  page.screenshot({ path: shot }).catch(() => {});
  console.log(`  ✗ ${where}: ${key}${detail ? ` (${detail})` : ''}`);
};
page.on('pageerror', (e) => problem(`page error: ${e.message}`, e.stack?.split('\n').slice(1, 3).join(' | ')));
page.on('console', (m) => m.type() === 'error' && problem(`console error: ${m.text()}`));

await page.addInitScript(() => {
  if (sessionStorage.getItem('seeded')) return;
  sessionStorage.setItem('seeded', '1');
  localStorage.setItem('rien-ne-va-plus.settings', JSON.stringify({ quality: 'low', fast: true, tips: false }));
});
await page.goto(`${url}?seed=MARA-${SEED}`);
await page.waitForFunction(() => window.__roulette?.game?.state, null, { timeout: 180000 });

// A call into the game that throws is a bug to note, not the end of the marathon.
const G = (fn, arg) => page.evaluate(fn, arg).catch((e) => {
  if (!/Execution context was destroyed|Target closed/.test(e.message)) problem(`threw: ${e.message.split('\n')[0]}`, e.message.split('\n').slice(1, 4).join(' | '));
  return null;
});
const frames = (n = 2) => G((n) => new Promise((res) => {
  let k = 0;
  const f = () => (++k >= n ? res() : requestAnimationFrame(f));
  requestAnimationFrame(f);
}), n);

/** Waits for the game to finish what it is doing; a sequence that never ends is a bug. */
async function idle(what) {
  try {
    // A run that is over (collected, or stepped out of) stays busy on purpose.
    await page.waitForFunction(() => {
      const g = window.__roulette.game;
      return (!g.busy || g.state.phase === 'gameOver' || g.atMenu) && !window.__roulette.director.tween;
    }, null, { timeout: 420000, polling: 250 });
  } catch {
    const at = await page.evaluate(() => {
      const r = window.__roulette;
      const g = r.game;
      return `busy ${g.busy}, camera ${r.director.current}${r.director.tween ? ' (moving)' : ''}, view ${g.view}, phase ${g.state.phase}, picking ${!!g.picking}, cards ${document.querySelectorAll('.modal-backdrop:not([inert])').length}`;
    }).catch(() => '?');
    problem(`stuck after ${what}`, at);
    // Unstick, so the marathon can go on and find more.
    await G(() => { window.__roulette.game.busy = false; });
  }
}

/** Answers whatever card is up: a choice at random among its buttons, as a person would. */
async function answerCards(limit = 6) {
  for (let k = 0; k < limit; k++) {
    const buttons = await G(() => {
      const top = [...document.querySelectorAll('.modal-backdrop:not([inert])')].at(-1);
      if (!top) return null;
      return [...top.querySelectorAll('button')].filter((b) => b.offsetParent !== null).map((b, i) => ({ i, text: b.textContent.trim().slice(0, 30) }));
    });
    if (!buttons) return;
    if (!buttons.length) {
      await page.keyboard.press('Escape');
    } else {
      const b = buttons[Math.floor(rand() * buttons.length)];
      await G((i) => {
        const top = [...document.querySelectorAll('.modal-backdrop:not([inert])')].at(-1);
        [...top.querySelectorAll('button')].filter((x) => x.offsetParent !== null)[i]?.click();
      }, b.i);
    }
    await frames(3);
    await idle('answering a card');
  }
}

/** Places wheel work being picked as a person does: tapping numbers on the felt, or putting it down. */
async function answerPicker() {
  for (let k = 0; k < 10; k++) {
    const picking = await G(() => !!window.__roulette.game.picking);
    if (!picking) return;
    if (rand() < 0.08) {
      await G(() => window.__roulette.game.cancelPick());
      return;
    }
    await G(async (r) => {
      const g = window.__roulette.game;
      const { BETS } = await import('/src/core/bets.js');
      const { pickView } = await import('/src/core/selectors.js');
      const v = pickView(g.state, g.picking.works, g.picking.chosen);
      if (v?.bets) return g.pickBet(BETS[Math.floor(r * BETS.length)].id);
      // A number it can take, mostly; now and then one it cannot, to hear no.
      const ok = Object.entries(v?.numbers ?? {}).filter(([, x]) => (Array.isArray(x) ? x.length : x)).map(([n]) => Number(n));
      const n = ok.length && r < 0.85 ? ok[Math.floor(((r * 1000) % 1) * ok.length)] : Math.floor(r * 37);
      if (v?.work.op === 'stamp' && !g.picking.stamp && Array.isArray(v.numbers[n]) && v.numbers[n].length) return g.pickPocket(v.numbers[n][0].id);
      g.pickBet(`straight:${n}`);
    }, rand());
    await frames(3);
    await answerCards(2);
    await idle('placing wheel work');
  }
}

let a = SEED * 2654435761;
function rand() {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const ids = await G(async () => {
  const c = await import('/src/core/content/index.js');
  return { talismans: c.TALISMANS.map((t) => t.id), records: c.RECORDS.map((r) => r.id) };
});
let nextTalisman = 0;
const tally = { spins: 0, hung: 0, bought: 0, cards: 0, records: 0, rings: 0, debts: 0, runs: 1 };

for (let night = 1; night <= NIGHTS; night++) {
  const s = await G(() => { const s = window.__roulette.game.state; return { phase: s.phase, debt: s.debt, round: s.round, rail: s.rail.map((t) => t.uid), hooks: s.railHooks }; });
  where = `night ${night} (debt ${s.debt}, night ${s.round})`;
  console.log(`${where}: ${JSON.stringify(tally)}`);

  if (s.phase === 'gameOver') {
    await answerCards();
    await G(() => { const g = window.__roulette.game; if (g.state.phase === 'gameOver') g.newRun(); });
    tally.runs += 1;
    await idle('a new run');
    continue;
  }
  // Plenty of everything: the marathon is about showing things, not winning.
  await G(() => { const d = window.__roulette.debug; d.addCoins(1e6); d.addTokens(40); });

  // The next talismans in the list replace most of the rail.
  for (const uid of s.rail) if (rand() < 0.75) await G((uid) => window.__roulette.game.sell(uid), uid);
  for (let k = 0; k < 6; k++) {
    const id = ids.talismans[nextTalisman++ % ids.talismans.length];
    await G((id) => window.__roulette.debug.grant(id), id);
    tally.hung += 1;
  }
  await frames(4);
  await answerCards();

  if (s.phase === 'roundStart') {
    await G((i) => window.__roulette.game.chooseByIndex(i), Math.floor(rand() * 3));
    await idle('choosing a night');
    await answerCards();
  }

  // Shop, visit Madame Zero, play a record, ring the Bell, shuffle the rail: in any order.
  const errands = ['cabinet', 'oracle', 'record', 'bell', 'move'].sort(() => rand() - 0.5);
  for (const e of errands) {
    if (rand() < 0.3) continue;
    if (e === 'cabinet') {
      await G(() => window.__roulette.game.turnTo('cabinet'));
      await idle('turning to the Cabinet');
      await G((i) => window.__roulette.game.buy(i), Math.floor(rand() * 4));
      tally.bought += 1;
      await frames(3);
      await answerCards();
      await answerPicker();
      if (rand() < 0.5) await G(() => window.__roulette.game.restock());
      await answerCards();
    } else if (e === 'oracle') {
      await G(() => window.__roulette.game.turnTo('oracle'));
      await idle('turning to Madame Zero');
      await G(() => window.__roulette.game.pullLever());
      await idle('pulling the lever');
      await answerCards();
      await G((i) => window.__roulette.game.takeFortune(i), Math.floor(rand() * 3));
      tally.cards += 1;
      await idle('taking a card');
      await answerCards();
      await answerPicker();
    } else if (e === 'record') {
      // Every record in the crate, so each tune and rule gets a turn.
      const id = ids.records[(night + tally.records) % ids.records.length];
      await G((id) => {
        const g = window.__roulette.game;
        if (!g.state.records.includes(id)) g.state = { ...g.state, records: [...g.state.records, id] };
        g.playRecord(id, 0);
      }, id);
      tally.records += 1;
      await idle('playing a record');
      await answerCards();
    } else if (e === 'bell') {
      await G(() => window.__roulette.game.turnTo('table'));
      await idle('turning to the table');
      const uid = await G(async () => {
        const { getTalisman } = await import('/src/core/content/index.js');
        const t = window.__roulette.game.state.rail.find((x) => getTalisman(x.id)?.bell);
        return t?.uid ?? null;
      });
      await G((uid) => window.__roulette.game.ringBell(uid ?? undefined), uid);
      tally.rings += 1;
      await idle('ringing the Bell');
      await answerCards();
      await answerPicker();
    } else if (e === 'move') {
      await G((r) => {
        const g = window.__roulette.game;
        const rail = g.state.rail;
        if (rail.length > 1) g.moveTalisman(rail[Math.floor(r * rail.length)].uid, Math.floor(((r * 7) % 1) * rail.length));
      }, rand());
    }
  }

  // Spin the night out, chips spread over every kind of bet.
  await G(() => window.__roulette.game.turnTo('table'));
  await idle('turning to the table');
  for (let spin = 0; spin < 12; spin++) {
    const phase = await G(() => window.__roulette.game.state.phase);
    if (phase !== 'betting') break;
    await G(async (seed) => {
      const g = window.__roulette.game;
      const { BETS } = await import('/src/core/bets.js');
      let r = seed;
      const next = () => ((r = (r * 9301 + 49297) % 233280), r / 233280);
      for (const chip of g.state.chips) if (next() < 0.8) g.placeChipOn(chip.id, BETS[Math.floor(next() * BETS.length)].id);
    }, Math.floor(rand() * 233280));
    await answerCards();
    const spun = await G(() => window.__roulette.game.requestSpin());
    if (!spun) break;
    tally.spins += 1;
    await idle('a spin');
    await answerCards();
    await answerPicker();
  }

  // Bank enough to pay, now and then not, and end the night.
  if (rand() < 0.85) await G(() => window.__roulette.game.bankAll());
  await G(() => window.__roulette.game.requestEndNight());
  await frames(3);
  await answerCards();
  await idle('the end of the night');
  await answerCards();
  const after = await G(() => window.__roulette.game.state.debt);
  if (after > s.debt) tally.debts += 1;
}

console.log(`\nmarathon: ${JSON.stringify(tally)}`);
console.log(problems.size ? `${problems.size} problem(s)` : 'no problems');
for (const [k, p] of problems) console.log(`\n✗ ${k}  (×${p.count}, first at ${p.where})\n  ${p.detail}\n  screenshot ${p.shot}`);
await browser.close();
await server.close();
process.exitCode = problems.size ? 1 : 0;
