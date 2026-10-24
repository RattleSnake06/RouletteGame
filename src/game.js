import * as THREE from 'three';
import { BET_KINDS, getBet } from './core/bets.js';
import { ACHIEVEMENTS, contentName, getEnhancement, getFortune, getMaterial, getOddity, getRecord, getStartingWheel, getTalisman } from './core/content/index.js';
import { almanacView, applyRun, chipSets, edgeChoices, endRun, endlessOpen, goalFor, isUnlocked, markTaught, runOptions, serializeProfile, standingFigures, wheelChoices } from './core/meta.js';
import { nightTokensFor } from './core/house.js';
import { ECONOMY } from './core/economy.js';
import { add, format, gt, gte, isBig, isZero, sub } from './core/num.js';
import { baseFactors } from './core/payout.js';
import { randomSeed } from './core/rng.js';
import { PHASE, act, chipsOnTable, costOf, createRun, hooksFor, interestRate, isFinalNight, owed } from './core/run.js';
import { deserializeRun, serializeRun } from './core/save.js';
import { bellView, cabinetView, gramophoneView, levelsView, luckView, numbersView, oracleView, pickView, previewBet, railView, statsView, wheelView } from './core/selectors.js';
import { DOUBLE_ZERO, numberLabel } from './core/wheel.js';
import { openSpecials } from './core/effects.js';
import { workRefusal } from './core/wheelwork.js';
import { playPayout } from './playback.js';
import { showAlmanac } from './ui/almanac.js';
import { showGuide } from './ui/guide.js';
import { TIPS } from './ui/tips.js';
import { showModal } from './ui/hud.js';
import { bellNote, betNote, boardNote, cardNote, chalkboardNote, chartNote, crankNote, devilNote, gramophoneNote, leverNote, placardNote, plaqueNote, slotNote, talismanNote } from './ui/notes.js';

// Glue between the rules (core/run.js) and the room. Every player action goes
// through dispatch(), which applies it to the run, saves, and returns the
// events the view plays back. The view never decides an outcome.

const PACKAGE_KEYS = ['long', 'short', 'sitout'];
// The stations, left to right as the player turns. Turning never wraps.
const VIEWS = ['oracle', 'cage', 'table', 'cabinet'];
const VIEW_NAMES = { oracle: 'Madame Zero', cage: 'Cage', table: 'Table', cabinet: 'Cabinet' };
// Outside bets Tab walks at the table, after the spots that hold chips.
const FOCUS_BETS = ['red', 'black', 'odd', 'even', 'low', 'high', 'dozen:1', 'dozen:2', 'dozen:3', 'column:1', 'column:2', 'column:3'];
const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// First-time tips, most pressing first, and how long one stays up.
const TIP_ORDER = ['lean', 'pity', 'devil', 'bank', 'nightOver', 'zero', 'cabinet', 'talisman', 'bell', 'record'];
const TIP_SECONDS = 14;
// The steps Music and Effects go through in Settings.
const LEVELS = [1, 0.75, 0.5, 0.25, 0];
const levelText = (v) => (v ? `${Math.round(v * 100)}%` : 'off');
/** "a, b and c". */
const listOf = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
// The hint line (doc 8.4). [Key] marks a key. On a touch screen the hints
// name touches instead (doc 9.10).
const KEY_HINTS = {
  cage: 'Banked coins count toward the debt. They cannot come back out.',
  cabinet: 'Click a compartment to buy, or press [1] [2] [3]. [R] turns the crank.',
  oracle: 'Pull her lever for three cards, [R]. Take one: click it, or press [1] [2] [3].',
  oracleDealt: 'Take one card: click it, or press [1] [2] [3]. [R] deals again, for coins.',
  oracleDone: 'She deals once a debt. Click the gramophone to change the record.',
  lookAtCabinet: 'Your tokens buy talismans at the Cabinet. [D] to look.',
  chooseNight: 'Choose how to spend the night: click a card, or press [1], [2] or [3].',
  placeChip: 'Click the felt to place a chip.',
  reorder: 'Talismans act left to right: drag them to reorder.',
  spinOrRing: 'Fling the wheel, or press [Space] to spin. [B] rings the Bell.',
  spin: 'Fling the wheel, or press [Space] to spin.',
  nightOver: 'The night is over. Bank your coins at the Cage, then press [E] to end the night.',
};
const TOUCH_HINTS = {
  cage: 'Banked coins count toward the debt. They cannot come back out.',
  cabinet: 'Tap a compartment to look, then Buy. The crank restocks.',
  oracle: 'Tap her lever: she deals three cards. You may take one.',
  oracleDealt: 'Tap a card to read it, then Take. The lever deals again, for coins.',
  oracleDone: 'She deals once a debt. Tap the gramophone to change the record.',
  lookAtCabinet: 'Your tokens buy talismans at the Cabinet. Swipe left to look.',
  chooseNight: 'Choose how to spend the night: tap the cards to read them, then tap one.',
  placeChip: 'Tap the felt to place a chip.',
  reorder: 'Talismans act left to right: drag them to reorder.',
  spinOrRing: 'Tap SPIN or fling the wheel. Tap the Bell to ring it.',
  spin: 'Tap SPIN or fling the wheel. Hold SPIN to spin fast.',
  nightOver: 'The night is over. Bank at the Cage, then tap the card to end the night.',
};

/** A stable name for a focusable object, so focus survives the list changing. */
const focusKey = (t) => `${t.kind}:${t.uid ?? t.betId ?? t.slot ?? t.card ?? t.plaque ?? ''}`;
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Wheel work (doc 5.4): what the bar over the felt asks for, how a pocket is
// told apart from its twins, and the line that names what was done.
const enhName = (id) => getEnhancement(id)?.name.toLowerCase() ?? 'plain';
const WORK_PROMPT = {
  gild: () => 'Tap a number to paint its pocket gold (painted gold twice, it turns platinum).',
  enhance: (w) => `Tap a number to make its pocket ${enhName(w.enh)}.`,
  widen: () => 'Tap a number to widen every pocket with it.',
  narrow: () => 'Tap a number to narrow every pocket with it.',
  paint: (w) => `Tap a number to paint its pocket ${w.color}.`,
  duplicate: () => 'Tap a number to give it a second pocket.',
  remove: () => 'Tap a number to remove its pocket.',
  stamp: () => 'Tap a number: its pocket gets a new number.',
  level: () => 'Tap a bet: its kind goes up a level.',
};
// A kind of bet as the placard and the toasts name it.
const BET_NAME = { straight: 'Straight-ups', split: 'Splits', street: 'Streets', corner: 'Corners', firstFour: 'First Fours', sixLine: 'Six Lines', dozen: 'Dozens', column: 'Columns', red: 'Red bets', black: 'Black bets', odd: 'Odd bets', even: 'Even bets', low: '1–18 bets', high: '19–36 bets' };
// A card that levels a group of bets names the group, by its first kind.
const LEVEL_GROUPS = { dozen: 'dozens, columns and even-money bets', split: 'splits, streets, corners and six-lines' };
const describePocket = (o) => `${o.color ?? 'blank'} · ${enhName(o.enh)}${o.width !== 1 ? ` · ${o.width}× as wide` : ''}`;
function workLine(works) {
  const said = works.map((e) => {
    const n = e.number === null ? 'a blank' : numberLabel(e.number);
    switch (e.op) {
      case 'gild':
        return `${n} ${e.enh === 'platinum' ? 'platinum' : 'painted gold'}`;
      case 'enhance':
        return `${n} ${enhName(e.enh)}`;
      case 'widen':
        return `${n} wider`;
      case 'narrow':
        return `${n} narrower`;
      case 'paint':
        return `${n} painted ${e.color}`;
      case 'duplicate':
        return `a second ${n}`;
      case 'remove':
        return `${n} removed`;
      default:
        return `a pocket changed to ${n}`;
    }
  });
  const line = said.join(', ');
  return `${line[0].toUpperCase()}${line.slice(1)}.`;
}

export class Game {
  constructor(deps) {
    Object.assign(this, deps);
    this.state = null;
    this.busy = false;
    this.view = 'table';
    this.fastHeld = false;
    this.power = 1; // room light, 0 when the Cage collects
    this.menuClose = null;
    this.seen = new Set(); // one-time hints already shown this session
    this.tipShown = null; // the first-time tip on screen (ui/tips.js), and its timer
    this.tipTimer = null;
    this.focus = null; // keyboard focus: { view, key } (see focusKey)
    this.noteTarget = null; // the object whose note is up
    this.lifted = null; // the rail talisman raised by keyboard focus
    // Bumped by a new run, so a spin or timer from the old run stops short.
    this.runId = 0;
    this._screen = new THREE.Vector3();
    this._ballAt = new THREE.Vector3();
    // Whether the LEAN lamp was lit at the last sync (null: not synced yet, so
    // a Lean already waiting in a loaded run lights without the creak).
    this.leanShown = null;
    this.justSpun = false;
    this.leanTimer = null; // a Lean's creak, waiting for the payout to finish
    this.feltZoom = false; // the felt close-up (touch betting)
    this.selectedChip = null; // a chip picked up by a tap (touch)
    this.atMenu = false; // the main menu or the chip select is up
  }

  // ---- Lifecycle ------------------------------------------------------------

  /**
   * Continue the saved run, or start a fresh one. A ?seed=XXXX-XXXX link
   * starts that seed, but only when no run is in progress.
   */
  boot() {
    const saved = this.platform.load('run');
    let state = saved ? deserializeRun(saved) : null;
    const seed = new URLSearchParams(window.location.search).get('seed');
    if (seed && (!state || state.phase === PHASE.GAME_OVER)) state = createRun({ seed: seed.toUpperCase(), ...runOptions(this.profile) });
    this.state = state ?? createRun({ seed: randomSeed(), ...runOptions(this.profile) });
    this.save();
    this.syncAll();
    this.ball.restAt(this.state.lastSpin?.pocketIndex ?? 0);
    if (this.state.phase === PHASE.GAME_OVER) {
      this.power = 0.15;
      this.busy = true;
      const id = this.runId;
      // From the main menu, a lost run is simply over: Play begins the next.
      setTimeout(() => id === this.runId && !this.atMenu && (this.state.outcome?.reason === 'left' ? this.showLeft() : this.showCollected()), 600);
    }
  }

  /**
   * A fresh run with this chip set (decision 26), the current run's set by
   * default, on the wheel and at the House Edge chosen (doc 7.2).
   */
  newRun(chipSet = this.state?.chipSet) {
    // A run in progress that a new one replaces was given up: it leaves its figure (doc 7.3).
    if (this.continueLine()) this.recordEnd('gaveUp');
    this.runId += 1;
    this.leanShown = null;
    clearTimeout(this.leanTimer);
    this.leanTimer = null;
    this.clearFocus();
    const { wheel, edge, endless } = this.chosenSetup();
    this.state = createRun({ seed: randomSeed(), chipSet, wheel, edge, endless, ...runOptions(this.profile) });
    this.hideExtraBalls();
    this.save();
    this.power = 1;
    this.busy = false;
    this.hud.setMode('play');
    this.lighting.set('table');
    this.setLocked(false);
    this.syncAll();
    this.turnTo('table');
  }

  save() {
    this.platform.save('run', serializeRun(this.state));
  }

  saveProfile() {
    this.platform.save('profile', serializeProfile(this.profile));
  }

  /** The Vault's padlocks and the figures in the dark follow the profile (doc 7.1, 7.3). */
  syncRoom() {
    this.vault?.sync({ locks: this.profile.locks, open: this.profile.vault });
    this.syncFigures();
  }

  syncFigures() {
    this.figures?.sync(standingFigures(this.profile));
  }

  /** The run ended: the profile keeps its figure (unless it stepped out) and its numbers. */
  recordEnd(cause) {
    this.profile = endRun(this.profile, this.state, cause);
    this.saveProfile();
    this.syncFigures();
  }

  // ---- The run's setup: its wheel and House Edge (doc 7.2) -------------------

  /** The wheel and edge last chosen, kept to those still open. */
  chosenSetup() {
    let saved = null;
    try {
      saved = JSON.parse(this.platform.load('setup') ?? 'null');
    } catch {
      saved = null;
    }
    const wheels = wheelChoices(this.profile).filter((w) => w.unlocked);
    const wheel = wheels.find((w) => w.id === saved?.wheel)?.id ?? 'european';
    const edge = Number.isInteger(saved?.edge) ? Math.max(0, Math.min(saved.edge, this.profile.edge)) : 0;
    const endless = saved?.endless === true && endlessOpen(this.profile);
    return { wheel, edge, endless };
  }

  setupView() {
    const { wheel, edge, endless } = this.chosenSetup();
    return {
      goal: goalFor(this.profile),
      endless,
      endlessOpen: endlessOpen(this.profile),
      wheel: wheelChoices(this.profile).find((w) => w.id === wheel),
      edge: edgeChoices(this.profile)[edge],
      wheels: wheelChoices(this.profile).filter((w) => w.unlocked).length,
      edges: edgeChoices(this.profile).filter((e) => e.unlocked).length,
    };
  }

  saveSetup(change) {
    this.platform.save('setup', JSON.stringify({ ...this.chosenSetup(), ...change }));
    this.menu.setSetup(this.setupView());
  }

  /** The starting wheels: the open ones to choose, the locked ones and what opens them. */
  chooseWheel() {
    const list = wheelChoices(this.profile);
    const now = this.chosenSetup().wheel;
    showModal({
      kicker: 'The wheel',
      title: 'Choose the wheel',
      lines: list.map((w) => (w.unlocked ? `<b>${escapeHtml(w.name)}</b>: ${escapeHtml(w.upside)} <i>${escapeHtml(w.downside)}</i>` : `<b>${escapeHtml(w.name)}</b>: locked. ${escapeHtml(w.unlocks)}`)),
      actions: [
        { label: 'Keep it', primary: true },
        ...list.filter((w) => w.unlocked && w.id !== now).map((w) => ({ label: `${w.name} wheel`, onClick: () => this.saveSetup({ wheel: w.id }) })),
      ],
    });
  }

