import { format, toNumber } from '../core/num.js';

// The flat HUD (design doc 8.4): coins and spins top-left, tokens top-right,
// the debt line and last payout top-centre. Everything else lives on objects
// in the room. Also hosts payout popups, the bet tooltip, flavour text,
// toasts and the hint line.

const COIN_SVG = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#c9a15a" stroke="#5c4320" stroke-width="1.5"/><circle cx="12" cy="12" r="6.2" fill="none" stroke="#5c4320" stroke-width="1.4"/></svg>`;
const TOKEN_SVG = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><polygon points="12,2 20.7,7 20.7,17 12,22 3.3,17 3.3,7" fill="#a88a52" stroke="#4a3618" stroke-width="1.5"/><polygon points="12,7 16.3,9.5 16.3,14.5 12,17 7.7,14.5 7.7,9.5" fill="none" stroke="#4a3618" stroke-width="1.3"/></svg>`;

function el(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export function createHud(root = document.body) {
  const hud = el('div', 'hud');
  hud.innerHTML = `
    <div class="hud-box hud-left">
      <div class="hud-row hud-coins">${COIN_SVG}<span data-k="coins">0</span></div>
      <div class="hud-row hud-spins">SPINS LEFT: <span data-k="spins">0</span></div>
    </div>
    <div class="hud-box hud-right">
      <div class="hud-row"><span data-k="tokens">0</span>${TOKEN_SVG}</div>
    </div>
    <div class="hud-center">
      <div class="hud-debt" data-k="debt"></div>
      <div class="hud-payout" data-k="payout"></div>
    </div>
    <button class="hud-nav hud-nav-left" data-k="navLeft" type="button"></button>
    <button class="hud-nav hud-nav-right" data-k="navRight" type="button"></button>
    <div class="hud-hint" data-k="hint"></div>
    <div class="hud-flavor" data-k="flavor"></div>
    <div class="hud-toast" data-k="toast"></div>
    <div class="hud-tooltip" data-k="tooltip"></div>
    <div class="hud-popups" data-k="popups"></div>
  `;
  root.appendChild(hud);
  const $ = (k) => hud.querySelector(`[data-k="${k}"]`);
  const refs = {
    coins: $('coins'),
    spins: $('spins'),
    tokens: $('tokens'),
    debt: $('debt'),
    payout: $('payout'),
    navLeft: $('navLeft'),
    navRight: $('navRight'),
    hint: $('hint'),
    flavor: $('flavor'),
    toast: $('toast'),
    tooltip: $('tooltip'),
    popups: $('popups'),
  };

  let shownCoins = 0;
  let coinAnim = null;

  function setCoins(value, { animate = false } = {}) {
    const target = value;
    if (!animate || typeof target !== 'number' || typeof shownCoins !== 'number') {
      coinAnim = null;
      shownCoins = target;
      refs.coins.textContent = format(target);
      return;
    }
    coinAnim = { from: shownCoins, to: target, t: 0, duration: 0.45 };
  }

  function update(dt) {
    if (!coinAnim) return;
    coinAnim.t = Math.min(1, coinAnim.t + dt / coinAnim.duration);
    const e = 1 - (1 - coinAnim.t) ** 3;
    shownCoins = Math.round(coinAnim.from + (coinAnim.to - coinAnim.from) * e);
    refs.coins.textContent = format(shownCoins);
    if (coinAnim.t >= 1) {
      shownCoins = coinAnim.to;
      coinAnim = null;
    }
  }

  let toastTimer = 0;
  let flavorTimer = 0;
  let payoutTimer = 0;

  return {
    root: hud,
    refs,
    update,
    setCoins,
    get shownCoins() {
      return shownCoins;
    },
    setSpins(n) {
      refs.spins.textContent = String(n);
    },
    setTokens(n) {
      refs.tokens.textContent = format(n);
    },
    setDebt(text) {
      refs.debt.textContent = text;
    },
    setHint(text) {
      refs.hint.textContent = text ?? '';
      refs.hint.classList.toggle('show', !!text);
    },
    setNav(left, right) {
      for (const [btn, label] of [
        [refs.navLeft, left],
        [refs.navRight, right],
      ]) {
        btn.textContent = label ?? '';
        btn.hidden = !label;
      }
    },
    showPayout(text, kind = 'win') {
      refs.payout.textContent = text;
      refs.payout.className = `hud-payout show ${kind}`;
      clearTimeout(payoutTimer);
      payoutTimer = setTimeout(() => refs.payout.classList.remove('show'), 1800);
    },
    flavor(text, ms = 1600) {
      refs.flavor.textContent = text;
      refs.flavor.classList.add('show');
      clearTimeout(flavorTimer);
      flavorTimer = setTimeout(() => refs.flavor.classList.remove('show'), ms);
    },
    toast(text, ms = 1600) {
      refs.toast.textContent = text;
      refs.toast.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => refs.toast.classList.remove('show'), ms);
    },
    /** A number that floats up from a point on screen. */
    popup(text, x, y, kind = 'win') {
      const p = el('div', `hud-popup ${kind}`, text);
      p.style.left = `${x}px`;
      p.style.top = `${y}px`;
      refs.popups.appendChild(p);
      setTimeout(() => p.remove(), 1400);
    },
    tooltip(html, x, y) {
      if (!html) {
        refs.tooltip.classList.remove('show');
        return;
      }
      refs.tooltip.innerHTML = html;
      refs.tooltip.classList.add('show');
      const pad = 18;
      const w = refs.tooltip.offsetWidth;
      const left = Math.min(window.innerWidth - w - 8, x + pad);
      refs.tooltip.style.left = `${Math.max(8, left)}px`;
      refs.tooltip.style.top = `${Math.max(8, y - 54)}px`;
    },
    approx: toNumber,
  };
}

/**
 * A blocking card in the middle of the screen. `actions` are buttons:
 * { label, primary, onClick }. Returns a function that closes it.
 */
export function showModal({ title, body, actions = [], className = '' }) {
  const backdrop = el('div', `modal-backdrop ${className}`);
  const card = el('div', 'modal-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  if (title) card.appendChild(el('h2', 'modal-title', title));
  if (body) card.appendChild(el('div', 'modal-body', body));
  const row = el('div', 'modal-actions');
  const close = () => {
    // Let go of focus at once: while the card fades out, a focused button
    // would swallow the next key press.
    if (backdrop.contains(document.activeElement)) document.activeElement.blur();
    backdrop.inert = true;
    backdrop.classList.remove('show');
    setTimeout(() => backdrop.remove(), 250);
  };
  for (const a of actions) {
    const b = el('button', a.primary ? 'modal-btn primary' : 'modal-btn', a.label);
    b.type = 'button';
    b.addEventListener('click', () => {
      close();
      a.onClick?.();
    });
    row.appendChild(b);
  }
  card.appendChild(row);
  backdrop.appendChild(card);
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('show'));
  (row.querySelector('.primary') ?? row.querySelector('button'))?.focus();
  return close;
}
