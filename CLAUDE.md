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
(43 then; doc 6.1, decisions 15–17), with pocket widths drawn live.
M1, touch and the phone layout (doc 9.10, 10), is done: `npm run touch` plays
debt 1 by touch alone on a landscape phone with nothing covered. Phase 4 (the
House) is done, built touch-first (decision 21). Madame Zero deals white and
black cards from her booth left of the Cage, the gramophone beside her plays
records, and engravings mark talismans: 16 cards and 9 records, each record
with its own synthesised loop (doc 5.9, 5.10, 6.2–6.4, 8.1, 8.6; the two chip
cards wait for Phase 5). The game now opens on a main menu, and each run
starts with a chip set chosen there: Normal, Clay, Bone, Glass and Gold, each
unlocked by paying debt 4 with the one before (decision 26, doc 6.6, 7.5;
`core/meta.js` keeps the profile). Phase 5 (building the wheel) is done, in
two halves (decisions 27 and 28): pockets carry ids and enhancements,
`core/wheelwork.js` does the wheel work, the Cabinet's 4th compartment sells
oddities priced in coins (a number of the debt's spins: wheel work, the Brass
Odds Plate, a chip of each material, a record), the Number Punches stamp
pockets (44 talismans), a stats chalkboard stands at the table's left and a
payout placard at the felt's right. Each kind of bet has a level; a level adds
a quarter of the base odds. No Lead or Wax, and no chip cards (owner). Wheel
work and levels are placed on the felt close-up (`game.beginWork`). Phase 6
(meta) is done (decision 29): a run's goal is debt 4 + the Vault's open
locks, and past it the player may step out of the light; each lock opens a
starting wheel (American with a real 00 as number 37, Golden, Bone, Mirror in
the felt's order), and lock 2 a second gramophone slot; reaching the goal
opens the next House Edge level (1–5, stacking; level 1 is the House's
green pocket with no number). `core/meta.js` keeps the profile (version 2):
locks, edge, figures (the newest twelve stand in the room), what was seen,
feats and the lifetime ledger; `core/house.js` reads a run's wheel and edge.
The Almanac is a book on the table and on both menus. Phase 7 (content and
balance) is done (decision 30): 68 talismans, 25 cards and 12 records, every
build family at every rarity; the seven special bets on a racetrack across
the top of the felt, shut until the Croupier's Glove, Snakeskin, "Neighbours
talk." or the Habanera opens them; multi-ball (`balls` hooks, up to two
extra ivory balls in the view); content opened by the Vault's locks and the
feats (`unlock`, `state.opened`, doc 7.1); and Endless, chosen on the chip
select once the Vault is open (`goal: null`; the profile keeps the deepest).
Phase 8 (polish) is built (decision 31): an Info book ("How to play",
`ui/guide.js`) on the main menu and the pause menu; Settings with music and
effects levels, large text, graphics quality (Low is the phone preset), the
crunch filter (off by default) and tips; one-time tips in the room for the
first debt (`ui/tips.js`, kept in `profile.taught`); a synthesised audio
pass; and the floor painted in a worker and kept in IndexedDB
(`view/floor.js`). Still open: a playtest with a new player, and frame rate
on a real phone. The builds pass (decision 32) is done: doc 6.8 names every
build (engine, pieces, endgame), the Pyre was added (talismans sold or used
up feed it; `useUp` in `core/effects.js` is the one used-up path, and the
Phoenix Feather catches the first each debt), and each build got the piece
it lacked. Decision 33 gave the Bell, Sectors, Zero and Timing a
legendary multiplier each (the Carillon, the Tote Board, the Patience Jar,
the Grandfather Clock, one per Vault lock), and the interest build stays as
the way deep into Endless: 83 talismans, 31 cards, 16 records. Player
text is plain English (decision 34): say "paint gold", not "gild". **Ask the
owner before building any new build or piece.** `npm run sim -- --bot
builds` plays one bot per build (`--kit` hangs its core from the first
spin). Next is Phase 9 (store releases). The people are sculpted
(decision 35, doc 8.5): the figure and Madame Zero are distance fields in
`src/view/shapes/`, meshed in a worker by `src/view/sculptCore.js` with baked
occlusion, kept in IndexedDB, with far, preview and full meshes. Bump a
shape's `version` when it changes. The best simulator bot at each
debt pays debts 1–4 in about 97%, 71%, 49% and 15% of runs with a new
player's pool (`--pool start`, decision 27's targets), and debts 5–8 in
about 10%, 5%, 2% and 1% with everything open (the default pool, the
gentle tail); debts 2, 4 and 8 sit near their floors and debt 3 near its
ceiling. Debts 2 and 4 owe 370 and 2,664,
debts 5–8 8,000 to 95,000. See `npm run sim`, which grades the best
Lean-playing bot at each debt on that debt's pool; `--no-oracle` keeps the
bots away from Madame Zero, `--old-pool` plays the Phase 3 pool, `--skip a,b`
keeps the bots off talismans, fortunes or records, `--bot solo:a,b` hangs
talismans from the first spin, and `--no-wheel` keeps them off wheel work;
`--pool start|full`, `--wheel`, `--edge`, `--locks` and `--figures` set a
run's setup. One point of Nudge is worth a lot (a straight-up's return grows
with 2N + 1). A Stake point doubles a line, and a multiplier on one number pays
a whole debt in a hit. Re-run the sim after any luck, jackpot or fortune
change.