  /** Once the Vault is open: a run to the goal, or endless (doc 7.1). */
  chooseGoal() {
    const { endless } = this.chosenSetup();
    const goal = goalFor(this.profile);
    showModal({
      kicker: 'The goal',
      title: 'How far?',
      lines: [
        `<b>To debt ${goal}</b>: pay it and you may step out of the light, the run won.`,
        '<b>Endless</b>: no goal and no stepping out. Play until the Cage collects; the deepest run goes in the Almanac.',
      ],
      actions: [
        { label: 'Keep it', primary: true },
        endless ? { label: `To debt ${goal}`, onClick: () => this.saveSetup({ endless: false }) } : { label: 'Endless', onClick: () => this.saveSetup({ endless: true }) },
      ],
    });
  }

  /** House Edge 0 to 5: each level stacks the ones before it. */
  chooseEdge() {
    const list = edgeChoices(this.profile);
    const now = this.chosenSetup().edge;
    showModal({
      kicker: 'House Edge',
      title: 'How hard is the House?',
      lines: [
        'Each level keeps the rules of the levels before it.',
        ...list.slice(1).map((e) => (e.unlocked ? `<b>${e.level}. ${escapeHtml(e.name)}</b>: ${escapeHtml(e.text)}` : `<b>${e.level}.</b> Locked. ${escapeHtml(e.unlocks)}`)),
      ],
      actions: [
        { label: 'Keep it', primary: true },
        ...list.filter((e) => e.unlocked && e.level !== now).map((e) => ({ label: e.level ? `House Edge ${e.level}` : 'No House Edge', onClick: () => this.saveSetup({ edge: e.level }) })),
      ],
    });
  }

  /** The Almanac (doc 7.4), from the main menu, the pause menu or the book on the table. */
  /** The Info book (Phase 8): how the game works, from the main menu or the pause menu. */
  openGuide({ onClose } = {}) {
    if (this.guide) return;
    this.guide = showGuide({ onClose: () => ((this.guide = null), onClose?.()) });
  }

  openAlmanac() {
    if (this.almanac) return;
    const names = (id) => getMaterial(id)?.id === id ? getMaterial(id).name : (contentName(id) ?? id);
    this.almanac = showAlmanac(almanacView(this.profile), { names, onClose: () => (this.almanac = null) });
  }

  // ---- The main menu and the chip select (doc 7.5) ---------------------------

  /** "debt 2 · night 1 · Glass chips" for a run worth continuing, or null. */
  continueLine() {
    const s = this.state;
    if (!s || s.phase === PHASE.GAME_OVER || (s.stats.spins === 0 && s.debt === 1 && s.round === 1)) return null;
    return `debt ${s.debt} · night ${s.round} · ${getMaterial(s.chipSet).name} chips${s.endless ? ' · endless' : ''}`;
  }

  /** The hall goes dark, the camera finds her in it, and the menu comes up. */
  showMainMenu({ cut = false } = {}) {
    this.menuClose?.();
    this.menuClose = null;
    this.leaveFelt();
    this.clearFocus();
    this.clearNote();
    this.atMenu = true;
    this.setLocked(true);
    this.hud.root.classList.remove('show');
    this.director.goTo('menu', { duration: 1.4, cut });
    this.lighting.set('menu');
    this.menu.show({ cont: this.continueLine() });
  }

  /** Back to the table, from the menu. */
  leaveMenu() {
    this.menu.hide();
    this.atMenu = false;
    this.setLocked(this.busy);
    this.hud.root.classList.add('show');
    this.view = 'table';
    this.hud.setView('table');
    this.director.goTo('table', { duration: 1.6 });
    this.lighting.set('table');
    this.syncAll();
  }

  continueRun() {
    if (this.continueLine()) this.leaveMenu();
  }

  /** Play: the chip select, once a run in progress has been given up. */
  playFromMenu() {
    const line = this.continueLine();
    if (!line) {
      this.openChipSelect();
      return;
    }
    showModal({
      title: 'Begin a new run?',
      lines: [`The run in progress (${escapeHtml(line)}) is given up. There is no undo.`],
      actions: [
        { label: 'Keep it', primary: true },
        { label: 'Give it up', danger: true, onClick: () => this.openChipSelect() },
      ],
    });
  }

  openChipSelect() {
    this.menu.showChips(chipSets(this.profile), this.state?.chipSet, this.setupView());
  }

  menuBack() {
    this.menu.showMain();
  }

  /** Begin: a new run with these chips, and the camera back to the table. */
  beginRun(chipSet) {
    if (!isUnlocked(this.profile, chipSet)) return;
    this.newRun(chipSet);
    this.leaveMenu();
  }

  /** The settings, from the main menu or the pause menu (`onDone` goes back to it). */
  openSettings({ onDone } = {}) {
    showModal({
      className: 'pause',
      title: 'Settings',
      actions: [
        { label: 'Done', primary: true, onClick: () => onDone?.() },
        { label: 'Fast spins', keepOpen: true, value: () => (this.settings.fast ? 'on' : 'off'), onClick: () => this.toggleFast() },
        { label: 'Sound', keepOpen: true, value: () => (this.settings.muted ? 'off' : 'on'), onClick: () => this.toggleMute() },
        { label: 'Music', keepOpen: true, value: () => levelText(this.settings.music), onClick: () => this.cycleLevel('music') },
        { label: 'Effects', keepOpen: true, value: () => levelText(this.settings.effects), onClick: () => this.cycleLevel('effects') },
        { label: 'Text', keepOpen: true, value: () => this.settings.text, onClick: () => this.toggleTextSize() },
        { label: 'Graphics', keepOpen: true, value: () => this.settings.quality, onClick: () => this.cycleQuality() },
        { label: 'Crunch', keepOpen: true, value: () => (this.settings.crunch ? 'on' : 'off'), onClick: () => this.toggleCrunch() },
        { label: 'Flashing lights', keepOpen: true, value: () => (this.settings.flashes ? 'on' : 'off'), onClick: () => this.toggleFlashes() },
        { label: 'Tips', keepOpen: true, value: () => (this.settings.tips ? 'on' : 'off'), onClick: () => this.toggleTips() },
      ],
    });
  }

  /** The first-time tips (doc 8.4): off hides the one showing and keeps the rest away. */
  toggleTips() {
    this.settings.tips = !this.settings.tips;
    if (!this.settings.tips) this.hideTip();
    this.saveSettings();
  }

  /** Music or effects, a step down each press (100%, 75%, 50%, 25%, off), then back to full. */
  cycleLevel(kind) {
    const at = LEVELS.indexOf(this.settings[kind]);
    this.settings[kind] = LEVELS[(at + 1) % LEVELS.length];
    this.audio.setLevels({ [kind]: this.settings[kind] });
    this.saveSettings();
  }

  /** Normal or large text for the HUD's reading, the cards and the books. */
  toggleTextSize() {
    this.settings.text = this.settings.text === 'large' ? 'normal' : 'large';
    document.documentElement.classList.toggle('text-large', this.settings.text === 'large');
    this.saveSettings();
  }

  /** High, medium or low (the phone preset): main.js puts it in force. */
  cycleQuality() {
    const order = ['high', 'medium', 'low'];
    this.settings.quality = order[(order.indexOf(this.settings.quality) + 1) % order.length];
    this.onGraphicsChanged?.();
    this.saveSettings();
  }

  /** The low-resolution crunch filter (decision 3), off unless chosen. */
  toggleCrunch() {
    this.settings.crunch = !this.settings.crunch;
    this.onGraphicsChanged?.();
    this.saveSettings();
  }

  dispatch(action) {
    const { state, events } = act(this.state, action);
    const rejected = events.find((e) => e.type === 'rejected');
    if (rejected) {
      this.audio.deny();
      this.hud.toast(rejected.reason, 1800, 'deny');
      return null;
    }
    this.state = state;
    this.save();
    // The profile follows the run (doc 7): locks, edges, the Vault, what was seen, feats.
    const { profile, news } = applyRun(this.profile, state, events);
    if (profile !== this.profile) {
      this.profile = profile;
      this.saveProfile();
    }
    this.news = news;
    // A feat that opens content says so (doc 7.1).
    const feats = news.filter((n) => n.kind === 'achievement').map((n) => {
      const name = ACHIEVEMENTS.find((a) => a.id === n.id)?.name;
      return n.content?.length ? `${name} (opens ${n.content.map((id) => contentName(id)).join(', ')})` : name;
    });
    if (feats.length) setTimeout(() => this.hud.toast(`In the Almanac: ${feats.join(', ')}`, 3200), 900);
    return events;
  }

  // ---- Syncing the room to the state ---------------------------------------

  syncAll() {
    const s = this.state;
    // The close-up is for betting: a night that ends or a new run leaves it.
    if (this.feltZoom && !this.picking && ((s.phase !== PHASE.BETTING && s.phase !== PHASE.ROUND_START) || this.view !== 'table')) this.zoomFelt(false);
    this.table.syncChips(s);
    this.table.updateMarquee(s.history);
    this.syncRoom();
    this.hud.setCoins(s.coins);
    this.syncItems();
    this.syncSpins();
    // The night cards stand on the felt: they step aside while wheel work is placed.
    if (s.phase === PHASE.ROUND_START && !this.busy && !this.picking) this.table.showPackages(s);
    else this.table.hidePackages();
    if (s.phase === PHASE.NIGHT_OVER && !this.busy) this.table.showEndCard(this.endCardLine());
    else this.table.hideEndCard();
    this.syncStatus();
    this.syncLuck();
    this.syncWheel();
    this.checkTips();
  }

  // ---- First-time tips (doc 8.4) ---------------------------------------------

  /** The first tip due that this profile has not been shown, if the moment is calm. */
  checkTips() {
    const s = this.state;
    if (!s || !this.settings.tips || this.atMenu || this.busy || this.tipShown || s.phase === PHASE.GAME_OVER) return;
    if (document.querySelector('.modal-backdrop.show')) return;
    const taught = new Set(this.profile.taught ?? []);
    const due = TIP_ORDER.find((id) => !taught.has(id) && this.tipDue(id));
    if (due) this.showTip(due);
  }

  /** Whether the moment a tip is about has come. */
  tipDue(id) {
    const s = this.state;
    switch (id) {
      case 'lean':
        return this.view === 'table' && this.leanShown === true;
      case 'pity':
        return this.view === 'table' && s.phase === PHASE.BETTING && luckView(s).pity > 0;
      case 'devil':
        return luckView(s).devil.live;
      case 'bank':
        return (s.lastSpin?.wins?.length ?? 0) > 0 && gt(s.coins, 0);
      case 'nightOver':
        return s.phase === PHASE.NIGHT_OVER;
      case 'zero':
        return (s.round >= 2 || s.debt >= 2) && oracleView(s).taken === null;
      case 'cabinet':
        return this.view === 'cabinet';
      case 'talisman':
        return s.rail.some((t) => !getTalisman(t.id)?.cursed);
      case 'bell':
        return !!bellView(s).head;
      case 'record':
        return s.records.length > 0;
      default:
        return false;
    }
  }

  /** Shows a tip once for this profile; it fades by itself, or when a spin starts. */
  showTip(id) {
    const tip = TIPS[id];
    const here = VIEWS.indexOf(this.view);
    const there = tip.toward ? VIEWS.indexOf(tip.toward) : here;
    this.hud.setTip(tip, { pulse: there < here ? 'left' : there > here ? 'right' : null });
    this.tipShown = id;
    this.profile = markTaught(this.profile, id);
    this.saveProfile();
    clearTimeout(this.tipTimer);
    this.tipTimer = setTimeout(() => this.hideTip(), TIP_SECONDS * 1000);
  }

  hideTip() {
    clearTimeout(this.tipTimer);
    this.tipTimer = null;
    if (!this.tipShown) return;
    this.tipShown = null;
    this.hud.setTip(null);
    // The next one waits for the next calm moment.
    setTimeout(() => this.checkTips(), 1200);
  }

  /**
   * Each pocket drawn at its live width (doc 5.4): a Brass Scales hung or
   * sold makes the even pockets swell or shrink before your eyes. The first
   * sync of a run draws them at once.
   */
  syncWheel() {
    const animate = this.wheelSynced === this.runId;
    const before = this.wheelWidths;
    const pockets = wheelView(this.state);
    this.wheelWidths = pockets.map((p) => `${p.id}:${p.width}`).join();
    // The wheel groans when its pockets change size or come and go.
    if (this.stage.wheel.setPockets(pockets, { animate }) && animate && before !== this.wheelWidths) this.audio.widen();
    this.wheelSynced = this.runId;
    this.table.setNumbers(numbersView(this.state));
    this.table.setTrack(openSpecials(this.state));
    this.table.syncStats(statsView(this.state));
    this.table.syncLevels(levelsView(this.state));
    // The ball stays in the pocket it came to rest in while others come and go around it.
    if (!this.ball.flying && this.state.lastSpin?.pocketId) {
      const at = this.stage.wheel.indexOf(this.state.lastSpin.pocketId);
      if (at >= 0 && at !== this.ball.pocket) this.ball.restAt(at);
    }
  }

  /**
   * The House's luck as the room shows it (doc 5.6, 5.7): the board's LEAN
   * lamp, Nudge and pity, the wheel's hum, and the 666 counter on the Cage.
   */
  syncLuck() {
    const s = this.state;
    const luck = luckView(s);
    // Once the run is over there is no next spin to show luck for.
    this.table.setLuck(s.phase === PHASE.GAME_OVER ? { lean: 0, pity: 0, total: 0 } : luck);
    this.cage.setDevil(luck.devil);
    const lean = s.phase !== PHASE.GAME_OVER && luck.lean > 0;
    this.lighting.setLean(lean && !this.busy);
    if (lean && this.leanShown === false) this.announceLean();
    this.leanShown = lean;
  }

