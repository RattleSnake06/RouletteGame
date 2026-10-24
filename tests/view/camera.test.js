import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraDirector } from '../../src/view/camera.js';

// The player's figure shows where the camera has it in the shot, whatever
// interrupts a move: a bot found the camera left inside it (the marathon).
function director() {
  const d = new CameraDirector(new THREE.PerspectiveCamera());
  const at = (x) => ({ position: new THREE.Vector3(x, 1, 0), target: new THREE.Vector3(x, 0, -5), fov: 50 });
  d.setAnchor('table', { ...at(0) });
  d.setAnchor('cage', { ...at(2) });
  d.setAnchor('wide', { ...at(9), kind: 'wide' });
  d.setAnchor('menu', { ...at(5), figure: true });
  d.goTo('table', { cut: true });
  return d;
}

describe('the figure in the shot', () => {
  it('shows at the wide shot and the menu, never at the eyes', () => {
    const d = director();
    expect(d.seesFigure()).toBe(false);
    d.goTo('wide', { cut: true });
    expect(d.seesFigure()).toBe(true);
    d.goTo('menu', { cut: true });
    expect(d.seesFigure()).toBe(true);
    d.goTo('cage', { cut: true });
    expect(d.seesFigure()).toBe(false);
  });

  it('appears part of the way out, and goes most of the way back', () => {
    const d = director();
    d.goTo('wide', { duration: 1 });
    d.update(0.2, 0);
    expect(d.seesFigure()).toBe(false);
    d.update(0.6, 0);
    expect(d.seesFigure()).toBe(true);
    d.update(1, 0);
    d.goTo('table', { duration: 1 });
    d.update(0.4, 0);
    expect(d.seesFigure()).toBe(true);
    d.update(0.6, 0);
    expect(d.seesFigure()).toBe(false);
  });

  it('is never left showing at the eyes when a move is cut short', () => {
    const d = director();
    d.goTo('wide', { duration: 1 });
    d.update(0.6, 0);
    expect(d.seesFigure()).toBe(true);
    // Back to the table before the wide shot lands, then a station.
    d.goTo('table', { duration: 0.4 });
    d.update(0.1, 0);
    d.goTo('cage', { duration: 0.6 });
    d.update(1, 0);
    expect(d.seesFigure()).toBe(false);
  });
});
