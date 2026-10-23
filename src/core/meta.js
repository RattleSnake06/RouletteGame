import { ACHIEVEMENTS, EDGES, ENGRAVINGS, ENHANCEMENTS, FORTUNES, MATERIALS, MAX_EDGE, ODDITIES, RECORDS, STARTING_WHEELS, TALISMANS } from './content/index.js';
import { deserialize, max, serialize } from './num.js';

// What carries over between runs (design doc 7, decisions 26 and 29), saved
// apart from the run (as 'profile', through src/platform/):
//
//   unlocked, best   the chip sets open, and the most debts paid with each
//                    (paying debt 4 with a set opens the next, in order)
//   locks, vault     the Vault's open padlocks (they open starting wheels and
//                    the gramophone's second slot, and move the goal), and
//                    whether the Vault itself has opened
//   edge             the highest House Edge level open: reaching the goal at
//                    a level opens the next
//   figures          the runs that ended without stepping out: they stand in
//                    the dark, the newest twelve; older ones fade out of it
//   seen, achievements, stats   the Almanac (doc 7.4); stats.deepest is the
//                    most debts an endless run has paid (doc 7.1)
//
// Everything here is pure: the game hands it the run and the events an
// action made, and saves what comes back.

export const UNLOCK_DEBT = 4;
export const PROFILE_VERSION = 2;
export const FIGURES = { standing: 12, kept: 40 };

/** "On your first run there is one" (doc 3): a stranger stands in the dark before you. */
const STRANGER = Object.freeze({ n: 0, stranger: true, cause: 'collected', debt: 6, paid: 5, best: 0, rail: [], chipSet: null, wheel: null, edge: 0, seed: null });

const SEEN_KINDS = ['talismans', 'fortunes', 'records', 'enhancements', 'oddities', 'engravings'];
const emptySeen = () => Object.fromEntries(SEEN_KINDS.map((k) => [k, []]));
const emptyStats = () => ({ runs: 0, goals: 0, left: 0, lost: 0, bestDebt: 0, bestSpin: 0, spins: 0, debtsPaid: 0, devils: 0, deepest: 0 });

export function newProfile() {
  return {
    v: PROFILE_VERSION,
    unlocked: [MATERIALS[0].id],
    best: {},
    locks: 0,
    vault: false,
    edge: 0,
    figures: [{ ...STRANGER }],
    seen: emptySeen(),
    achievements: [],
    stats: emptyStats(),
  };
}

// --- The chip select ---------------------------------------------------------

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
      unlocked: profile.unlocked.includes(m.id),
      best: profile.best[m.id] ?? 0,
      unlocks: prev ? `Pay debt ${UNLOCK_DEBT} with ${prev.name} chips.` : null,
    };
  });
}

export const isUnlocked = (profile, id) => profile.unlocked.includes(id);

/** Every starting wheel, with whether it is open and which lock opens it. */
export function wheelChoices(profile) {
  return STARTING_WHEELS.map((w) => ({
    id: w.id,
    name: w.name,
    upside: w.upside,
    downside: w.downside,
    lock: w.lock,
    unlocked: profile.locks >= w.lock,
    unlocks: w.lock ? `Open lock ${w.lock} of the Vault (pay debt ${UNLOCK_DEBT - 1 + w.lock}).` : null,
  }));
}

/** House Edge 0 to 5, with whether each may be chosen and what it adds. */
export function edgeChoices(profile) {
  return [{ level: 0, name: 'The House as it stands', text: 'No edge beyond the zero.' }, ...EDGES].map((e) => ({
    level: e.level,
    name: e.name,
    text: e.text,
    unlocked: e.level <= profile.edge,
    unlocks: e.level ? `Reach your goal at House Edge ${e.level - 1}.` : null,
  }));
}

export const wheelOpen = (profile, id) => wheelChoices(profile).some((w) => w.id === id && w.unlocked);