## Commands

- `npm run dev` starts the dev server (http://localhost:5173). It opens on the
  main menu. `?seed=XXXX-XXXX` skips the menu and starts a seeded run when
  none is in progress (the tests use it).
- `npm run build` writes a static build to `dist/`.
- `npm test` runs the core unit tests (vitest). Keep them green.
- `npm run sim` runs the balance simulator. Re-run it after any economy change.
  `--chips <set>` plays a starting chip set (normal, clay, bone, glass, gold).
- `npm run layout` checks the phone layout at three landscape sizes (nothing
  covered, controls at least 44 px); it takes `CHROME_PATH` like the smoke test.
- `npm run touch` plays debt 1 at 844×390 with real touch input only (sent
  through the DevTools protocol, so there are real pointers to capture), and
  runs the layout checks at every station. Synthetic `PointerEvent`s cannot
  be captured; use CDP touches (`Input.dispatchTouchEvent`) for touch tests.
- `npm run smoke` plays a debt end to end in headless Chromium; set
  `CHROME_PATH` (in the cloud container: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`).
- In the dev build, `window.__roulette.debug` has `addCoins(n)`, `addTokens(n)`,
  `grant(id)` (hang a talisman for free, cursed ones included), `lean(n)` (a
  Lean on the next spin), `misses(n)` (to try pity), and `devil()` / `calm()`
  (the Devil fires on every throw, or goes back to normal), and `work(op, n,
  extra)` (wheel work on the pocket with number n: `work('gild', 17)`,
  `work('enhance', 9, { enh: 'glass' })`, `work('duplicate', 0)`) for testing.

## Conventions

- ES modules, 2-space indentation, single quotes. Comments explain why, not what.
- No image, audio or model files so far: textures are procedural
  (`src/view/textures.js`), sound is synthesised (`src/audio/audio.js`) and the
  people are sculpted from distance fields (`src/view/shapes/`). Keep it that
  way unless agreed otherwise.
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
- **The sculpted people arrive a few seconds after load** (longer in software
  WebGL, where the worker competes with the renderer): they are invisible until
  the first mesh lands. Wait for a mesh with a full-size index before judging
  them, e.g. `stage.figure.group` holding a visible mesh with over 60,000 indices.
- **Pipes hide exit codes:** `npm run smoke | tail` exits 0 even when the test
  fails. Read the last lines for "Smoke test passed." or check the exit code first.
- **Useful page hooks** (dev build): `window.__roulette` has `game`, `rail`,
  `bell`, `cabinet`, `oracle`, `menu`, `table`, `stage`, `director`, `lighting` and `debug`.
  `game.showMainMenu()`, `game.openChipSelect()` and `game.beginRun(set)` drive
  the menu; `game.profile` holds what is unlocked.
  `game.screenPosition(rail.talismanWorldPosition(uid))`,
  `cabinet.slotWorldPosition(i)`, `table.spotWorldPosition(betId)`,
  `oracle.leverWorldPosition()`, `oracle.cardWorldPosition(i)` and
  `oracle.gramophoneWorldPosition()` give click targets; interactive meshes
  carry `userData.role` (`night-card`, `end-card`, `cage-button`,
  `compartment`, `crank`, `chart`, `bell`, `bell-tag`, `plaque`,
  `talisman-mesh`, `board`, `devil-counter`, `lever`, `fortune-card`,
  `gramophone`, `chalkboard`, `placard`, `almanac`). The views are `oracle`, `cage`, `table` and `cabinet`.
  `vault` and `figures` are the Vault door and the figures; `game.profile`
  is the meta profile, `game.openAlmanac()`, `game.chooseWheel()`,
  `game.chooseEdge()` and `game.stepOut()` drive Phase 6's screens;
  `game.openGuide()` opens the Info book and `game.openSettings()` the
  settings; `game.showTip(id)` shows a first-time tip (they fade after 14 s,
  which is a few frames in software WebGL, so show one just before a
  screenshot); `game.chooseGoal()` picks Endless once `profile.vault` is set, and
  `game.placeChip(id, 'neighbours:17')` opens the racetrack's number
  chooser when the Neighbours are open.
  `game.picking` is set while wheel work is being placed; `game.pickBet(betId)`
  stands for a tap on the felt then, and `cabinet.slotWorldPosition(3)` is the
  oddity. `table.boardWorldPosition()` and
  `cage.devilWorldPosition()` anchor their notes; `lighting.lean` says whether
  the LEAN lamp is lit.
  `debug.grant(id)` hangs a talisman and marks its Cabinet offer sold.
