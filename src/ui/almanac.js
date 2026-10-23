import { format } from '../core/num.js';
import { INK, lineMark, markImg, oldTallies } from './marks.js';

// The Almanac (design doc 7.4): a leather book of what the player has seen,
// the feats done, the figures in the dark and the lifetime ledger. It lies
// over the room like a card: a page per tab, unseen entries as silhouettes.
// Opened from the book on the table, the main menu or the pause menu.

const el = (tag, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Short tab names, so the tabs fit a phone's width in two rows at most.
const TAB = { talismans: 'Charms', fortunes: 'Fortunes', records: 'Records', enhancements: 'Pockets', oddities: 'Oddities', engravings: 'Engraved' };
const WHEEL_NAME = { european: 'European', american: 'American', gilded: 'Gilded', bone: 'Bone', mirror: 'Mirror' };

/**
 * Opens the Almanac on `view` (core/meta.js almanacView). `names` maps ids to
 * names for the figures' rails and chips. Returns close().
 */
export function showAlmanac(view, { names = (id) => id, onClose } = {}) {
  const backdrop = el('div', 'modal-backdrop almanac');
  backdrop.append(markImg(oldTallies(240, 520, 301, [[10, 10, 12, 1.4], [20, 110, 9, 1.4], [6, 210, 14, 1.4]]), 'wall wall-l', 1));
  const card = el('div', 'almanac-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'The Almanac');
  const head = el('header', 'alm-head');
  const seen = view.sections.reduce((n, s) => n + s.seen, 0);
  const total = view.sections.reduce((n, s) => n + s.entries.length, 0);
  head.append(el('h2', 'scrawl fat', 'The Almanac'), el('span', 'alm-count typed', `${seen} of ${total} seen`));
  const closeBtn = el('button', 'alm-close');
  closeBtn.type = 'button';
  closeBtn.append(el('span', 'label scrawl fat', 'Close'));
  head.append(closeBtn);
  const tabs = el('nav', 'alm-tabs');
  const page = el('div', 'alm-page');
  page.tabIndex = 0;
  card.append(head, tabs, markImg(lineMark(900, 12, 41, INK.boneDim, 2, { y0: 6, y1: 7, stretch: true }), 'alm-rule'), page);
  backdrop.append(card);

  const pages = [
    ...view.sections.map((s) => ({ id: s.kind, label: TAB[s.kind] ?? s.title, count: `${s.seen}/${s.entries.length}`, draw: () => drawEntries(s) })),
    { id: 'feats', label: 'Feats', count: `${view.achievements.filter((a) => a.done).length}/${view.achievements.length}`, draw: drawFeats },
    { id: 'figures', label: 'Figures', count: String(view.figures.filter((f) => f.standing).length), draw: drawFigures },
    { id: 'ledger', label: 'Ledger', count: '', draw: drawLedger },
  ];

  function drawEntries(section) {
    const grid = el('div', 'alm-grid');
    for (const e of section.entries) {
      const item = el('div', `alm-entry${e.seen ? '' : ' unseen'}`);
      if (e.seen) item.append(el('b', 'scrawl', escapeHtml(e.name)), el('span', 'typed', escapeHtml(e.text ?? '')));
      else item.append(el('b', 'scrawl', '?'), el('span', 'typed', 'Not yet seen.'));
      grid.append(item);
    }
    page.append(grid);
  }

  function drawFeats() {
    const grid = el('div', 'alm-grid');
    for (const a of view.achievements) {
      const item = el('div', `alm-entry feat${a.done ? ' done' : ''}`);
      item.append(el('b', 'scrawl', escapeHtml(a.name)), el('span', 'typed', escapeHtml(a.text)));
      if (a.done) item.append(markImg(lineMark(160, 14, a.name.length * 7, INK.blood, 3, { y0: 9, y1: 5, stretch: true }), 'feat-mark'));
      grid.append(item);
    }
    page.append(grid);
  }

  function drawFigures() {
    page.append(el('p', 'alm-note typed', 'Every run that ends without stepping out of the light leaves its figure in the dark. The newest twelve stand there.'));
    const list = el('div', 'alm-ledger');
    for (const f of view.figures) {
      const who = f.stranger ? 'A stranger' : `Run ${f.n}`;
      const bits = [];
      if (f.chipSet) bits.push(`${names(f.chipSet)} chips`);
      if (f.wheel) bits.push(`${WHEEL_NAME[f.wheel] ?? f.wheel} wheel`);
      if (f.edge) bits.push(`House Edge ${f.edge}`);
      if (f.best) bits.push(`best spin ${format(f.best)}`);
      const rail = f.rail?.length ? f.rail.map(names).join(', ') : f.stranger ? 'unknown' : 'a bare rail';
      const row = el('div', `alm-row${f.standing ? '' : ' faded'}`);
      row.append(el('b', 'scrawl', escapeHtml(who)), el('span', 'typed', escapeHtml(`${f.cause}.${bits.length ? ` ${bits.join(' · ')}.` : ''} Rail: ${rail}.`)));
      list.append(row);
    }
    page.append(list);
  }

  function drawLedger() {
    const st = view.stats;
    const rows = [
      ['Runs', String(st.runs)],
      ['Goals reached', String(st.goals)],
      ['Stepped out', String(st.left)],
      ['Collected or given up', String(st.lost)],
      ['Most debts paid in a run', String(st.bestDebt)],
      ['Best spin', format(st.bestSpin)],
      ['Spins', String(st.spins)],
      ['The Devil fired', String(st.devils)],
      ['The Vault', view.vault ? 'open' : `${view.locks} of 4 locks open`],
      ['House Edge open', view.edge ? `to ${view.edge}` : 'not yet'],
    ];
    const list = el('div', 'alm-ledger stats');
    for (const [k, v] of rows) {
      const row = el('div', 'alm-row');
      row.append(el('span', 'typed', escapeHtml(k)), el('b', 'scrawl', escapeHtml(v)));
      list.append(row);
    }
    page.append(list);
  }

  const buttons = [closeBtn];
  let current = null;
  function open(id) {
    current = id;
    page.textContent = '';
    page.scrollTop = 0;
    for (const b of tabs.children) b.classList.toggle('on', b.dataset.page === id);
    pages.find((p) => p.id === id).draw();
  }
  for (const p of pages) {
    const b = el('button', 'alm-tab');
    b.type = 'button';
    b.dataset.page = p.id;
    b.append(el('span', 'label scrawl', p.label));
    if (p.count) b.append(el('span', 'n typed', p.count));
    b.addEventListener('click', () => open(p.id));
    tabs.append(b);
    buttons.push(b);
  }

  const onKey = (ev) => {
    if (backdrop.inert) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      close();
      return;
    }
    if (ev.key !== 'Tab') return;
    ev.preventDefault();
    ev.stopPropagation();
    const i = buttons.indexOf(document.activeElement);
    buttons[(i + (ev.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
  };
  document.addEventListener('keydown', onKey, true);

  function close() {
    document.removeEventListener('keydown', onKey, true);
    if (backdrop.contains(document.activeElement)) document.activeElement.blur();
    backdrop.inert = true;
    backdrop.classList.remove('show');
    setTimeout(() => backdrop.remove(), 250);
    onClose?.();
  }
  closeBtn.addEventListener('click', close);

  document.body.append(backdrop);
  open(pages[0].id);
  requestAnimationFrame(() => backdrop.classList.add('show'));
  closeBtn.focus({ focusVisible: true });
  return { close, open, get page() {
    return current;
  } };
}