/** The newest figures, oldest first, that still stand in the dark (Madame Zero may have sent one away). */
export function standingFigures(profile) {
  return profile.figures.slice(-FIGURES.standing).filter((f) => !f.gone);
}

/** Content that waits for a lock of the Vault or a feat (decision 29). */
const GATED = () => [...TALISMANS, ...FORTUNES, ...RECORDS].filter((d) => d.unlock);
const opensWith = (profile, def) => (def.unlock.lock ? profile.locks >= def.unlock.lock : profile.achievements.includes(def.unlock.feat));

/** The gated content this profile has opened. */
export const openedContent = (profile) => GATED().filter((d) => opensWith(profile, d)).map((d) => d.id);

/** What opens a gated item, as the Almanac says it. */
export function opensLine(def) {
  if (!def?.unlock) return null;
  if (def.unlock.lock) return `Opens with lock ${def.unlock.lock} of the Vault.`;
  const feat = ACHIEVEMENTS.find((a) => a.id === def.unlock.feat);
  return `Opens with the feat “${feat?.name ?? def.unlock.feat}”: ${feat?.text ?? ''}`.trim();
}

/** What a new run takes from the profile (core/run.js createRun). */
export const runOptions = (profile) => ({ locks: profile.locks, vault: profile.vault, figures: standingFigures(profile).length, opened: openedContent(profile) });

/** Endless (doc 7.1): a run with no goal, once the Vault has opened. */
export const endlessOpen = (profile) => profile.vault;

/** The goal a new run would have: debt 4 + the open locks. */
export const goalFor = (profile) => UNLOCK_DEBT + profile.locks;

// --- While a run plays -------------------------------------------------------

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

/**
 * The profile after one action of the run: what its events opened (a chip
 * set, a lock, a House Edge level, the Vault), the figure Madame Zero sent
 * away, what the player has now seen, and achievements. Returns
 * { profile, news } with news in the order it happened:
 *   { kind: 'chips', id } | { kind: 'lock', lock, wheels, slot } |
 *   { kind: 'edge', level } | { kind: 'vault' } | { kind: 'achievement', id }
 * The profile is the same object when nothing changed.
 */
export function applyRun(profile, state, events) {
  let p = profile;
  const news = [];
  for (const e of events) {
    if (e.type === 'debtPaid') {
      const r = recordDebtPaid(p, { chipSet: state.chipSet, debtsPaid: e.debt });
      p = r.profile;
      if (r.unlocked) news.push({ kind: 'chips', id: r.unlocked });
    } else if (e.type === 'lockOpened' && e.lock > p.locks) {
      p = { ...p, locks: e.lock };
      const content = GATED().filter((d) => d.unlock.lock === e.lock).map((d) => d.id);
      news.push({ kind: 'lock', lock: e.lock, wheels: STARTING_WHEELS.filter((w) => w.lock === e.lock).map((w) => w.id), slot: e.lock === 2, content });
    } else if (e.type === 'goalReached') {
      p = { ...p, stats: { ...p.stats, goals: p.stats.goals + 1 } };
      if (state.edge >= p.edge && p.edge < MAX_EDGE) {
        p = { ...p, edge: p.edge + 1 };
        news.push({ kind: 'edge', level: p.edge });
      }
    } else if (e.type === 'vaultOpened' && !p.vault) {
      p = { ...p, vault: true };
      news.push({ kind: 'vault' });
    } else if (e.type === 'fortuneEffect' && e.effect === 'figureGone') {
      p = sendAway(p);
    }
  }
  p = discover(p, state);
  const done = new Set(p.achievements);
  const fresh = ACHIEVEMENTS.filter((a) => !done.has(a.id) && a.check(state, events)).map((a) => a.id);
  if (fresh.length) {
    p = { ...p, achievements: [...p.achievements, ...fresh] };
    for (const id of fresh) news.push({ kind: 'achievement', id, content: GATED().filter((d) => d.unlock.feat === id).map((d) => d.id) });
  }
  return { profile: p, news };
}

