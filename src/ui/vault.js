import { INK, lineMark, markImg, oldTallies } from './marks.js';

// The Vault screen (design doc 7.1, decision 36): the iron door's four
// compartments, opened from the main menu. A shut one hangs its padlock and
// names the debt that opens it; an open one stands ajar on what its lock
// opened. One the player has not yet watched open first drops its padlock
// and swings open, so the news of a lock has somewhere to be seen.

const el = (tag, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const ROMAN = ['I', 'II', 'III', 'IV'];
// The beats of a compartment opening: the shackle jumps and the padlock
// falls, then the door swings.
const BEAT = { first: 600, swing: 650, next: 1400 };

/** A shut compartment's line: the debt that opens it, and the lock before it. */
export const shutLine = (l) => `Pay debt ${l.debt}${l.lock > 1 ? ` with lock ${ROMAN[l.lock - 2]} open` : ''}.`;

/**
 * Opens the Vault screen on `view` (core/meta.js vaultView). `onDetails(lock)`
 * opens a compartment's card; `onSeen()` is called once every fresh
 * compartment has swung open; `sound` has `clunk` and `open`. Returns close().
 */
export function showVaultScreen(view, { onDetails, onSeen, onClose, sound = {} } = {}) {
  const backdrop = el('div', 'modal-backdrop almanac vault-screen');
  backdrop.append(markImg(oldTallies(240, 520, 401, [[10, 10, 12, 1.4], [20, 110, 9, 1.4], [6, 210, 14, 1.4]]), 'wall wall-l', 1));
  const card = el('div', 'almanac-card vault-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'The Vault');
  const head = el('header', 'alm-head');
  head.append(el('h2', 'scrawl fat', 'The Vault'), el('span', 'alm-count typed', view.vault ? 'The Vault is open' : `${view.open} of ${view.locks.length} locks open`));
  const closeBtn = el('button', 'alm-close');
  closeBtn.type = 'button';
  closeBtn.append(el('span', 'label scrawl fat', 'Close'));
  head.append(closeBtn);

  const face = el('div', `vault-face${view.vault ? ' ajar' : ''}`);
  const boxes = view.locks.map((l) => {
    const box = el('button', `vault-box ${l.open && !l.fresh ? 'open' : 'shut'}`);
    box.type = 'button';
    box.dataset.lock = String(l.lock);
    box.setAttribute('aria-label', l.open ? `Lock ${l.lock}, open: ${l.contents.map((c) => c.name).join(', ')}.` : `Lock ${l.lock}, shut. ${shutLine(l)}`);
    // Inside, behind the door: what the lock opened. A shut one is drawn
    // empty, so nothing shows through before it opens.
    const inside = el('span', 'vb-inside');
    if (l.open) {
      for (const c of l.contents) {
        const item = el('span', 'vb-item');
        item.append(el('i', `g g-${c.kind}${c.black ? ' black' : ''}`), el('span', 'typed', escapeHtml(c.name)));
        inside.append(item);
      }
    }
    const door = el('span', 'vb-door');
    door.append(el('span', 'vb-plate', ROMAN[l.lock - 1]), el('span', 'vb-lock'), el('span', 'vb-hint typed', l.open ? 'Open' : `Pay debt ${l.debt}`));
    box.append(inside, door);
    box.addEventListener('click', () => onDetails?.(l));
    face.append(box);
    return box;
  });

  const next = view.locks.find((l) => !l.open);
  let foot;
  if (view.vault) foot = 'The Vault is open: behind the door, one chair and a wheel no bigger than a plate. <b>Zero is not empty.</b> Endless waits on the chip select.';
  else if (next) foot = `Pay debt ${next.debt}, your goal, and lock ${ROMAN[next.lock - 1]} falls open. Tap a compartment to see what it holds.`;
  else foot = `All four locks are open. Pay debt ${view.vaultDebt} or later and the Vault itself opens.`;
  card.append(head, markImg(lineMark(900, 12, 43, INK.boneDim, 2, { y0: 6, y1: 7, stretch: true }), 'alm-rule'), face, el('p', 'vault-foot typed', foot));
  backdrop.append(card);

  // The compartments opened since the last visit swing open, one after another.
  const timers = [];
  const fresh = view.locks.filter((l) => l.fresh);
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const swing = (box, l) => {
    box.classList.remove('shut', 'unlocking');
    box.classList.add('open');
    box.setAttribute('aria-label', `Lock ${l.lock}, open: ${l.contents.map((c) => c.name).join(', ')}.`);
  };
  if (fresh.length) {
    if (still) {
      for (const l of fresh) swing(boxes[l.lock - 1], l);
      onSeen?.();
    } else {
      let t = BEAT.first;
      for (const l of fresh) {
        const box = boxes[l.lock - 1];
        timers.push(setTimeout(() => {
          box.classList.add('unlocking');
          sound.clunk?.();
        }, t));
        timers.push(setTimeout(() => {
          swing(box, l);
          sound.open?.();
        }, t + BEAT.swing));
        t += BEAT.next;
      }
      timers.push(setTimeout(() => onSeen?.(), t));
    }
  }

  const buttons = [closeBtn, ...boxes];
  const onTop = () => [...document.querySelectorAll('.modal-backdrop:not([inert])')].at(-1) === backdrop;
  const onKey = (ev) => {
    if (backdrop.inert || !onTop()) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      close();
      return;
    }
    const step = { Tab: ev.shiftKey ? -1 : 1, ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
    if (!step) return;
    ev.preventDefault();
    ev.stopPropagation();
    const i = buttons.indexOf(document.activeElement);
    buttons[(i + step + buttons.length) % buttons.length]?.focus();
  };
  document.addEventListener('keydown', onKey, true);

  function close() {
    for (const t of timers) clearTimeout(t);
    document.removeEventListener('keydown', onKey, true);
    if (backdrop.contains(document.activeElement)) document.activeElement.blur();
    backdrop.inert = true;
    backdrop.classList.remove('show');
    setTimeout(() => backdrop.remove(), 250);
    onClose?.();
  }
  closeBtn.addEventListener('click', close);

  document.body.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('show'));
  closeBtn.focus({ focusVisible: true });
  return { close, boxes };
}