  /**
   * A Lean ahead: the wheel creaks and the bulb hums. After a spin it waits
   * for the payout swipe to finish (it shows for about 2.4 s); a spin started
   * sooner plays the creak at once (see spinSequence).
   */
  announceLean() {
    const id = this.runId;
    const delay = this.justSpun ? 2.5 : 0.1;
    clearTimeout(this.leanTimer);
    this.leanTimer = setTimeout(() => {
      this.leanTimer = null;
      const luck = luckView(this.state);
      if (id !== this.runId || this.busy || !(luck.lean > 0)) return;
      this.audio.lean();
      this.hud.flavor(
        [
          ['The wheel creaks. ', 'dim'],
          ['The House leans', 'bone'],
          // The Black Cat's crossing cancels it: no Nudge at all on that spin.
          [luck.blocked ? ', but the Black Cat crosses your path.' : '.', 'dim'],
        ],
        2200,
      );
    }, delay * 1000);
  }

  /** The rail, the Bell, the Cabinet, tokens and the Glass Eye's mark. */
  syncItems() {
    const s = this.state;
    this.rail.sync(railView(s), hooksFor(s));
    this.bell.sync(bellView(s));
    this.cabinet.sync(cabinetView(s));
    const gramophone = gramophoneView(s);
    this.oracle.sync({ oracle: oracleView(s), gramophone });
    // The music follows the record on the platter, whatever put it there.
    // Two slots play together; the horn plays the first one's tune.
    this.audio.playRecord((gramophone.playing ?? gramophone.second)?.tune ?? null);
    this.table.setMarks({ foreseen: s.foreseen ? s.wheel.pockets[s.foreseen.pocketIndex].number : null });
    this.hud.setTokens(s.tokens);
    // A focused talisman that was sold or smashed takes the focus with it.
    if (this.focus && this.focus.view === this.view && !this.focusedTarget()) this.clearFocus();
    this.refreshNote();
  }

  /** The night's tally: spins left of the night's allowance. */
  syncSpins() {
    const s = this.state;
    const total = s.phase === PHASE.ROUND_START ? 0 : (s.spinsTonight ?? 0);
    let note = '';
    if (s.phase === PHASE.ROUND_START) note = 'choose a night';
    // A save from before the tally knew the night's size cannot tell a played
    // night from a sat-out one.
    else if (s.phase === PHASE.NIGHT_OVER) note = s.spinsTonight === 0 ? 'sat out' : 'the night is over';
    this.hud.setDread({
      lowSpins: s.phase === PHASE.BETTING && total > 2 && s.spinsLeft <= 2,
      lastNight: isFinalNight(s) && s.phase !== PHASE.GAME_OVER,
    });
    this.hud.setSpins(s.spinsLeft, total, { note });
  }

  /** HUD debt, the Cage's counters, hints and navigation. */
  syncStatus() {
    const s = this.state;
    this.hud.setDebt({ debt: s.debt, goal: s.won ? null : s.goal, banked: s.deposited, owed: owed(s), round: s.round, rounds: ECONOMY.roundsPerDebt });
    const keep = this.keepAmount();
    this.cage.sync({
      owed: owed(s),
      deposited: s.deposited,
      coins: s.coins,
      canBank: gt(s.coins, 0) && s.phase !== PHASE.GAME_OVER,
      round: s.round,
      keep,
      canEnd: s.phase === PHASE.NIGHT_OVER,
      endLabel: s.phase === PHASE.NIGHT_OVER ? (isFinalNight(s) ? 'the Cage collects' : nightTokensFor(s) ? `interest + ${plural(nightTokensFor(s), 'token')}` : 'interest') : 'spin first',
      rate: interestRate(s),
    });
    this.updateHint();
    this.updateNav();
  }

  /** Coins to keep back when banking: the price of tomorrow's long night. */
  keepAmount() {
    const s = this.state;
    const lastNightOver = isFinalNight(s) && s.phase === PHASE.NIGHT_OVER;
    if (lastNightOver) return null;
    const keep = costOf(s, 'long');
    return gt(s.coins, keep) ? keep : null;
  }

  endCardLine() {
    const s = this.state;
    if (isFinalNight(s)) return `The Cage collects ${format(owed(s))} tonight.`;
    return `Banked coins earn ${Math.round(interestRate(s) * 100)}% and you get a token. Then night ${s.round + 1} begins.`;
  }

  updateHint() {
    const s = this.state;
    const hints = this.touch ? TOUCH_HINTS : KEY_HINTS;
    let hint = '';
    const offers = cabinetView(s).slots.filter((x) => x.id);
    if (this.busy) hint = '';
    else if (s.phase === PHASE.GAME_OVER) hint = '';
    else if (this.view === 'cage') hint = hints.cage;
    else if (this.view === 'cabinet') hint = hints.cabinet;
    else if (this.view === 'oracle') {
      const deal = oracleView(s);
      hint = deal.taken !== null ? hints.oracleDone : deal.dealt ? hints.oracleDealt : hints.oracle;
    }
    else if (s.phase === PHASE.ROUND_START && !this.seen.has('cabinet') && offers.some((x) => x.affordable)) hint = hints.lookAtCabinet;
    else if (s.phase === PHASE.ROUND_START) hint = hints.chooseNight;
    else if (s.phase === PHASE.BETTING && chipsOnTable(s).length === 0) hint = hints.placeChip;
    else if (s.phase === PHASE.BETTING && s.rail.length > 1 && !this.seen.has('moved')) hint = hints.reorder;
    else if (s.phase === PHASE.BETTING && bellView(s).head) hint = hints.spinOrRing;
    else if (s.phase === PHASE.BETTING) hint = hints.spin;
    else if (s.phase === PHASE.NIGHT_OVER) hint = hints.nightOver;
    this.hud.setHint(hint);
    // The SPIN button stays up through the spin, so it can be held for speed.
    const atTable = this.view === 'table' && s.phase !== PHASE.GAME_OVER;
    this.hud.setSpinButton({
      shown: this.touch && atTable && (this.busy || s.phase === PHASE.BETTING),
      ready: !this.busy && s.phase === PHASE.BETTING && chipsOnTable(s).length > 0,
    });
  }

  updateNav() {
    if (this.busy) {
      this.hud.setNav(null, null);
      return;
    }
    const i = VIEWS.indexOf(this.view);
    this.hud.setNav(VIEW_NAMES[VIEWS[i - 1]] ?? null, VIEW_NAMES[VIEWS[i + 1]] ?? null);
  }

  setLocked(locked) {
    this.table.setLocked(locked);
    this.cage.setLocked(locked);
    this.rail.setLocked(locked);
    this.bell.setLocked(locked);
    this.cabinet.setLocked(locked);
    this.oracle.setLocked(locked);
    if (locked) this.clearNote();
  }

  // ---- Camera ---------------------------------------------------------------

  turnTo(view) {
    if (this.busy && view !== 'table') return;
    // Turning away puts down the wheel work being placed.
    if (this.picking) this.cancelPick();
    if (view === this.view && this.director.current === view) return;
    this.leaveFelt();
    this.clearFocus();
    this.view = view;
    this.clearNote();
    this.hud.setView(view);
    // The Cabinet is a longer turn than the Cage.
    // Every station is seen through your eyes: your figure fades (after the wheel-work shot from above).
    this.director.goTo(view, { duration: view === 'cabinet' || this.director.current === 'cabinet' ? 0.75 : 0.6 });
    if (!this.busy) this.lighting.set(view);
    if (view === 'cabinet') this.seen.add('cabinet');
    this.updateHint();
    this.updateNav();
    this.checkTips();
  }

  turn(dir) {
    if (this.busy) return;
    const next = VIEWS[VIEWS.indexOf(this.view) + dir];
    if (next) this.turnTo(next);
  }

  // ---- Chips ----------------------------------------------------------------

  onClickBet(betId) {
    if (this.busy) return;
    if (this.picking) {
      this.pickBet(betId);
      return;
    }
    // On a phone the felt is small from the chair: a tap leans in first.
    if (this.touch && !this.feltZoom) {
      this.zoomFelt(true);
      return;
    }
    // A chip picked up by a tap goes where the next tap says.
    const picked = this.selectedChip;
    if (picked) {
      this.selectChip(null);
      this.placeChip(picked, betId);
      return;
    }
    const free = this.state.chips.find((c) => !this.state.placements[c.id]);
    if (!free) {
      this.hud.toast(this.touch ? 'All your chips are down. Tap one to pick it up, then tap where it goes.' : 'All your chips are on the table. Drag one to move it.');
      return;
    }
    this.placeChip(free.id, betId);
  }

  /** A tap on a chip: off the felt (mouse), or picked up to put down elsewhere (touch). */
  onChipTapped(chipId) {
    if (this.busy || this.picking) return;
    if (!this.touch) {
      if (this.state.placements[chipId]) this.removeChip(chipId);
      return;
    }
    if (!this.feltZoom) this.zoomFelt(true);
    if (this.selectedChip !== chipId) {
      this.selectChip(chipId);
      return;
    }
    // Tapped again: it comes off the felt.
    this.selectChip(null);
    if (this.state.placements[chipId]) this.removeChip(chipId);
  }

  selectChip(chipId) {
    if (this.selectedChip === chipId) return;
    this.selectedChip = chipId;
    this.table.setSelectedChip(chipId);
    this.table.syncChips(this.state);
  }

  /**
   * The felt close-up (doc 9.10): on a phone, betting leans in over the felt
   * so its spots are big enough for a finger. Back, a turn or a spin leaves.
   */
  zoomFelt(on) {
    // The night cards stand on the felt: the close-up reads them too.
    const can = this.touch && this.view === 'table' && !this.busy && (this.state.phase === PHASE.BETTING || this.state.phase === PHASE.ROUND_START);
    if (on && !can) return;
    if (!on) {
      this.leaveFelt();
      this.director.goTo('table', { duration: 0.5 });
      return;
    }
    if (this.feltZoom) return;
    this.feltZoom = true;
    this.clearNote();
    this.hud.setZoomed(true);
    this.director.goTo('felt', { duration: 0.5 });
  }

  /** Out of the close-up, leaving the camera to whoever moves it next. */
  leaveFelt() {
    if (!this.feltZoom) return;
    this.feltZoom = false;
    this.hud.setZoomed(false);
    this.hud.hideLoupe();
    this.selectChip(null);
  }

  /** The Android back button: out of the close-up, else the menu. Returns true if it acted. */
  back() {
    // At the main menu: the chip select steps back to the menu; the menu holds.
    if (this.atMenu) {
      this.menuBack();
      return true;
    }
    if (this.picking) {
      this.endWork();
      return true;
    }
    if (!this.feltZoom) return false;
    this.zoomFelt(false);
    return true;
  }

  /** The magnifier follows a finger aiming at the felt; null hides it. */
  onAim(aim) {
    if (!aim || !aim.at) {
      this.hud.hideLoupe();
      return;
    }
    this.hud.showLoupe({
      x: aim.x,
      y: aim.y,
      label: aim.bet ? `${getBet(aim.bet).label} · pays ${betNote(this.state, aim.bet).pays.odds}×` : 'Not a bet',
      draw: (ctx, size) => this.table.drawLoupe(ctx, aim.at, size, size / 1.7),
    });
  }

  placeChip(chipId, betId) {
    // A chip picked up before a spin began and let go during it goes back.
    if (this.busy) return this.table.syncChips(this.state);
    // The Neighbours and Finales zones of the racetrack hold a bet for every
    // number: once open, a chip there asks which one.
    const kind = getBet(betId).kind;
    if ((kind === 'neighbours' || kind === 'finale') && openSpecials(this.state).has(kind)) {
      this.chooseTrackBet(chipId, kind);
      return;
    }
    this.placeChipOn(chipId, betId);
  }

  /** Which number for a Neighbours bet, or which last digit for a Finale. */
  chooseTrackBet(chipId, kind) {
    const place = (n) => () => this.placeChipOn(chipId, `${kind}:${n}`);
    let actions;
    if (kind === 'neighbours') {
      // Laid out as the felt is: the zero (and the 00) down the left, then
      // twelve columns of three.
      const double = this.state.wheelOrder?.includes(DOUBLE_ZERO);
      actions = [
        { label: '0', onClick: place(0), cell: { col: 1, row: double ? 2 : 1, rows: double ? 2 : 3 } },
        ...(double ? [{ label: numberLabel(DOUBLE_ZERO), onClick: place(DOUBLE_ZERO), cell: { col: 1, row: 1 } }] : []),
        ...Array.from({ length: 36 }, (_, i) => i + 1).map((n) => ({ label: String(n), onClick: place(n), cell: { col: Math.ceil(n / 3) + 1, row: 3 - ((n - 1) % 3) } })),
      ];
    } else {
      actions = Array.from({ length: 10 }, (_, d) => ({ label: String(d), onClick: place(d) }));
    }
    showModal({
      className: `numbers ${kind}`,
      kicker: kind === 'neighbours' ? 'The racetrack · Neighbours' : 'The racetrack · Finales',
      title: kind === 'neighbours' ? 'Which number?' : 'Which digit?',
      lines: [kind === 'neighbours' ? `The number and the two pockets either side of it on the wheel. Pays ${BET_KINDS.neighbours.odds}.` : 'Every number ending in the digit. Pays 9, or 12 on 7, 8 and 9.'],
      // A chip dragged onto the zone goes back if no number is chosen.
      actions: [{ label: 'Never mind', primary: true, onClick: () => this.table.syncChips(this.state) }, ...actions],
    });
  }