/** The oldest figure still standing goes (Ask the figures): kept in the ledger, gone from the dark. */
function sendAway(profile) {
  const oldest = standingFigures(profile)[0];
  if (!oldest) return profile;
  return { ...profile, figures: profile.figures.map((f) => (f === oldest ? { ...f, gone: true } : f)) };
}

/** Everything the run shows the player goes into the Almanac (the same profile when nothing is new). */
export function discover(profile, state) {
  const found = {
    talismans: [...state.rail.map((t) => t.id), ...state.cabinet.slots.filter((x) => x.kind === 'talisman' && x.id).map((x) => x.id)],
    oddities: state.cabinet.slots.filter((x) => x.kind === 'oddity' && x.id).map((x) => x.id),
    records: [...state.records, ...state.cabinet.slots.filter((x) => x.record).map((x) => x.record)],
    fortunes: state.oracle?.cards ?? [],
    enhancements: state.wheel.pockets.map((p) => p.enh).filter(Boolean),
    engravings: [...state.rail, ...state.cabinet.slots].map((x) => x.engraving).filter(Boolean),
  };
  let seen = profile.seen;
  for (const kind of SEEN_KINDS) {
    const have = new Set(seen[kind]);
    const add = [...new Set(found[kind])].filter((id) => !have.has(id));
    if (add.length) seen = { ...seen, [kind]: [...seen[kind], ...add] };
  }
  return seen === profile.seen ? profile : { ...profile, seen };
}

/**
 * The run is over: `cause` is 'collected' (the Cage), 'gaveUp' (a new run
 * begun over it) or 'left' (stepped out of the light past the goal). Every
 * run but one that stepped out leaves its figure in the dark (doc 7.3).
 */
export function endRun(profile, state, cause) {
  const s = state.stats;
  const st = profile.stats;
  const stats = {
    ...st,
    runs: st.runs + 1,
    left: st.left + (cause === 'left' ? 1 : 0),
    lost: st.lost + (cause === 'left' ? 0 : 1),
    bestDebt: Math.max(st.bestDebt, s.debtsPaid),
    bestSpin: serialize(max(deserialize(st.bestSpin), s.bestSpin)),
    spins: st.spins + s.spins,
    debtsPaid: st.debtsPaid + s.debtsPaid,
    devils: st.devils + (s.devils ?? 0),
    deepest: state.endless ? Math.max(st.deepest ?? 0, s.debtsPaid) : (st.deepest ?? 0),
  };
  let figures = profile.figures;
  if (cause !== 'left') {
    const figure = {
      n: stats.runs,
      cause,
      debt: state.debt,
      paid: s.debtsPaid,
      best: serialize(s.bestSpin),
      rail: state.rail.map((t) => t.id),
      chipSet: state.chipSet,
      wheel: state.wheelId ?? 'european',
      edge: state.edge ?? 0,
      seed: state.seed,
      endless: !!state.endless,
    };
    figures = [...figures, figure].slice(-FIGURES.kept);
  }
  return { ...profile, stats, figures };
}

/** "Collected at debt 4", "Gave up at debt 2". */
export function figureCause(f) {
  if (f.gone) return 'Sent away by Madame Zero';
  const where = `debt ${f.debt}${f.endless ? ', endless' : ''}`;
  return f.cause === 'gaveUp' ? `Gave up at ${where}` : `Collected at ${where}`;
}

// --- The Almanac -------------------------------------------------------------

const ENTRY = {
  talismans: (d) => ({ name: d.name, text: d.text }),
  fortunes: (d) => ({ name: d.text, text: d.effect }),
  records: (d) => ({ name: d.name, text: d.rule }),
  enhancements: (d) => ({ name: d.name, text: d.text }),
  oddities: (d) => ({ name: d.name, text: d.text }),
  engravings: (d) => ({ name: d.name, text: d.text }),
};
const POOL = {
  talismans: () => TALISMANS,
  fortunes: () => FORTUNES,
  records: () => RECORDS,
  enhancements: () => ENHANCEMENTS,
  oddities: () => ODDITIES,
  engravings: () => ENGRAVINGS,
};
const TITLES = { talismans: 'Talismans', fortunes: 'Fortunes', records: 'Records', enhancements: 'Pockets', oddities: 'Oddities', engravings: 'Engravings' };

