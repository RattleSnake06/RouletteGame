# Rien Ne Va Plus

A roulette roguelike. A giant roulette wheel alone in a dark hall under a single
bulb, a debt you have to pay, and three nights to pay it.

The plan for the full game is in [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md).
**Phases 1 and 2 are playable:** the core loop, plus talismans, the Curio
Cabinet, tokens and the Bell. Luck and risk (Nudge, Leans, the Devil) arrive in
Phase 3.

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
4. **Buy talismans at the Curio Cabinet** (turn right with D). They cost tokens and
   hang on the brass rail behind the felt, where they act left to right on every
   spin: drag them to reorder. The Cabinet restocks free each night; the crank
   restocks it now for coins. Click a talisman to sell it.
5. **Ring the Bell** (B, or click it) to wake an active talisman: the Glass Eye
   shows where the next ball lands; the Wheel of Fortune throws a losing ball
   again; the Piggy Bank smashes when you click its own tag.
6. **Bank at the Cage** (turn left with A or the ◀ button). Banked coins earn 5%
   at the end of each night and count toward the debt, but they cannot come back
   out. Every night that ends also pays a token.
7. **End the night.** After the third night the Cage collects what you owe. Fall
   short and the run is over.

| Key | Action |
|---|---|
| Space | Spin (hold to hurry the ball) |
| A / D, ← / → | Turn: the Cage, the table, the Cabinet |
| 1 / 2 / 3 | Long night / short night / sit out; at the Cabinet, buy |
| R | Restock the Cabinet (at the Cabinet) |
| B | Ring the Bell |
| Tab / Shift+Tab | Walk the talismans, Bell and plaques (or the Cabinet) |
| Enter | Open, buy or ring what is focused |
| [ / ] | Move the focused talisman along the rail |
| Delete | Sell the focused talisman |
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
  core/        rules: bets, wheel, money, economy, talismans, the Cabinet, the
               Bell, payouts, run state machine, saves
  view/        three.js: hall, wheel, ball choreography, camera, stations
  ui/          HUD, popups, notes, modals
  audio/       synthesised sound
  input/       keys → game actions (gamepad later)
  platform/    saves and settings (web now, Steam desktop later)
  game.js      connects the rules to the room
  playback.js  plays a spin's payout back, talisman by talisman
  main.js      boot and frame loop
sim/           balance simulator
tests/         unit tests and the smoke test
```
