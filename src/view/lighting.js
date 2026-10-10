// Lighting moods (design doc 8.5). The lights share one budget of attention:
// while the player bets, the wheel is a shape in the dark and the lamp lights
// the felt; when the ball flies, the bulb comes on hard and everything else
// sinks. Each station's own light rises when the player turns to it.
//
//   wheel    the bulb over the wheel
//   lamp     the hanging lamp over the table
//   rail     the warm fill on the talisman rail
//   cage     the Cage's banker's lamp
//   cabinet  the light inside the Curio Cabinet

export const MOODS = {
  intro: { wheel: 1, lamp: 1, rail: 1, cage: 1, cabinet: 1 },
  table: { wheel: 0.015, lamp: 1, rail: 1, cage: 0.3, cabinet: 0.35 },
  cage: { wheel: 0.015, lamp: 0.55, rail: 0.5, cage: 1, cabinet: 0.2 },
  cabinet: { wheel: 0.015, lamp: 0.55, rail: 0.5, cage: 0.2, cabinet: 1 },
  spin: { wheel: 1, lamp: 0.16, rail: 0.25, cage: 0.1, cabinet: 0.1 },
};
const CHANNELS = ['lamp', 'rail', 'cage', 'cabinet'];

// The bulb catching when it switches on: [until (s), level].
const STUTTER = [
  [0.05, 0.15],
  [0.09, 0.9],
  [0.16, 0.25],
  [0.2, 1],
  [0.26, 0.55],
];

export class LightingDirector {
  constructor(mood = 'intro') {
    this.mood = mood;
    this.wheel = MOODS[mood].wheel;
    for (const c of CHANNELS) this[c] = MOODS[mood][c];
    this.stutter = -1;
  }

  /** Switch mood. Returns true when the wheel's bulb was just switched on. */
  set(mood) {
    if (!MOODS[mood] || mood === this.mood) return false;
    const switchingOn = MOODS[this.mood].wheel < 0.5 && MOODS[mood].wheel >= 0.5;
    this.mood = mood;
    if (switchingOn) {
      this.wheel = MOODS[mood].wheel;
      this.stutter = 0;
    }
    return switchingOn;
  }

  /** Eases toward the mood; returns each channel's level for this frame. */
  update(dt) {
    const target = MOODS[this.mood];
    // On fast, off slow: the wheel sinks back into the dark while the payout plays.
    const wheelRate = target.wheel > this.wheel ? 6 : 0.9;
    this.wheel += (target.wheel - this.wheel) * (1 - Math.exp(-dt * wheelRate));
    for (const c of CHANNELS) this[c] += (target[c] - this[c]) * (1 - Math.exp(-dt * 2.6));
    let wheel = this.wheel;
    if (this.stutter >= 0) {
      this.stutter += dt;
      const step = STUTTER.find(([until]) => this.stutter < until);
      if (step) wheel *= step[1];
      else this.stutter = -1;
    }
    return { wheel, lamp: this.lamp, rail: this.rail, cage: this.cage, cabinet: this.cabinet };
  }
}