/**
 * The Almanac (doc 7.4): every section with its entries in content order,
 * unseen ones as silhouettes (no name, no text); the achievements; the
 * lifetime stats; and the ledger of figures, newest first.
 */
export function almanacView(profile) {
  const sections = SEEN_KINDS.map((kind) => {
    const seen = new Set(profile.seen[kind]);
    // An unseen entry that waits for a lock or a feat says what opens it.
    const entries = POOL[kind]().map((d) => (seen.has(d.id) ? { id: d.id, seen: true, ...ENTRY[kind](d) } : { id: d.id, seen: false, opens: d.unlock && !opensWith(profile, d) ? opensLine(d) : null }));
    return { kind, title: TITLES[kind], entries, seen: entries.filter((e) => e.seen).length };
  });
  const done = new Set(profile.achievements);
  const standing = new Set(standingFigures(profile));
  return {
    sections,
    achievements: ACHIEVEMENTS.map((a) => ({ id: a.id, name: a.name, text: a.text, done: done.has(a.id) })),
    stats: { ...profile.stats, bestSpin: deserialize(profile.stats.bestSpin) },
    figures: [...profile.figures].reverse().map((f) => ({ ...f, best: deserialize(f.best ?? 0), standing: standing.has(f), cause: figureCause(f) })),
    locks: profile.locks,
    vault: profile.vault,
    edge: profile.edge,
  };
}

// --- Saving ------------------------------------------------------------------

export const serializeProfile = (profile) => JSON.stringify(profile);

const strings = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []);
const count = (n, hi = Infinity) => (Number.isInteger(n) && n >= 0 ? Math.min(n, hi) : 0);
const money = (v) => {
  try {
    return serialize(deserialize(v));
  } catch {
    return 0;
  }
};

/** A saved profile, or a fresh one when there is none or it cannot be read. A version 1 profile keeps its chip sets. */
export function deserializeProfile(json) {
  try {
    const data = json ? JSON.parse(json) : null;
    if (!data || (data.v !== 1 && data.v !== PROFILE_VERSION) || !Array.isArray(data.unlocked)) return newProfile();
    // Sets the game no longer knows are dropped; the first set is always open.
    const known = new Set(MATERIALS.map((m) => m.id));
    const unlocked = [...new Set([MATERIALS[0].id, ...data.unlocked.filter((id) => known.has(id))])];
    const best = Object.fromEntries(Object.entries(data.best ?? {}).filter(([id, n]) => known.has(id) && Number.isInteger(n)));
    const base = { ...newProfile(), unlocked, best };
    if (data.v === 1) {
      // Before the Vault: the debts a run got past open the locks they would have.
      const furthest = Math.max(0, ...Object.values(best));
      return { ...base, locks: Math.max(0, Math.min(4, furthest - (UNLOCK_DEBT - 1))) };
    }
    const seen = Object.fromEntries(SEEN_KINDS.map((k) => [k, strings(data.seen?.[k])]));
    const st = { ...emptyStats(), ...(data.stats ?? {}) };
    const stats = Object.fromEntries(Object.entries(emptyStats()).map(([k]) => [k, k === 'bestSpin' ? money(st[k]) : count(st[k])]));
    const figures = Array.isArray(data.figures) ? data.figures.filter((f) => f && typeof f === 'object' && Number.isInteger(f.debt)).slice(-FIGURES.kept) : base.figures;
    return {
      ...base,
      locks: count(data.locks, 4),
      vault: data.vault === true,
      edge: count(data.edge, MAX_EDGE),
      figures,
      seen,
      achievements: strings(data.achievements),
      stats,
    };
  } catch {
    return newProfile();
  }
}
