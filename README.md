# Roulette Roguelike

A giant roulette wheel alone in a dark room, under a single bulb. This is the
first step: a wheel you can grab and spin with the mouse.

The plan for the full game is in [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md).

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
```

`npm run build` writes a static site to `dist/` (relative paths, so it can be
hosted from any folder).

## Controls

- **Drag the wheel** around its hub to turn it. Let go while moving to fling
  it; it coasts down on bearing friction.
- **M** toggles sound (sound starts on your first click, as browsers require).

Touch works too.

## How it's built

[Three.js](https://threejs.org) + [Vite](https://vite.dev). There are no image or
audio files. Every texture (the peeling floorboards, mahogany drum, inlaid cone,
number ring) is painted procedurally at load time, and the sounds are
synthesised with WebAudio.

```
src/
  main.js          renderer, camera framing, game loop
  spin.js          grab-and-fling rotation controller
  audio.js         room tone, rotor whirr, pocket ticks
  postfx.js        bloom, grain, vignette, colour grade
  textures.js      procedural canvas textures
  scene/
    wheel.js       the wheel: stator, rotor, pockets, turret, ball
    room.js        floor, walls, spotlight, light shaft, dust
    figure.js      the figure standing beside the wheel
```

The wheel uses the European single-zero layout. `wheel.js` exports
`WHEEL_ORDER` and `pocketAngle()`; those will be the starting point for working
out where the ball lands.
