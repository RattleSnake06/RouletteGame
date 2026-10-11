import { BET_KINDS, getBet } from '../core/bets.js';
import { getTalisman } from '../core/content/index.js';
import { RARITY } from '../core/economy.js';
import { gte } from '../core/num.js';
import { bellView, cabinetView, luckView, previewBet, railView, rarityOdds } from '../core/selectors.js';
import { LUCK } from '../core/nudge.js';

// What each object's note says (design doc 8.4): plain specs for hud.note,
// read from the run's state. Nothing here changes the run.

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const nameOf = (id) => getTalisman(id)?.name ?? id;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** A chance as the 666 counter shows it: "1.5%", "0.25%". */
export const percent = (p) => `${Math.round(p * 10000) / 100}%`;
const signedPercent = (p) => `${p < 0 ? '−' : '+'}${percent(Math.abs(p))}`;

/** How a talisman's effect reads in a popup or a note: "+1 Stake", "×2". */
export function effectText(step) {
  const n = step.amount;
  switch (step.effect) {
    case 'stake':
      return `+${n} Stake`;
    case 'odds':
      return `+${n} odds`;
    case 'oddsMult':
      return `+${n} Odds`;
    case 'mult':
      return `×${n}`;
    case 'hit':
      return n === 0.25 ? '×¼ beside' : `×${n} hit`;
    case 'covers':
      return 'counts';
    case 'chipValue':
      return `+${n} value`;
    case 'coins':
      return `+${n}`;
    case 'tokens':
      return `+${plural(n, 'token')}`;
    case 'interest':
      return `+${Math.round(n * 100)}%`;
    case 'armed':
      return 'armed';
    case 'foreseen':
      return 'sees';
    case 'nudge':
      return `+${n} Nudge`;
    case 'clockwise':
      return 'clockwise only';
    case 'straightOnly':
      return 'onto straight-ups';
    case 'noPity':
      return 'no pity';
    case 'devil':
      return `${signedPercent(n)} Devil`;
    case 'devilMult':
      return n === 0.5 ? 'Devil ×½' : `Devil ×${n}`;
    default:
      return null;
  }
}

/** A felt spot: its odds as printed, and what the rail makes of them. */
export function betNote(state, betId) {
  const bet = getBet(betId);
  const base = BET_KINDS[bet.kind].odds;
  const preview = previewBet(state, betId);
  if (!preview) return { title: bet.label, pays: { odds: base } };
  const sources = preview.sources
    .filter((s) => ['stake', 'odds', 'oddsMult', 'mult'].includes(s.effect))
    .map((s) => [s.as !== s.id ? `${nameOf(s.id)} (${nameOf(s.as)})` : nameOf(s.id), effectText(s)]);
  if (preview.paysMax > preview.pays) sources.push(['on some numbers', `up to ${preview.paysMax}×`]);
  return { title: bet.label, pays: { odds: preview.pays, base, sources } };
}

export function talismanNote(state, uid, { tag = false } = {}) {
  const view = railView(state).find((v) => v.uid === uid);
  if (!view) return null;
  if (tag) {
    return {
      title: view.name,
      lines: [view.usable ? 'Click the tag to ring the Bell for it.' : 'It cannot answer the Bell now.'],
      status: view.status,
    };
  }
  const lines = [view.text];
  if (view.copying) lines.push(`Copying ${nameOf(view.copying)}.`);
  else if (view.id === 'twin_mirrors') lines.push('Nothing to its right to copy.');
  if (view.cursed) {
    return { title: view.name, rarity: 'cursed', lines, status: [view.status, 'It will not come off the hook.'].filter(Boolean).join(' ') };
  }
  return {
    title: view.name,
    rarity: view.rarity,
    lines,
    status: view.status,
    price: { label: 'sells for', amount: view.sellValue, unit: 'tokens' },
  };
}

