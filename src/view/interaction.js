import * as THREE from 'three';

// Pointer interaction with objects in the room. Each interactive object gets a
// handler:
//
//   enabled()         optional; false makes the object ignore the pointer
//   cursor            CSS cursor while hovered (default 'pointer')
//   hover(hit, ev)    pointer moved over the object (called on every move)
//   leave()           pointer left the object
//   click(hit, ev)    pressed and released without dragging
//   down(hit, ev)     pressed; return true to capture the pointer for a drag
//   drag(ev)          captured pointer moved
//   up(ev)            captured pointer released
//
// Presses that hit an interactive object are marked as consumed, so the wheel
// fling (registered after this) ignores them.

const CLICK_SLOP = 6; // px a press may wander and still count as a click

export class Interaction {
  constructor(dom, camera) {
    this.dom = dom;
    this.camera = camera;
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.targets = [];
    this.enabled = true;
    this.hovered = null;
    this.captured = null;
    this.pressed = null;
    this.consumed = new WeakSet();
    this.fallbackCursor = () => 'default';
    this.lastEvent = null;

    dom.addEventListener('pointerdown', (e) => this._down(e));
    window.addEventListener('pointermove', (e) => this._move(e));
    window.addEventListener('pointerup', (e) => this._up(e));
    window.addEventListener('pointercancel', (e) => this._up(e));
  }

  add(object, handler) {
    object.traverse((o) => {
      if (o.isMesh) o.userData.interact = handler;
    });
    this.targets.push(object);
    return object;
  }

  remove(object) {
    this.targets = this.targets.filter((t) => t !== object);
    if (this.hovered?.object === object) this._setHovered(null);
  }

  /** Raycaster aimed through a pointer event. */
  ray(ev) {
    const rect = this.dom.getBoundingClientRect();
    this.ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.raycaster;
  }

  pick(ev) {
    if (!this.enabled) return null;
    const hits = this.ray(ev).intersectObjects(this.targets, true);
    for (const hit of hits) {
      if (!hit.object.visible) continue;
      const handler = hit.object.userData.interact;
      if (!handler) continue;
      if (handler.enabled && !handler.enabled()) continue;
      return { handler, hit };
    }
    return null;
  }

  /** Re-run hover against the last known pointer position (after the scene changes). */
  refresh() {
    if (this.lastEvent && !this.captured) this._hover(this.lastEvent);
  }

  _setHovered(next) {
    if (this.hovered && this.hovered.handler !== next?.handler) this.hovered.handler.leave?.();
    this.hovered = next;
  }

  _hover(ev) {
    const p = this.pick(ev);
    this._setHovered(p);
    if (p) {
      p.handler.hover?.(p.hit, ev);
      this.dom.style.cursor = p.handler.cursor ?? 'pointer';
    } else {
      this.dom.style.cursor = this.fallbackCursor(ev);
    }
  }

  _down(ev) {
    if (ev.button !== undefined && ev.button !== 0) return;
    this.lastEvent = ev;
    const p = this.pick(ev);
    if (!p) return;
    this.consumed.add(ev);
    ev.preventDefault();
    if (p.handler.down?.(p.hit, ev, this)) {
      this.captured = p.handler;
      this.dom.setPointerCapture?.(ev.pointerId);
      return;
    }
    this.pressed = { handler: p.handler, x: ev.clientX, y: ev.clientY };
  }

  _move(ev) {
    this.lastEvent = ev;
    if (this.captured) {
      this.captured.drag?.(ev, this);
      return;
    }
    if (ev.target !== this.dom && !this.dom.contains(ev.target)) {
      this._setHovered(null);
      return;
    }
    this._hover(ev);
  }

  _up(ev) {
    this.lastEvent = ev;
    if (this.captured) {
      const handler = this.captured;
      this.captured = null;
      this.dom.releasePointerCapture?.(ev.pointerId);
      handler.up?.(ev, this);
      this._hover(ev);
      return;
    }
    const pressed = this.pressed;
    this.pressed = null;
    if (!pressed) return;
    if (Math.hypot(ev.clientX - pressed.x, ev.clientY - pressed.y) > CLICK_SLOP) return;
    const p = this.pick(ev);
    if (p && p.handler === pressed.handler) p.handler.click?.(p.hit, ev);
  }
}
