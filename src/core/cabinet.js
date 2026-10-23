import { ENGRAVINGS, ODDITIES, RECORDS, TALISMANS, isOffered } from './content/index.js';
import { ECONOMY, RARITY } from './economy.js';
import { Rng } from './rng.js';

// The Curio Cabinet's offers (doc 5.8). Three talisman compartments and a
// fourth for an oddity (doc 5.11). Offers come from the cabinet stream only,
// so restocking can never change a spin. From the second debt a talisman may
// come engraved (doc 6.4).

/** The debt from which the Cabinet's offers can come engraved. */
export const ENGRAVED_FROM = 2;

export const TALISMAN_SLOTS = 3;
const EMPTY = { kind: 'talisman', id: null, sold: true };
const NO_ODDITY = { kind: 'oddity', id: null, sold: true };

// discount: tokens off every talisman until the next restock; freeBuys:
// purchases still to come for nothing (Madame Zero's fortunes).
export const emptyCabinet = () => ({
  slots: [...Array.from({ length: TALISMAN_SLOTS }, () => ({ ...EMPTY })), { ...NO_ODDITY }],
  paidRestocks: 0,
  discount: 0,
  freeBuys: 0,
});

export const copyCabinet = (c) => ({ slots: c.slots.map((s) => ({ ...s })), paidRestocks: c.paidRestocks, discount: c.discount ?? 0, freeBuys: c.freeBuys ?? 0 });

/**
 * An engraving by the table's chances (doc 6.4): null for none. With
 * `always`, one is certain, still in proportion to the chances; `cursed:
 * false` leaves the Cursed engraving out.
 */
export function rollEngraving(rng, { always = false, cursed = true } = {}) {
  const pool = ENGRAVINGS.filter((e) => cursed || !e.cursed);
  const total = pool.reduce((t, e) => t + e.chance, 0);
  let r = rng.next() * (always ? total : 1);
  for (const e of pool) {
    if (r < e.chance) return e.id;
    r -= e.chance;
  }
  return null;
}

/**
 * Rolls the talisman compartments. Rarity works by reroll: pick a talisman at
 * random, keep it with probability equal to its rarity weight, otherwise pick
 * again, so the weights are exactly the relative odds. Nothing on the rail is
 * offered, and nothing twice in one restock.
 */
export function rollTalismanSlots(rail, rng, debt = 1, opened = null) {
  const exclude = new Set(rail.map((t) => t.id));
  return Array.from({ length: TALISMAN_SLOTS }, () => {
    const pool = TALISMANS.filter((d) => d.inCabinet && !exclude.has(d.id) && isOffered({ opened }, d));
    if (!pool.length) return { ...EMPTY };
    let pick = null;
    for (let tries = 0; tries < 64; tries++) {
      pick = pool[rng.int(pool.length)];
      if (rng.next() < RARITY[pick.rarity].weight) break;
    }
    exclude.add(pick.id);
    // Debt 1 draws nothing more, so its offers are as they always were.
    const engraving = debt >= ENGRAVED_FROM ? rollEngraving(rng) : null;
    return { kind: 'talisman', id: pick.id, sold: false, engraving };
  });
}

/**
 * The oddity compartment, by the same rarity reroll (oddities can come again
 * and again). A chip is not offered to a full hand, nor a record when every
 * record is owned; a record is one not yet owned, drawn here too.
 */
export function rollOdditySlot(rng, { owned = [], chips = 0, opened = null } = {}) {
  const left = RECORDS.filter((r) => !owned.includes(r.id) && isOffered({ opened }, r));
  const pool = ODDITIES.filter((d) => !(d.gives?.chip && chips >= ECONOMY.maxChips) && !(d.gives?.record && !left.length));
  let pick = null;
  for (let tries = 0; tries < 64; tries++) {
    pick = pool[rng.int(pool.length)];
    if (rng.next() < RARITY[pick.rarity].weight) break;
  }
  const offer = { kind: 'oddity', id: pick.id, sold: false };
  if (pick.gives?.record) offer.record = left[rng.int(left.length)].id;
  return offer;
}

/** Restocks the draft's compartments from its cabinet stream: talismans first, then the oddity. */
export function restockSlots(draft) {
  const rng = new Rng(draft.rng.cabinet);
  const talismans = rollTalismanSlots(draft.rail, rng, draft.debt, draft.opened);
  const oddity = rollOdditySlot(rng, { owned: draft.records, chips: draft.chips.length, opened: draft.opened });
  // "Until the next restock" (The cabinet owes you): this is the next restock.
  draft.cabinet.discount = 0;
  draft.rng.cabinet = rng.state();
  draft.cabinet.slots = [...talismans, oddity];
  return draft.cabinet.slots;
}
