// All sound is synthesised with WebAudio: a low room tone, the whirr of the
// rotor, and a soft wooden tick each time a pocket passes.
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
