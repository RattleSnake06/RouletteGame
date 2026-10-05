# Rien Ne Va Plus

A roulette roguelike. A giant roulette wheel alone in a dark hall under a single
bulb, a debt you have to pay, and three nights to pay it.

The plan for the full game is in [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md).
**Phase 1 (the core loop) is playable.** There are no items yet, so runs rarely
get past the first debt; talismans arrive in Phase 2.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
```

`npm run build` writes a static site to `dist/` (relative paths, so it can be
hosted from any folder). Add `?seed=ABCD-EFGH` to the URL to start a specific
seed; it only applies when no run is in progress.

## How to play

1. **Choose the night:** a long night (7 spins), a short night (3 spins and a
   token), or sit it out (tokens when the debt is paid). Spins cost coins.
2. **Place chips** on the felt: click a spot, or drag a chip from the tray. Hover
   any spot to see the bet and what it pays. Chips are yours to keep. Only the
   spin costs money.
3. **Spin:** fling the wheel with the mouse, or press Space.
4. **Bank at the Cage** (turn left with A or the ◀ button). Banked coins earn 5%
   at the end of each night and count toward the debt, but they cannot come back
   out.
5. **End the night.** After the third night the Cage collects what you owe. Fall
   short and the run is over.

| Key | Action |
|---|---|
| Space | Spin (hold to hurry the ball) |
| A / D, ← / → | Turn between the table and the Cage |
| 1 / 2 / 3 | Long night / short night / sit out |
| E | End the night |
| F | Fast spins on/off |
| M | Sound on/off |
| Esc | Pause menu |

## Scripts

| Command | What it does |
|---|---|
| `npm test` | Unit tests for the rules (vitest) |
| `npm run sim` | Balance simulator: bots play thousands of runs headless |
| `npm run smoke` | Plays a debt end to end in headless Chromium (`CHROME_PATH=…` to pick a browser) |

## How it's built

[Three.js](https://threejs.org) + [Vite](https://vite.dev). No image or audio
files: textures are painted procedurally at load time and sounds are synthesised
with WebAudio.

The rules live in `src/core/` as pure, deterministic JavaScript with seeded
randomness. The core decides every outcome and returns events; the view only
plays them back.

```
src/
  core/        rules: bets, wheel, money, economy, run state machine, saves
  view/        three.js: hall, wheel, ball choreography, camera, stations
  ui/          HUD, popups, tooltips, modals
  audio/       synthesised sound
  input/       keys → game actions (gamepad later)
  platform/    saves and settings (web now, Steam desktop later)
  game.js      connects the rules to the room
  main.js      boot and frame loop
sim/           balance simulator
tests/         unit tests and the smoke test
```