  placeChipOn(chipId, betId) {
    if (!this.busy && this.dispatch({ type: 'placeChip', chipId, betId })) {
      this.audio.chip();
      this.updateHint();
    }
    // Placed, or refused (a fixed chip, a closed bet, mid-spin): either way
    // the chip shows where the run has it, not where it was let go.
    this.table.syncChips(this.state);
  }

  removeChip(chipId) {
    if (!this.busy && this.dispatch({ type: 'removeChip', chipId })) {
      this.audio.chip();
      this.updateHint();
    }
    this.table.syncChips(this.state);
  }

  /**
   * The bet note sits beside the spot itself, not the pointer, and shows what
   * the rail makes of the bet. The plaques read that bet's factors meanwhile.
   */
  onHoverBet(betId, ev) {
    if (!betId) {
      this.hud.note(null);
      this.rail.setPlaques(baseFactors());
      return;
    }
    this.noteTarget = null;
    this.rail.setPlaques(previewBet(this.state, betId) ?? baseFactors());
    // In the close-up the magnifier names the bet and its pay: no note over the felt.
    if (this.feltZoom) return;
    const anchor = this.screenPosition(this.table.spotWorldPosition(betId)) ?? { x: ev.clientX, y: ev.clientY };
    this.hud.note(betNote(this.state, betId), anchor);
  }

  // ---- Notes and keyboard focus -------------------------------------------

  /** The note for an object in the room, and where it is. */
  noteFor(target) {
    const s = this.state;
    switch (target.kind) {
      case 'talisman':
        return { spec: talismanNote(s, target.uid), world: this.rail.talismanWorldPosition(target.uid) };
      case 'tag':
        return { spec: talismanNote(s, target.uid, { tag: true }), world: this.rail.tagWorldPosition(target.uid) };
      case 'plaque':
        return { spec: plaqueNote(target.plaque), world: this.rail.plaqueWorldPosition(target.plaque) };
      case 'bell':
        return { spec: bellNote(s), world: this.bell.worldPosition() };
      case 'slot':
        return { spec: slotNote(s, target.slot), world: this.cabinet.slotWorldPosition(target.slot) };
      case 'crank':
        return { spec: crankNote(s), world: this.cabinet.crankWorldPosition() };
      case 'chart':
        return { spec: chartNote(s), world: this.cabinet.chartWorldPosition() };
      case 'bet':
        return { spec: betNote(s, target.betId), world: this.table.spotWorldPosition(target.betId) };
      case 'board':
        return { spec: boardNote(s), world: this.table.boardWorldPosition() };
      case 'chalkboard':
        return { spec: chalkboardNote(s), world: this.table.chalkboardWorldPosition() };
      case 'placard':
        return { spec: placardNote(s), world: this.table.placardWorldPosition() };
      case 'almanac':
        return { spec: { title: 'The Almanac', lines: ['What you have seen, the feats you have done, the figures in the dark and the ledger of every run.'], status: 'Click to open it.' }, world: this.table.almanacWorldPosition() };
      case 'devil':
        return { spec: devilNote(s), world: this.cage.devilWorldPosition() };
      case 'lever':
        return { spec: leverNote(s), world: this.oracle.leverWorldPosition() };
      case 'card':
        return { spec: cardNote(s, target.card), world: this.oracle.cardWorldPosition(target.card) };
      case 'gramophone':
        return { spec: gramophoneNote(s), world: this.oracle.gramophoneWorldPosition() };
      default:
        return null;
    }
  }

  showNote(target, ev) {
    this.noteTarget = target;
    // A focused bet shows its factors on the plaques, as hovering it does.
    this.rail.setPlaques(target.kind === 'bet' ? (previewBet(this.state, target.betId) ?? baseFactors()) : baseFactors());
    const { spec = null, world = null } = this.noteFor(target) ?? {};
    const anchor = this.screenPosition(world) ?? (ev ? { x: ev.clientX, y: ev.clientY } : null);
    this.hud.note(spec, anchor);
  }

  /** Pointer over (or off) a rail talisman, the Bell, a plaque or the Cabinet. */
  onHoverItem(target, ev) {
    if (this.busy) return;
    if (!target) {
      if (!this.focus) this.clearNote();
      return;
    }
    this.clearFocus();
    this.showNote(target, ev);
  }

  /** Values changed under an open note: rewrite it. */
  refreshNote() {
    if (!this.noteTarget) return;
    const { kind, uid } = this.noteTarget;
    if ((kind === 'talisman' || kind === 'tag') && !this.state.rail.some((t) => t.uid === uid)) {
      this.clearNote();
      return;
    }
    this.showNote(this.noteTarget);
  }

  clearNote() {
    this.noteTarget = null;
    this.hud.note(null);
  }

  /** What Tab walks through at each station (doc 9.10: hover must be reachable by focus). */
  focusables() {
    if (this.view === 'table') {
      // The spots holding chips first, then the outside bets: what a bet pays
      // with the rail as it is must be reachable without a mouse (doc 8.4).
      const held = [...new Set(Object.values(this.state.placements))];
      const bets = [...held, ...FOCUS_BETS.filter((b) => !held.includes(b))];
      return [
        ...this.state.rail.map((t) => ({ kind: 'talisman', uid: t.uid })),
        { kind: 'bell' },
        { kind: 'plaque', plaque: 'stake' },
        { kind: 'plaque', plaque: 'odds' },
        { kind: 'board' },
        { kind: 'chalkboard' },
        { kind: 'placard' },
        ...bets.map((betId) => ({ kind: 'bet', betId })),
      ];
    }
    if (this.view === 'cabinet') {
      return [...this.state.cabinet.slots.map((_, slot) => ({ kind: 'slot', slot })), { kind: 'crank' }, { kind: 'chart' }];
    }
    if (this.view === 'cage' && luckView(this.state).devil.live) return [{ kind: 'devil' }];
    if (this.view === 'oracle') {
      const deal = oracleView(this.state);
      const cards = deal.taken === null ? deal.cards.map((c) => ({ kind: 'card', card: c.index })) : [];
      return [{ kind: 'lever' }, ...cards, { kind: 'gramophone' }];
    }
    return [];
  }

  focusStep(dir) {
    if (this.busy) return;
    const list = this.focusables();
    if (!list.length) return;
    const at = this.focus?.view === this.view ? list.findIndex((t) => focusKey(t) === this.focus.key) : -1;
    const i = at >= 0 ? at : dir > 0 ? -1 : list.length;
    const index = (i + dir + list.length) % list.length;
    this.setFocus({ view: this.view, key: focusKey(list[index]) });
  }

  setFocus(focus) {
    this.lower();
    this.focus = focus;
    const target = this.focusedTarget();
    if (!target) {
      this.focus = null;
      return;
    }
    if (target.kind === 'talisman') {
      this.rail.lift(target.uid, true);
      this.lifted = target.uid;
    }
    this.showNote(target);
  }

  clearFocus() {
    this.lower();
    if (!this.focus) return;
    this.focus = null;
    this.rail.setPlaques(baseFactors());
  }

  /** Lower the talisman keyboard focus raised, wherever focus has gone since. */
  lower() {
    if (this.lifted) this.rail.lift(this.lifted, false);
    this.lifted = null;
  }

  /**
   * Focus is held by identity, not by position: the list reorders as chips
   * are placed and talismans leave, and Enter must act on what the note shows.
   */
  focusedTarget() {
    if (!this.focus || this.focus.view !== this.view) return null;
    return this.focusables().find((t) => focusKey(t) === this.focus.key) ?? null;
  }

  /** Enter: buy, ring, restock or open what has focus. */
  activate() {
    const target = this.focusedTarget();
    if (!target) return false;
    if (target.kind === 'talisman') this.openTalisman(target.uid);
    else if (target.kind === 'bell') this.ringBell();
    else if (target.kind === 'slot') this.buy(target.slot);
    else if (target.kind === 'crank') this.restock();
    else if (target.kind === 'bet') this.onClickBet(target.betId);
    else if (target.kind === 'lever') this.pullLever();
    else if (target.kind === 'card') this.takeFortune(target.card);
    else if (target.kind === 'gramophone') this.openCrate();
    else if (target.kind === 'chalkboard') this.openChalkboard();
    else if (target.kind === 'placard') this.openPlacard();
    return true;
  }

  /** [ and ]: move the focused talisman one hook along. */
  moveFocused(dir) {
    const target = this.focusedTarget();
    if (target?.kind !== 'talisman') {
      if (this.view === 'table' && this.state.rail.length > 1) this.hud.toast('Tab to a talisman first, then [ or ] moves it.');
      return;
    }
    const from = this.state.rail.findIndex((t) => t.uid === target.uid);
    const to = from + dir;
    if (to < 0 || to >= this.state.rail.length) return;
    if (this.moveTalisman(target.uid, to)) this.setFocus({ view: this.view, key: focusKey(target) });
  }

  sellFocused() {
    const target = this.focusedTarget();
    if (target?.kind === 'talisman') this.confirmSell(target.uid);
  }

  // ---- Nights ---------------------------------------------------------------

  choosePackage(packageId) {
    if (this.busy || this.state.phase !== PHASE.ROUND_START) return;
    const events = this.dispatch({ type: 'choosePackage', packageId });
    if (!events) return;
    this.audio.card();
    const ev = events[0];
    if (ev.tokens) this.hud.toast(`+${plural(ev.tokens, 'token')}`);
    if (!isZero(ev.cost)) this.hud.strikeCoins();
    this.hud.setCoins(this.state.coins, { animate: true });
    this.syncAll();
  }

  /** 1–3: a night card at the table, a compartment at the Cabinet. */
  chooseByIndex(i) {
    if (this.view === 'cabinet') this.buy(i);
    else if (this.view === 'oracle') this.takeFortune(i);
    else this.choosePackage(PACKAGE_KEYS[i]);
  }

  bank(amount) {
    if (this.busy || !gt(amount, 0)) return;
    if (this.dispatch({ type: 'deposit', amount })) {
      this.audio.bank();
      this.hud.strikeCoins();
      this.hud.setCoins(this.state.coins, { animate: true });
      this.hud.toast(`Banked ${format(amount)}`);
      this.syncStatus();
      // The crank's tag shows whether a restock is affordable.
      this.syncItems();
      if (this.state.phase === PHASE.ROUND_START) this.table.showPackages(this.state);
    }
  }

  bankAll() {
    this.bank(this.state.coins);
  }

  bankKeep() {
    const keep = this.keepAmount();
    if (keep !== null) this.bank(sub(this.state.coins, keep));
  }

  requestEndNight() {
    const s = this.state;
    if (this.busy || s.phase !== PHASE.NIGHT_OVER) return;
    if (isFinalNight(s) && !gte(s.deposited, owed(s))) {
      const due = owed(s);
      const couldCover = gte(add(s.deposited, s.coins), due);
      if (couldCover) {
        showModal({
          kicker: 'The Cage',
          title: 'Collects tonight',
          lines: [`You owe <b>${format(due)}</b> and have banked <b>${format(s.deposited)}</b>. You still hold <b>${format(s.coins)}</b> coins.`],
          actions: [
            { label: 'Not yet' },
            { label: 'End anyway', danger: true, onClick: () => this.endNight() },
            {
              label: 'Bank all and end',
              primary: true,
              onClick: () => {
                this.bank(this.state.coins);
                this.endNight();
              },
            },
          ],
        });
      } else {
        showModal({
          kicker: 'The Cage',
          title: 'You cannot cover the debt',
          lines: [`You owe <b>${format(due)}</b>. Even with every coin you hold, you are <b>${format(sub(due, add(s.deposited, s.coins)))}</b> short.`],
          actions: [{ label: 'Not yet' }, { label: 'End the night', primary: true, onClick: () => this.endNight() }],
        });
      }
      return;
    }
    this.endNight();
  }

  endNight() {
    const events = this.dispatch({ type: 'endNight' });
    if (!events) return;
    this.table.hideEndCard();
    const interest = events.find((e) => e.type === 'interest');
    const tokens = events.filter((e) => e.type === 'tokens' || (e.type === 'trigger' && e.effect === 'tokens')).reduce((n, e) => n + e.amount, 0);
    const paidLines = [];
    if (interest && gt(interest.amount, 0)) paidLines.push(`Interest: +${format(interest.amount)} banked`);
    if (tokens) paidLines.push(`+${plural(tokens, 'token')}`);
    const gone = this.announceGone(events);
    if (gone) paidLines.push(gone);
    if (paidLines.length) this.hud.toast(paidLines.join(' · '), gone ? 3200 : 2200);
    this.audio.buy();
    const collected = events.find((e) => e.type === 'collected');
    if (collected) {
      this.gameOver();
      return;
    }
    const paid = events.find((e) => e.type === 'debtPaid');
    this.syncAll();
    this.turnTo('table');
    if (paid) {
      this.audio.debtPaid();
      this.table.hidePackages();
      // What the payment opened (dispatch kept it in the profile): a chip set,
      // a lock of the Vault, a House Edge level. At the goal the Cage would
      // let the player go (doc 7.1).
      const opened = this.newsLines(this.news ?? []);
      const goal = events.find((e) => e.type === 'goalReached');
      const goalLines = goal ? ['This was your goal. The Cage would let you go: <b>step out of the light</b> and the run is won. Or play on, as far as the debts let you.'] : [];
      const card = () => showModal({
        className: 'paid',
        kicker: 'The Cage',
        title: `Debt ${paid.debt}`,
        struck: true,
        after: 'paid',
        lines: [`The Cage takes its <b>${format(paid.owed)}</b>. Debt ${paid.debt + 1} is <b>${format(owed(this.state))}</b>.`, ...opened, ...goalLines],
        ledger: [
          ['Left in the Cage', format(paid.surplus)],
          [paid.satOut ? `Tokens (${plural(paid.satOut, 'night')} sat out)` : 'Tokens', `+${paid.rewardTokens}`, 'tok'],
          ['Coins for the next nights', `+${format(paid.rewardCoins)}`],
          ...(events.some((e) => e.type === 'chargesRefilled') ? [['Bell charges', 'refilled']] : []),
          // The toast for a talisman used up at dawn is hidden under this modal.
          ...events.filter((e) => e.type === 'talismanDestroyed').map((e) => [getTalisman(e.id)?.name ?? e.id, e.reason]),
          ...events.filter((e) => e.type === 'talismanRevived').map((e) => [getTalisman(e.id)?.name ?? e.id, 'came back']),
        ],
        actions: goal
          ? [
              { label: 'Step out of the light', primary: true, onClick: () => this.stepOut() },
              { label: 'Keep playing', onClick: () => this.syncAll() },
            ]
          : [{ label: 'Continue', primary: true, onClick: () => this.syncAll() }],
      });
      if (events.some((e) => e.type === 'vaultOpened')) this.showVault(card);
      else card();
      this.syncRoom();
      this.hud.setCoins(this.state.coins, { animate: true });
    } else {
      this.audio.card();
    }
  }

