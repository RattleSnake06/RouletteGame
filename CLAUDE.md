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
  `src/core/content/`.
- Until Phase 1 lands, the existing scene code lives in `src/scene/`,
  `src/spin.js`, `src/audio.js`, `src/postfx.js` and `src/textures.js`. It moves
  under `src/view/` as part of Phase 1.

## Commands

- `npm run dev` starts the dev server (http://localhost:5173).
- `npm run build` writes a static build to `dist/`.
- Phase 1 adds `npm test` (vitest) and `npm run sim` (balance simulator).

## Conventions

- ES modules, 2-space indentation, single quotes. Comments explain why, not what.
- No image or audio files so far: textures are procedural (`src/textures.js`) and
  sound is synthesised (`src/audio.js`). Keep it that way unless agreed otherwise.
- Check visual changes with a real render, not just a build. Headless Chromium
  works with `--use-angle=swiftshader`. Software WebGL runs at about 1–4 fps, so
  anything timed per frame (intro fade, spin physics) looks slow there.
