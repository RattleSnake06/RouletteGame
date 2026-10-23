// The gramophone's music (design doc 5.10, 8.6; decision 23): each record is
// a short loop, synthesised here and played through the horn: a band-pass
// for the horn's throat, a soft clip, a slow wow in the pitch and the
// crackle of the groove. With nothing on the platter, the hall hums.
//
// A tune is data: a tempo, a loop length in steps (a step is a sixteenth, or
// an eighth where `stepBeats` says so), and tracks of [step, note(s), length,
// velocity] played by one instrument each. Notes are MIDI numbers. Drums are
// strings with one character a step: k kick, s snare, h hat, t timpani.

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

// Chords, as MIDI numbers.
const Am = [57, 60, 64];
const Dm = [57, 62, 65];
const E7 = [56, 59, 62, 64];

export const TUNES = {
  // Waltz in Green: A minor, an accordion's oom-pah-pah.
  waltz: {
    bpm: 112,
    steps: 48,
    tracks: [
      { inst: 'bass', notes: [[0, 45, 4], [12, 50, 4], [24, 40, 4], [36, 45, 4]] },
      { inst: 'reed', level: 0.55, notes: [[4, Am, 3], [8, Am, 3], [16, Dm, 3], [20, Dm, 3], [28, E7, 3], [32, E7, 3], [40, Am, 3], [44, Am, 3]] },
      { inst: 'reed', notes: [[0, 76, 4], [4, 72, 2], [6, 71, 2], [8, 69, 4], [12, 74, 6], [18, 77, 2], [20, 76, 4], [24, 71, 4], [28, 68, 4], [32, 71, 2], [34, 74, 2], [36, 72, 4], [40, 71, 2], [42, 69, 6]] },
    ],
  },
  // Red Light Tango: D minor, the habanera in the bass, staccato chords.
  tango: {
    bpm: 112,
    steps: 64,
    tracks: [
      {
        inst: 'bass',
        notes: [[0, 38, 3], [3, 45, 1], [4, 38, 2], [6, 45, 2], [8, 38, 3], [11, 45, 1], [12, 38, 2], [14, 45, 2],
          [16, 33, 3], [19, 40, 1], [20, 33, 2], [22, 40, 2], [24, 33, 3], [27, 40, 1], [28, 33, 2], [30, 40, 2],
          [32, 38, 3], [35, 45, 1], [36, 38, 2], [38, 45, 2], [40, 38, 3], [43, 45, 1], [44, 38, 2], [46, 45, 2],
          [48, 43, 3], [51, 50, 1], [52, 43, 2], [54, 50, 2], [56, 45, 3], [59, 52, 1], [60, 45, 2], [62, 52, 2]],
      },
      { inst: 'reed', level: 0.5, notes: [[4, [62, 65, 69], 1], [12, [62, 65, 69], 1], [20, [61, 64, 67], 1], [28, [61, 64, 67], 1], [36, [62, 65, 69], 1], [44, [62, 65, 69], 1], [52, [62, 67, 70], 1], [60, [61, 64, 67], 1]] },
      { inst: 'reed', notes: [[0, 69, 3], [3, 74, 1], [4, 77, 4], [8, 76, 2], [10, 74, 2], [12, 73, 4], [16, 76, 6], [22, 79, 2], [24, 77, 2], [26, 76, 2], [28, 74, 2], [30, 73, 2], [32, 74, 3], [35, 69, 1], [36, 74, 4], [40, 77, 4], [44, 81, 4], [48, 79, 4], [52, 77, 2], [54, 76, 2], [56, 74, 8]] },
    ],
  },
  // Lullaby for Zero: E minor, a music box over a soft bass, in eighths.
  lullaby: {
    bpm: 150,
    stepBeats: 1,
    steps: 24,
    tracks: [
      { inst: 'bell', level: 0.5, notes: [64, 67, 71, 76, 71, 67, 60, 64, 67, 72, 67, 64, 57, 60, 64, 69, 64, 60, 59, 63, 66, 69, 66, 63].map((n, i) => [i, n, 2]) },
      { inst: 'bell', notes: [[0, 83, 6], [6, 79, 3], [9, 76, 3], [12, 84, 3], [15, 81, 3], [18, 78, 6]] },
      { inst: 'soft', notes: [[0, 52, 6], [6, 48, 6], [12, 45, 6], [18, 47, 6]] },
    ],
  },
  // Overture of Excess: C major, brass and timpani, all of it at once.
  overture: {
    bpm: 128,
    steps: 64,
    tracks: [
      { inst: 'bass', notes: [[0, 36, 8], [8, 36, 8], [16, 41, 8], [24, 41, 8], [32, 43, 8], [40, 43, 8], [48, 36, 8], [56, 36, 8]] },
      { inst: 'brass', level: 0.5, notes: [[0, [60, 64, 67], 3], [3, [60, 64, 67], 1], [4, [60, 64, 67], 4], [16, [60, 65, 69], 3], [19, [60, 65, 69], 1], [20, [60, 65, 69], 4], [32, [59, 62, 67], 3], [35, [59, 62, 67], 1], [36, [59, 62, 67], 4], [48, [60, 64, 67, 72], 8]] },
      { inst: 'brass', notes: [[0, 67, 3], [3, 67, 1], [4, 72, 4], [8, 76, 4], [12, 79, 4], [16, 81, 6], [22, 79, 2], [24, 77, 4], [28, 81, 4], [32, 79, 3], [35, 77, 1], [36, 76, 2], [38, 74, 2], [40, 71, 4], [44, 74, 4], [48, 72, 4], [52, 67, 2], [54, 76, 2], [56, 84, 8]] },
    ],
    drums: 't.......t.......t.......t.......t.......t.......t.......tttttttt',
  },
  // Funeral March: B-flat minor, slow, an organ and a muffled drum.
  march: {
    bpm: 46,
    steps: 32,
    tracks: [
      { inst: 'bass', notes: [[0, 34, 4], [4, 41, 4], [8, 34, 4], [12, 41, 4], [16, 34, 4], [20, 41, 4], [24, 34, 4], [28, 41, 4]] },
      { inst: 'organ', level: 0.28, notes: [[0, [46, 49, 53], 16], [16, [46, 49, 53], 8], [24, [45, 48, 53], 8]] },
      { inst: 'organ', notes: [[0, 58, 4], [4, 58, 3], [7, 58, 1], [8, 58, 8], [16, 61, 3], [19, 60, 1], [20, 60, 3], [23, 58, 1], [24, 58, 3], [27, 57, 1], [28, 58, 4]] },
    ],
    drums: 'k.......k.......k.......k.......',
  },
  // Boogie-Woogie: C, a walking left hand and a shuffle.
  boogie: {
    bpm: 150,
    swing: 0.33,
    steps: 64,
    tracks: [
      {
        inst: 'bass',
        notes: [36, 40, 43, 45, 46, 45, 43, 40, 36, 40, 43, 45, 46, 45, 43, 40, 41, 45, 48, 50, 51, 50, 48, 45, 36, 40, 43, 45, 46, 45, 43, 40].map((n, i) => [i * 2, n, 2]),
      },
      { inst: 'piano', level: 0.45, notes: [2, 6, 10, 14, 18, 22, 26, 30, 50, 54, 58, 62].map((s) => [s, [60, 64, 67, 70], 1]).concat([34, 38, 42, 46].map((s) => [s, [60, 63, 65, 69], 1])) },
      { inst: 'piano', notes: [[20, 72, 2], [22, 75, 1], [23, 76, 2], [26, 79, 2], [28, 81, 2], [30, 79, 2], [52, 82, 2], [54, 81, 2], [56, 79, 2], [58, 75, 2], [60, 72, 4]] },
    ],
    drums: 'h.h.s.h.h.h.s.h.h.h.s.h.h.h.s.h.h.h.s.h.h.h.s.h.h.h.s.h.h.h.s.h.',
  },
  // Nocturne: D-flat, a rolling left hand and a slow song over it.
  nocturne: {
    bpm: 63,
    steps: 32,
    tracks: [
      { inst: 'piano', level: 0.4, notes: [37, 44, 49, 53, 56, 53, 49, 44, 37, 44, 49, 53, 56, 53, 49, 44, 42, 49, 54, 58, 61, 58, 54, 49, 42, 49, 54, 58, 61, 58, 54, 49].map((n, i) => [i, n, 3]) },
      { inst: 'piano', notes: [[0, 77, 6], [6, 75, 2], [8, 73, 4], [12, 68, 4], [16, 70, 6], [22, 73, 2], [24, 77, 4], [28, 75, 4]] },
    ],
  },
  // Static: no music, only the groove's hiss and crackle.
  static: { bpm: 60, steps: 16, tracks: [], crackle: 4, hiss: 3 },
  // Danse Macabre: G minor, Death's fiddle tuned to the tritone, then the
  // bones of the xylophone.
  danse: {
    bpm: 126,
    steps: 48,
    tracks: [
      { inst: 'bass', notes: [[0, 43, 4], [12, 43, 4], [24, 38, 4], [36, 43, 4]] },
      { inst: 'reed', level: 0.45, notes: [[0, [69, 75], 2], [3, [69, 75], 2], [6, [69, 75], 2], [24, [62, 66, 69], 3], [30, [62, 66, 69], 3], [36, [67, 70, 74], 3], [42, [67, 70, 74], 3]] },
      { inst: 'bell', notes: [[12, 67, 2], [14, 67, 2], [16, 67, 2], [18, 70, 2], [20, 69, 2], [22, 67, 2], [24, 66, 2], [26, 67, 2], [28, 69, 2], [30, 62, 6], [36, 67, 2], [38, 67, 2], [40, 67, 2], [42, 70, 2], [44, 74, 4]] },
    ],
  },
  // Carousel: F major, a calliope's fairground waltz.
  carousel: {
    bpm: 152,
    steps: 48,
    tracks: [
      { inst: 'bass', notes: [[0, 41, 4], [12, 48, 4], [24, 48, 4], [36, 41, 4]] },
      { inst: 'calliope', level: 0.4, notes: [[4, [65, 69, 72], 2], [8, [65, 69, 72], 2], [16, [64, 67, 70], 2], [20, [64, 67, 70], 2], [28, [64, 67, 70], 2], [32, [64, 67, 70], 2], [40, [65, 69, 72], 2], [44, [65, 69, 72], 2]] },
      { inst: 'calliope', notes: [[0, 72, 4], [4, 69, 2], [6, 72, 2], [8, 77, 4], [12, 76, 4], [16, 79, 2], [18, 76, 2], [20, 72, 4], [24, 70, 4], [28, 74, 2], [30, 70, 2], [32, 67, 4], [36, 69, 4], [40, 72, 2], [42, 69, 2], [44, 65, 4]] },
    ],
  },
};

