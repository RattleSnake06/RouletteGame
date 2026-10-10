// All sound is synthesised with WebAudio: a low room tone, the whirr of the
// rotor, pocket ticks, the ball's rattle and bounces, chips, coins and the
// Cage. Nothing plays until start() is called from a user gesture.
export class WheelAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.lastTickTime = 0;
  }

  // Must be called from a user gesture (browsers block audio until then).
  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    const white = ctx.createBuffer(1, len, ctx.sampleRate);
    const wd = white.getChannelData(0);
    for (let i = 0; i < len; i++) wd[i] = Math.random() * 2 - 1;
    this.white = white;

    // Rotor whirr: looping noise through a lowpass that opens with speed.
    const whirSrc = ctx.createBufferSource();
    whirSrc.buffer = white;
    whirSrc.loop = true;
    this.whirFilter = ctx.createBiquadFilter();
    this.whirFilter.type = 'lowpass';
    this.whirFilter.frequency.value = 120;
    this.whirFilter.Q.value = 1.2;
    this.whirGain = ctx.createGain();
    this.whirGain.gain.value = 0;
    whirSrc.connect(this.whirFilter).connect(this.whirGain).connect(this.master);
    whirSrc.start();

    // Room tone: brown noise, very low and very quiet.
    const brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const bd = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      bd[i] = last * 3.5;
    }
    const roomSrc = ctx.createBufferSource();
    roomSrc.buffer = brown;
    roomSrc.loop = true;
    const roomLP = ctx.createBiquadFilter();
    roomLP.type = 'lowpass';
    roomLP.frequency.value = 180;
    const roomGain = ctx.createGain();
    roomGain.gain.value = 0;
    roomGain.gain.linearRampToValueAtTime(0.14, ctx.currentTime + 4);
    roomSrc.connect(roomLP).connect(roomGain).connect(this.master);
    roomSrc.start();

    // Ball rattle: bright noise, chopped by a fast random flutter.
    const rollSrc = ctx.createBufferSource();
    rollSrc.buffer = white;
    rollSrc.loop = true;
    const rollBP = ctx.createBiquadFilter();
    rollBP.type = 'bandpass';
    rollBP.frequency.value = 3200;
    rollBP.Q.value = 0.9;
    this.rollGain = ctx.createGain();
    this.rollGain.gain.value = 0;
    rollSrc.connect(rollBP).connect(this.rollGain).connect(this.master);
    rollSrc.start();
    this.rollFilter = rollBP;
  }

  /** Short filtered noise burst with an envelope: the building block of clicks. */
  _burst({ freq, q = 2, gain, decay, type = 'bandpass', at = 0 }) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain, now + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0005, now + decay);
    src.connect(f).connect(g).connect(this.master);
    src.start(now, Math.random() * 1.5, decay + 0.05);
  }

  _tone({ freq, to, gain, decay, type = 'sine', at = 0 }) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, now + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0005, now + decay);
    osc.connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + decay + 0.05);
  }

  /** A clay chip set down on felt. */
  chip() {
    this._burst({ freq: 2400, q: 3, gain: 0.22, decay: 0.05 });
    this._tone({ freq: 380, to: 220, gain: 0.12, decay: 0.07 });
  }

  /** A card dealt or picked up. */
  card() {
    this._burst({ freq: 1800, q: 0.7, gain: 0.12, decay: 0.12, type: 'highpass' });
  }

  /** Ball rolling on the track, level 0..1. */
  roll(level) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const flutter = 0.6 + Math.random() * 0.4;
    this.rollGain.gain.setTargetAtTime(level * 0.11 * flutter, now, 0.03);
    this.rollFilter.frequency.setTargetAtTime(2200 + level * 2200, now, 0.05);
  }

  /** The ball hitting a fret or pocket, strength 0..1. */
  bounce(strength) {
    this._burst({ freq: 3600 + Math.random() * 900, q: 4, gain: 0.08 + strength * 0.22, decay: 0.04 });
    this._tone({ freq: 1500 + Math.random() * 300, to: 900, gain: 0.04 + strength * 0.06, decay: 0.05 });
  }

  /** The ball dropping into its final pocket. */
  settle() {
    this._burst({ freq: 1400, q: 2, gain: 0.3, decay: 0.08 });
    this._tone({ freq: 520, to: 260, gain: 0.18, decay: 0.12 });
  }

  /** One payout; `step` raises the pitch through a run of wins. */
  coin(step = 0) {
    const f = 1700 * 2 ** (Math.min(step, 12) / 12);
    this._tone({ freq: f, gain: 0.09, decay: 0.35, type: 'triangle' });
    this._tone({ freq: f * 2.01, gain: 0.03, decay: 0.2 });
  }

  /** Nothing paid. */
  miss() {
    this._tone({ freq: 140, to: 90, gain: 0.16, decay: 0.3, type: 'triangle' });
  }

  /** Coins pushed through the Cage's slot. */
  bank() {
    for (let i = 0; i < 6; i++) {
      this._tone({ freq: 2100 + Math.random() * 900, gain: 0.05, decay: 0.18, type: 'triangle', at: i * 0.045 });
      this._burst({ freq: 5000, q: 2, gain: 0.05, decay: 0.03, at: i * 0.045 });
    }
  }

  /** The night ends: a low, soft bell. */
  nightBell() {
    this._tone({ freq: 196, gain: 0.16, decay: 2.2 });
    this._tone({ freq: 392.5, gain: 0.05, decay: 1.6 });
    this._tone({ freq: 587, gain: 0.025, decay: 1.2 });
  }

  /** A debt paid off. */
  debtPaid() {
    [262, 330, 392, 523].forEach((f, i) => this._tone({ freq: f, gain: 0.1, decay: 1.4, type: 'triangle', at: i * 0.09 }));
  }

  /** The Cage collects and the run ends. */
  collected() {
    this._tone({ freq: 70, to: 35, gain: 0.5, decay: 2.5, type: 'sine' });
    this._burst({ freq: 300, q: 0.5, gain: 0.25, decay: 1.6, type: 'lowpass' });
  }

  /** The wheel's bulb switching on: a relay clunk and the filament's hum. */
  clunk() {
    this._burst({ freq: 900, q: 1.5, gain: 0.35, decay: 0.06 });
    this._tone({ freq: 95, to: 60, gain: 0.3, decay: 0.25, type: 'triangle' });
    this._tone({ freq: 120, gain: 0.05, decay: 1.2, type: 'sawtooth', at: 0.04 });
  }

  /** A refused action. */
  deny() {
    this._tone({ freq: 160, gain: 0.08, decay: 0.12, type: 'square' });
  }

  /** The service bell: a bright ding when a talisman answers, a dull clack when none does. */
  bell(kind = 'ding') {
    if (kind === 'dull') {
      this._burst({ freq: 1200, q: 3, gain: 0.18, decay: 0.05 });
      this._tone({ freq: 410, to: 380, gain: 0.07, decay: 0.18, type: 'triangle' });
      return;
    }
    // Inharmonic partials, as a struck brass dome has.
    this._burst({ freq: 5200, q: 2, gain: 0.12, decay: 0.03 });
    this._tone({ freq: 1568, gain: 0.14, decay: 1.6 });
    this._tone({ freq: 1568 * 2.76, gain: 0.04, decay: 0.7 });
    this._tone({ freq: 1568 * 5.4, gain: 0.015, decay: 0.35 });
  }

  /** A talisman acting during a payout; `step` climbs within a chip's line. */
  trigger(step = 0) {
    const f = 880 * 2 ** (Math.min(step, 10) / 10);
    this._burst({ freq: 4200, q: 6, gain: 0.05, decay: 0.025 });
    this._tone({ freq: f, gain: 0.06, decay: 0.16, type: 'triangle' });
    this._tone({ freq: f * 2.4, gain: 0.02, decay: 0.08 });
  }

  /** The Cabinet's restock crank: a ratchet. */
  crank() {
    for (let i = 0; i < 9; i++) this._burst({ freq: 2600 - i * 80, q: 5, gain: 0.07, decay: 0.025, at: i * 0.07 });
    this._tone({ freq: 90, to: 70, gain: 0.08, decay: 0.7, type: 'triangle' });
  }

  /** Tokens pushed across the counter: a heavier clink than coins. */
  buy() {
    [0, 0.07, 0.15].forEach((at, i) => {
      this._tone({ freq: 1250 + i * 140, gain: 0.08, decay: 0.3, type: 'triangle', at });
      this._burst({ freq: 3800, q: 3, gain: 0.05, decay: 0.03, at });
    });
  }

  /** A talisman taken off its hook and traded for tokens. */
  sell() {
    this._burst({ freq: 2000, q: 1, gain: 0.08, decay: 0.08, type: 'highpass' });
    this._tone({ freq: 1100, to: 900, gain: 0.06, decay: 0.25, type: 'triangle', at: 0.05 });
  }

  /** The Piggy Bank smashed: a ceramic crack, then the coins spill. */
  smash() {
    this._burst({ freq: 2800, q: 0.8, gain: 0.35, decay: 0.12 });
    this._burst({ freq: 900, q: 1, gain: 0.25, decay: 0.2, type: 'lowpass' });
    for (let i = 0; i < 8; i++) this._tone({ freq: 1900 + Math.random() * 1400, gain: 0.05, decay: 0.2, type: 'triangle', at: 0.08 + i * 0.05 });
  }

  /** The Glass Eye seeing ahead: a glassy shimmer. */
  foresee() {
    [1320, 1760, 2217, 2640].forEach((f, i) => this._tone({ freq: f, gain: 0.035, decay: 1.1, at: i * 0.06 }));
  }

  /** The Wheel of Fortune throws the ball again: a rising whoosh. */
  rethrow() {
    this._burst({ freq: 900, q: 0.6, gain: 0.18, decay: 0.45, type: 'lowpass' });
    this._tone({ freq: 220, to: 660, gain: 0.07, decay: 0.4, type: 'sawtooth' });
  }

  tick(speed) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    if (now - this.lastTickTime < 0.022) return;
    this.lastTickTime = now;
    const vol = Math.min(1, 0.2 + speed / 7) * 0.32;

    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900 + Math.random() * 700;
    bp.Q.value = 3.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(vol, now + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0008, now + 0.045);
    src.connect(bp).connect(g).connect(this.master);
    src.start(now, Math.random() * 1.5, 0.06);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520 + Math.random() * 60, now);
    osc.frequency.exponentialRampToValueAtTime(260, now + 0.05);
    const og = ctx.createGain();
    og.gain.setValueAtTime(vol * 0.5, now);
    og.gain.exponentialRampToValueAtTime(0.0008, now + 0.06);
    osc.connect(og).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  update(speed) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const s = Math.min(speed / 12, 1);
    this.whirGain.gain.setTargetAtTime(s * 0.22, now, 0.08);
    this.whirFilter.frequency.setTargetAtTime(110 + s * 650, now, 0.08);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
    return this.muted;
  }
}
