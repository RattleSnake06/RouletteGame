import { TALISMANS } from './content/index.js';
import { RARITY } from './economy.js';
import { Rng } from './rng.js';

// The Curio Cabinet's offers (doc 5.8). Three talisman compartments and a
// fourth for oddities, shuttered until Phase 5. Offers come from the cabinet
// stream only, so restocking can never change a spin.

export const TALISMAN_SLOTS = 3;
const SHUT_ODDITY = { kind: 'oddity', id: null, shut: true };
const EMPTY = { kind: 'talisman', id: null, sold: true };

export const emptyCabinet = () => ({
  slots: [...Array.from({ length: TALISMAN_SLOTS }, () => ({ ...EMPTY })), { ...SHUT_ODDITY }],
  paidRestocks: 0,
});

export const copyCabinet = (c) => ({ slots: c.slots.map((s) => ({ ...s })), paidRestocks: c.paidRestocks });

/**
 * Rolls the talisman compartments. Rarity works by reroll: pick a talisman at
 * random, keep it with probability equal to its rarity weight, otherwise pick
 * again, so the weights are exactly the relative odds. Nothing on the rail is
 * offered, and nothing twice in one restock.
 */
export function rollTalismanSlots(rail, rng) {
  const exclude = new Set(rail.map((t) => t.id));
  return Array.from({ length: TALISMAN_SLOTS }, () => {
    const pool = TALISMANS.filter((d) => d.inCabinet && !exclude.has(d.id));
    if (!pool.length) return { ...EMPTY };
    let pick = null;
    for (let tries = 0; tries < 64; tries++) {
      pick = pool[rng.int(pool.length)];
      if (rng.next() < RARITY[pick.rarity].weight) break;
    }
    exclude.add(pick.id);
    return { kind: 'talisman', id: pick.id, sold: false };
  });
}

/** Restocks the draft's talisman compartments from its cabinet stream. */
export function restockSlots(draft) {
  const rng = new Rng(draft.rng.cabinet);
  const talismans = rollTalismanSlots(draft.rail, rng);
  draft.rng.cabinet = rng.state();
  draft.cabinet.slots = [...talismans, ...draft.cabinet.slots.slice(TALISMAN_SLOTS)];
  return draft.cabinet.slots;
}
