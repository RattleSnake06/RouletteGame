import { ENGRAVING_LIST } from './engravings.js';
import { FORTUNE_LIST } from './fortunes.js';
import { RECORD_LIST } from './records.js';
import { TALISMAN_LIST } from './talismans.js';

// The content registry. Definitions are frozen data; hooks read state and
// call ctx methods, never write state themselves.

const DEFAULTS = {
  tags: [],
  cursed: false,
  inCabinet: true,
  copyable: true,
  echoable: true,
  copies: null,
  echoes: false,
  instant: false,
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

// Phase 4: Madame Zero's fortunes, the gramophone's records, and engravings.
// Ids are unique across every registry, so an event's source names one thing.

export const FORTUNES = FORTUNE_LIST.map((d) => Object.freeze({ maxPicks: null, requires: null, hooks: {}, ...d }));
export const RECORDS = RECORD_LIST.map((d) => Object.freeze({ init: null, hooks: {}, ...d }));
export const ENGRAVINGS = ENGRAVING_LIST.map((d) => Object.freeze({ hooks: {}, ...d }));
const FORTUNE_BY_ID = new Map(FORTUNES.map((d) => [d.id, d]));
const RECORD_BY_ID = new Map(RECORDS.map((d) => [d.id, d]));
const ENGRAVING_BY_ID = new Map(ENGRAVINGS.map((d) => [d.id, d]));

export const getFortune = (id) => FORTUNE_BY_ID.get(id) ?? null;
export const getRecord = (id) => RECORD_BY_ID.get(id) ?? null;
export const getEngraving = (id) => ENGRAVING_BY_ID.get(id) ?? null;

/** The name of anything that can act: a talisman, a record, an engraving, or a fortune (her line). */
export function contentName(id) {
  const d = getTalisman(id) ?? getRecord(id) ?? getEngraving(id);
  if (d) return d.name;
  return getFortune(id)?.text ?? id;
}