export function slotNote(state, slot) {
  const view = cabinetView(state).slots[slot];
  if (!view) return null;
  if (view.kind !== 'talisman') return { title: 'Not yet', lines: ['This compartment is boarded up. Oddities come later.'] };
  if (view.sold) return { title: 'Sold', lines: ['Restocked at the start of each night, or with the crank.'] };
  return {
    title: view.name,
    rarity: view.rarity,
    lines: [view.text],
    status: view.hookFree ? null : 'The rail is full: you will choose one to sell.',
    price: { amount: view.price, unit: 'tokens', ok: view.affordable, short: view.affordable ? '' : `${view.short} short` },
  };
}

export function crankNote(state) {
  const view = cabinetView(state);
  return {
    title: 'Restock',
    lines: ['New talismans in every compartment. Free at the start of each night.'],
    status: `Then ${view.nextRestockCost}. The price resets each debt.`,
    price: { label: 'costs', amount: view.restockCost, unit: 'coins', ok: gte(state.coins, view.restockCost) },
  };
}

export function chartNote(state) {
  const odds = rarityOdds(state);
  return {
    title: 'Rarity',
    lines: Object.keys(RARITY).map((r) => `${cap(r)}: ${RARITY[r].price} tokens, ${Math.round(odds[r] * 100)}%.`),
    status: 'Chances in the first compartment, leaving out what you own.',
  };
}

export function bellNote(state) {
  const view = bellView(state);
  if (!view.owned.length) return { title: 'The Bell', lines: ['A service bell. Some talismans answer it.'] };
  const names = view.queue.map((uid) => nameOf(state.rail.find((t) => t.uid === uid).id));
  const lines = names.length
    ? [`Rings the next talisman in line: ${names.join(', then ')}.`]
    : ['Nothing would answer it now.'];
  if (state.rail.some((t) => getTalisman(t.id)?.bell?.targetOnly)) lines.push('The Piggy Bank answers only a ring at its tag.');
  return { title: 'The Bell', lines, status: 'B rings it.' };
}

/** The results board: the LEAN lamp, the next spin's Nudge, and pity. */
export function boardNote(state) {
  const luck = luckView(state);
  const lines = [];
  if (luck.lean) lines.push(`The House leans: +${luck.lean} Nudge on the next spin.`);
  else lines.push('The LEAN lamp lights a spin ahead, before you bet.');
  if (luck.total) {
    const parts = [];
    if (luck.lean) parts.push(`Lean ${luck.lean}`);
    if (luck.pity) parts.push(`pity ${luck.pity}`);
    for (const c of luck.charmSources.filter((x) => x.effect === 'nudge')) parts.push(`${nameOf(c.id)} ${c.amount}`);
    lines.push(`Nudge ${luck.total} next spin: ${parts.join(', ')}.`);
  }
  if (luck.clockwise) lines.push('Compass: the ball hops clockwise only.');
  if (luck.straightOnly) lines.push('Lodestone: the ball hops only onto straight-up chips.');
  const misses = luck.missStreak;
  const missText = `${misses} miss${misses === 1 ? '' : 'es'}`;
  let status = 'Nudge lets the ball hop that many pockets to the best one in reach.';
  if (luck.pity) status = `Pity +${luck.pity}: ${missText} in a row. It grows until something pays.`;
  else if (misses > 0 && !luck.charmSources.some((c) => c.effect === 'noPity')) {
    status = `${missText} in a row. After ${LUCK.pityAfter}, pity nudges the ball.`;
  }
  return { title: 'The board', lines, status };
}

/** The green 666 counter on the Cage. */
export function devilNote(state) {
  const { devil } = luckView(state);
  const lines = [`On every throw, a ${percent(devil.chance)} chance the number burns to 666.`, 'Then every coin in hand is lost. Banked coins are safe.'];
  for (const s of devil.sources) lines.push(`${nameOf(s.id)}: ${effectText(s)}.`);
  return { title: '666', lines, status: 'Nudge cannot touch it.' };
}

export function plaqueNote(key) {
  return key === 'stake'
    ? { title: 'Stake', lines: ["Every winning chip's payout is multiplied by this."] }
    : { title: 'Odds', lines: ["The bet's odds are multiplied by this."] };
}
