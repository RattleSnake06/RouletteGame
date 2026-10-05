# Rien Ne Va Plus

A roulette roguelike with the feel of Clover Pit (dark, diegetic, debt-driven),
built on roulette's own mechanics. Three.js + Vite. Developed in the browser,
shipping on Steam as an Electron app.

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
- Steam is a target: route input through `src/input/` actions and saves and
  platform calls through `src/platform/` from the start (doc 9.10).

## Architecture rules (doc section 9)

- `src/core/` is pure game logic: no DOM, no three.js. Deterministic, using
  seeded RNG streams. All money goes through the big-number wrapper `core/num.js`.
- The core returns ordered events; `view/` and `ui/` only play them back. The
  view never decides outcomes.
- Talismans, fortunes, records and the rest are data objects with hooks in
  `src/core/content/` (from Phase 2).
- Money is a plain number below 1e15 and a break_infinity Decimal above it.
  Always use the helpers in `core/num.js` (`add`, `mul`, `gte`, `format`…),
  never `+` or `<` on money.
- `src/game.js` is the only place that calls `act()`. Station callbacks and
  input actions go through it.

## Status

Phase 1 (core loop) is done. Next is Phase 2: talismans, the Curio Cabinet,
tokens and the Bell. Without items the economy cannot carry a run past debt 1;
that is expected (see `npm run sim`).

## Commands

- `npm run dev` starts the dev server (http://localhost:5173). `?seed=XXXX-XXXX`
  starts a seeded run when none is in progress.
- `npm run build` writes a static build to `dist/`.
- `npm test` runs the core unit tests (vitest). Keep them green.
- `npm run sim` runs the balance simulator. Re-run it after any economy change.
- `npm run smoke` plays a debt end to end in headless Chromium; set
  `CHROME_PATH` (in the cloud container: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`).
- In the dev build, `window.__roulette.debug.addCoins(n)` tops up coins for
  testing later debts.

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