  /** What the profile's news says, as lines for the debt-paid card. */
  newsLines(news) {
    const lines = [];
    for (const n of news) {
      if (n.kind === 'chips') lines.push(`<b>${escapeHtml(getMaterial(n.id).name)} chips</b> are unlocked. Choose them on the main menu for a new run.`);
      else if (n.kind === 'lock') {
        const wheels = n.wheels.map((id) => `the ${getStartingWheel(id).name} wheel`).join(' and ');
        lines.push(`<b>Lock ${n.lock} of the Vault</b> falls open: ${wheels} can be chosen for a new run${n.slot ? ', and the gramophone takes a second record' : ''}. A new run’s goal is debt ${4 + n.lock}.`);
        if (n.content?.length) lines.push(`From the next run, the House also offers ${escapeHtml(listOf(n.content.map((id) => contentName(id))))}.`);
      } else if (n.kind === 'edge') lines.push(`<b>House Edge ${n.level}</b> is open for a new run: ${escapeHtml(edgeChoices(this.profile)[n.level].name.toLowerCase())}.`);
    }
    return lines;
  }

  /** The Vault opens (doc 7.1): the ending, for now a card, and the House lets you play on. */
  showVault(then) {
    this.audio.debtPaid();
    showModal({
      className: 'paid',
      kicker: 'The Vault',
      title: 'The Vault opens',
      lines: [
        'The fourth padlock drops. Behind the iron door there is no gold: a small room, one chair, and a wheel no bigger than a plate, still turning.',
        'On the wall, in her hand: <b>ZERO IS NOT EMPTY. SHE WAS A PLAYER ONCE.</b>',
        'The House will let you play on now, for as long as the debts let you.',
      ],
      actions: [{ label: 'Continue', primary: true, onClick: () => then?.() }],
    });
  }

  /** Past the goal: the run is won and ends, and no figure is left in the dark (doc 7.1). */
  stepOut() {
    if (this.busy || this.menuClose) return;
    const events = this.dispatch({ type: 'leave' });
    if (!events) return;
    this.recordEnd('left');
    this.busy = true;
    this.setLocked(true);
    this.syncAll();
    this.showLeft();
  }

  showLeft() {
    const s = this.state;
    showModal({
      className: 'paid',
      kicker: 'The Cage',
      title: 'You step out of the light',
      lines: [`Debt ${s.outcome.debtsPaid} paid, and the Cage lets you go. No figure of yours joins the others in the dark.`],
      ledger: [
        ['Debts paid', String(s.stats.debtsPaid)],
        ['Wheel', `${getStartingWheel(s.wheelId).name}${s.edge ? `, House Edge ${s.edge}` : ''}`],
        ['Best spin', format(s.stats.bestSpin)],
        ['Rail', s.rail.length ? s.rail.map((t) => getTalisman(t.id)?.name ?? t.id).join(', ') : 'bare'],
        ['Seed', s.seed, 'seed'],
      ],
      actions: [
        {
          label: 'Begin again',
          primary: true,
          onClick: () => {
            this.showMainMenu();
            this.openChipSelect();
          },
        },
      ],
    });
  }

  gameOver() {
    // The run leaves its figure in the dark (doc 7.3).
    this.recordEnd('collected');
    this.busy = true;
    this.setLocked(true);
    this.syncAll();
    this.audio.collected();
    this.power = 0.12;
    this.turnTo('table');
    const id = this.runId;
    setTimeout(() => id === this.runId && this.showCollected(), 1800);
  }

  showCollected() {
    const s = this.state;
    const o = s.outcome;
    showModal({
      className: 'collected',
      kicker: 'The House',
      title: 'Collected',
      lines: [`You owed <b>${format(o.owed)}</b> and had <b>${format(o.deposited)}</b> in the Cage. The House took the rest.`, 'You join the figures in the dark.'],
      ledger: [
        ['Debts paid', String(s.stats.debtsPaid)],
        ['Spins', String(s.stats.spins)],
        ['Best spin', format(s.stats.bestSpin)],
        ['Rail', s.rail.length ? s.rail.map((t) => getTalisman(t.id)?.name ?? t.id).join(', ') : 'bare'],
        ['Seed', s.seed, 'seed'],
      ],
      // A new run begins at the chip select: a set may have opened this run.
      actions: [
        {
          label: 'Begin again',
          primary: true,
          onClick: () => {
            this.showMainMenu();
            this.openChipSelect();
          },
        },
      ],
    });
  }

  // ---- Madame Zero and the gramophone -----------------------------------------

  /** Her lever: three cards, the first pull of a debt free, each one after for coins. */
  pullLever() {
    if (this.busy || this.menuClose) return;
    if (this.view !== 'oracle') {
      this.hud.toast('Turn to Madame Zero to pull her lever.');
      return;
    }
    const events = this.dispatch({ type: 'pullLever' });
    if (!events) {
      this.oracle.deny({ kind: 'lever' });
      return;
    }
    const dealt = events.find((e) => e.type === 'fortunesDealt');
    this.audio.crank();
    this.oracle.pullAnim();
    if (!isZero(dealt.cost)) {
      this.hud.strikeCoins();
      this.hud.setCoins(this.state.coins, { animate: true });
    }
    // Her voice is always subtitled (doc 8.6).
    const line = dealt.rerolls > 0 ? '“Again, then.”' : dealt.kind === 'black' ? '“The Devil came by tonight. My cards are darker.”' : '“Three cards. Take one, only one.”';
    this.hud.toast(line, 2400);
    this.clearNote();
    this.syncAll();
    const id = this.runId;
    setTimeout(() => id === this.runId && this.audio.card(), 300);
  }

  /** Takes card `i` of her deal: it comes true now, and she is done for the debt. */
  takeFortune(i) {
    if (this.busy || this.menuClose) return;
    const deal = oracleView(this.state);
    if (!deal.dealt || !deal.cards[i]) return;
    const coinsBefore = this.state.coins;
    const events = this.dispatch({ type: 'takeFortune', index: i });
    if (!events) {
      this.oracle.deny({ kind: 'card', card: i });
      return;
    }
    const taken = events.find((e) => e.type === 'fortuneTaken');
    const def = getFortune(taken.id);
    this.audio.card();
    this.oracle.takeAnim(i);
    this.clearNote();
    this.hud.toast(`“${def.text}”`, 2200);
    const summary = this.fortuneSummary(events);
    this.syncAll();
    // A level card: the placard on the table flashes as its odds go up.
    if (events.some((e) => e.type === 'betLevel')) this.table.pulsePlacard();
    for (const e of events) {
      if (e.type !== 'fortuneEffect') continue;
      if (e.effect === 'setCoins') {
        // Coins burnt are struck through; coins doubled just count up.
        if (gt(coinsBefore, this.state.coins)) this.hud.strikeCoins();
        this.hud.setCoins(this.state.coins, { animate: true });
      }
      if (e.uid) this.rail.pulse(e.uid, 0.8);
      for (const uid of e.uids ?? []) this.rail.pulse(uid, 0.8);
    }
    this.playRecordEvents(events, { quiet: true });
    if (!summary) return;
    const id = this.runId;
    setTimeout(() => id === this.runId && this.hud.toast(summary, 2800), 2200);
  }

  /** What a taken card did, in a line. */
  fortuneSummary(events) {
    const parts = [];
    for (const e of events) {
      if (e.type !== 'fortuneEffect') continue;
      if (e.effect === 'tokens') parts.push(`+${plural(e.amount, 'token')}`);
      else if (e.effect === 'setTokens') parts.push(`tokens: ${e.amount}`);
      else if (e.effect === 'setCoins') parts.push(`coins in hand: ${format(e.amount)}`);
      else if (e.effect === 'recharged') parts.push(e.uids.length ? 'the Bell talismans are recharged' : 'nothing needed recharging');
      else if (e.effect === 'discount') parts.push(`talismans ${plural(e.amount, 'token')} cheaper until the next restock`);
      else if (e.effect === 'freeBuys') parts.push(`the next ${e.amount} talismans are free`);
      else if (e.effect === 'widen') parts.push(`${plural(e.count, 'pocket')} wider`);
      else if (e.effect === 'hook') parts.push('a new hook on the rail');
      else if (e.effect === 'record') parts.push(`${getRecord(e.record).name} for the gramophone`);
      else if (e.effect === 'engraved') parts.push(`${getTalisman(this.state.rail.find((t) => t.uid === e.uid)?.id)?.name ?? 'a talisman'} is engraved`);
      else if (e.effect === 'offersEngraved') parts.push('the Cabinet’s talismans are engraved');
      else if (e.effect === 'hung') parts.push(`${getTalisman(e.talisman).name} hangs on the rail`);
      else if (e.effect === 'levels') parts.push(`${LEVEL_GROUPS[e.kinds[0]] ?? BET_NAME[e.kinds[0]].toLowerCase()} go up a level`);
      else if (e.effect === 'soldAll') parts.push('the rail burns: every talisman sold for all it cost');
    }
    // Wheel work a card did (Gold finds gold, Feed the zero): the pockets it changed.
    const works = events.filter((e) => e.type === 'wheelWork');
    if (works.length) parts.push(workLine(works).slice(0, -1));
    if (!parts.length) return '';
    const text = parts.join('; ');
    return `${text[0].toUpperCase()}${text.slice(1)}.`;
  }

  /** The gramophone: the crate, with Play for each record and a way to lift the needle. */
  openCrate() {
    if (this.busy || this.menuClose) return;
    if (this.view !== 'oracle') return;
    this.clearNote();
    const g = gramophoneView(this.state);
    // Two slots once the Vault's second lock is open: a record goes on the
    // first free one, or in place of the first.
    const on = [g.playing, g.second].filter(Boolean);
    const lines = on.length ? on.map((r) => `<b>${escapeHtml(r.name)}</b> plays. ${escapeHtml(r.rule)}`) : ['Nothing plays. The hall hums.'];
    if (g.slots > 1) lines.push(`<i>The gramophone plays two records at once.</i>`);
    if (!g.crate.length) lines.push('<i>The crate is empty. Records come from Madame Zero’s cards and the Cabinet.</i>');
    for (const r of g.crate.filter((x) => !x.playing)) lines.push(`${escapeHtml(r.name)}: ${escapeHtml(r.rule)}`);
    const free = !g.playing ? 0 : g.slots > 1 && !g.second ? 1 : 0;
    const actions = [{ label: 'Leave it', primary: true }];
    for (const r of g.crate.filter((x) => !x.playing)) actions.push({ label: `Play ${r.name}`, onClick: () => this.playRecord(r.id, free) });
    if (g.playing) actions.push({ label: g.second ? `Lift ${g.playing.name}` : 'Lift the needle', onClick: () => this.playRecord(null, 0) });
    if (g.second) actions.push({ label: `Lift ${g.second.name}`, onClick: () => this.playRecord(null, 1) });
    showModal({ kicker: 'The gramophone', title: on.length ? on.map((r) => r.name).join(' & ') : 'Nothing plays', lines, actions });
  }

  playRecord(id, slot = 0) {
    if (this.busy || this.menuClose) return;
    const events = this.dispatch({ type: 'playRecord', id, slot });
    if (!events) return;
    this.syncAll();
    this.playRecordEvents(events);
  }

  /** A record went on or came off: the music follows (doc 5.10). */
  playRecordEvents(events, { quiet = false } = {}) {
    const played = events.findLast((e) => e.type === 'recordPlayed');
    if (!played || quiet) return;
    this.hud.toast(played.id ? `${getRecord(played.id).name} plays.` : 'The needle lifts. The hall hums.', 2000);
  }

  // On a touch screen her lever and cards open a card first (doc 9.10).

  offerLever() {
    if (this.busy || this.menuClose) return;
    const deal = oracleView(this.state);
    if (deal.taken !== null) {
      this.showNote({ kind: 'lever' });
      return;
    }
    this.clearNote();
    const spec = leverNote(this.state);
    showModal({
      kicker: 'Madame Zero',
      title: deal.dealt ? 'Deal again?' : 'Pull her lever?',
      lines: spec.lines.map(escapeHtml),
      actions: [
        { label: deal.dealt ? `Deal again · ${format(deal.rerollCost)} coins` : 'Pull · free', primary: true, onClick: () => this.pullLever() },
        { label: 'Not now' },
      ],
    });
  }

  offerCard(i) {
    if (this.busy || this.menuClose) return;
    const deal = oracleView(this.state);
    const card = deal.cards[i];
    if (!card) return;
    this.clearNote();
    const lines = [escapeHtml(card.effect)];
    if (card.lore) lines.push(`<i>On its back: ${escapeHtml(card.lore)}</i>`);
    if (!card.takeable) lines.push('<i>That fortune cannot come true now.</i>');
    const actions = card.takeable ? [{ label: 'Take it', primary: true, onClick: () => this.takeFortune(i) }, { label: 'Not now' }] : [{ label: 'Not now', primary: true }];
    showModal({ kicker: `Madame Zero · ${card.kind} card · ${card.rarity}`, title: card.text, lines, actions });
  }

