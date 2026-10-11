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
//
// Two events act on top of the mood: a Lean announced makes the wheel's bulb
// hum brighter in the dark (doc 5.6), and the Devil puts every light out for a
// moment (doc 5.7). With flashing lights turned off (doc 8.7) the blackout is a
// fade, with no stutter.

export const MOODS = {
  intro: { wheel: 1, lamp: 1, rail: 1, cage: 1, cabinet: 1 },
  table: { wheel: 0.015, lamp: 1, rail: 1, cage: 0.3, cabinet: 0.35 },
  cage: { wheel: 0.015, lamp: 0.55, rail: 0.5, cage: 1, cabinet: 0.2 },
  cabinet: { wheel: 0.015, lamp: 0.55, rail: 0.5, cage: 0.2, cabinet: 1 },
  spin: { wheel: 1, lamp: 0.16, rail: 0.25, cage: 0.1, cabinet: 0.1 },
};
const CHANNELS = ['lamp', 'rail', 'cage', 'cabinet'];

// The Devil's blackout: the bulb pops and stutters out, the hall stays dark,
// then the lights creep back. [until (s), level]; the last step ramps.
const BLACKOUT = [
  [0.05, 1.6],
  [0.1, 0.1],
  [0.16, 0.7],
  [0.22, 0],
];
const DARK_FOR = 1.5;
const RETURN = 1.4;

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
    this.lean = false;
    this.clock = 0;
    this.out = -1; // seconds into a blackout, or -1
    this.flashes = true;
  }

  /** The LEAN lamp is lit: the wheel's bulb hums a little brighter in the dark. */
  setLean(on) {
    this.lean = !!on;
  }

  /** The Devil fires: every light goes out, then comes back. */
  blackout() {
    this.out = 0;
  }

  get dark() {
    return this.out >= 0;
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
    this.clock += dt;
    const target = MOODS[this.mood];
    let wheelTarget = target.wheel;
    // A Lean ahead: a dim, humming glow on the wheel even while it rests in the dark.
    if (this.lean && wheelTarget < 0.5) wheelTarget = Math.max(wheelTarget, 0.09 + 0.025 * Math.sin(this.clock * 11) * Math.sin(this.clock * 2.3));
    // On fast, off slow: the wheel sinks back into the dark while the payout plays.
    const wheelRate = wheelTarget > this.wheel ? 6 : 0.9;
    this.wheel += (wheelTarget - this.wheel) * (1 - Math.exp(-dt * wheelRate));
    for (const c of CHANNELS) this[c] += (target[c] - this[c]) * (1 - Math.exp(-dt * 2.6));
    let wheel = this.wheel;
    if (this.stutter >= 0) {
      this.stutter += dt;
      const step = STUTTER.find(([until]) => this.stutter < until);
      if (step) wheel *= step[1];
      else this.stutter = -1;
    }
    let all = 1;
    if (this.out >= 0) {
      this.out += dt;
      all = this.blackoutLevel(this.out);
      if (this.out > BLACKOUT.at(-1)[0] + DARK_FOR + RETURN) this.out = -1;
    }
    return { wheel: wheel * all, lamp: this.lamp * all, rail: this.rail * all, cage: this.cage * all, cabinet: this.cabinet * all, all };
  }

  blackoutLevel(t) {
    const end = BLACKOUT.at(-1)[0];
    if (t < end) {
      if (!this.flashes) return Math.max(0, 1 - t / end);
      return BLACKOUT.find(([until]) => t < until)[1];
    }
    if (t < end + DARK_FOR) return 0;
    const u = Math.min(1, (t - end - DARK_FOR) / RETURN);
    return u * u;
  }
}
