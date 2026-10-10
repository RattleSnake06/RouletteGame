import { format, gte, ratio, toNumber } from '../core/num.js';
import { SCRAWL } from './fonts.js';
import {
  INK,
  arrowMark,
  coinGlyph,
  dotsMark,
  hexGlyph,
  lineMark,
  loopMark,
  markImg,
  oldTallies,
  seedOf,
  setMark,
  smearMark,
  swapMark,
  swipeMark,
  tally,
} from './marks.js';

// The HUD (design doc 8.4): no boxes. Values are scratched or brushed straight
// onto the dark, the way a prisoner marks a cell wall. Coins and the night's
// tally top-left, the debt top-centre, tokens top-right. Payouts, flavour
// lines, toasts, popups and the bet note come and go.
//
// The marks (swipes, tallies, loops) are baked images; live numerals are plain
// text with a static mask, so nothing filters or re-rasterises per frame.

function el(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Text widths in ems of the scrawl face, for sizing swipes before layout.
const measureCtx = document.createElement('canvas').getContext('2d');
function scrawlEm(text, letterSpacing = 0) {
  measureCtx.font = `100px ${SCRAWL}`;
  return measureCtx.measureText(text).width / 100 + letterSpacing * text.length;
}

/** Restart a CSS animation by toggling a class across a reflow. */
function replay(node, cls) {
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}

const FLARE_MS = 1500;
const RARITY_MARKS = { common: 1, uncommon: 2, rare: 3, legendary: 4 };
const COINS_MAX_EM = 3.4; // past this the figure steps down so it never reaches the debt

export function createHud(root = document.body) {
  const hud = el('div', 'hud');
  hud.innerHTML = `
    <div class="hud-coins" data-k="coinsCluster">
      <span class="sr" data-k="coinsSr"></span>
      <div class="coins-was scrawl" data-k="coinsWas" aria-hidden="true"><span></span></div>
      <div class="coins-row" aria-hidden="true">
        <span class="coins-num scrawl fat grain" data-k="coins">0</span>
      </div>
      <div class="tally-row" data-k="tallyRow" aria-hidden="true"><span class="tally-label typed" data-k="spins"></span></div>
    </div>
    <div class="hud-debt" data-k="debtCluster">
      <span class="sr" data-k="debtSr"></span>
      <div class="debt-head typed" aria-hidden="true"><span data-k="debtNo"></span><span class="night-word">night</span><span class="nights" data-k="nights"></span></div>
      <div class="owed" aria-hidden="true">
        <span class="cell"><span class="v scrawl fat banked" data-k="banked">0</span><span class="k typed">banked</span></span>
        <span class="slash" data-k="slash"></span>
        <span class="cell due-cell"><span class="v scrawl fat due" data-k="owed">0</span><span class="k typed">owed</span></span>
      </div>
      <div class="meter" data-k="meter" aria-hidden="true"><span class="meter-fill" data-k="meterFill"></span></div>
    </div>
    <div class="hud-tokens" data-k="tokensCluster">
      <span class="sr" data-k="tokensSr"></span>
      <div class="tokens-row" aria-hidden="true"><span class="tokens-num scrawl fat grain" data-k="tokens">0</span></div>
      <span class="k typed" aria-hidden="true">tokens</span>
    </div>
    <div class="hud-payout" data-k="payout"><span class="v scrawl fat grain"></span></div>
    <div class="hud-flavor" data-k="flavor"><span class="words scrawl fat"></span></div>
    <button class="hud-nav hud-nav-left" data-k="navLeft" type="button" hidden></button>
    <button class="hud-nav hud-nav-right" data-k="navRight" type="button" hidden></button>
    <div class="hud-note" data-k="tooltip" aria-live="polite"><div class="note-body"></div></div>
    <div class="hud-toast typed" data-k="toast"><span></span></div>
    <div class="hud-hint typed" data-k="hint"></div>
    <div class="hud-popups" data-k="popups"></div>
  `;
  root.appendChild(hud);
  const $ = (k) => hud.querySelector(`[data-k="${k}"]`);
  const refs = {
    coinsSr: $('coinsSr'),
    debtSr: $('debtSr'),
    tokensSr: $('tokensSr'),
    coinsCluster: $('coinsCluster'),
    coins: $('coins'),
    coinsWas: $('coinsWas'),
    tallyRow: $('tallyRow'),
    spins: $('spins'),
    debtCluster: $('debtCluster'),
    debtNo: $('debtNo'),
    nights: $('nights'),
    banked: $('banked'),
    owed: $('owed'),
    meter: $('meter'),
    meterFill: $('meterFill'),
    tokensCluster: $('tokensCluster'),
    tokens: $('tokens'),
    payout: $('payout'),
    flavor: $('flavor'),
    navLeft: $('navLeft'),
    navRight: $('navRight'),
    tooltip: $('tooltip'),
    toast: $('toast'),
    hint: $('hint'),
    popups: $('popups'),
  };

  // ---- Static marks -----------------------------------------------------------
  const coinsRow = refs.coins.parentElement;
  const coinsSwipe = markImg(swipeMark(300, 52, 21, INK.bloodDeep, { slope: -0.05 }), 'coins-swipe');
  coinsRow.prepend(markImg(coinGlyph(40, 3), 'coin-glyph', 0.014));
  coinsRow.prepend(coinsSwipe);
  const wasStrike = markImg(lineMark(120, 24, 25, INK.blood, 3, { y0: 18, y1: 7 }), 'was-strike');
  refs.coinsWas.appendChild(wasStrike);
  const TALLY_SCALE = 0.03;
  const tallyImg = markImg(tally(0, 0, 4), 'tally', TALLY_SCALE);
  refs.tallyRow.prepend(tallyImg);
  refs.tokens.parentElement.appendChild(markImg(hexGlyph(34, 6), 'hex-glyph', 0.03));
  refs.debtCluster.querySelector('.debt-head').insertBefore(markImg(lineMark(26, 18, 31, INK.boneDim, 2, { y0: 16, y1: 2 }), 'gash', 0.05), refs.debtCluster.querySelector('.night-word'));
  $('slash').appendChild(markImg(lineMark(22, 42, 37, INK.boneDim, 3, { y0: 40, y1: 2 }), '', 0.022));
  const owedStrike = markImg(lineMark(110, 30, 39, INK.bone, 3.2, { y0: 22, y1: 8 }), 'owed-strike', 0.011);
  refs.owed.parentElement.appendChild(owedStrike);
  refs.meter.prepend(markImg(lineMark(200, 10, 43, INK.blood, 2.6, { o: 0.45 }), 'meter-track'));
  refs.meterFill.appendChild(markImg(lineMark(200, 10, 43, INK.bone, 3.4), 'meter-ink'));
  const payoutSwipe = markImg(swipeMark(300, 74, 41, INK.bloodDeep, { slope: -0.04 }), 'payout-swipe');
  const payoutSwipe2 = markImg(swipeMark(300, 60, 47, INK.bloodDeep, { slope: 0.05 }), 'payout-swipe second');
  refs.payout.prepend(payoutSwipe2);
  refs.payout.prepend(payoutSwipe);
  refs.flavor.prepend(markImg(smearMark(400, 120, 11), 'smear'));
  refs.tooltip.prepend(markImg(lineMark(50, 30, 45, INK.boneDim, 2.4, { y0: 28, y1: 2, bow: 0.12 }), 'leader'));
  refs.toast.appendChild(markImg(lineMark(160, 12, 59, INK.blood, 2.4, { y0: 8, y1: 4, stretch: true }), 'deny-line'));

  function buildNav(btn, dir, key) {
    const arrow = markImg(arrowMark(82, 30, dir === 'left' ? 51 : 52, dir), 'arrow', 0.02);
    const word = el('span', 'word scrawl fat');
    const keyCap = el('span', 'key');
    keyCap.append(markImg(loopMark(34, 30, dir === 'left' ? 53 : 54, INK.boneDim, 2.2), '', 0.028), el('span', 'typed', key));
    const focus = markImg(lineMark(90, 12, dir === 'left' ? 55 : 56, INK.bone, 2.6, { y0: 8, y1: 5 }), 'focus-mark', 0.016);
    const wordWrap = el('span', 'word-wrap');
    wordWrap.append(word, focus);
    if (dir === 'left') btn.append(arrow, wordWrap, keyCap);
    else btn.append(keyCap, wordWrap, arrow);
    return word;
  }
  const navWords = { left: buildNav(refs.navLeft, 'left', 'A'), right: buildNav(refs.navRight, 'right', 'D') };

  // ---- Attention: values flare when they change, then settle back -------------
  const flareTimers = new Map();
  function flare(node) {
    node.classList.add('flare');
    clearTimeout(flareTimers.get(node));
    flareTimers.set(
      node,
      setTimeout(() => node.classList.remove('flare'), FLARE_MS),
    );
  }

  // ---- Coins ------------------------------------------------------------------
  let shownCoins = 0;
  let targetCoins = 0;
  let coinAnim = null;
  let swipeBucket = 0;

  /** Size the figure and its swipe for the value it is heading to. */
  function fitCoins(text) {
    const em = scrawlEm(text, 0.03);
    const scale = Math.min(1, Math.max(0.5, COINS_MAX_EM / em));
    refs.coins.style.fontSize = scale < 1 ? `${scale.toFixed(3)}em` : '';
    const bucket = Math.ceil((em * scale + 0.75) * 4) / 4;
    if (bucket !== swipeBucket) {
      swipeBucket = bucket;
      swapMark(coinsSwipe, swipeMark(Math.round(bucket * 100), 52, 21, INK.bloodDeep, { slope: -0.05 }));
    }
  }

  function showCoinText(value) {
    refs.coins.textContent = format(value);
  }

  // What a screen reader hears: the coins being counted to, not a frame of
  // the count-up, and the night's spins.
  let spinsSpoken = '';
  function speakCoins() {
    refs.coinsSr.textContent = `${format(targetCoins)} coins. ${spinsSpoken}`;
  }

  function setCoins(value, { animate = false } = {}) {
    const changed = !gte(value, targetCoins) || !gte(targetCoins, value);
    targetCoins = value;
    fitCoins(format(value));
    speakCoins();
    if (changed) {
      flare(refs.coinsCluster);
      if (animate) replay(refs.coinsCluster, 'bump');
    }
    if (!animate || typeof value !== 'number' || typeof shownCoins !== 'number' || reducedMotion()) {
      coinAnim = null;
      shownCoins = value;
      showCoinText(value);
      return;
    }
    coinAnim = { from: shownCoins, to: value, t: 0, duration: 0.45 };
  }

  /** The total before a change, small and struck through, then gone. */
  let wasTimer = 0;
  function strikeCoins() {
    const text = format(targetCoins);
    refs.coinsWas.querySelector('span').textContent = text;
    wasStrike.style.width = `${(scrawlEm(text) + 0.3).toFixed(2)}em`;
    replay(refs.coinsWas, 'show');
    clearTimeout(wasTimer);
    wasTimer = setTimeout(() => refs.coinsWas.classList.remove('show'), 1700);
  }

  function update(dt) {
    if (!coinAnim) return;
    coinAnim.t = Math.min(1, coinAnim.t + dt / coinAnim.duration);
    const e = 1 - (1 - coinAnim.t) ** 3;
    shownCoins = Math.round(coinAnim.from + (coinAnim.to - coinAnim.from) * e);
    showCoinText(shownCoins);
    if (coinAnim.t >= 1) {
      shownCoins = coinAnim.to;
      coinAnim = null;
    }
  }

  // ---- Spins ------------------------------------------------------------------
  let tallyKey = '';
  let lowSpins = false;
  function setSpins(left, total = left, { note = '' } = {}) {
    spinsSpoken = total > 0 ? `${left} of ${total} spins left.` : note ? `${note[0].toUpperCase()}${note.slice(1)}.` : '';
    speakCoins();
    const key = `${left}/${total}/${lowSpins}/${note}`;
    if (key === tallyKey) return;
    tallyKey = key;
    if (total > 0) {
      // Seeded by the night's size so the same night keeps the same marks.
      setMark(tallyImg, tally(left, total, 4 + total, { color: lowSpins && left > 0 ? INK.blood : INK.bone }), TALLY_SCALE);
      tallyImg.hidden = false;
      refs.spins.innerHTML = `<b class="scrawl">${left}</b> of ${total} left`;
    } else {
      tallyImg.hidden = true;
      refs.spins.textContent = note;
    }
  }

  // ---- Debt -------------------------------------------------------------------
  let nightsKey = '';
  let debtKey = '';
  function setNights(round, rounds) {
    const key = `${round}/${rounds}`;
    if (key === nightsKey) return;
    nightsKey = key;
    refs.nights.textContent = '';
    for (let n = 1; n <= rounds; n++) {
      const state = n < round ? 'done' : n === round ? 'now' : 'later';
      const cell = el('span', `n ${state}`);
      cell.appendChild(el('span', 'digit', String(n)));
      // A night gone is struck off; tonight is ringed in red chalk.
      if (state === 'done') cell.appendChild(markImg(lineMark(24, 30, 33 + n, INK.blood, 2.6, { y0: 27, y1: 4 }), 'night-mark', 0.042));
      if (state === 'now') cell.appendChild(markImg(loopMark(40, 38, 35 + n, INK.blood, 2.6), 'night-mark', 0.042));
      refs.nights.appendChild(cell);
    }
  }

  function setDebt({ debt, banked, owed, round, rounds }) {
    refs.debtNo.textContent = `debt ${debt}`;
    setNights(round, rounds);
    refs.banked.textContent = format(banked);
    refs.owed.textContent = format(owed);
    const covered = gte(banked, owed);
    refs.debtCluster.classList.toggle('covered', covered);
    const fill = covered ? 1 : Math.max(0, Math.min(1, ratio(banked, owed)));
    refs.meterFill.style.clipPath = `inset(0 ${((1 - fill) * 100).toFixed(1)}% 0 0)`;
    owedStrike.style.width = `${(scrawlEm(format(owed)) * 1.15 + 0.2).toFixed(2)}em`;
    refs.debtSr.textContent = `Debt ${debt}, night ${round} of ${rounds}: ${format(banked)} banked of ${format(owed)} owed.${covered ? ' Covered.' : ''}`;
    const key = `${debt}/${format(banked)}/${format(owed)}/${round}`;
    if (debtKey && key !== debtKey) flare(refs.debtCluster);
    debtKey = key;
  }

  // ---- Tokens -----------------------------------------------------------------
  let tokensShown = null;
  function setTokens(n) {
    const text = format(n);
    if (tokensShown !== null && text !== tokensShown) flare(refs.tokensCluster);
    tokensShown = text;
    refs.tokens.textContent = text;
    refs.tokensSr.textContent = `${text} tokens.`;
  }

  // ---- Payout and flavour -------------------------------------------------------
  let payoutTimer = 0;
  let flavorTimer = 0;

  function showPayout(text, kind = 'win') {
    const v = refs.payout.querySelector('.v');
    v.textContent = text;
    if (kind !== 'miss') {
      // Widths in steps of half an em, so repeat payouts reuse a decoded swipe.
      const w = Math.ceil((scrawlEm(text, 0.02) + 0.9) * 2) * 50;
      swapMark(payoutSwipe, swipeMark(w, 74, 41, INK.bloodDeep, { slope: -0.04 }));
      swapMark(payoutSwipe2, swipeMark(Math.round(w * 0.8), 56, 47, INK.bloodDeep, { slope: 0.06 }));
    }
    // The flavour line steps aside: the two never share the screen.
    refs.flavor.classList.remove('show');
    refs.payout.className = `hud-payout ${kind}`;
    void refs.payout.offsetWidth;
    refs.payout.classList.add('show');
    clearTimeout(payoutTimer);
    payoutTimer = setTimeout(() => refs.payout.classList.add('out'), 1900);
  }

  /**
   * A line brushed across the room. `parts` is a string or a list of
   * [text, tone] pairs; tone is 'bone', 'blood', 'green' or 'dim'.
   */
  function flavor(parts, ms = 1600) {
    const words = refs.flavor.querySelector('.words');
    const list = typeof parts === 'string' ? [[parts, 'blood']] : parts;
    words.innerHTML = list.map(([text, tone = 'bone']) => `<span class="${tone}">${escapeHtml(text)}</span>`).join('');
    // The payout steps aside in turn: the two never share the screen.
    clearTimeout(payoutTimer);
    refs.payout.classList.remove('show', 'out');
    replay(refs.flavor, 'show');
    clearTimeout(flavorTimer);
    flavorTimer = setTimeout(() => refs.flavor.classList.remove('show'), ms);
  }

  // ---- Toasts, hint and navigation ------------------------------------------------
  let toastTimer = 0;
  function toast(text, ms = 1600, kind = '') {
    refs.toast.querySelector('span').textContent = text;
    refs.toast.className = `hud-toast typed ${kind}`;
    replay(refs.toast, 'show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => refs.toast.classList.remove('show'), ms);
  }

  let hintText = null;
  /** Hint line; [Key] marks a key, written in scrawl and underlined in red. */
  function setHint(text) {
    text = text ?? '';
    if (text === hintText) return;
    hintText = text;
    refs.hint.textContent = '';
    for (const [i, part] of text.split(/\[([^\]]+)\]/).entries()) {
      if (!part) continue;
      if (i % 2 === 0) refs.hint.append(part);
      else {
        const key = el('span', 'key');
        key.append(el('span', 'scrawl', escapeHtml(part)));
        const w = Math.round((scrawlEm(part) * 1.15 + 0.4) * 60);
        key.append(markImg(lineMark(w, 12, seedOf(part), INK.blood, 3, { y0: 8, y1: 5 }), 'underline', 0.0167));
        refs.hint.append(key);
      }
    }
    refs.hint.classList.toggle('show', !!text);
  }

  function setNav(left, right) {
    for (const [btn, word, label] of [
      [refs.navLeft, navWords.left, left],
      [refs.navRight, navWords.right, right],
    ]) {
      word.textContent = label ?? '';
      btn.hidden = !label;
      if (label) btn.setAttribute('aria-label', `Go to the ${label} (${btn === refs.navLeft ? 'A' : 'D'})`);
    }
  }

  // ---- Popups and the bet note --------------------------------------------------
  function popup(text, x, y, kind = 'win') {
    const p = el('div', `hud-popup scrawl fat ${kind}`);
    p.textContent = text;
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    refs.popups.appendChild(p);
    setTimeout(() => p.remove(), 1400);
  }

  /**
   * A note scrawled beside an object, with a scratch leading to it (doc 8.4).
   * `anchor` is the object's screen position, projected from the room, so the
   * note stays put while the pointer moves over the object.
   *
   *   title    scrawled name
   *   rarity   'common' | 'uncommon' | 'rare' | 'legendary': tally strokes and the word
   *   pays     { odds, base, sources: [[label, text]] }: a bet's effective odds,
   *            the printed odds struck through when talismans change them
   *   lines    typed sentences (plain text)
   *   status   a dim typed line ("2 charges this debt")
   *   price    { amount, unit: 'tokens' | 'coins', ok, short, label }
   */
  let noteKey = '';
  function note(spec, anchor) {
    const box = refs.tooltip;
    if (!spec || !anchor) {
      box.classList.remove('show');
      noteKey = '';
      return;
    }
    const body = box.querySelector('.note-body');
    const key = JSON.stringify(spec);
    if (key !== noteKey) {
      noteKey = key;
      body.textContent = '';
      body.appendChild(el('div', 'what scrawl', escapeHtml(spec.title)));
      if (spec.rarity) {
        const row = el('div', 'rarity typed');
        const n = RARITY_MARKS[spec.rarity] ?? 1;
        row.append(markImg(tally(n, n, 61 + n, { color: INK.brass, h: 34, gap: 10, w: 3.6 }), 'rarity-marks', 0.012), el('span', '', spec.rarity));
        body.appendChild(row);
      }
      if (spec.pays) {
        const row = el('div', 'pays');
        row.appendChild(el('span', 'typed', 'pays'));
        if (spec.pays.base !== undefined && spec.pays.base !== spec.pays.odds) {
          const was = el('span', 'was scrawl', `${escapeHtml(spec.pays.base)}×`);
          was.appendChild(markImg(lineMark(80, 24, 63, INK.blood, 3, { y0: 18, y1: 7 }), 'was-strike', 0.012));
          row.appendChild(was);
        }
        row.appendChild(el('span', 'odds scrawl fat', `${escapeHtml(spec.pays.odds)}×`));
        body.appendChild(row);
        for (const [label, text] of spec.pays.sources ?? []) {
          body.appendChild(el('div', 'source typed', `<b>${escapeHtml(text)}</b> ${escapeHtml(label)}`));
        }
      }
      for (const line of spec.lines ?? []) body.appendChild(el('div', 'line typed', escapeHtml(line)));
      if (spec.status) body.appendChild(el('div', 'status typed', escapeHtml(spec.status)));
      if (spec.price) {
        const p = spec.price;
        const row = el('div', `price${p.ok === false ? ' short' : ''}`);
        if (p.label) row.appendChild(el('span', 'typed', escapeHtml(p.label)));
        row.appendChild(el('span', 'amount scrawl fat', escapeHtml(format(p.amount))));
        row.appendChild(markImg(p.unit === 'coins' ? coinGlyph(40, 3) : hexGlyph(34, 6), 'unit', p.unit === 'coins' ? 0.014 : 0.024));
        if (p.short) row.appendChild(el('span', 'typed short-by', escapeHtml(p.short)));
        body.appendChild(row);
      }
    }
    box.classList.add('show');
    // Up and to the right of the object, mirrored when the left has more
    // room; then nudged so it never leaves the screen.
    const gap = 52 * designPixel();
    body.style.translate = '';
    const w = body.offsetWidth;
    const h = body.offsetHeight;
    const roomRight = window.innerWidth - anchor.x;
    const flip = anchor.x + gap + w > window.innerWidth - 12 && anchor.x > roomRight;
    const left = flip ? anchor.x - gap - w : anchor.x + gap;
    const shiftX = Math.max(12 - left, Math.min(0, window.innerWidth - 12 - (left + w)));
    // The body sits above the anchor; keep its top on screen.
    const top = anchor.y - 22 * designPixel() - h;
    const shiftY = Math.max(0, 12 - top);
    box.classList.toggle('flip', flip);
    body.style.translate = shiftX || shiftY ? `${Math.round(shiftX)}px ${Math.round(shiftY)}px` : '';
    box.style.transform = `translate(${Math.round(anchor.x)}px, ${Math.round(anchor.y)}px)`;
  }

  /** The bet note: a felt spot's name and what it pays. */
  function tooltip(info, anchor) {
    note(info && { title: info.label, pays: { odds: info.pays, base: info.base, sources: info.sources } }, anchor);
  }

  // ---- Mood ---------------------------------------------------------------------
  /** 'spin' sinks the HUD so the wheel owns the screen; 'play' brings it back. */
  function setMode(mode) {
    hud.classList.toggle('spinning', mode === 'spin');
  }

  /**
   * At the Cage its own sign carries the debt, so the HUD's copy steps back;
   * at the Cabinet prices are in tokens, so the tokens come forward.
   */
  function setView(view) {
    hud.classList.toggle('at-cage', view === 'cage');
    hud.classList.toggle('at-cabinet', view === 'cabinet');
  }

  /** Dread: few spins left, or the night the Cage collects. */
  function setDread({ lowSpins: low = false, lastNight = false } = {}) {
    hud.classList.toggle('last-night', lastNight);
    if (low !== lowSpins) {
      lowSpins = low;
      tallyKey = ''; // repaint the tally in the new colour
    }
  }

  return {
    root: hud,
    refs,
    update,
    setCoins,
    strikeCoins,
    get shownCoins() {
      return shownCoins;
    },
    setSpins,
    setTokens,
    setDebt,
    setHint,
    setNav,
    showPayout,
    flavor,
    toast,
    popup,
    note,
    tooltip,
    setMode,
    setView,
    setDread,
    approx: toNumber,
  };
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The CSS --u unit in px: one design pixel at 1280×800. */
const designPixel = () => Math.min(2.4, Math.max(0.72, Math.min(window.innerWidth * 0.00078125, window.innerHeight * 0.00125)));

// ---- Modals ---------------------------------------------------------------------

/**
 * A blocking moment written on the dark: no card, the room falls away behind a
 * soot veil. Returns a function that closes it.
 *
 *   kicker   small typed voice line above the title ('The Cage')
 *   title    scrawled title; `struck` strikes it out and `after` follows it
 *   lines    paragraphs (trusted HTML built by the game)
 *   ledger   [label, value, className?] rows
 *   actions  { label, primary, danger, keepOpen, value: () => text, onClick }
 *            The primary action carries the swipe; others sit in a row.
 *            An action with `value` is a toggle that shows its current state.
 */
export function showModal({ kicker, title, struck = false, after, lines = [], ledger = [], actions = [], className = '' }) {
  const backdrop = el('div', `modal-backdrop ${className}`);
  const sheet = el('div', 'modal-card');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  backdrop.append(
    markImg(oldTallies(240, 520, 101, [[10, 10, 12, 1.4], [20, 110, 9, 1.4], [6, 210, 14, 1.4], [30, 310, 7, 1.4]]), 'wall wall-l', 1),
    markImg(oldTallies(220, 460, 103, [[10, 10, 10, 1.4], [6, 110, 13, 1.4], [24, 210, 6, 1.4]]), 'wall wall-r', 1),
  );

  if (kicker) sheet.appendChild(el('div', 'modal-kicker typed', escapeHtml(kicker)));
  if (title) {
    const h = el('h2', 'modal-title');
    h.id = `modal-title-${Math.random().toString(36).slice(2, 8)}`;
    sheet.setAttribute('aria-labelledby', h.id);
    const main = el('span', 'main scrawl fat');
    main.textContent = title;
    if (struck) {
      const w = Math.round((scrawlEm(title) + 0.4) * 60);
      main.appendChild(markImg(lineMark(w, 40, seedOf(title), INK.blood, 4.2, { y0: 34, y1: 12, bow: 0.03 }), 'title-strike', 0.0167));
    }
    h.appendChild(main);
    if (after) {
      h.append(' ');
      h.appendChild(el('span', 'after scrawl fat', escapeHtml(after)));
    }
    sheet.appendChild(h);
  }
  for (const line of lines) sheet.appendChild(el('p', 'modal-line typed', line));
  if (ledger.length) {
    const grid = el('div', 'modal-ledger');
    ledger.forEach(([k, v, cls = ''], i) => {
      grid.append(el('span', 'k typed', escapeHtml(k)), markImg(dotsMark(200, 10, 80 + i), 'dots'), el('span', `v scrawl fat ${cls}`, escapeHtml(v)));
    });
    grid.appendChild(markImg(lineMark(470, 14, 73, INK.boneDim, 2.4, { y0: 6, y1: 8, double: true }), 'rule'));
    sheet.appendChild(grid);
  }

  // Keep keyboard focus inside the card: Tab walks its buttons and wraps, and
  // a key pressed with focus lost (a click on the veil) brings it back.
  const trap = (ev) => {
    if (backdrop.inert || !['Tab', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(ev.key)) return;
    const inside = backdrop.contains(document.activeElement);
    if (ev.key === 'Tab') {
      ev.preventDefault();
      ev.stopPropagation();
      const i = buttons.indexOf(document.activeElement);
      const next = !inside || i < 0 ? 0 : (i + (ev.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
      return;
    }
    if (!inside) {
      ev.preventDefault();
      ev.stopPropagation();
      (buttons.find((b) => b.classList.contains('primary')) ?? buttons[0])?.focus();
    }
  };
  document.addEventListener('keydown', trap, true);

  const close = () => {
    document.removeEventListener('keydown', trap, true);
    // Let go of focus at once: while the veil fades out, a focused button
    // would swallow the next key press.
    if (backdrop.contains(document.activeElement)) document.activeElement.blur();
    backdrop.inert = true;
    backdrop.classList.remove('show');
    setTimeout(() => backdrop.remove(), 250);
  };

  const primary = actions.find((a) => a.primary);
  const rest = actions.filter((a) => a !== primary);
  const buttons = [];
  function makeButton(a, cls) {
    const b = el('button', `modal-btn ${cls}${a.danger ? ' danger' : ''}`);
    b.type = 'button';
    const label = el('span', 'label scrawl fat', escapeHtml(a.label));
    b.appendChild(label);
    let valueNode = null;
    if (a.value) {
      valueNode = el('span', 'opt scrawl fat');
      b.appendChild(valueNode);
    }
    const paint = () => {
      if (!valueNode) return;
      const v = a.value();
      valueNode.textContent = '';
      valueNode.append(el('span', '', escapeHtml(v)), markImg(loopMark(56, 38, seedOf(v), INK.blood, 2.6), 'loop', 0.036));
      b.setAttribute('aria-label', `${a.label}: ${v}`);
    };
    paint();
    b.appendChild(markImg(lineMark(120, 12, seedOf(a.label), INK.bone, 2.6, { y0: 8, y1: 5, stretch: true }), 'focus-mark'));
    b.addEventListener('click', () => {
      if (a.keepOpen) {
        a.onClick?.();
        paint();
        return;
      }
      close();
      a.onClick?.();
    });
    buttons.push(b);
    return b;
  }

  if (primary) {
    const wrap = el('div', 'modal-primary');
    const b = makeButton(primary, 'primary');
    // A tall bed of paint under the whole word: a thin band would read as a strike.
    const w = Math.round((scrawlEm(primary.label) + 1.1) * 100);
    b.prepend(markImg(swipeMark(w, 125, seedOf(primary.label), INK.bloodDeep, { slope: -0.03 }), 'swipe'));
    wrap.append(b, el('div', 'keyhint typed', 'enter'));
    sheet.appendChild(wrap);
  }
  if (rest.length) {
    const row = el('div', 'modal-actions');
    rest.forEach((a, i) => {
      if (i) row.appendChild(markImg(lineMark(14, 26, 90 + i, INK.boneDim, 2.2, { y0: 24, y1: 2 }), 'gash'));
      row.appendChild(makeButton(a, ''));
    });
    sheet.appendChild(row);
  }

  // Arrow keys (and later the pad) walk the actions in the order they are
  // laid out: up and down between the main action and the row, left and right
  // along the row. Nothing wraps, so one stray press from the main action can
  // never land on a destructive one.
  backdrop.addEventListener('keydown', (ev) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(ev.key)) return;
    ev.preventDefault();
    ev.stopPropagation();
    const main = buttons.find((b) => b.classList.contains('primary'));
    const row = buttons.filter((b) => b !== main);
    const at = document.activeElement;
    const i = row.indexOf(at);
    let next = null;
    if (ev.key === 'ArrowDown' && (at === main || i < 0)) next = row[0];
    else if (ev.key === 'ArrowUp' && i >= 0) next = main;
    else if (i >= 0 && ev.key === 'ArrowLeft') next = row[i - 1];
    else if (i >= 0 && ev.key === 'ArrowRight') next = row[i + 1];
    else if (i < 0 && at !== main && !main) next = row[0];
    next?.focus();
  });

  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('show'));
  (buttons.find((b) => b.classList.contains('primary')) ?? buttons[0])?.focus({ focusVisible: true });
  return close;
}
