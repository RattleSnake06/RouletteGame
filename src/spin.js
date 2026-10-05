import * as THREE from 'three';

const TAU = Math.PI * 2;
const wrap = (a) => a - TAU * Math.round(a / TAU);

// Grab-and-fling rotation for the wheel. While held, the rotor follows the
// cursor's angle around the hub (with a little lag, so it feels heavy).
// On release it keeps the hand's angular velocity and coasts to a stop.
export class SpinController {
  constructor({ camera, dom, planeY, grabRadius, onGrab, onRelease }) {
    this.camera = camera;
    this.dom = dom;
    this.grabRadius = grabRadius;
    this.onGrab = onGrab;
    this.onRelease = onRelease;

    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.hit = new THREE.Vector3();

    this.angle = 0; // rotor rotation (rad), counter-clockwise from above
    this.velocity = 0; // rad/s
    this.target = 0;
    this.dragging = false;
    this.lastPointerAngle = 0;
    this.samples = [];
    this.maxSpeed = 10;

    this.pointer = new THREE.Vector2(); // normalised -1..1, for camera parallax

    this._down = this._down.bind(this);
    this._move = this._move.bind(this);
    this._up = this._up.bind(this);
    dom.addEventListener('pointerdown', this._down);
    window.addEventListener('pointermove', this._move);
    window.addEventListener('pointerup', this._up);
    window.addEventListener('pointercancel', this._up);
  }

  get speed() {
    return Math.abs(this.velocity);
  }

  _project(ev) {
    const rect = this.dom.getBoundingClientRect();
    this.ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    this.pointer.copy(this.ndc);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.plane, this.hit)) return null;
    return { angle: Math.atan2(-this.hit.z, this.hit.x), r: Math.hypot(this.hit.x, this.hit.z) };
  }

  _down(ev) {
    if (ev.button !== undefined && ev.button !== 0) return;
    const p = this._project(ev);
    if (!p || p.r > this.grabRadius) return;
    ev.preventDefault();
    this.dragging = true;
    this.dom.setPointerCapture?.(ev.pointerId);
    this.lastPointerAngle = p.angle;
    this.target = this.angle;
    this.samples.length = 0;
    this.samples.push({ t: ev.timeStamp, a: this.target });
    this.dom.style.cursor = 'grabbing';
    this.onGrab?.();
  }

  _move(ev) {
    if (!this.dragging) {
      const p = this._project(ev);
      this.dom.style.cursor = p && p.r <= this.grabRadius ? 'grab' : 'default';
      return;
    }
    // Browsers merge pointer moves to one per frame; the coalesced list keeps
    // every intermediate position, which makes the fling speed accurate.
    const coalesced = ev.getCoalescedEvents?.();
    for (const e of coalesced && coalesced.length ? coalesced : [ev]) this._dragTo(e);
  }

  _dragTo(ev) {
    const p = this._project(ev);
    // Near the hub the angle is meaningless; wait until the cursor is out again.
    if (!p || p.r < 0.5) {
      if (p) this.lastPointerAngle = p.angle;
      return;
    }
    this.target += wrap(p.angle - this.lastPointerAngle);
    this.lastPointerAngle = p.angle;
    // Event timestamps record when the hand actually moved, even if the
    // main thread was busy and handlers ran late.
    const now = ev.timeStamp;
    this.samples.push({ t: now, a: this.target });
    while (this.samples.length > 2 && now - this.samples[0].t > 250) this.samples.shift();
  }

  _up(ev) {
    if (!this.dragging) return;
    this.dragging = false;
    this.dom.releasePointerCapture?.(ev.pointerId);
    const p = this._project(ev);
    this.dom.style.cursor = p && p.r <= this.grabRadius ? 'grab' : 'default';

    // Fling velocity from the hand's last ~100 ms of motion (pointer events,
    // not frames, so a slow frame rate cannot swallow the flick). A hand
    // that stopped before letting go gives no spin.
    const now = ev.timeStamp;
    const recent = this.samples.filter((s) => now - s.t < 100);
    let v = 0;
    if (recent.length >= 2 && now - recent[recent.length - 1].t < 60) {
      const a = recent[0];
      const b = recent[recent.length - 1];
      if (b.t > a.t) v = ((b.a - a.a) / (b.t - a.t)) * 1000;
    }
    this.velocity = THREE.MathUtils.clamp(v, -this.maxSpeed, this.maxSpeed);
    this.onRelease?.(this.velocity);
  }

  update(dt) {
    if (this.dragging) {
      const prev = this.angle;
      this.angle += (this.target - this.angle) * (1 - Math.exp(-dt * 22));
      this.velocity = dt > 0 ? (this.angle - prev) / dt : 0;
    } else if (this.velocity !== 0) {
      // Bearing drag: a constant part plus a speed-proportional part.
      const mag = Math.abs(this.velocity);
      const decel = 0.15 + 0.2 * mag;
      const next = Math.max(0, mag - decel * dt);
      this.velocity = next < 0.004 ? 0 : Math.sign(this.velocity) * next;
      this.angle += this.velocity * dt;
    }
  }
}
