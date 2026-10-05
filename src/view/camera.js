import * as THREE from 'three';

// Fixed camera anchors with eased moves between them (design doc 8.2):
// first person at the table, turned toward the Cage, and the wide shot used
// while the ball is in flight.

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export class CameraDirector {
  constructor(camera) {
    this.camera = camera;
    this.anchors = new Map();
    this.current = null;
    this.tween = null;
    this.reducedMotion = false;
    this.parallax = new THREE.Vector2();
    this._dummy = new THREE.PerspectiveCamera();
  }

  /** Define or update an anchor. `kind` is 'eye' (first person) or 'wide'. */
  setAnchor(name, { position, target, fov, kind = 'eye' }) {
    this._dummy.position.copy(position);
    this._dummy.lookAt(target);
    this.anchors.set(name, {
      position: position.clone(),
      quaternion: this._dummy.quaternion.clone(),
      fov,
      kind,
    });
  }

  /** Move to an anchor. Resolves on arrival. `onProgress(e)` gets 0..1. */
  goTo(name, { duration = 0.75, cut = false, onProgress } = {}) {
    const to = this.anchors.get(name);
    if (!to) throw new Error(`No camera anchor: ${name}`);
    if (this.tween) this.tween.resolve();
    this.current = name;
    if (cut || this.reducedMotion || duration <= 0) {
      this.tween = null;
      onProgress?.(1);
      this._apply(to.position, to.quaternion, to.fov);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.tween = {
        from: {
          position: this.camera.position.clone(),
          quaternion: this.camera.quaternion.clone(),
          fov: this.camera.fov,
        },
        to,
        t: 0,
        duration,
        onProgress,
        resolve,
      };
    });
  }

  update(dt, time) {
    const tw = this.tween;
    if (tw) {
      tw.t = Math.min(1, tw.t + dt / tw.duration);
      const e = easeInOut(tw.t);
      this.camera.position.lerpVectors(tw.from.position, tw.to.position, e);
      this.camera.quaternion.slerpQuaternions(tw.from.quaternion, tw.to.quaternion, e);
      this.camera.fov = tw.from.fov + (tw.to.fov - tw.from.fov) * e;
      this.camera.updateProjectionMatrix();
      tw.onProgress?.(e);
      if (tw.t >= 1) {
        this.tween = null;
        tw.resolve();
      }
      return;
    }
    const a = this.anchors.get(this.current);
    if (!a) return;
    // Resting sway: breathing in first person, a slow drift plus a hint of
    // cursor parallax in the wide shot.
    const pos = a.position.clone();
    if (a.kind === 'wide') {
      pos.x += Math.sin(time * 0.21) * 0.06 + this.parallax.x * 0.3;
      pos.y += Math.sin(time * 0.17 + 1.1) * 0.04 + this.parallax.y * 0.15;
    } else {
      pos.y += Math.sin(time * 1.5) * 0.003;
    }
    this._apply(pos, a.quaternion, a.fov);
  }

  _apply(position, quaternion, fov) {
    this.camera.position.copy(position);
    this.camera.quaternion.copy(quaternion);
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