  // ---- The Curio Cabinet and the rail ----------------------------------------

  /** Buy from compartment `slot`. A full rail asks which talisman to sell. */
  buy(slot) {
    if (this.busy || this.menuClose) return;
    const s = this.state;
    const offer = cabinetView(s).slots[slot];
    if (!offer) return;
    // An oddity's work needs a place on the wheel: its card asks first.
    if (offer.kind === 'oddity') {
      this.offerSlot(slot);
      return;
    }
    if (offer.id && !offer.hookFree) {
      const best = Math.max(0, ...railView(s).map((v) => v.sellValue ?? 0));
      if (s.tokens + best >= offer.price) {
        this.askTradeIn(slot, offer);
        return;
      }
    }
    this.completeBuy(slot);
  }

  askTradeIn(slot, offer) {
    const rail = railView(this.state);
    showModal({
      kicker: 'Curio Cabinet',
      title: 'The rail is full',
      lines: [`Sell one to make room for <b>${escapeHtml(offer.name)}</b> (${plural(offer.price, 'token')}).`],
      actions: [
        { label: 'Keep looking', primary: true },
        ...rail
          // A cursed talisman will not come off its hook.
          .filter((v) => v.sellValue !== null && this.state.tokens + v.sellValue >= offer.price)
          .map((v) => ({ label: `${v.name} · +${v.sellValue}`, onClick: () => this.completeBuy(slot, v.uid) })),
      ],
    });
  }

  completeBuy(slot, sellUid) {
    const events = this.dispatch(sellUid ? { type: 'buy', slot, sellUid } : { type: 'buy', slot });
    if (!events) {
      this.cabinet.deny({ kind: 'slot', slot });
      return;
    }
    const bought = events.find((e) => e.type === 'bought');
    const sold = events.find((e) => e.type === 'sold');
    this.audio.buy();
    this.cabinet.pulse(slot);
    const name = getTalisman(bought.id).name;
    if (bought.instant) {
      // It never reaches the rail: it is opened on the spot.
      const coins = events.filter((e) => e.type === 'trigger' && e.effect === 'coins').reduce((t, e) => add(t, e.amount), 0);
      this.hud.toast(gt(coins, 0) ? `You open the ${name}: +${format(coins)} coins.` : `You open the ${name}. It is empty.`, 2600);
      this.hud.strikeCoins();
      this.hud.setCoins(this.state.coins, { animate: true });
      this.audio.coin(2);
      this.syncAll();
      return;
    }
    this.hud.toast(sold ? `${getTalisman(sold.id).name} sold. ${name} hangs on the rail.` : `${name} hangs on the rail.`, 2200);
    this.syncAll();
    // It swings when you next look at the rail.
    this.rail.pulse(bought.uid, 0.8);
  }

  restock() {
    if (this.busy || this.menuClose) return;
    // [R] is the handle in front of you: her lever, or the Cabinet's crank.
    if (this.view === 'oracle') {
      this.pullLever();
      return;
    }
    if (this.view !== 'cabinet') {
      this.hud.toast('Turn to the Cabinet to restock it.');
      return;
    }
    const events = this.dispatch({ type: 'restock' });
    if (!events) {
      this.cabinet.deny({ kind: 'crank' });
      return;
    }
    this.audio.crank();
    this.cabinet.restockAnim();
    this.hud.strikeCoins();
    this.hud.setCoins(this.state.coins, { animate: true });
    this.syncAll();
  }

  /** A click on a rail talisman: its card, with Sell and (for actives) Ring. */
  /** A talisman still on the rail (one just smashed may linger on screen a moment). */
  onRail(uid) {
    return this.state.rail.some((t) => t.uid === uid);
  }

  openTalisman(uid) {
    if (this.busy || this.menuClose || !this.onRail(uid)) return;
    const v = railView(this.state).find((x) => x.uid === uid);
    if (!v) return;
    this.clearNote();
    this.rail.lift(uid, true);
    const done = (fn) => () => {
      this.rail.lift(uid, false);
      fn?.();
    };
    const lines = [escapeHtml(v.text)];
    if (v.status) lines.push(`<i>${escapeHtml(v.status)}</i>`);
    if (v.cursed) lines.push('<i>Cursed. It will not come off the hook.</i>');
    const actions = [{ label: 'Keep', primary: true, onClick: done() }];
    if (v.active && v.usable) actions.push({ label: v.work ? 'Stamp pockets' : v.targetOnly ? 'Smash it' : 'Ring for it', onClick: done(() => this.ringBell(uid)) });
    // Order matters (doc 5.8): move it along the rail without a drag.
    if (this.state.rail.length > 1) {
      const step = (dir) => () => {
        const i = this.state.rail.findIndex((t) => t.uid === uid);
        if (i + dir < 0 || i + dir >= this.state.rail.length || !this.moveTalisman(uid, i + dir)) this.audio.deny();
      };
      actions.push({ label: '◀ Left', keepOpen: true, onClick: step(-1) }, { label: 'Right ▶', keepOpen: true, onClick: step(1) });
    }
    if (!v.cursed) actions.push({ label: `Sell · +${v.sellValue}`, danger: true, onClick: done(() => this.sell(uid)) });
    showModal({ kicker: `The rail · ${v.rarity}`, title: v.name, lines, actions });
  }

  // On a touch screen a stray tap must never buy, restock or ring (doc 9.10):
  // these open a card, and only its button acts.

  /** A compartment: its card, with Buy. */
  offerSlot(slot) {
    if (this.busy || this.menuClose) return;
    const v = cabinetView(this.state).slots[slot];
    if (!v?.id) {
      this.showNote({ kind: 'slot', slot });
      return;
    }
    if (v.kind === 'oddity') {
      this.offerOddity(slot, v);
      return;
    }
    this.clearNote();
    const spec = slotNote(this.state, slot);
    const lines = [escapeHtml(v.text)];
    if (spec.status) lines.push(`<i>${escapeHtml(spec.status)}</i>`);
    if (!v.affordable) lines.push(`<i>${escapeHtml(v.short)} short.</i>`);
    showModal({
      kicker: `Curio Cabinet · ${v.rarity}`,
      title: v.name,
      lines,
      actions: [
        { label: `Buy · ${plural(v.price, 'token')}`, primary: true, onClick: () => this.buy(slot) },
        { label: 'Not now' },
      ],
    });
  }

  /** The chalkboard's card: the wheel's chances in plain lines (doc 5.11). */
  openChalkboard() {
    if (this.busy || this.menuClose || this.picking) return;
    this.clearNote();
    const spec = chalkboardNote(this.state);
    showModal({ kicker: spec.status.replace(/\.$/, ''), title: 'The chalkboard', lines: spec.lines.map(escapeHtml), actions: [{ label: 'Done', primary: true }] });
  }

  /** The payout placard's card: what each kind of bet pays now (doc 5.11). */
  openPlacard() {
    if (this.busy || this.menuClose || this.picking) return;
    this.clearNote();
    const spec = placardNote(this.state);
    showModal({ kicker: spec.status.replace(/\.$/, ''), title: spec.title, lines: spec.lines.map(escapeHtml), actions: [{ label: 'Done', primary: true }] });
  }

  /** An oddity: its card, with Buy, which then asks where on the wheel its work goes. */
  offerOddity(slot, v) {
    this.clearNote();
    const lines = [escapeHtml(v.text)];
    if (v.record) lines.push(`<b>${escapeHtml(v.record.name)}</b>: ${escapeHtml(v.record.rule)}`);
    if (!v.workable) lines.push(v.chip ? '<i>Your pockets are full: six chips at most.</i>' : '<i>There is nowhere on the wheel it could work now.</i>');
    else if (!v.affordable) lines.push(`<i>${escapeHtml(format(v.short))} coins short.</i>`);
    else if (v.picks.length) lines.push(`<i>You choose ${v.picks[0].on === 'bet' ? 'the bet' : 'where it goes'} on the felt; it is paid for when its work is done.</i>`);
    const buy = () => {
      const now = cabinetView(this.state).slots[slot];
      if (!now?.affordable || !now.workable) {
        this.audio.deny();
        this.cabinet.deny({ kind: 'slot', slot });
        this.hud.toast(!now?.workable ? (now?.chip ? 'Your pockets are full.' : 'There is nowhere on the wheel it could work now.') : 'Not enough coins.', 1800, 'deny');
        return;
      }
      // A chip or a record needs no place on the wheel: it is bought from the card.
      if (!now.picks.length) {
        const events = this.dispatch({ type: 'buyOddity', slot, targets: [] });
        if (!events) return;
        this.audio.buy();
        this.cabinet.pulse(slot);
        this.oddityGot(events);
        this.syncAll();
        return;
      }
      this.beginWork({
        title: now.name,
        works: now.picks,
        done: (targets) => this.dispatch({ type: 'buyOddity', slot, targets }),
        after: () => {
          this.audio.buy();
          this.cabinet.pulse(slot);
        },
      });
    };
    showModal({
      kicker: `Curio Cabinet · oddity · ${v.rarity}`,
      title: v.name,
      lines,
      actions: [{ label: `Buy · ${format(v.price)} coins`, primary: true, onClick: buy }, { label: 'Not now' }],
    });
  }

  /** What a chip or a record oddity put in your hands, in a line. */
  oddityGot(events) {
    const chip = events.find((e) => e.type === 'chipGained');
    const record = events.find((e) => e.type === 'recordGained');
    if (chip) this.hud.toast(`A ${getMaterial(chip.material).name.toLowerCase()} chip joins your stack.`, 2400);
    if (record) {
      this.hud.toast(`${getRecord(record.record).name} goes in the crate${events.some((e) => e.type === 'recordPlayed') ? ', and on the gramophone' : ''}.`, 2600);
      this.playRecordEvents(events, { quiet: true });
    }
  }

  // ---- Wheel work (doc 5.4, 5.11): oddities and the Number Punches ------------

  /**
   * Choosing where wheel work goes: the felt close-up, with the numbers the
   * work can act on lit and a bar saying what to tap. `job`: { title, works
   * (its picks, in order), upTo (it may stop early: the Number Punches),
   * done(targets) (dispatches; returns the events or null), after(events) }.
   */
  beginWork(job) {
    if (this.busy || this.menuClose) return;
    this.clearNote();
    this.leaveFelt();
    this.clearFocus();
    this.picking = { ...job, chosen: [], stamp: null, from: this.view };
    this.view = 'table';
    this.hud.setView('table');
    this.feltZoom = true;
    this.hud.setZoomed(true);
    this.lighting.set('table');
    this.table.hidePackages();
    this.table.hideEndCard();
    this.director.goTo('felt', { duration: 0.6 });
    this.updateNav();
    this.showPick();
  }

  /** What the bar and the felt show for the next pick. */
  showPick() {
    const p = this.picking;
    const view = pickView(this.state, p.works, p.chosen);
    const stamping = view.work.op === 'stamp';
    const count = p.works.length;
    const step = count > 1 && !p.upTo ? ` (${p.chosen.length + 1} of ${count})` : p.upTo ? ` (${p.chosen.length} of ${count} so far)` : '';
    let valid;
    let prompt;
    if (view.bets) {
      // A level: every spot on the felt can take it, so nothing sinks into the dark.
      this.table.setPicking({ valid: [], chosen: [], all: true });
      this.hud.setPicking({ title: p.title, prompt: WORK_PROMPT.level(), actions: [{ label: 'Cancel', onClick: () => this.endWork() }], slim: true });
      return;
    }
    if (stamping && p.stamp) {
      const pocket = this.state.wheel.pockets.find((x) => x.id === p.stamp);
      valid = Array.from({ length: 37 }, (_, n) => n).filter((n) => n !== pocket.number);
      prompt = `Stamp it with which number?`;
    } else {
      valid = Array.from({ length: 37 }, (_, n) => n).filter((n) => (view.work.on === 'number' ? view.numbers[n] : view.numbers[n].length));
      prompt = `${WORK_PROMPT[view.work.op](view.work)}${step}`;
    }
    const chosenNumbers = p.chosen.map((t) => (typeof t === 'number' ? t : this.numberOfPocket(typeof t === 'object' ? t.pocket : t))).filter((n) => n !== null);
    this.table.setPicking({ valid, chosen: chosenNumbers });
    const actions = [{ label: 'Cancel', onClick: () => this.endWork() }];
    // Blank pockets have no number on the felt: a button stands for them.
    if (view.blanks.length && !(stamping && p.stamp)) actions.push({ label: 'A blank pocket', onClick: () => this.pickPocket(view.blanks[0].id) });
    if (p.upTo && p.chosen.length && !p.stamp) actions.push({ label: 'Done', primary: true, onClick: () => this.finishWork() });
    this.hud.setPicking({ title: p.title, prompt, actions });
  }

  numberOfPocket(id) {
    return this.state.wheel.pockets.find((x) => x.id === id)?.number ?? null;
  }

