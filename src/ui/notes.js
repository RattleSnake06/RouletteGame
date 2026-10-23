import { BET_KINDS, getBet } from '../core/bets.js';
import { contentName, getEnhancement, getTalisman } from '../core/content/index.js';
import { RARITY } from '../core/economy.js';
import { gte } from '../core/num.js';
import { betChance, bellView, cabinetView, gramophoneView, luckView, oracleView, previewBet, railView, rarityOdds, statsView } from '../core/selectors.js';

// What each object's note says (design doc 8.4): plain specs for hud.note,
// read from the run's state. Nothing here changes the run.

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const nameOf = (id) => contentName(id);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** A chance as the 666 counter shows it: "1.5%", "0.25%", "0.375%". */
export const percent = (p) => `${Math.round(p * 1e5) / 1000}%`;
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
    case 'chipBase':
      return `+${n} value, for good`;
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
    case 'pityAfter':
      return `pity after ${n}`;
    case 'noNudge':
      return 'no Nudge';
    case 'widen':
      return `${plural(step.count, 'pocket')} +${n} wide`;
    case 'gone':
      return 'used up';
    case 'anchor':
      return `holds ${n}`;
    default:
      return null;
  }
}

/** A felt spot: its odds as printed, and what the rail makes of them. */
export function betNote(state, betId) {
  const bet = getBet(betId);
  const base = BET_KINDS[bet.kind].odds;
  const preview = previewBet(state, betId);
  // How often it wins on the wheel as built (doc 5.4); nothing, if no pocket carries it.
  const status = `Wins ${pct1(betChance(state, betId))} of spins on this wheel, before Nudge.`;
  if (!preview) return { title: bet.label, pays: { odds: base }, status };
  const sources = preview.sources
    .filter((s) => ['stake', 'odds', 'oddsMult', 'mult'].includes(s.effect))
    .map((s) => [s.as !== s.id ? `${nameOf(s.id)} (${nameOf(s.as)})` : nameOf(s.id), effectText(s)]);
  if (preview.paysMax > preview.pays) sources.push(['on some numbers', `up to ${preview.paysMax}×`]);
  return { title: bet.label, pays: { odds: preview.pays, base, sources }, status };
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
  if (view.engraving) lines.push(`Engraved ${view.engraving.name}: ${view.engraving.text}`);
  if (view.copying) lines.push(view.dim ? `Its copy of ${nameOf(view.copying)} is used up.` : `Copying ${nameOf(view.copying)}.`);
  else if (view.id === 'twin_mirrors') lines.push('Nothing to its right to copy.');
  if (view.echoing) lines.push(view.dim ? `${nameOf(view.echoing)} has nothing for it to repeat.` : `Repeating ${nameOf(view.echoing)}.`);
  else if (view.id === 'tuning_fork') lines.push('Nothing to its left to repeat.');
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
  if (view.sold) return { title: 'Sold', lines: ['Restocked at the start of each night, or with the crank.'] };
  if (view.kind === 'oddity') {
    return {
      title: view.name,
      rarity: view.rarity,
      lines: [view.text],
      status: view.workable ? 'Wheel work: you choose where it goes on the felt.' : 'There is nowhere on the wheel it could work now.',
      price: { amount: view.price, unit: 'coins', ok: view.affordable, short: view.affordable ? '' : `${view.short} short` },
    };
  }
  const lines = [view.text];
  if (view.engraving) lines.push(`Engraved ${view.engraving.name}: ${view.engraving.text}`);
  return {
    title: view.name,
    rarity: view.rarity,
    lines,
    status: view.instant ? 'It needs no hook: it is opened on the spot.' : view.hookFree ? null : 'The rail is full: you will choose one to sell.',
    price: { amount: view.price, unit: 'tokens', ok: view.affordable, short: view.affordable ? '' : `${view.short} short` },
  };
}