const LOOKAHEAD = 0.3; // seconds of music scheduled ahead
const TICK = 80; // ms between scheduling passes
const MUSIC = 0.2; // the gramophone's level under the room's sounds
const HUM = 0.014; // the hall's hum, with the needle up

export class Gramophone {
  constructor(ctx, out, noise) {
    this.ctx = ctx;
    this.noise = noise;
    this.tune = null;
    this.timer = null;

    // The horn: a soft clip, then the throat's narrow band.
    this.bus = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 1.8) / Math.tanh(1.8);
    }
    shaper.curve = curve;
    const low = ctx.createBiquadFilter();
    low.type = 'highpass';
    low.frequency.value = 230;
    const high = ctx.createBiquadFilter();
    high.type = 'lowpass';
    high.frequency.value = 3400;
    high.Q.value = 0.9;
    this.level = ctx.createGain();
    this.level.gain.value = 0;
    this.bus.connect(shaper).connect(low).connect(high).connect(this.level).connect(out);

    // Wow: the platter runs a little uneven, so every note's pitch sways.
    this.wow = ctx.createOscillator();
    this.wow.frequency.value = 0.55;
    this.wowDepth = ctx.createGain();
    this.wowDepth.gain.value = 7; // cents
    this.wow.connect(this.wowDepth);
    this.wow.start();

    // The groove's hiss.
    const hiss = ctx.createBufferSource();
    hiss.buffer = noise;
    hiss.loop = true;
    const hissBand = ctx.createBiquadFilter();
    hissBand.type = 'bandpass';
    hissBand.frequency.value = 5200;
    hissBand.Q.value = 0.6;
    this.hiss = ctx.createGain();
    this.hiss.gain.value = 0;
    hiss.connect(hissBand).connect(this.hiss).connect(out);
    hiss.start();
    // Crackles and the needle's thump, on while a record turns.
    this.groove = ctx.createGain();
    this.groove.gain.value = 0;
    this.groove.connect(out);

    // The hall's hum: the mains in old wiring, low and steady.
    this.hum = ctx.createGain();
    this.hum.gain.value = 0;
    for (const [f, g] of [
      [50, 1],
      [100, 0.55],
      [150, 0.18],
    ]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(this.hum);
      o.start();
    }
    this.hum.connect(out);
    this.hum.gain.linearRampToValueAtTime(HUM, ctx.currentTime + 3);
  }

  /** Put a tune on (its key in TUNES), or lift the needle (null). */
  play(key) {
    const tune = (key && TUNES[key]) || null;
    if (tune === this.tune) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.tune = tune;
    clearInterval(this.timer);
    this.timer = null;
    for (const g of [this.level, this.hiss, this.hum, this.groove]) g.gain.cancelScheduledValues(now);
    if (!tune) {
      // The needle lifts: the music stops at once, the hum comes back.
      this.level.gain.setTargetAtTime(0, now, 0.05);
      this.hiss.gain.setTargetAtTime(0, now, 0.05);
      this.groove.gain.setTargetAtTime(0, now, 0.05);
      this.hum.gain.setTargetAtTime(HUM, now, 0.6);
      return;
    }
    // The needle drops: a thump, the groove, then the tune.
    this.groove.gain.setValueAtTime(1, now);
    this.click(now, 0.25, 900);
    this.level.gain.setTargetAtTime(MUSIC, now + 0.25, 0.08);
    this.hiss.gain.setTargetAtTime(0.004 * (tune.hiss ?? 1), now, 0.2);
    this.hum.gain.setTargetAtTime(HUM * 0.25, now, 0.4);
    this.step = 0;
    this.next = now + 0.45;
    this.timer = setInterval(() => this.schedule(), TICK);
    this.schedule();
  }

  /** Seconds one step lasts. */
  stepTime(tune) {
    return 60 / tune.bpm / (tune.stepBeats ? 1 : 4);
  }

  schedule() {
    const tune = this.tune;
    if (!tune) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    // A tab in the background throttles the timer: skip ahead, never burst.
    if (this.next < now - 0.1) this.next = now + 0.05;
    const dt = this.stepTime(tune);
    while (this.next < now + LOOKAHEAD) {
      const step = this.step;
      // Swing: the second eighth of each beat comes late.
      const at = this.next + (tune.swing && step % 4 === 2 ? tune.swing * dt : 0);
      for (const track of tune.tracks) {
        for (const [s, notes, len, vel = 1] of track.notes) {
          if (s !== step) continue;
          for (const n of [notes].flat()) this.note(track.inst, at, n, len * dt, vel * (track.level ?? 1) / Math.sqrt([notes].flat().length));
        }
      }
      const drum = tune.drums?.[step];
      if (drum && drum !== '.') this.drum(drum, at);
      // The groove crackles now and then.
      if (Math.random() < 0.18 * (tune.crackle ?? 1) * dt * 4) this.click(at + Math.random() * dt, 0.02 + Math.random() * 0.06, 2500);
      this.step = (step + 1) % tune.steps;
      this.next += dt;
    }
  }

  /** One note of an instrument. */
  note(inst, at, midi, dur, vel) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const out = ctx.createGain();
    out.connect(this.bus);
    const voices = [];
    const osc = (type, freq, gain = 1) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      this.wowDepth.connect(o.detune);
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g);
      voices.push(o);
      return g;
    };
    const filter = (type, freq, q = 0.7) => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = freq;
      b.Q.value = q;
      return b;
    };
    const env = out.gain;
    let end = at + dur;
    switch (inst) {
      case 'bass': {
        osc('triangle', f).connect(out);
        osc('sine', f / 2, 0.6).connect(out);
        env.setValueAtTime(0, at);
        env.linearRampToValueAtTime(0.5 * vel, at + 0.01);
        env.exponentialRampToValueAtTime(0.12 * vel, at + Math.max(0.05, dur * 0.8));
        end = at + dur + 0.05;
        env.exponentialRampToValueAtTime(0.0005, end);
        break;
      }
      case 'reed': {
        // An accordion: two saws a few cents apart, through a soft filter.
        const lp = filter('lowpass', 1500);
        osc('sawtooth', f * 1.004).connect(lp);
        osc('sawtooth', f * 0.996).connect(lp);
        lp.connect(out);
        env.setValueAtTime(0, at);
        env.linearRampToValueAtTime(0.16 * vel, at + 0.03);
        env.setValueAtTime(0.14 * vel, at + Math.max(0.04, dur - 0.05));
        end = at + dur + 0.06;
        env.linearRampToValueAtTime(0, end);
        break;
      }
      case 'brass': {
        const lp = filter('lowpass', 700, 2);
        lp.frequency.setValueAtTime(700, at);
        lp.frequency.linearRampToValueAtTime(2600, at + 0.05);
        lp.frequency.exponentialRampToValueAtTime(1400, at + 0.3);
        osc('sawtooth', f).connect(lp);
        osc('square', f * 0.5, 0.3).connect(lp);
        lp.connect(out);
        env.setValueAtTime(0, at);
        env.linearRampToValueAtTime(0.2 * vel, at + 0.04);
        env.setValueAtTime(0.16 * vel, at + Math.max(0.05, dur - 0.04));
        end = at + dur + 0.05;
        env.linearRampToValueAtTime(0, end);
        break;
      }
      case 'organ': {
        osc('sine', f).connect(out);
        osc('sine', f * 2, 0.5).connect(out);
        osc('sine', f * 3, 0.25).connect(out);
        env.setValueAtTime(0, at);
        env.linearRampToValueAtTime(0.2 * vel, at + 0.06);
        env.setValueAtTime(0.2 * vel, at + Math.max(0.07, dur - 0.08));
        end = at + dur + 0.1;
        env.linearRampToValueAtTime(0, end);
        break;
      }
      case 'bell':
      case 'soft': {
        // A music box: a sine with an inharmonic shimmer, ringing long.
        osc('sine', f).connect(out);
        if (inst === 'bell') osc('sine', f * 2.76, 0.25).connect(out);
        env.setValueAtTime(0, at);
        env.linearRampToValueAtTime((inst === 'bell' ? 0.22 : 0.18) * vel, at + 0.005);
        end = at + Math.max(dur, 1.4);
        env.exponentialRampToValueAtTime(0.0005, end);
        break;
      }
      case 'piano': {
        const lp = filter('lowpass', 2600);
        osc('triangle', f).connect(lp);
        osc('sine', f * 2, 0.35).connect(lp);
        lp.connect(out);
        env.setValueAtTime(0, at);
        env.linearRampToValueAtTime(0.24 * vel, at + 0.005);
        end = at + Math.max(dur, 0.25) + 0.9;
        env.exponentialRampToValueAtTime(0.0005, end);
        break;
      }
      case 'calliope': {
        // Steam whistles: a square and its octave, with a wide vibrato.
        const lp = filter('lowpass', 2400);
        const vib = ctx.createOscillator();
        vib.frequency.value = 6;
        const depth = ctx.createGain();
        depth.gain.value = 18;
        vib.connect(depth);
        const a = osc('square', f, 0.6);
        const b = osc('sine', f * 2, 0.5);
        for (const v of voices) depth.connect(v.detune);
        voices.push(vib);
        a.connect(lp);
        b.connect(lp);
        lp.connect(out);
        env.setValueAtTime(0, at);
        env.linearRampToValueAtTime(0.13 * vel, at + 0.02);
        env.setValueAtTime(0.12 * vel, at + Math.max(0.03, dur - 0.03));
        end = at + dur + 0.04;
        env.linearRampToValueAtTime(0, end);
        break;
      }
      default:
        out.disconnect();
        return;
    }
    for (const v of voices) {
      v.start(at);
      v.stop(end + 0.05);
    }
    // Let the note go: nothing may keep a finished voice connected.
    voices[0].onended = () => {
      out.disconnect();
      for (const v of voices) {
        try {
          this.wowDepth.disconnect(v.detune);
        } catch {
          // The calliope's vibrato was never wired to the wow.
        }
      }
    };
  }

  /** k kick, s snare, h hat, t timpani. */
  drum(kind, at) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.connect(this.bus);
    if (kind === 'k' || kind === 't') {
      const o = ctx.createOscillator();
      const long = kind === 't';
      o.frequency.setValueAtTime(long ? 98 : 110, at);
      o.frequency.exponentialRampToValueAtTime(long ? 72 : 45, at + (long ? 0.5 : 0.18));
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(long ? 0.5 : 0.6, at + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0005, at + (long ? 0.7 : 0.3));
      o.connect(g);
      o.start(at);
      o.stop(at + 0.75);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const b = ctx.createBiquadFilter();
    b.type = kind === 'h' ? 'highpass' : 'bandpass';
    b.frequency.value = kind === 'h' ? 7000 : 1900;
    const len = kind === 'h' ? 0.04 : 0.14;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(kind === 'h' ? 0.12 : 0.3, at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0005, at + len);
    src.connect(b).connect(g);
    src.start(at, Math.random() * 1.5, len + 0.02);
  }

  /** A crackle in the groove (or the needle's thump, low and loud). */
  click(at, gain, freq) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const b = ctx.createBiquadFilter();
    b.type = freq < 1500 ? 'lowpass' : 'highpass';
    b.frequency.value = freq;
    const g = ctx.createGain();
    const len = freq < 1500 ? 0.08 : 0.004 + Math.random() * 0.006;
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0005, at + len);
    src.connect(b).connect(g).connect(this.groove);
    src.start(at, Math.random() * 1.5, len + 0.01);
  }
}