  /** A tap on the felt while choosing: the number under it. */
  pickBet(betId) {
    const p = this.picking;
    const bet = getBet(betId);
    if (pickView(this.state, p.works, p.chosen).bets) {
      p.chosen.push(bet.kind);
      this.afterPick();
      return;
    }
    if (bet.kind !== 'straight') {
      this.hud.toast('Tap a number.', 1400);
      return;
    }
    const n = bet.numbers[0];
    const view = pickView(this.state, p.works, p.chosen);
    if (view.work.op === 'stamp' && p.stamp) {
      if (this.numberOfPocket(p.stamp) === n) return this.denyPick(`It reads ${n} already.`);
      p.chosen.push({ pocket: p.stamp, number: n });
      p.stamp = null;
      this.afterPick();
      return;
    }
    if (view.work.on === 'number') {
      if (!view.numbers[n]) return this.denyPick(workRefusal(this.state, view.work, n) ?? 'Not there.');
      p.chosen.push(n);
      this.afterPick();
      return;
    }
    const options = view.numbers[n];
    if (!options.length) {
      const any = this.state.wheel.pockets.find((x) => x.number === n);
      return this.denyPick(any ? (workRefusal(this.state, view.work, view.work.op === 'stamp' ? { pocket: any.id, number: 0 } : any.id) ?? 'Not there.') : `No pocket reads ${n}.`);
    }
    // Pockets that look alike work alike: the first will do. Otherwise, which one?
    const looks = new Map(options.map((o) => [`${o.color}|${o.enh}|${o.width}`, o]));
    if (looks.size === 1) {
      this.pickPocket(options[0].id);
      return;
    }
    showModal({
      kicker: p.title,
      title: `Which ${n}?`,
      lines: [`${options.length} pockets read ${n}.`],
      actions: [...looks.values()].map((o) => ({ label: describePocket(o), onClick: () => this.pickPocket(o.id) })).concat({ label: 'Neither' }),
    });
  }

  denyPick(reason) {
    this.audio.deny();
    this.hud.toast(reason, 1600, 'deny');
  }

  pickPocket(id) {
    const p = this.picking;
    if (!p) return;
    const view = pickView(this.state, p.works, p.chosen);
    if (view.work.op === 'stamp') {
      p.stamp = id;
      this.audio.chip();
      this.showPick();
      return;
    }
    p.chosen.push(id);
    this.afterPick();
  }

  afterPick() {
    const p = this.picking;
    this.audio.chip();
    if (p.chosen.length >= p.works.length) this.finishWork();
    else this.showPick();
  }

  /** Every pick chosen (or Done): the work is done, paid for, and shown on the wheel. */
  finishWork() {
    const p = this.picking;
    const events = p.done(p.chosen);
    const from = p.from;
    this.cancelPick();
    if (!events) {
      this.returnTo(from);
      return;
    }
    p.after?.(events);
    this.syncAll();
    this.showWork(events, from);
  }

  /** Puts the work down: the bar goes, the felt lights again, the night cards stand back up. */
  cancelPick() {
    if (!this.picking) return;
    this.picking = null;
    this.hud.setPicking(null);
    this.table.setPicking(null);
    this.leaveFelt();
    this.syncAll();
  }

  /** Cancel: back to where the work was picked up. */
  endWork() {
    const from = this.picking?.from ?? 'table';
    this.cancelPick();
    this.returnTo(from);
  }

  returnTo(view) {
    this.view = view;
    this.hud.setView(view);
    this.lighting.set(view);
    this.director.goTo(view, { duration: 0.6 });
    this.updateHint();
    this.updateNav();
  }

  /**
   * The wheel, from above, while it takes the work: pockets swell, take their
   * gilt or paint, come and go. A line says what changed; then back.
   */
  showWork(events, from) {
    const works = events.filter((e) => e.type === 'wheelWork');
    // A level is shown on the payout placard, not the wheel.
    const level = events.find((e) => e.type === 'betLevel');
    if (level) {
      this.audio.work(true);
      this.table.pulsePlacard();
      this.hud.toast(`${BET_NAME[level.kind]} go up to level ${level.level}: they pay ${format(level.odds)} now.`, 2800);
    }
    if (!works.length) return this.returnTo(from);
    this.audio.work(works.some((e) => e.op === 'gild'));
    // The wheel's bulb comes up, as for a spin, so the work shows.
    if (this.lighting.set('spin')) this.audio.clunk();
    // From above you see yourself at the table, as in a spin.
    this.director.goTo('wide', { duration: 0.6 });
    this.hud.flavor([[workLine(works), 'bone']], 2200);
    const id = this.runId;
    clearTimeout(this.workTimer);
    this.workTimer = setTimeout(() => {
      if (id !== this.runId || this.busy || this.picking || this.director.current !== 'wide') return;
      this.returnTo(from);
    }, 2400);
  }

  /** The crank: a card, with Restock and its price. */
  offerRestock() {
    if (this.busy || this.menuClose) return;
    this.clearNote();
    const cost = cabinetView(this.state).restockCost;
    showModal({
      kicker: 'Curio Cabinet',
      title: 'Restock',
      lines: ['New talismans in every compartment.'],
      actions: [
        { label: isZero(cost) ? 'Restock · free' : `Restock · ${format(cost)} coins`, primary: true, onClick: () => this.restock() },
        { label: 'Not now' },
      ],
    });
  }

  /** The Bell: a card naming who would answer, with Ring. With no one to answer, it just rings dull. */
  offerRing() {
    if (this.busy || this.menuClose) return;
    const head = bellView(this.state).head;
    if (!head) {
      this.ringBell();
      return;
    }
    this.clearNote();
    const name = getTalisman(this.state.rail.find((t) => t.uid === head).id).name;
    showModal({
      kicker: 'The Bell',
      title: 'Ring the Bell?',
      lines: [`${escapeHtml(name)} answers it.`],
      actions: [{ label: 'Ring', primary: true, onClick: () => this.ringBell() }, { label: 'Not now' }],
    });
  }

  confirmSell(uid) {
    const v = railView(this.state).find((x) => x.uid === uid);
    if (!v || this.busy || this.menuClose) return;
    if (v.cursed) {
      this.audio.deny();
      this.rail.pulse(uid, 0.5);
      this.hud.toast(`${v.name} will not come off the hook.`, 1800, 'deny');
      return;
    }
    showModal({
      kicker: 'The rail',
      title: `Sell ${v.name}?`,
      lines: [`It goes back to the Cabinet for <b>${plural(v.sellValue, 'token')}</b>.`],
      actions: [
        { label: 'Keep it', primary: true },
        { label: `Sell · +${v.sellValue}`, danger: true, onClick: () => this.sell(uid) },
      ],
    });
  }

  sell(uid) {
    if (this.busy || !this.onRail(uid)) return;
    const events = this.dispatch({ type: 'sell', uid });
    if (!events) return;
    const sold = events.find((e) => e.type === 'sold');
    this.audio.sell();
    this.hud.toast(`${getTalisman(sold.id).name} sold for ${plural(sold.refund, 'token')}.`);
    this.clearFocus();
    this.syncAll();
  }

  moveTalisman(uid, to) {
    if (this.busy || !this.onRail(uid) || to >= this.state.rail.length) return false;
    const events = this.dispatch({ type: 'moveTalisman', uid, to });
    if (!events) return false;
    this.seen.add('moved');
    if (events.length) this.audio.chip();
    // Order can change the interest rate (Twin Mirrors copying a Pawn Ticket).
    this.syncAll();
    return true;
  }

  /**
   * The Bell: the next talisman in line, or the one whose tag was clicked. A
   * talisman that works on the wheel (the Number Punches) first asks where:
   * its ring carries the `targets` chosen on the felt.
   */
  ringBell(uid, targets) {
    if (this.busy || this.menuClose || (uid && !this.onRail(uid))) return;
    const v = uid ? railView(this.state).find((x) => x.uid === uid) : null;
    if (v?.work && !targets) {
      if (!v.usable) {
        this.bell.ring(false);
        this.audio.bell('dull');
        this.hud.toast('It does not answer.');
        return;
      }
      const works = Array.from({ length: v.work.picks }, () => v.work);
      this.beginWork({ title: v.name, works, upTo: true, done: (chosen) => this.ringBell(uid, chosen) });
      return;
    }
    const events = this.dispatch(uid ? { type: 'ringBell', uid, ...(targets ? { targets } : {}) } : { type: 'ringBell' });
    if (!events) {
      this.bell.ring(false);
      return null;
    }
    const rung = events.find((e) => e.type === 'bellRung');
    this.bell.ring(!!rung.uid);
    if (!rung.uid) {
      this.audio.bell('dull');
      this.hud.toast('Nothing answers.');
      return events;
    }
    this.audio.bell('ding');
    const name = getTalisman(rung.id).name;
    const smashed = events.find((e) => e.type === 'talismanDestroyed');
    const back = this.announceGone(events.filter((e) => e.type === 'talismanRevived'));
    if (back) this.hud.toast(back, 2600);
    for (const e of events) {
      if (e.type === 'trigger') this.rail.pulse(e.src.uid);
      if (e.type === 'trigger' && e.effect === 'armed') this.hud.toast(`${name} is armed: if the next spin pays nothing, the ball is thrown again.`, 2600);
      if (e.type === 'trigger' && e.effect === 'data' && e.key === 'armed' && e.amount === true) {
        const status = railView(this.state).find((v) => v.uid === rung.uid)?.status;
        if (status) this.hud.toast(`${name} is ${status}.`, 2600);
      }
      if (e.type === 'trigger' && e.effect === 'coins') {
        const p = this.screenPosition(this.rail.talismanWorldPosition(e.src.uid));
        if (p) this.hud.popup(`+${format(e.amount)}`, p.x, p.y);
        this.hud.strikeCoins();
      }
      if (e.type === 'foreseen') {
        this.audio.foresee();
        this.hud.flavor(
          [
            ['The eye sees ', 'dim'],
            ...(e.number === null
              ? [['a blank pocket', 'bone']]
              : [
                  [`${numberLabel(e.number)} `, e.color === 'red' ? 'blood' : e.color === 'green' ? 'green' : 'bone'],
                  [e.color, 'dim'],
                ]),
          ],
          2400,
        );
      }
    }
    if (smashed) {
      this.audio.smash();
      // The coins count, so the Cage and the night cards update now; the pig
      // shakes once before it leaves its hook.
      this.syncStatus();
      if (this.state.phase === PHASE.ROUND_START) this.table.showPackages(this.state);
      const id = this.runId;
      // The pig's hook empties: a Twin Mirrors may now copy something new.
      setTimeout(() => {
        if (id !== this.runId) return;
        this.syncItems();
        this.syncLuck();
        this.syncWheel();
      }, 450);
    } else {
      this.syncAll();
    }
    this.hud.setCoins(this.state.coins, { animate: true });
  }

  // ---- Spinning -------------------------------------------------------------

  /** From Space or a flung wheel. Returns true if a spin started. */
  requestSpin() {
    const s = this.state;
    if (this.busy || this.menuClose || this.ball.flying || this.picking) return false;
    if (s.phase === PHASE.ROUND_START) {
      this.hud.toast('Choose how to spend the night first.');
      return false;
    }
    if (s.phase !== PHASE.BETTING) {
      if (s.phase === PHASE.NIGHT_OVER) this.hud.toast('No spins left tonight.');
      return false;
    }
    if (chipsOnTable(s).length === 0) {
      this.audio.deny();
      this.hud.toast('Place a chip on the felt first.');
      return false;
    }
    this.spinSequence();
    return true;
  }

  get timeScale() {
    return this.busy && (this.settings.fast || this.fastHeld) ? 2.6 : 1;
  }

