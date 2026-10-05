// Lighting moods (design doc 8.5). The wheel's bulb and the table lamp share
// one budget of attention: while the player bets, the wheel is a shape in the
// dark and the lamp lights the felt; when the ball flies, the bulb comes on
// hard and the lamp sinks.

export const MOODS = {
  intro: { wheel: 1, lamp: 1 },
  table: { wheel: 0.015, lamp: 1 },
  cage: { wheel: 0.015, lamp: 0.55 },
  spin: { wheel: 1, lamp: 0.16 },
};

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
    this.lamp = MOODS[mood].lamp;
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

  /** Eases toward the mood; returns { wheel, lamp } levels for this frame. */
  update(dt) {
    const target = MOODS[this.mood];
    // On fast, off slow: the wheel sinks back into the dark while the payout plays.
    const wheelRate = target.wheel > this.wheel ? 6 : 0.9;
    this.wheel += (target.wheel - this.wheel) * (1 - Math.exp(-dt * wheelRate));
    this.lamp += (target.lamp - this.lamp) * (1 - Math.exp(-dt * 2.6));
    let wheel = this.wheel;
    if (this.stutter >= 0) {
      this.stutter += dt;
      const step = STUTTER.find(([until]) => this.stutter < until);
      if (step) wheel *= step[1];
      else this.stutter = -1;
    }
    return { wheel, lamp: this.lamp };
  }
}
