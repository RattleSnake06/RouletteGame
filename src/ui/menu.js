import { paintChipFace } from './chipLook.js';
import { INK, lineMark, markImg, oldTallies, swipeMark } from './marks.js';

// The main menu and the chip select (design doc 7.5, decision 26). They lie
// over the hall in near darkness: the 3D room stays behind them, with Madame
// Zero's eyes in the dark. Every control is a real button, at least 44 px on
// a touch screen; the keys walk them as Tab does.

const el = (tag, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Lines she whispers under the title, one at a time.
const WHISPERS = ['The House is waiting.', 'She is watching.', 'The wheel remembers.', 'Everything has a price.', 'Zero is not empty.', 'It all adds up to 666.'];

/** A set's chips, fanned on a canvas: their faces, or black shapes while locked. */
function chipStack(set, w = 168, h = 96) {
  const canvas = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const face = document.createElement('canvas');
  face.width = face.height = 128;
  paintChipFace(face.getContext('2d'), 128, set.id, '1');
  const d = 62;
  const step = Math.min(30, (w - d - 8) / Math.max(1, set.count - 1));
  const x0 = (w - (d + step * (set.count - 1))) / 2;
  for (let i = 0; i < set.count; i++) {
    const x = x0 + i * step;
    const y = (h - d) / 2 + (i % 2 ? 6 : -4);
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();
    if (set.unlocked) {
      ctx.drawImage(face, x, y, d, d);
    } else {
      // A silhouette: the chip's shape and nothing else.
      ctx.beginPath();
      ctx.arc(x + d / 2, y + d / 2, d / 2 - 1, 0, Math.PI * 2);
      ctx.fillStyle = '#0b0909';
      ctx.fill();
      ctx.strokeStyle = 'rgba(179, 169, 147, 0.25)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
  return canvas;
}

/**
 * handlers: { onContinue, onPlay, onAlmanac, onSettings, onBegin(setId),
 * onBack, onWheel, onEdge, onGoal }. The chip select also chooses the starting wheel
 * and the House Edge (doc 7.2): each a button that opens its list, shown once
 * the Vault or a win has opened more than one.
 */
export function createMainMenu(handlers) {
  const root = el('div', 'title-screen');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Main menu');
  root.append(
    markImg(oldTallies(240, 520, 201, [[10, 10, 12, 1.4], [20, 110, 9, 1.4], [6, 210, 14, 1.4], [30, 310, 7, 1.4]]), 'wall wall-l', 1),
    markImg(oldTallies(220, 460, 203, [[10, 10, 10, 1.4], [6, 110, 13, 1.4], [24, 210, 6, 1.4], [16, 330, 11, 1.4]]), 'wall wall-r', 1),
  );

  // ---- The main menu ---------------------------------------------------------------
  const main = el('div', 'ts-main');
  const title = el('h1', 'ts-title scrawl fat', '<span>Rien ne va</span> <span class="blood">plus.</span>');
  const swipe = markImg(swipeMark(900, 120, 66, INK.bloodDeep, { slope: -0.02 }), 'ts-swipe', 0.0125);
  const whisper = el('p', 'ts-whisper typed', WHISPERS[0]);
  const nav = el('nav', 'ts-menu');
  const item = (label, onClick) => {
    const b = el('button', 'ts-item');
    b.type = 'button';
    b.append(el('span', 'label scrawl fat', label), el('span', 'sub typed'));
    b.append(markImg(lineMark(160, 14, label.length * 7, INK.blood, 3, { y0: 9, y1: 5, stretch: true }), 'ts-mark'));
    b.addEventListener('click', onClick);
    nav.append(b);
    return b;
  };
  const cont = item('Continue', () => handlers.onContinue?.());
  const playBtn = item('Play', () => handlers.onPlay?.());
  item('Almanac', () => handlers.onAlmanac?.());
  item('Settings', () => handlers.onSettings?.());
  main.append(title, swipe, whisper, nav);

  // ---- The chip select -------------------------------------------------------------------
  const chips = el('div', 'ts-chips');
  chips.hidden = true;
  const head = el('div', 'ts-chips-head');
  const goalLine = el('p', 'typed', 'Pay debt 4 with a set, and the next one opens.');
  head.append(el('h2', 'scrawl fat', 'Choose your chips'), goalLine);
  const row = el('div', 'ts-row');
  const foot = el('div', 'ts-foot');
  const back = el('button', 'ts-item ts-back');
  back.type = 'button';
  back.append(el('span', 'label scrawl fat', '← Back'));
  back.addEventListener('click', () => handlers.onBack?.());
  const begin = el('button', 'ts-item ts-begin');
  begin.type = 'button';
  begin.append(el('span', 'label scrawl fat', 'Begin'), el('span', 'sub typed'));
  begin.append(markImg(swipeMark(420, 110, 71, INK.bloodDeep, { slope: -0.03 }), 'ts-begin-swipe', 0.0125));
  const chooser = (onClick) => {
    const b = el('button', 'ts-item ts-pick');
    b.type = 'button';
    b.append(el('span', 'label scrawl fat'));
    b.addEventListener('click', onClick);
    return b;
  };
  const wheelBtn = chooser(() => handlers.onWheel?.());
  const edgeBtn = chooser(() => handlers.onEdge?.());
  const goalBtn = chooser(() => handlers.onGoal?.());
  const picks = el('div', 'ts-picks');
  picks.append(wheelBtn, edgeBtn, goalBtn);
  foot.append(back, picks, begin);
  chips.append(head, row, foot);
  let selected = null;
  let sets = [];
  begin.addEventListener('click', () => selected && handlers.onBegin?.(selected));

  let setup = null;
  function select(id) {
    const set = sets.find((s) => s.id === id);
    if (!set?.unlocked) return;
    selected = id;
    for (const card of row.children) card.classList.toggle('on', card.dataset.set === id);
    begin.querySelector('.sub').textContent = `with ${set.name} chips`;
  }

  /** The wheel and House Edge chosen, and how many of each are open. */
  function drawSetup() {
    if (!setup) return;
    goalLine.textContent = setup.endless
      ? 'Endless: no goal. Play until the Cage collects. Pay debt 4 with a set, and the next one opens.'
      : `Your goal: pay debt ${setup.goal}. Pay debt 4 with a set, and the next one opens.`;
    wheelBtn.hidden = setup.wheels < 2;
    edgeBtn.hidden = setup.edges < 2;
    goalBtn.hidden = !setup.endlessOpen;
    picks.hidden = wheelBtn.hidden && edgeBtn.hidden && goalBtn.hidden;
    // With the choosers out, a narrow screen drops Begin's second line (CSS).
    chips.classList.toggle('setup', !picks.hidden);
    wheelBtn.querySelector('.label').textContent = `${setup.wheel.name} wheel ▾`;
    edgeBtn.querySelector('.label').textContent = setup.edge.level ? `House Edge ${setup.edge.level} ▾` : 'No House Edge ▾';
    wheelBtn.setAttribute('aria-label', `${setup.wheel.name} wheel. ${setup.wheel.upside} ${setup.wheel.downside} Change the wheel.`);
    edgeBtn.setAttribute('aria-label', `House Edge ${setup.edge.level}: ${setup.edge.text} Change the edge.`);
    goalBtn.querySelector('.label').textContent = setup.endless ? 'Endless ▾' : `To debt ${setup.goal} ▾`;
    goalBtn.setAttribute('aria-label', setup.endless ? 'Endless: no goal. Change the goal.' : `Goal: debt ${setup.goal}. Change the goal.`);
  }

  function drawSets() {
    row.textContent = '';
    for (const set of sets) {
      const card = el('button', `ts-set${set.unlocked ? '' : ' locked'}`);
      card.type = 'button';
      card.dataset.set = set.id;
      card.setAttribute('aria-label', set.unlocked ? `${set.name} chips, ${set.count}. ${set.upside} ${set.downside}` : `${set.name} chips, locked. ${set.unlocks}`);
      card.append(chipStack(set));
      card.append(el('span', 'name scrawl fat', escapeHtml(set.name)), el('span', 'count typed', `${set.count} chips`));
      if (set.unlocked) {
        card.append(el('span', 'up typed', escapeHtml(set.upside)));
        if (set.downside) card.append(el('span', 'down typed', escapeHtml(set.downside)));
        if (set.best) card.append(el('span', 'best typed', `best: debt ${set.best} paid`));
      } else {
        card.append(el('span', 'lock typed', escapeHtml(set.unlocks)));
      }
      card.addEventListener('click', () => select(set.id));
      // Two taps, or a double click, on an open set begins at once.
      card.addEventListener('dblclick', () => set.unlocked && handlers.onBegin?.(set.id));
      row.append(card);
    }
  }

  root.append(main, chips);
  document.body.append(root);

  // Arrow keys walk the buttons on show, as Tab does.
  root.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !chips.hidden) {
      ev.preventDefault();
      handlers.onBack?.();
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(ev.key)) return;
    const list = [...root.querySelectorAll('button')].filter((b) => b.offsetParent);
    const i = list.indexOf(document.activeElement);
    const dir = ev.key === 'ArrowDown' || ev.key === 'ArrowRight' ? 1 : -1;
    ev.preventDefault();
    ev.stopPropagation();
    list[Math.max(0, Math.min(list.length - 1, i + dir))]?.focus();
  });

  let whisperTimer = null;
  let w = 0;
  const startWhispers = () => {
    clearInterval(whisperTimer);
    whisperTimer = setInterval(() => {
      w = (w + 1) % WHISPERS.length;
      whisper.classList.remove('on');
      setTimeout(() => {
        whisper.textContent = WHISPERS[w];
        whisper.classList.add('on');
      }, 700);
    }, 6000);
  };

  return {
    root,
    get open() {
      return !root.hidden;
    },
    /** The main menu. `cont` describes a saved run ("debt 2 · night 1"), or null for none. */
    show({ cont: line = null } = {}) {
      root.hidden = false;
      main.hidden = false;
      chips.hidden = true;
      cont.hidden = !line;
      cont.querySelector('.sub').textContent = line ?? '';
      requestAnimationFrame(() => root.classList.add('show'));
      whisper.classList.add('on');
      startWhispers();
      (line ? cont : playBtn).focus({ focusVisible: true });
    },
    /**
     * The chip select: every set, `last` chosen to begin with. `run` is the
     * rest of the run's setup: { goal, wheel, edge, wheels, edges } (the
     * chosen wheel and edge, and how many of each are open).
     */
    showChips(list, last = null, run = null) {
      sets = list;
      setup = run;
      drawSets();
      drawSetup();
      main.hidden = true;
      chips.hidden = false;
      select(sets.find((s) => s.id === last && s.unlocked)?.id ?? sets.find((s) => s.unlocked).id);
      begin.focus({ focusVisible: true });
    },
    /** The wheel or the edge changed. */
    setSetup(run) {
      setup = run;
      drawSetup();
    },
    showMain() {
      main.hidden = false;
      chips.hidden = true;
      (cont.hidden ? playBtn : cont).focus({ focusVisible: true });
    },
    hide() {
      clearInterval(whisperTimer);
      if (root.contains(document.activeElement)) document.activeElement.blur();
      root.classList.remove('show');
      setTimeout(() => {
        if (!root.classList.contains('show')) root.hidden = true;
      }, 600);
    },
  };
}

