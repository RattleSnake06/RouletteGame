import * as THREE from 'three';
import { getTalisman } from './core/content/index.js';
import { ECONOMY } from './core/economy.js';
import { add, format, gt, gte, isBig, isZero, sub } from './core/num.js';
import { baseFactors } from './core/payout.js';
import { randomSeed } from './core/rng.js';
import { PHASE, act, chipsOnTable, costOf, createRun, interestRate, isFinalNight, owed } from './core/run.js';
import { deserializeRun, serializeRun } from './core/save.js';
import { bellView, cabinetView, previewBet, railView } from './core/selectors.js';
import { playPayout } from './playback.js';
import { showModal } from './ui/hud.js';
import { bellNote, betNote, chartNote, crankNote, plaqueNote, slotNote, talismanNote } from './ui/notes.js';

// Glue between the rules (core/run.js) and the room. Every player action goes
// through dispatch(), which applies it to the run, saves, and returns the
// events the view plays back. The view never decides an outcome.

const PACKAGE_KEYS = ['long', 'short', 'sitout'];
// The stations, left to right as the player turns. Turning never wraps.
const VIEWS = ['cage', 'table', 'cabinet'];
const VIEW_NAMES = { cage: 'Cage', table: 'Table', cabinet: 'Cabinet' };
const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

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
    this.focus = null; // keyboard focus: { view, index }
    this.noteTarget = null; // the object whose note is up
    this._screen = new THREE.Vector3();
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
    if (seed && (!state || state.phase === PHASE.GAME_OVER)) state = createRun({ seed: seed.toUpperCase() });
    this.state = state ?? createRun({ seed: randomSeed() });
    this.save();
    this.syncAll();
    this.ball.restAt(this.state.lastSpin?.pocketIndex ?? 0);
    if (this.state.phase === PHASE.GAME_OVER) {
      this.power = 0.15;
      this.busy = true;
      setTimeout(() => this.showCollected(), 600);
    }
  }

  newRun() {
    this.state = createRun({ seed: randomSeed() });
    this.save();
    this.power = 1;
    this.busy = false;
    this.lighting.set('table');
    this.setLocked(false);
    this.syncAll();
    this.turnTo('table');
  }

  save() {
    this.platform.save('run', serializeRun(this.state));
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
    return events;
  }

  // ---- Syncing the room to the state ---------------------------------------

  syncAll() {
    const s = this.state;
    this.table.syncChips(s);
    this.table.updateMarquee(s.history);
    this.hud.setCoins(s.coins);
    this.syncItems();
    this.syncSpins();
    if (s.phase === PHASE.ROUND_START && !this.busy) this.table.showPackages(s);
    else this.table.hidePackages();
    if (s.phase === PHASE.NIGHT_OVER && !this.busy) this.table.showEndCard(this.endCardLine());
    else this.table.hideEndCard();
    this.syncStatus();
  }

  /** The rail, the Bell, the Cabinet, tokens and the Glass Eye's mark. */
  syncItems() {
    const s = this.state;
    this.rail.sync(railView(s));
    this.bell.sync(bellView(s));
    this.cabinet.sync(cabinetView(s));
    this.table.setMarks({ foreseen: s.foreseen ? s.wheel.pockets[s.foreseen.pocketIndex].number : null });
    this.hud.setTokens(s.tokens);
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
    this.hud.setDebt({ debt: s.debt, banked: s.deposited, owed: owed(s), round: s.round, rounds: ECONOMY.roundsPerDebt });
    const keep = this.keepAmount();
    this.cage.sync({
      owed: owed(s),
      deposited: s.deposited,
      coins: s.coins,
      canBank: gt(s.coins, 0) && s.phase !== PHASE.GAME_OVER,
      round: s.round,
      keep,
      canEnd: s.phase === PHASE.NIGHT_OVER,
      endLabel: s.phase === PHASE.NIGHT_OVER ? (isFinalNight(s) ? 'the Cage collects' : `interest + ${plural(ECONOMY.nightTokens, 'token')}`) : 'spin first',
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
    let hint = '';
    const offers = cabinetView(s).slots.filter((x) => x.id);
    if (this.busy) hint = '';
    else if (s.phase === PHASE.GAME_OVER) hint = '';
    else if (this.view === 'cage') hint = 'Banked coins count toward the debt. They cannot come back out.';
    else if (this.view === 'cabinet') hint = 'Click a compartment to buy, or press [1] [2] [3]. [R] turns the crank.';
    else if (s.phase === PHASE.ROUND_START && !this.seen.has('cabinet') && offers.some((x) => x.affordable)) {
      hint = 'Your tokens buy talismans at the Cabinet. [D] to look.';
    } else if (s.phase === PHASE.ROUND_START) hint = 'Choose how to spend the night: click a card, or press [1], [2] or [3].';
    else if (s.phase === PHASE.BETTING && chipsOnTable(s).length === 0) hint = 'Click the felt to place a chip.';
    else if (s.phase === PHASE.BETTING && s.rail.length > 1 && !this.seen.has('moved')) {
      hint = 'Drag talismans along the rail to reorder them. They act left to right.';
    } else if (s.phase === PHASE.BETTING && bellView(s).head) hint = 'Fling the wheel, or press [Space] to spin. [B] rings the Bell.';
    else if (s.phase === PHASE.BETTING) hint = 'Fling the wheel, or press [Space] to spin.';
    else if (s.phase === PHASE.NIGHT_OVER) hint = 'The night is over. Bank your coins at the Cage, then press [E] to end the night.';
    this.hud.setHint(hint);
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
    if (locked) this.clearNote();
  }

  // ---- Camera ---------------------------------------------------------------

  turnTo(view) {
    if (this.busy && view !== 'table') return;
    if (view === this.view && this.director.current === view) return;
    this.view = view;
    this.clearNote();
    this.hud.setView(view);
    // The Cabinet is a longer turn than the Cage.
    this.director.goTo(view, { duration: view === 'cabinet' || this.director.current === 'cabinet' ? 0.75 : 0.6 });
    if (!this.busy) this.lighting.set(view);
    if (view === 'cabinet') this.seen.add('cabinet');
    this.updateHint();
    this.updateNav();
  }

  turn(dir) {
    if (this.busy) return;
    const next = VIEWS[VIEWS.indexOf(this.view) + dir];
    if (next) this.turnTo(next);
  }

  // ---- Chips ----------------------------------------------------------------

  onClickBet(betId) {
    if (this.busy) return;
    const free = this.state.chips.find((c) => !this.state.placements[c.id]);
    if (!free) {
      this.hud.toast('All your chips are on the table. Drag one to move it.');
      return;
    }
    this.placeChip(free.id, betId);
  }

  placeChip(chipId, betId) {
    if (this.dispatch({ type: 'placeChip', chipId, betId })) {
      this.audio.chip();
      this.table.syncChips(this.state);
      this.updateHint();
    }
  }

  removeChip(chipId) {
    if (this.dispatch({ type: 'removeChip', chipId })) {
      this.audio.chip();
      this.table.syncChips(this.state);
      this.updateHint();
    }
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
    const anchor = this.screenPosition(this.table.spotWorldPosition(betId)) ?? { x: ev.clientX, y: ev.clientY };
    this.hud.note(betNote(this.state, betId), anchor);
    this.rail.setPlaques(previewBet(this.state, betId) ?? baseFactors());
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
      default:
        return null;
    }
  }

  showNote(target, ev) {
    this.noteTarget = target;
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
    if (this.noteTarget.kind === 'talisman' && !this.state.rail.some((t) => t.uid === this.noteTarget.uid)) {
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
      return [
        ...this.state.rail.map((t) => ({ kind: 'talisman', uid: t.uid })),
        { kind: 'bell' },
        { kind: 'plaque', plaque: 'stake' },
        { kind: 'plaque', plaque: 'odds' },
      ];
    }
    if (this.view === 'cabinet') {
      return [...this.state.cabinet.slots.map((_, slot) => ({ kind: 'slot', slot })), { kind: 'crank' }, { kind: 'chart' }];
    }
    return [];
  }

  focusStep(dir) {
    if (this.busy) return;
    const list = this.focusables();
    if (!list.length) return;
    const i = this.focus?.view === this.view ? this.focus.index : dir > 0 ? -1 : list.length;
    const index = (i + dir + list.length) % list.length;
    this.setFocus({ view: this.view, index });
  }

  setFocus(focus) {
    const prev = this.focusedTarget();
    if (prev?.kind === 'talisman') this.rail.lift(prev.uid, false);
    this.focus = focus;
    const target = this.focusedTarget();
    if (!target) {
      this.focus = null;
      return;
    }
    if (target.kind === 'talisman') this.rail.lift(target.uid, true);
    this.showNote(target);
  }

  clearFocus() {
    if (!this.focus) return;
    const target = this.focusedTarget();
    if (target?.kind === 'talisman') this.rail.lift(target.uid, false);
    this.focus = null;
  }

  focusedTarget() {
    if (!this.focus || this.focus.view !== this.view) return null;
    return this.focusables()[this.focus.index] ?? null;
  }

  /** Enter: buy, ring, restock or open what has focus. */
  activate() {
    const target = this.focusedTarget();
    if (!target) return false;
    if (target.kind === 'talisman') this.openTalisman(target.uid);
    else if (target.kind === 'bell') this.ringBell();
    else if (target.kind === 'slot') this.buy(target.slot);
    else if (target.kind === 'crank') this.restock();
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
    if (this.moveTalisman(target.uid, to)) this.setFocus({ view: this.view, index: to });
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
    if (paidLines.length) this.hud.toast(paidLines.join(' · '), 2200);
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
      showModal({
        className: 'paid',
        kicker: 'The Cage',
        title: `Debt ${paid.debt}`,
        struck: true,
        after: 'paid',
        lines: [`The Cage takes its <b>${format(paid.owed)}</b>. Debt ${paid.debt + 1} is <b>${format(owed(this.state))}</b>.`],
        ledger: [
          ['Left in the Cage', format(paid.surplus)],
          [paid.satOut ? `Tokens (${plural(paid.satOut, 'night')} sat out)` : 'Tokens', `+${paid.rewardTokens}`, 'tok'],
          ['Coins for the next nights', `+${format(paid.rewardCoins)}`],
          ...(events.some((e) => e.type === 'chargesRefilled') ? [['Bell charges', 'refilled']] : []),
        ],
        actions: [{ label: 'Continue', primary: true, onClick: () => this.syncAll() }],
      });
      this.hud.setCoins(this.state.coins, { animate: true });
    } else {
      this.audio.card();
    }
  }

  gameOver() {
    this.busy = true;
    this.setLocked(true);
    this.syncAll();
    this.audio.collected();
    this.power = 0.12;
    this.turnTo('table');
    setTimeout(() => this.showCollected(), 1800);
  }

  showCollected() {
    const s = this.state;
    const o = s.outcome;
    showModal({
      className: 'collected',
      kicker: 'The House',
      title: 'Collected',
      lines: [`You owed <b>${format(o.owed)}</b> and had <b>${format(o.deposited)}</b> in the Cage. The House took the rest.`],
      ledger: [
        ['Debts paid', String(s.stats.debtsPaid)],
        ['Spins', String(s.stats.spins)],
        ['Best spin', format(s.stats.bestSpin)],
        ['Rail', s.rail.length ? s.rail.map((t) => getTalisman(t.id)?.name ?? t.id).join(', ') : 'bare'],
        ['Seed', s.seed, 'seed'],
      ],
      actions: [{ label: 'Begin again', primary: true, onClick: () => this.newRun() }],
    });
  }

  // ---- The Curio Cabinet and the rail ----------------------------------------

  /** Buy from compartment `slot`. A full rail asks which talisman to sell. */
  buy(slot) {
    if (this.busy || this.menuClose) return;
    const s = this.state;
    const offer = cabinetView(s).slots[slot];
    if (!offer) return;
    if (offer.id && !offer.hookFree) {
      const best = Math.max(0, ...railView(s).map((v) => v.sellValue));
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
          .filter((v) => this.state.tokens + v.sellValue >= offer.price)
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
    this.hud.toast(sold ? `${getTalisman(sold.id).name} sold. ${name} hangs on the rail.` : `${name} hangs on the rail.`, 2200);
    this.syncItems();
    this.syncStatus();
    // It swings when you next look at the rail.
    this.rail.pulse(bought.uid, 0.8);
  }

  restock() {
    if (this.busy || this.menuClose) return;
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
    this.syncItems();
    this.syncStatus();
  }

  /** A click on a rail talisman: its card, with Sell and (for actives) Ring. */
  openTalisman(uid) {
    if (this.busy || this.menuClose) return;
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
    const actions = [{ label: 'Keep', primary: true, onClick: done() }];
    if (v.active && v.usable) actions.push({ label: v.targetOnly ? 'Smash it' : 'Ring for it', onClick: done(() => this.ringBell(uid)) });
    actions.push({ label: `Sell · +${v.sellValue}`, danger: true, onClick: done(() => this.sell(uid)) });
    showModal({ kicker: `The rail · ${v.rarity}`, title: v.name, lines, actions });
  }

  confirmSell(uid) {
    const v = railView(this.state).find((x) => x.uid === uid);
    if (!v || this.busy) return;
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
    const events = this.dispatch({ type: 'sell', uid });
    if (!events) return;
    const sold = events.find((e) => e.type === 'sold');
    this.audio.sell();
    this.hud.toast(`${getTalisman(sold.id).name} sold for ${plural(sold.refund, 'token')}.`);
    this.clearFocus();
    this.syncItems();
    this.syncStatus();
  }

  moveTalisman(uid, to) {
    if (this.busy) return false;
    const events = this.dispatch({ type: 'moveTalisman', uid, to });
    if (!events) return false;
    this.seen.add('moved');
    if (events.length) this.audio.chip();
    this.syncItems();
    this.updateHint();
    return true;
  }

  /** The Bell: the next talisman in line, or the one whose tag was clicked. */
  ringBell(uid) {
    if (this.busy || this.menuClose) return;
    const events = this.dispatch(uid ? { type: 'ringBell', uid } : { type: 'ringBell' });
    if (!events) {
      this.bell.ring(false);
      return;
    }
    const rung = events.find((e) => e.type === 'bellRung');
    this.bell.ring(!!rung.uid);
    if (!rung.uid) {
      this.audio.bell('dull');
      this.hud.toast('Nothing answers.');
      return;
    }
    this.audio.bell('ding');
    const name = getTalisman(rung.id).name;
    const smashed = events.find((e) => e.type === 'talismanDestroyed');
    for (const e of events) {
      if (e.type === 'trigger') this.rail.pulse(e.src.uid);
      if (e.type === 'trigger' && e.effect === 'armed') this.hud.toast(`${name} is armed: if the next spin pays nothing, the ball is thrown again.`, 2600);
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
            [`${e.number} `, e.color === 'red' ? 'blood' : e.color === 'green' ? 'green' : 'bone'],
            [e.color, 'dim'],
          ],
          2400,
        );
      }
    }
    this.hud.setCoins(this.state.coins, { animate: true });
    if (smashed) {
      this.audio.smash();
      // Let the pig shake once before it leaves its hook.
      setTimeout(() => this.syncItems(), 450);
    } else {
      this.syncItems();
    }
    this.updateHint();
  }

  // ---- Spinning -------------------------------------------------------------

  /** From Space or a flung wheel. Returns true if a spin started. */
  requestSpin() {
    const s = this.state;
    if (this.busy || this.menuClose) return false;
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
    this.setLocked(true);
    this.clearFocus();
    this.clearNote();
    const coinsBefore = this.state.coins;
    const events = this.dispatch({ type: 'spin' });
    if (!events) {
      this.busy = false;
      this.setLocked(false);
      return;
    }
    const { result } = events.find((e) => e.type === 'spin');
    const detail = events.filter((e) => e.type !== 'spin');
    const fast = this.settings.fast;
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
    this.spin.boost(3.4);
    this.hud.setView('table');
    if (!fast) {
      this.view = 'table';
      this.director.goTo('wide', { duration: 1.0, onProgress: (e) => e > 0.3 && this.stage.setFigureGhost(false) });
    } else if (this.view !== 'table') {
      // Fast spins skip the wide shot, so they must be watched from the table.
      this.view = 'table';
      this.director.goTo('table', { duration: 0.4 });
    }

    // The wheel's bulb comes on hard for the spin; the table lamp sinks.
    if (this.lighting.set('spin')) this.audio.clunk();
    const colorTone = (c) => (c === 'red' ? 'blood' : c === 'green' ? 'green' : 'bone');

    // An armed Wheel of Fortune: the first throw paid nothing, so the ball
    // jumps out and goes round again.
    const first = result.firstThrow?.[0];
    if (first) {
      await this.ball.launch(first.pocketIndex);
      this.audio.settle();
      this.table.flashResult(first.number);
      this.hud.flavor(
        [
          [`${first.number} `, colorTone(first.color)],
          ['pays nothing...', 'dim'],
        ],
        1100,
      );
      await wait(fast ? 0.25 : 0.7);
      const by = detail.find((e) => e.type === 'rethrow')?.by;
      if (by) this.rail.pulse(by, 1.2);
      this.bell.ring(true);
      this.audio.bell('ding');
      this.audio.rethrow();
      this.hud.flavor([['Again.', 'blood']], 900);
      await this.ball.launch(result.pocketIndex, { short: true });
    } else {
      await this.ball.launch(result.pocketIndex);
    }

    this.audio.settle();
    this.table.flashResult(result.number);
    this.table.setMarks({ foreseen: null });
    this.table.updateMarquee(this.state.history);
    this.hud.flavor(
      [
        [`${result.number} `, colorTone(result.color)],
        [result.foreseen ? `${result.color}, as foreseen` : result.color, 'dim'],
      ],
      1300,
    );
    await wait(fast ? 0.2 : 0.6);
    // Attention returns to the felt; the wheel fades back into the dark slowly.
    this.lighting.set('table');
    if (!fast) {
      await this.director.goTo('table', { duration: 0.8, onProgress: (e) => e > 0.7 && this.stage.setFigureGhost(true) });
    }

    if (!result.miss) this.hud.strikeCoins();
    await playPayout(
      { table: this.table, rail: this.rail, hud: this.hud, audio: this.audio, screenPosition: (w) => this.screenPosition(w) },
      detail,
      { fast, coinsBefore },
    );
    this.hud.setMode('play');
    if (result.miss) {
      this.audio.miss();
      this.hud.showPayout(gt(result.total, 0) ? `+${format(result.total)}` : 'nothing', 'miss');
    } else {
      // A win worth half the hand or more gets the bigger swipe.
      this.hud.showPayout(`+${format(result.total)}`, gte(add(result.total, result.total), coinsBefore) ? 'big' : 'win');
    }
    this.hud.setCoins(this.state.coins, { animate: !isBig(this.state.coins) });

    this.busy = false;
    this.setLocked(false);
    if (this.state.phase === PHASE.NIGHT_OVER) this.audio.nightBell();
    this.syncAll();
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
    const s = this.state;
    const close = showModal({
      className: 'pause',
      title: 'Paused',
      lines: [
        `Debt <b>${s.debt}</b>, night <b>${s.round}</b>. Seed <b>${s.seed}</b>.`,
        'Space spins · A/D turn · 1/2/3 choose a night or buy · E ends the night · B rings the Bell · R restocks · Tab walks the rail · F fast spins · M sound',
      ],
      actions: [
        { label: 'Resume', primary: true, onClick: () => (this.menuClose = null) },
        { label: 'Fast spins', keepOpen: true, value: () => (this.settings.fast ? 'on' : 'off'), onClick: () => this.toggleFast() },
        { label: 'Sound', keepOpen: true, value: () => (this.settings.muted ? 'off' : 'on'), onClick: () => this.toggleMute() },
        { label: 'Abandon run', danger: true, onClick: () => ((this.menuClose = null), this.confirmAbandon()) },
      ],
    });
    this.menuClose = close;
  }

  confirmAbandon() {
    showModal({
      title: 'Abandon this run?',
      lines: ['The run ends here and a new one begins. There is no undo.'],
      actions: [
        { label: 'Keep playing', primary: true },
        { label: 'Abandon', danger: true, onClick: () => this.newRun() },
      ],
    });
  }
}
