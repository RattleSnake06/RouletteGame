import { MATERIALS } from './content/index.js';

// What carries over between runs (design doc 7, decision 26): which chip sets
// are unlocked, and the furthest each has gone. Saved apart from the run (as
// 'profile', through src/platform/). Paying debt 4 with a set unlocks the
// next one in MATERIALS order, for the next run.

export const UNLOCK_DEBT = 4;
export const PROFILE_VERSION = 1;

export function newProfile() {
  return { v: PROFILE_VERSION, unlocked: [MATERIALS[0].id], best: {} };
}

/** Every chip set, in unlock order, with whether it may be chosen and what opens it. */
export function chipSets(profile) {
  return MATERIALS.map((m, i) => {
    const prev = MATERIALS[i - 1];
    return {
      id: m.id,
      name: m.name,
      count: m.count,
      upside: m.upside,
      downside: m.downside,
      colors: m.colors,
      unlocked: profile.unlocked.includes(m.id),
      best: profile.best[m.id] ?? 0,
      unlocks: prev ? `Pay debt ${UNLOCK_DEBT} with ${prev.name} chips.` : null,
    };
  });
}

export const isUnlocked = (profile, id) => profile.unlocked.includes(id);

/**
 * A debt was just paid with `chipSet`. Returns the profile as it now stands
 * and the set this unlocked, if any.
 */
export function recordDebtPaid(profile, { chipSet, debtsPaid }) {
  let next = profile;
  if (debtsPaid > (profile.best[chipSet] ?? 0)) next = { ...next, best: { ...next.best, [chipSet]: debtsPaid } };
  const i = MATERIALS.findIndex((m) => m.id === chipSet);
  const following = MATERIALS[i + 1];
  if (debtsPaid >= UNLOCK_DEBT && following && !next.unlocked.includes(following.id)) {
    next = { ...next, unlocked: [...next.unlocked, following.id] };
    return { profile: next, unlocked: following.id };
  }
  return { profile: next, unlocked: null };
}

export const serializeProfile = (profile) => JSON.stringify(profile);

/** A saved profile, or a fresh one when there is none or it cannot be read. */
export function deserializeProfile(json) {
  try {
    const data = json ? JSON.parse(json) : null;
    if (!data || data.v !== PROFILE_VERSION || !Array.isArray(data.unlocked)) return newProfile();
    // Sets the game no longer knows are dropped; the first set is always open.
    const known = new Set(MATERIALS.map((m) => m.id));
    const unlocked = [...new Set([MATERIALS[0].id, ...data.unlocked.filter((id) => known.has(id))])];
    const best = Object.fromEntries(Object.entries(data.best ?? {}).filter(([id, n]) => known.has(id) && Number.isInteger(n)));
    return { v: PROFILE_VERSION, unlocked, best };
  } catch {
    return newProfile();
  }
}