export function crankNote(state) {
  const view = cabinetView(state);
  return {
    title: 'Restock',
    lines: ['New talismans and a new oddity in the compartments. Free at the start of each night.'],
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
  const own = state.rail.filter((t) => getTalisman(t.id)?.bell?.targetOnly).map((t) => nameOf(t.id));
  if (own.length) lines.push(`${[...new Set(own)].join(' and ')} answer${own.length === 1 ? 's' : ''} only a ring at ${own.length === 1 ? 'its' : 'their'} tag.`);
  return { title: 'The Bell', lines, status: 'B rings it.' };
}

const pct1 = (p) => `${Math.round(p * 1000) / 10}%`;

/**
 * The stats chalkboard (doc 5.11): the wheel in a few lines. The numbers
 * most above their fair chance, the colours, dozens and columns, and what
 * wheel work has done to which pockets.
 */
export function chalkboardNote(state) {
  const v = statsView(state);
  const lines = [];
  const c = v.colors;
  lines.push(`Red ${pct1(c.red)}, black ${pct1(c.black)}, zero ${pct1(c.green)}${v.blanks ? `, blank ${pct1(c.blank)}` : ''}.`);
  lines.push(`Dozens ${v.dozens.map(pct1).join(', ')}. Columns ${v.columns.map(pct1).join(', ')}.`);
  const up = v.numbers.filter((n) => n.chance > v.fair * 1.02).sort((a, b) => b.chance - a.chance);
  if (up.length) lines.push(`Above the fair ${pct1(v.fair)}: ${up.slice(0, 6).map((n) => `${n.number} (${pct1(n.chance)})`).join(', ')}${up.length > 6 ? '…' : ''}.`);
  const gone = v.numbers.filter((n) => !n.count).map((n) => n.number);
  if (gone.length) lines.push(`No pocket reads ${gone.join(', ')}.`);
  const groups = new Map();
  for (const e of v.enhanced) if (e.enh !== 'blank') groups.set(e.name, [...(groups.get(e.name) ?? []), e.number]);
  for (const [name, ns] of groups) lines.push(`${name}: ${ns.join(', ')}. ${getEnhancement(v.enhanced.find((e) => e.name === name).enh).text}`);
  if (v.blanks) lines.push(`${plural(v.blanks, 'blank pocket')}: nothing wins there.`);
  return {
    title: 'The chalkboard',
    lines,
    status: v.pockets === v.plainPockets ? `${v.pockets} pockets.` : `${v.pockets} pockets, of the House's ${v.plainPockets}.`,
  };
}

/** The results board: the LEAN lamp, the next spin's Nudge, and pity. */
export function boardNote(state) {
  const luck = luckView(state);
  const lines = [];
  if (luck.blocked) {
    // The crossing cancels the Lean too, so the two read as one line.
    lines.push(luck.lean ? `The House leans (+${luck.lean}), but the Black Cat crosses your path: no Nudge on the next spin.` : 'The Black Cat crosses your path: no Nudge on the next spin.');
  } else if (luck.lean) lines.push(`The House leans: +${luck.lean} Nudge on the next spin.`);
  else lines.push('The LEAN lamp lights a spin ahead, before you bet.');
  if (!luck.blocked && luck.total) {
    const parts = [];
    if (luck.lean) parts.push(`Lean ${luck.lean}`);
    if (luck.pity) parts.push(`pity ${luck.pity}`);
    for (const c of luck.charmSources.filter((x) => x.effect === 'nudge')) parts.push(`${nameOf(c.id)} ${c.amount}`);
    lines.push(`Nudge ${luck.total} next spin: ${parts.join(', ')}.`);
  }
  if (luck.clockwise) lines.push('Compass: the ball hops clockwise only.');
  if (luck.straightOnly) lines.push('Lodestone: the ball hops only onto straight-up chips.');
  if (luck.anchors.includes(13)) lines.push('Thirteen Ball: Nudge never moves the ball off 13.');
  const misses = luck.missStreak;
  const missText = `${misses} miss${misses === 1 ? '' : 'es'}`;
  let status = 'Nudge lets the ball hop that many pockets to the best one in reach.';
  if (luck.blocked) status = misses > 0 ? `No pity on a crossing: ${missText} in a row.` : 'No Nudge on a crossing, from anything.';
  else if (luck.pityBlocked) status = misses > 0 ? `No pity (Black Candle): ${missText} in a row.` : 'No pity (Black Candle).';
  else if (luck.pity) status = `Pity +${luck.pity}: ${missText} in a row. It grows until something pays.`;
  else if (misses > 0) status = `${missText} in a row. After ${luck.pityAfter}, pity nudges the ball.`;
  return { title: 'The board', lines, status };
}

/** The green 666 counter on the Cage. */
export function devilNote(state) {
  const { devil } = luckView(state);
  const lines = [`On every throw, a ${percent(devil.chance)} chance the number burns to 666.`, 'Then every coin in hand is lost. Banked coins are safe.'];
  for (const s of devil.sources) lines.push(`${nameOf(s.id)}: ${effectText(s)}.`);
  if (devil.ward) lines.push(`${nameOf(state.rail.find((t) => t.uid === devil.ward).id)} will turn him away once.`);
  return { title: '666', lines, status: 'Nudge cannot touch it.' };
}

export function plaqueNote(key) {
  return key === 'stake'
    ? { title: 'Stake', lines: ["Every winning chip's payout is multiplied by this."] }
    : { title: 'Odds', lines: ["The bet's odds are multiplied by this."] };
}

/** Madame Zero's lever: what a pull does now, and what it costs. */
export function leverNote(state) {
  const deal = oracleView(state);
  if (deal.taken !== null) return { title: 'Madame Zero', lines: ['She has nothing more for you this debt.'], status: 'She deals again when the next debt begins.' };
  if (!deal.dealt) {
    const lines = ['Pull her lever: she deals three cards, and you may take one.', 'Once a debt. The first pull is free.'];
    const status = deal.kind === 'black' ? 'The Devil came this debt: her cards will be black.' : 'If the Devil comes first, her cards turn black.';
    return { title: 'Madame Zero', lines, status };
  }
  return {
    title: 'Deal again',
    lines: [`Three new ${deal.kind} cards for the ones on her easel.`],
    status: 'Each new deal costs a coin more.',
    price: { label: 'costs', amount: deal.rerollCost, unit: 'coins', ok: deal.canReroll },
  };
}

/** One of the cards on her easel. */
export function cardNote(state, index) {
  const card = oracleView(state).cards[index];
  if (!card) return null;
  const lines = [card.effect];
  let status = card.lore ? `On its back: ${card.lore}` : null;
  if (card.taken) status = 'Taken.';
  else if (!card.takeable && oracleView(state).taken === null) status = 'That fortune cannot come true now.';
  return { title: card.text, rarity: card.rarity, lines, status };
}

/** The gramophone: what plays, and what is in the crate. */
export function gramophoneNote(state) {
  const g = gramophoneView(state);
  const lines = g.playing ? [g.playing.rule] : ['Nothing plays. The hall hums.'];
  const count = g.crate.length;
  const status = count ? `${plural(count, 'record')} in the crate. Only the one playing acts.` : 'The crate is empty. Records come from Madame Zero.';
  return { title: g.playing ? g.playing.name : 'The gramophone', lines, status };
}
