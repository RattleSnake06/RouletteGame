import * as THREE from 'three';

// The Bell (design doc 5.8): a brass service bell on the near-left corner of
// the table. Ringing it wakes the next talisman in line that can answer.
// Table-local coordinates, like the rail: the table top is at y 0.95.

const POS = new THREE.Vector3(-0.47, 0.95, 0.23);

export function createBell({ materials, interaction, callbacks = {} }) {
  const group = new THREE.Group();
  group.name = 'bell';
  group.position.copy(POS);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.043, 0.012, 28), materials.darkMetal);
  base.position.y = 0.006;
  base.castShadow = true;
  base.receiveShadow = true;
  // Its own material, so the dome can glint without lighting every brass part.
  const domeMat = materials.brass.clone();
  domeMat.emissive = new THREE.Color(0xffc070);
  domeMat.emissiveIntensity = 0;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.034, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
  dome.position.y = 0.012;
  dome.castShadow = true;
  const plunger = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.018, 8), materials.brass);
  stem.position.y = 0.009;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.007, 12, 8), materials.brass);
  knob.position.y = 0.02;
  plunger.add(stem, knob);
  plunger.position.y = 0.044;
  group.add(base, dome, plunger);

  // The hit area is a little bigger than the bell, so it is easy to strike.
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 12), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 0.035;
  hit.userData.role = 'bell';
  group.add(hit);

  let locked = false;
  let press = 0;
  let glint = 0;
  let ready = false;

  interaction.add(hit, {
    enabled: () => !locked,
    hover: (h, ev) => callbacks.onHover?.({ kind: 'bell' }, ev),
    leave: () => callbacks.onHover?.(null),
    click: () => callbacks.onRing?.(),
  });

  /** The plunger dips; a talisman answered or not. */
  function ring(answered) {
    press = 1;
    glint = answered ? 1 : 0.15;
  }

  /** The dome glints faintly while some talisman would answer. */
  function sync(view) {
    ready = view.queue.length > 0;
  }

  function update(dt, t) {
    press = Math.max(0, press - dt * 6);
    plunger.position.y = 0.044 - 0.004 * Math.sin(Math.min(1, press) * Math.PI);
    glint = Math.max(0, glint - dt * 1.6);
    const idle = ready ? 0.06 + 0.04 * Math.sin(t * 2.1) : 0;
    domeMat.emissiveIntensity = Math.max(idle, glint * 0.8);
  }

  return {
    group,
    ring,
    sync,
    update,
    setLocked(v) {
      locked = v;
    },
    worldPosition(out = new THREE.Vector3()) {
      return dome.getWorldPosition(out).add(new THREE.Vector3(0, 0.03, 0));
    },
  };
}
