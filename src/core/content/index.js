import { TALISMAN_LIST } from './talismans.js';

// The content registry. Definitions are frozen data; hooks read state and
// call ctx methods, never write state themselves.

const DEFAULTS = {
  tags: [],
  inCabinet: true,
  copyable: true,
  copies: null,
  init: null,
  charges: null,
  bell: null,
  status: null,
  hooks: {},
};

const withDefaults = (def) => Object.freeze({ ...DEFAULTS, ...def });

/** Cabinet pool order: registry order, then test-only additions (never offered). */
export const TALISMANS = TALISMAN_LIST.map(withDefaults);
const BY_ID = new Map(TALISMANS.map((d) => [d.id, d]));

export function getTalisman(id) {
  return BY_ID.get(id) ?? null;
}

/** Test and debug use only: registers a definition the Cabinet never offers. */
export function registerTestTalisman(def) {
  const d = withDefaults({ ...def, inCabinet: false });
  BY_ID.set(d.id, d);
  return d;
}