  async spinSequence() {
    this.busy = true;
    this.hideTip();
    this.setLocked(true);
    this.clearFocus();
    this.clearNote();
    // A Lean still waiting for its creak: this is the spin it falls on, so creak now.
    if (this.leanTimer) {
      clearTimeout(this.leanTimer);
      this.leanTimer = null;
      this.audio.lean();
    }
    const coinsBefore = this.state.coins;
    const events = this.dispatch({ type: 'spin' });
    if (!events) {
      this.busy = false;
      this.setLocked(false);
      return;
    }
    const { result } = events.find((e) => e.type === 'spin');
    // A new run (from the pause menu, or a reload) leaves this sequence behind.
    const id = this.runId;
    const stale = () => id !== this.runId;
    const detail = events.filter((e) => e.type !== 'spin');
    const fast = this.settings.fast;
    // A spin from the close-up: the wheel has to be in view.
    this.leaveFelt();
    this.syncSpins();
    this.updateHint();
    this.updateNav();
    this.hud.setMode('spin');
    this.hud.flavor(
      [
        ['Rien ne va ', 'bone'],
        ['plus.', 'blood'],
      ],
      1300,
    );
    // Carousel (doc 6.3): the wheel turns backwards while it plays.
    this.spin.boost(3.4, gramophoneView(this.state).reverse ? -1 : 0);
    this.hud.setView('table');
    if (!fast) {
      this.view = 'table';
      this.director.goTo('wide', { duration: 1.0 });
    } else if (this.director.current !== 'table') {
      // Fast spins skip the wide shot, so they must be watched from the
      // table: from a station, the close-up, or wheel work seen from above.
      this.view = 'table';
      this.director.goTo('table', { duration: 0.4 });
    }

    // The wheel's bulb comes on hard for the spin; the table lamp sinks.
    this.lighting.setLean(false);
    if (this.lighting.set('spin')) this.audio.clunk();
    const colorTone = (c) => (c === 'red' ? 'blood' : c === 'green' ? 'green' : 'bone');
    // Salt Cellar and Evil Eye keep watch on every throw once the Devil is live;
    // the Brass Scales lean on the wheel as it turns.
    for (const e of detail) if (e.type === 'trigger' && (e.hook === 'devilChance' || e.hook === 'widths' || e.hook === 'balls')) this.rail.pulse(e.src.uid, 0.45);
    // Multi-ball (doc 6.1): say how many balls fly.
    if (result.balls.length > 1) this.hud.flavor([[`${['', '', 'Two', 'Three'][result.balls.length] ?? result.balls.length} balls.`, 'bone']], 1200);
    // What each throw shows after its hops: anchors that held the ball, then
    // wards. On a re-throw, the first throw's are flagged `first`.
    const first = result.firstThrow?.[0];
    const ofThrow = (type, isFirst) => detail.filter((e) => (type === 'anchor' ? e.type === 'trigger' && e.effect === 'anchor' : e.type === type) && (!first || e.first === isFirst));
    const afterHops = async (isFirst) => {
      // The Black Cat's crossing: shown once, as the first ball settles.
      if (result.luck.blocked && (isFirst || !first)) this.showCrossing(detail);
      const holds = ofThrow('anchor', isFirst);
      if (holds.length) {
        await this.playHolds(holds, fast);
        if (stale()) return false;
      }
      for (const ward of ofThrow('devilWarded', isFirst)) {
        await this.playWard(ward, fast);
        if (stale()) return false;
      }
      return true;
    };

    // An armed Wheel of Fortune: the first throw paid nothing, so the ball
    // jumps out and goes round again.
    if (first) {
      await this.launchBalls(result.firstThrow, result.firstHops);
      if (stale()) return;
      this.audio.settle();
      if (result.firstHops.length) {
        await this.playHops(result.firstHops, result.luck, detail, fast);
        if (stale()) return;
      }
      if (!(await afterHops(true))) return;
      this.table.flashResult(first.number);
      this.hud.flavor(
        [
          [first.number === null ? (first.color === 'green' ? 'The House’s pocket ' : 'A blank ') : `${numberLabel(first.number)} `, colorTone(first.color)],
          // Nudge can move the ball off the foreseen pocket.
          [result.foreseen && !result.firstHops.length ? 'as foreseen, pays nothing...' : 'pays nothing...', 'dim'],
        ],
        1100,
      );
      await wait(fast ? 0.25 : 0.7);
      if (stale()) return;
      const by = detail.find((e) => e.type === 'rethrow')?.by;
      if (by) this.rail.pulse(by, 1.2);
      this.bell.ring(true);
      this.audio.bell('ding');
      this.audio.rethrow();
      this.hud.flavor([['Again.', 'blood']], 900);
      await this.launchBalls(result.balls, result.hops, { short: true });
      if (stale()) return;
    } else {
      await this.launchBalls(result.balls, result.hops);
      if (stale()) return;
    }

    this.audio.settle();
    if (result.hops.length) {
      // On a re-throw they shake once: for the first throw's hops if it had any.
      await this.playHops(result.hops, result.luck, first && result.firstHops.length ? [] : detail, fast);
      if (stale()) return;
    }
    this.table.setMarks({ foreseen: null });
    this.table.updateMarquee(this.state.history);
    if (!(await afterHops(false))) return;
    if (result.devil) {
      await this.playDevil(result, fast);
      if (stale()) return;
    } else {
      this.table.flashResult(result.number);
      this.hud.flavor(
        [
          // A blank pocket has no number and no colour: nothing wins there.
          [result.number === null ? (result.color === 'green' ? 'The House’s pocket. ' : 'Blank. ') : `${numberLabel(result.number)} `, colorTone(result.color)],
          // After a re-throw the Eye's landing was thrown away: this one was not foreseen.
          [result.number === null ? 'Nothing wins there.' : result.foreseen && !first && !result.hops.length ? `${result.color}, as foreseen` : result.color, 'dim'],
        ],
        1300,
      );
      await wait(fast ? 0.2 : 0.6);
      if (stale()) return;
    }
    // Attention returns to the felt; the wheel fades back into the dark slowly.
    this.lighting.set('table');
    if (!fast) {
      await this.director.goTo('table', { duration: 0.8 });
      if (stale()) return;
    }

    if (!result.miss) this.hud.strikeCoins();
    await playPayout(
      { table: this.table, rail: this.rail, hud: this.hud, audio: this.audio, screenPosition: (w) => this.screenPosition(w) },
      detail,
      { fast, coinsBefore: result.devil ? 0 : coinsBefore, alive: () => !stale() },
    );
    if (stale()) return;
    this.hud.setMode('play');
    if (result.devil) {
      this.hud.showPayout(gt(result.lost, 0) ? `−${format(result.lost)}` : 'nothing', 'miss');
    } else if (result.miss) {
      this.audio.miss();
      this.hud.showPayout(gt(result.total, 0) ? `+${format(result.total)}` : 'nothing', 'miss');
    } else {
      // A win worth half the hand or more gets the bigger swipe.
      this.hud.showPayout(`+${format(result.total)}`, gte(add(result.total, result.total), coinsBefore) ? 'big' : 'win');
    }
    this.hud.setCoins(this.state.coins, { animate: !isBig(this.state.coins) });
    const gone = this.announceGone(detail);
    // A Glass pocket that broke under the ball (doc 6.5).
    const shattered = detail.find((e) => e.type === 'pocketShattered');
    if (shattered) this.audio.shatter();
    // "Hot hands." kept a streak through this miss (doc 6.8).
    const held = detail.some((e) => e.type === 'trigger' && e.src?.id === 'hot_hands') && 'Hot hands: the streak holds.';
    const said = [shattered && `The glass pocket shatters: ${shattered.number} is a blank now.`, gone, held].filter(Boolean).join(' ');
    if (said) this.hud.toast(said, 2800);

    this.busy = false;
    this.setLocked(false);
    if (this.state.phase === PHASE.NIGHT_OVER) this.audio.nightBell();
    this.justSpun = true;
    this.syncAll();
    this.justSpun = false;
  }

  /**
   * Nudge on screen (doc 5.6, 8.3): the ball creeps pocket to pocket, a spark
   * and a tick on each hop, warm for a Lean, cold for pity, brass for a
   * talisman's own luck. The talismans that lent Nudge shake as it starts.
   */
  /**
   * Throws every ball of a spin together (multi-ball, doc 6.1): each to where
   * it comes to rest before Nudge moves it. The ivory balls appear for a
   * spin that throws them and go when one throws fewer. Resolves when all
   * have settled.
   */
  launchBalls(balls, hops, opts = {}) {
    const restsAt = (ball, pocketIndex) => hops.find((h) => h.ball === ball)?.from ?? pocketIndex;
    const throws = [this.ball.launch(restsAt(0, balls[0].pocketIndex), opts)];
    const n = this.state.wheel.pockets.length;
    (this.extraBalls ?? []).forEach((extra, i) => {
      const b = balls[i + 1];
      if (!b) {
        extra.ball.visible = false;
        return;
      }
      // A new ball starts a few pockets along, so the balls never ride as one.
      if (!extra.ball.visible) extra.restAt((this.ball.pocket + 7 * (i + 1)) % n);
      extra.ball.visible = true;
      throws.push(extra.launch(restsAt(b.ball, b.pocketIndex), opts));
    });
    return Promise.all(throws);
  }

  /** The ivory balls leave the wheel (a new run, a reload). */
  hideExtraBalls() {
    for (const extra of this.extraBalls ?? []) extra.ball.visible = false;
  }

  async playHops(hops, luck, detail, fast) {
    const id = this.runId;
    for (const e of detail) if (e.type === 'trigger' && e.hook === 'nudge') this.rail.pulse(e.src.uid, 0.9);
    if (luck.kind === 'pity') this.hud.flavor([['Pity.', 'dim']], 900);
    else if (luck.kind === 'lean') this.hud.flavor([['The House leans.', 'bone']], 900);
    await wait(fast ? 0.08 : 0.3);
    let step = 0;
    for (const hop of hops) {
      if (id !== this.runId) return;
      const anim = hop.ball ? (this.extraBalls?.[hop.ball - 1] ?? this.ball) : this.ball;
      await anim.hop(hop.path, {
        time: fast ? 0.08 : 0.13,
        onHop: () => {
          this.sparks.burst(anim.ball.getWorldPosition(this._ballAt), luck.kind);
          this.audio.hop(luck.kind, step);
          step += 1;
        },
      });
    }
    await wait(fast ? 0.05 : 0.15);
  }

  /**
   * The Devil (doc 5.7): the number under the ball burns away to 666, the
   * bulb goes out and every coin in hand is lost. Deposits are safe.
   */
  /**
   * Holy Water turns the Devil away (doc 5.7): the 666 flares and fails, the
   * vial cracks with a clear note, and cold sparks rise off the ball.
   */
  async playWard(ward, fast) {
    this.audio.ward();
    this.rail.pulse(ward.src.uid, 1.4);
    this.cage.flareDevil();
    this.sparks.burst(this.ball.ball.getWorldPosition(this._ballAt), 'pity', { count: 40, speed: 2.4 });
    // A Twin Mirrors' copy goes dark; the vial it copied still hangs.
    const copy = ward.src.as !== ward.src.id;
    this.hud.flavor(
      [
        ['666 ', 'green'],
        [copy ? "turned away. The mirror's copy goes dark." : 'turned away. The vial shatters.', 'bone'],
      ],
      1800,
    );
    await wait(fast ? 0.5 : 1.3);
    // Its hook empties now, not after the payout.
    this.syncItems();
  }

  /** An anchor kept the ball from a better pocket (the Thirteen Ball on 13). */
  async playHolds(holds, fast) {
    for (const e of holds) this.rail.pulse(e.src.uid, 1);
    this.hud.flavor([[`${getTalisman(holds[0].src.as)?.name ?? 'It'} holds the ball on ${holds[0].amount}.`, 'dim']], 1000);
    await wait(fast ? 0.2 : 0.6);
  }

  /** The Black Cat crossed: this spin had no Nudge at all. */
  showCrossing(detail) {
    for (const e of detail) if (e.type === 'trigger' && e.effect === 'noNudge') this.rail.pulse(e.src.uid, 1);
    this.hud.flavor([['The Black Cat crosses your path: no Nudge.', 'dim']], 1100);
  }

  /** Talismans this action used up (a wilted clover, an empty purse): a line each. */
  announceGone(events) {
    const VERB = { crumbled: 'is empty. It crumbles.', wilted: 'wilts.', spent: 'is used up.' };
    const gone = events.filter((e) => e.type === 'talismanDestroyed' && VERB[e.reason]);
    // The Phoenix Feather brings one back instead (doc 6.8).
    const back = events.filter((e) => e.type === 'talismanRevived');
    if (!gone.length && !back.length) return null;
    this.audio.crumble();
    return [
      ...gone.map((e) => `${getTalisman(e.id)?.name ?? e.id} ${VERB[e.reason]}`),
      ...back.map((e) => `${getTalisman(e.id)?.name ?? e.id} burns, and the Phoenix Feather brings it back.`),
    ].join(' ');
  }

  async playDevil(result, fast) {
    // The 666 burns over the pocket and turns with it.
    this.sparks.burnAt(() => this.ball.ball.getWorldPosition(this._ballAt));
    this.lighting.blackout();
    this.audio.devil();
    this.cage.flareDevil();
    this.hud.flavor(
      [
        ['666. ', 'green'],
        [gt(result.lost, 0) ? 'The Devil takes every coin in hand.' : 'The Devil finds your hands empty.', 'dim'],
      ],
      2800,
    );
    if (gt(result.lost, 0)) {
      this.hud.strikeCoins();
      this.hud.setCoins(0, { animate: true });
    }
    await wait(fast ? 1.8 : 3.0);
  }

  screenPosition(world) {
    if (!world) return null;
    const v = this._screen.copy(world).project(this.stage.camera);
    if (v.z > 1) return null;
    const rect = this.stage.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  // ---- Menu and settings ------------------------------------------------------

  toggleFast() {
    this.settings.fast = !this.settings.fast;
    this.saveSettings();
    this.hud.toast(this.settings.fast ? 'Fast spins on' : 'Fast spins off');
  }

  /** Flashing lights (doc 8.7): off turns the Devil's blackout into a fade. */
  toggleFlashes() {
    this.settings.flashes = !this.settings.flashes;
    this.lighting.flashes = this.settings.flashes;
    this.sparks.flashes = this.settings.flashes;
    this.saveSettings();
    this.hud.toast(this.settings.flashes ? 'Flashing lights on' : 'Flashing lights off');
  }

  toggleMute() {
    const muted = this.audio.toggleMute();
    this.settings.muted = muted;
    this.saveSettings();
    this.hud.toast(muted ? 'Sound off' : 'Sound on');
  }

  saveSettings() {
    this.onSettingsChanged?.(this.settings);
  }

  toggleMenu() {
    if (this.menuClose) {
      this.menuClose();
      this.menuClose = null;
      return;
    }
    // Not while the ball flies or the Cage collects: abandoning then would
    // leave the old run's sequence playing into the new one.
    if (this.busy) return;
    const s = this.state;
    const close = showModal({
      className: 'pause',
      title: 'Paused',
      lines: [
        `Debt <b>${s.debt}</b>, night <b>${s.round}</b>. Seed <b>${s.seed}</b>.`,
        this.touch
          ? 'Swipe or tap the edge tabs to turn · tap SPIN or fling the wheel, hold SPIN to spin fast · tap anything to read it · tap a talisman to sell, ring or move it'
          : 'Space spins · A/D turn · 1/2/3 choose a night or buy · E ends the night · B rings the Bell · R restocks · Tab walks the rail · F fast spins · M sound',
      ],
      actions: [
        { label: 'Resume', primary: true, onClick: () => (this.menuClose = null) },
        // Settings and Info come back to this menu when they close.
        { label: 'Settings', onClick: () => ((this.menuClose = null), this.openSettings({ onDone: () => this.toggleMenu() })) },
        { label: 'Info', onClick: () => ((this.menuClose = null), this.openGuide({ onClose: () => this.toggleMenu() })) },
        { label: 'Almanac', onClick: () => ((this.menuClose = null), this.openAlmanac()) },
        // Past the goal the run can be won and ended here too (doc 7.1).
        ...(s.won ? [{ label: 'Step out of the light', onClick: () => ((this.menuClose = null), this.stepOut()) }] : []),
        // Giving up a run is Main menu, then Play: it asks first (doc 7.5).
        { label: 'Main menu', onClick: () => ((this.menuClose = null), this.showMainMenu()) },
      ],
    });
    this.menuClose = close;
  }

}
