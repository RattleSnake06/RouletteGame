# Rien Ne Va Plus

A roulette roguelike with the feel of Clover Pit (dark, diegetic, debt-driven),
built on roulette's own mechanics. Three.js + Vite. Developed in the browser,
shipping first on phones (App Store and Play Store, wrapped with Capacitor) and
second on Steam (Electron).

## The design doc is the source of truth

`docs/GAME_DESIGN.md` defines the rules, content, presentation, architecture and
roadmap.

- Before working on any game system, read that system's section of the doc
  (the contents list at the top maps topics to sections).
- If a request conflicts with the doc, say so and ask before building. Once a
  change is agreed, update the doc in the same commit, so code and doc never
  drift apart.
- Build in roadmap order (section 10). Don't start later-phase systems early.
- Section 12 lists the decisions the owner has made. Treat them as fixed.

## Decisions

- First person at the table; cut to the third-person wide shot during spins.
- Chips are owned bets; the risk is the coin cost per spin.
- Keep the current render; the low-res "crunch" filter is optional.
- Leans are announced one spin early.
- Phones are the main target, landscape only; Steam is the second (doc 9.10,
  decisions 18–21). Every control must be reachable by touch, at least 44 px,
  and none may cover another clickable: run `npm run layout` after any HUD or
  camera change. Route input through `src/input/` actions and saves and
  platform calls through `src/platform/` (doc 9.10).

## Architecture rules (doc section 9)

- `src/core/` is pure game logic: no DOM, no three.js. Deterministic, using
  seeded RNG streams. All coin amounts (coins, deposits, debts, payouts, prices
  in coins) go through the big-number wrapper `core/num.js`. Tokens are plain
  integers.
- The core returns ordered events; `view/` and `ui/` only play them back. The
  view never decides outcomes.
- Talismans, fortunes, records and the rest are data objects with hooks in
  `src/core/content/` (from Phase 2).
- Money is a plain number below 1e15 and a break_infinity Decimal above it.
  Always use the helpers in `core/num.js` (`add`, `mul`, `gte`, `format`…),
  never `+` or `<` on coins.
- Talismans act in rail order. Payout hooks are pure and build a plan
  (`core/payout.js`); commit hooks change the run. Every effect emits a
  `trigger` event so the view can show it.
- `src/game.js` is the only place that calls `act()`. Station callbacks and
  input actions go through it.

## Status

Phases 1 (core loop), 2 (talismans, the Curio Cabinet, tokens and the Bell)
and 3 (Nudge, telegraphed Leans, pity, the Devil, cursed talismans) are done,
plus twenty more talismans built ahead of Phase 4 at the owner's request
(43 in all; doc 6.1, decisions 15–17), with pocket widths drawn live.
Next is M1, touch and the phone layout (doc 10, decision 21), then Phase 4:
Madame Zero, fortunes (white and black cards), engravings and records. The best simulator bot at each debt pays debts 1–4 in about 99%, 74%,
25% and 8% of runs, inside the Phase 3 targets but close to the debt 2 ceiling
and the debt 3 floor (see `npm run sim`, which grades the best Lean-playing bot
at each debt; `--old-pool` plays the Phase 3 pool, `--skip a,b` keeps the bots
off talismans, `--bot solo:a,b` hangs talismans from the first spin). One point
of Nudge is worth a lot (a straight-up's return grows with 2N + 1), and a
multiplier on one number pays a whole debt in a hit: re-run the sim after any
luck or jackpot change.

## Commands

- `npm run dev` starts the dev server (http://localhost:5173). `?seed=XXXX-XXXX`
  starts a seeded run when none is in progress.
- `npm run build` writes a static build to `dist/`.
- `npm test` runs the core unit tests (vitest). Keep them green.
- `npm run sim` runs the balance simulator. Re-run it after any economy change.
- `npm run layout` checks the phone layout at three landscape sizes (nothing
  covered, controls at least 44 px); it takes `CHROME_PATH` like the smoke test.
- `npm run smoke` plays a debt end to end in headless Chromium; set
  `CHROME_PATH` (in the cloud container: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`).
- In the dev build, `window.__roulette.debug` has `addCoins(n)`, `addTokens(n)`,
  `grant(id)` (hang a talisman for free, cursed ones included), `lean(n)` (a
  Lean on the next spin), `misses(n)` (to try pity), and `devil()` / `calm()`
  (the Devil fires on every throw, or goes back to normal) for testing.

## Conventions

- ES modules, 2-space indentation, single quotes. Comments explain why, not what.
- No image or audio files so far: textures are procedural (`src/view/textures.js`)
  and sound is synthesised (`src/audio/audio.js`). Keep it that way unless agreed
  otherwise.
- Check visual changes with a real render, not just a build. Headless Chromium
  works with `--use-angle=swiftshader`. Software WebGL runs at about 1–4 fps, so
  anything timed per frame (camera moves, the ball) runs in slow motion there:
  cut the camera with `director.goTo(name, { cut: true })` for screenshots, and
  wait for `!director.tween` before clicking objects.

## Testing in a real browser

- **A cut lands on the next frame.** After `director.goTo(name, { cut: true })`,
  wait two animation frames before projecting positions or clicking, or the
  click is aimed with the old camera. The first frames after load are slow
  (about 4 s for two frames in software WebGL). In page code:
  `await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`;
  the smoke test has a `frames()` helper.
- **Use a dev server that never reloads** when anything else may edit files
  (another agent, a second session): Vite's file watcher reloads the page and
  breaks a scripted run mid-way. Point Vite at a config such as
  `export default { root: '/home/user/RouletteGame', server: { hmr: false, watch: { ignored: ['**/*'] } } }`
  and restart it after each source edit, since it no longer sees changes. The
  smoke test's own server is set up this way.
- **Stop servers by PID** (`echo $!` when starting one). `pkill -f` and
  `pgrep -f` with a pattern also match the shell running the command and kill it.
  Start Vite as `node node_modules/vite/bin/vite.js …`, not `npx vite`: with
  `npx`, `$!` is the wrapper's PID, killing it leaves the server running, and a
  restart on the same port then fails quietly and the old code keeps being served.
- **CSS fades advance only when a frame is drawn.** In software WebGL a frame can
  take seconds, so a note (0.12 s fade) may still be half transparent seconds
  after it appears. Wait several frames before screenshotting a note.
- **Per-frame animations run in slow motion** (each frame's step is capped at
  1/20 s): a newly hung charm takes a dozen frames to slide onto its hook, and
  the Devil's blackout and burn last far longer than in a real browser.
- **Pipes hide exit codes:** `npm run smoke | tail` exits 0 even when the test
  fails. Read the last lines for "Smoke test passed." or check the exit code first.
- **Useful page hooks** (dev build): `window.__roulette` has `game`, `rail`,
  `bell`, `cabinet`, `table`, `stage`, `director`, `lighting` and `debug`.
  `game.screenPosition(rail.talismanWorldPosition(uid))`,
  `cabinet.slotWorldPosition(i)` and `table.spotWorldPosition(betId)` give click
  targets; interactive meshes carry `userData.role` (`night-card`, `end-card`,
  `cage-button`, `compartment`, `crank`, `chart`, `bell`, `bell-tag`, `plaque`,
  `talisman-mesh`, `board`, `devil-counter`). `table.boardWorldPosition()` and
  `cage.devilWorldPosition()` anchor their notes; `lighting.lean` says whether
  the LEAN lamp is lit.
  `debug.grant(id)` hangs a talisman and marks its Cabinet offer sold.
