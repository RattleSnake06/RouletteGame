import { DIM, pocketAngle } from './wheel.js';

// Ball choreography (design doc 9.6). The result is decided by the core
// before launch; this only makes the ball arrive there believably.
//
//   orbit   the ball rides the track against the rotor, slowing
//   drop    it spirals in across the number ring
//   settle  it bounces through a few pockets and stops in the target pocket
//
// The orbit is aimed using the rotor's predicted angle so the ball reaches the
// pockets about DELTA_NOM short of its target. The settle phase then runs in
// the rotor's own frame, so whatever the rotor actually did, the ball ends
// exactly in the decided pocket.

const TAU = Math.PI * 2;
const mod = (a, n) => ((a % n) + n) % n;
const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

const T_LIFT = 0.35;
const T_ORBIT = 1.9;
const T_DROP = 0.5;
const T_POCKETS = T_ORBIT + T_DROP;
const DELTA_NOM = 1.3; // rad still to travel (relative to the rotor) when the drop ends
const W_END = 2.2; // ball's angular speed in the world when the drop ends
const A_BASE = 13; // minimum orbit travel in rad (about two laps)

const REST_Y = DIM.pocketY + DIM.ballRadius;
const DROP_RADIUS = 3.14;
const HOPS = [0, 0.2, 0.38, 0.54, 0.68, 0.8];
const HOP_HEIGHT = [0.13, 0.09, 0.06, 0.035, 0.018];

export class BallAnimator {
  constructor({ ball, spin, onBounce, onSettle, onRoll }) {
    this.ball = ball;
    this.spin = spin;
    this.onBounce = onBounce;
    this.onSettle = onSettle;
    this.onRoll = onRoll;
    this.mode = 'rest';
    this.pocket = 0;
    this._resolve = null;
  }

  get flying() {
    return this.mode !== 'rest';
  }

  restAt(pocketIndex) {
    this.mode = 'rest';
    this.pocket = pocketIndex;
    this._place(this.spin.angle + pocketAngle(pocketIndex), DIM.ballRestRadius, REST_Y);
  }

  /** Launch toward a pocket index (wheel order). Resolves when the ball settles. */
  launch(target) {
    const s = this.spin.velocity >= 0 ? -1 : 1; // the ball runs against the rotor
    const theta0 = this.spin.angle + pocketAngle(this.pocket);
    const aim = this.spin.predictAngle(T_POCKETS) + pocketAngle(target) - s * DELTA_NOM;
    const travel = A_BASE + mod(s * (aim - theta0) - A_BASE, TAU);
    const w0 = (2 * travel) / T_POCKETS - W_END;
    this.flight = { s, theta0, w0, decel: (w0 - W_END) / T_POCKETS, target, tau: 0 };
    this.mode = 'orbit';
    return new Promise((resolve) => {
      this._resolve = resolve;
    });
  }

  update(dt) {
    if (this.mode === 'rest') {
      this._place(this.spin.angle + pocketAngle(this.pocket), DIM.ballRestRadius, REST_Y);
      return;
    }
    const f = this.flight;
    f.tau += dt;

    if (this.mode === 'orbit') {
      const tau = Math.min(f.tau, T_POCKETS);
      const theta = f.theta0 + f.s * (f.w0 * tau - 0.5 * f.decel * tau * tau);
      let r = DIM.trackRadius + 0.008 * Math.sin(tau * 9);
      let y = DIM.trackY;
      if (tau < T_LIFT) {
        const p = tau / T_LIFT;
        r = lerp(DIM.ballRestRadius, DIM.trackRadius, smooth(p));
        y = lerp(REST_Y, DIM.trackY, smooth(p)) + 0.12 * Math.sin(Math.PI * p);
      } else if (tau > T_ORBIT) {
        const p = (tau - T_ORBIT) / T_DROP;
        r = lerp(DIM.trackRadius, DROP_RADIUS, smooth(p));
        y = lerp(DIM.trackY, REST_Y + 0.06, p) + 0.06 * Math.sin(Math.PI * p);
      }
      this._place(theta, r, y);
      this.onRoll?.(Math.min(1, (f.w0 - f.decel * tau) / 8));
      if (f.tau >= T_POCKETS) this._beginSettle(theta);
      return;
    }

    // Settle, in the rotor's frame.
    const u = Math.min(1, (f.tau - f.settleStart) / f.settleTime);
    const eased = 1 - (1 - u) ** 2.2;
    const phi = f.phiStart + f.delta * eased;
    const r = lerp(DROP_RADIUS, DIM.ballRestRadius, smooth(Math.min(1, u * 1.25))) + 0.045 * Math.sin(u * 17) * (1 - u) ** 2;
    let y = REST_Y;
    for (let i = 0; i < HOP_HEIGHT.length; i++) {
      if (u >= HOPS[i] && u < HOPS[i + 1]) {
        const p = (u - HOPS[i]) / (HOPS[i + 1] - HOPS[i]);
        y += HOP_HEIGHT[i] * 4 * p * (1 - p);
      }
    }
    while (f.nextHop < HOPS.length && u >= HOPS[f.nextHop]) {
      this.onBounce?.(1 - f.nextHop / HOPS.length);
      f.nextHop += 1;
    }
    this._place(this.spin.angle + phi, r, y);
    this.onRoll?.(Math.max(0, 0.45 * (1 - u * 1.4)));
    if (u >= 1) {
      this.mode = 'rest';
      this.pocket = f.target;
      this.onRoll?.(0);
      this.onSettle?.();
      const resolve = this._resolve;
      this._resolve = null;
      resolve?.();
    }
  }

  _beginSettle(theta) {
    const f = this.flight;
    const phiStart = theta - this.spin.angle;
    const vRel = f.s * W_END - this.spin.velocity;
    const dir = Math.sign(vRel) || f.s;
    let delta = dir * mod(dir * (pocketAngle(f.target) - phiStart), TAU);
    if (Math.abs(delta) < 0.45) delta += dir * TAU;
    f.phiStart = phiStart;
    f.delta = delta;
    f.settleStart = f.tau;
    f.settleTime = Math.min(1.9, Math.max(0.9, (2.2 * Math.abs(delta)) / Math.max(0.5, Math.abs(vRel))));
    f.nextHop = 1;
    this.mode = 'settle';
  }

  _place(angle, r, y) {
    this.ball.position.set(r * Math.cos(angle), y, -r * Math.sin(angle));
  }
}
