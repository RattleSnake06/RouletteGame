import * as THREE from 'three';
import { BET_KINDS, getBet } from './core/bets.js';
import { ECONOMY } from './core/economy.js';
import { add, format, gt, gte, isBig, isZero, sub } from './core/num.js';
import { randomSeed } from './core/rng.js';
import { PHASE, act, chipsOnTable, costOf, createRun, isFinalNight, owed } from './core/run.js';
import { deserializeRun, serializeRun } from './core/save.js';
import { showModal } from './ui/hud.js';

// Glue between the rules (core/run.js) and the room. Every player action goes
// through dispatch(), which applies it to the run, saves, and returns the
// events the view plays back. The view never decides an outcome.

const PACKAGE_KEYS = ['long', 'short', 'sitout'];
const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));

export class Game {
  constructor(deps) {
    Object.assign(this, deps);
    this.state = null;
    this.busy = false;
    this.view = 'table';
    this.fastHeld = false;
    this.power = 1; // room light, 0 when the Cage collects
    this.menuClose = null;
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
    this.hud.setTokens(s.tokens);
    this.syncSpins();
    if (s.phase === PHASE.ROUND_START && !this.busy) this.table.showPackages(s);
    else this.table.hidePackages();
    if (s.phase === PHASE.NIGHT_OVER && !this.busy) this.table.showEndCard(this.endCardLine());
    else this.table.hideEndCard();
    this.syncStatus();
  }

  /** The night's tally: spins left of the night's allowance. */
  syncSpins() {
    const s = this.state;
    const total = s.phase === PHASE.ROUND_START ? 0 : (s.spinsTonight ?? s.spinsLeft);
    const note = s.phase === PHASE.ROUND_START ? 'choose a night' : s.phase === PHASE.NIGHT_OVER ? 'sat out' : '';
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
      endLabel: s.phase === PHASE.NIGHT_OVER ? (isFinalNight(s) ? 'the Cage collects' : 'interest is paid') : 'spin first',
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
    return `Banked coins earn ${Math.round(ECONOMY.interestRate * 100)}%, then night ${s.round + 1} begins.`;
  }

  updateHint() {
    const s = this.state;
    let hint = '';
    if (this.busy) hint = '';
    else if (s.phase === PHASE.GAME_OVER) hint = '';
    else if (this.view === 'cage') hint = 'Banked coins count toward the debt. They cannot come back out.';
    else if (s.phase === PHASE.ROUND_START) hint = 'Choose how to spend the night: click a card, or press [1], [2] or [3].';
    else if (s.phase === PHASE.BETTING && chipsOnTable(s).length === 0) hint = 'Click the felt to place a chip.';
    else if (s.phase === PHASE.BETTING) hint = 'Fling the wheel, or press [Space] to spin.';
    else if (s.phase === PHASE.NIGHT_OVER) hint = 'The night is over. Bank your coins at the Cage, then press [E] to end the night.';
    this.hud.setHint(hint);
  }

  updateNav() {
    if (this.busy) this.hud.setNav(null, null);
    else if (this.view === 'table') this.hud.setNav('Cage', null);
    else this.hud.setNav(null, 'Table');
  }

  setLocked(locked) {
    this.table.setLocked(locked);
    this.cage.setLocked(locked);
  }

  // ---- Camera ---------------------------------------------------------------

  turnTo(view) {
    if (this.busy && view !== 'table') return;
    if (view === this.view && this.director.current === view) return;
    this.view = view;
    this.hud.tooltip(null);
    this.hud.setView(view);
    this.director.goTo(view, { duration: 0.6 });
    if (!this.busy) this.lighting.set(view === 'cage' ? 'cage' : 'table');
    this.updateHint();
    this.updateNav();
  }

  turn(dir) {
    if (this.busy) return;
    if (dir < 0 && this.view === 'table') this.turnTo('cage');
    if (dir > 0 && this.view === 'cage') this.turnTo('table');
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

  /** The bet note sits beside the spot itself, not the pointer. */
  onHoverBet(betId, ev) {
    if (!betId) {
      this.hud.tooltip(null);
      return;
    }
    const bet = getBet(betId);
    const anchor = this.screenPosition(this.table.spotWorldPosition(betId)) ?? { x: ev.clientX, y: ev.clientY };
    this.hud.tooltip({ label: bet.label, pays: BET_KINDS[bet.kind].odds }, anchor);
  }

  // ---- Nights ---------------------------------------------------------------

  choosePackage(packageId) {
    if (this.busy || this.state.phase !== PHASE.ROUND_START) return;
    const events = this.dispatch({ type: 'choosePackage', packageId });
    if (!events) return;
    this.audio.card();
    const ev = events[0];
    if (ev.tokens) this.hud.toast(`+${ev.tokens} token`);
    if (!isZero(ev.cost)) this.hud.strikeCoins();
    this.hud.setCoins(this.state.coins, { animate: true });
    this.syncAll();
  }

  chooseByIndex(i) {
    this.choosePackage(PACKAGE_KEYS[i]);
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
    if (interest && gt(interest.amount, 0)) this.hud.toast(`Interest: +${format(interest.amount)} banked`);
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
          [paid.satOut ? `Tokens (${paid.satOut} night${paid.satOut > 1 ? 's' : ''} sat out)` : 'Tokens', `+${paid.rewardTokens}`, 'tok'],
          ['Coins for the next nights', `+${format(paid.rewardCoins)}`],
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
        ['Seed', s.seed, 'seed'],
      ],
      actions: [{ label: 'Begin again', primary: true, onClick: () => this.newRun() }],
    });
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
    this.hud.tooltip(null);
    const coinsBefore = this.state.coins;
    const events = this.dispatch({ type: 'spin' });
    if (!events) {
      this.busy = false;
      this.setLocked(false);
      return;
    }
    const { result } = events.find((e) => e.type === 'spin');
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
    await this.ball.launch(result.pocketIndex);

    this.audio.settle();
    this.table.flashResult(result.number);
    this.table.updateMarquee(this.state.history);
    this.hud.flavor(
      [
        [`${result.number} `, result.color === 'red' ? 'blood' : result.color === 'green' ? 'green' : 'bone'],
        [result.color, 'dim'],
      ],
      1300,
    );
    await wait(fast ? 0.2 : 0.6);
    // Attention returns to the felt; the wheel fades back into the dark slowly.
    this.lighting.set('table');
    if (!fast) {
      await this.director.goTo('table', { duration: 0.8, onProgress: (e) => e > 0.7 && this.stage.setFigureGhost(true) });
    }

    let running = coinsBefore;
    if (!result.miss) this.hud.strikeCoins();
    for (const [i, w] of result.wins.entries()) {
      this.table.glowChip(w.chipId);
      this.audio.coin(i);
      const p = this.screenPosition(this.table.chipWorldPosition(w.chipId));
      if (p) this.hud.popup(`+${format(w.amount)}`, p.x, p.y);
      running = add(running, w.amount);
      this.hud.setCoins(running, { animate: true });
      await wait(fast ? 0.08 : 0.22);
    }
    this.hud.setMode('play');
    if (result.miss) {
      this.audio.miss();
      this.hud.showPayout('nothing', 'miss');
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
      kicker: `Debt ${s.debt} · night ${s.round} · seed ${s.seed}`,
      title: 'Paused',
      lines: ['Space spins · A/D turn · 1/2/3 choose a night · E ends the night · F fast spins · M sound'],
      actions: [
        { label: 'Resume', primary: true, onClick: () => (this.menuClose = null) },
        { label: 'Abandon run', danger: true, onClick: () => ((this.menuClose = null), this.confirmAbandon()) },
        { label: 'Fast spins', keepOpen: true, value: () => (this.settings.fast ? 'on' : 'off'), onClick: () => this.toggleFast() },
        { label: 'Sound', keepOpen: true, value: () => (this.settings.muted ? 'off' : 'on'), onClick: () => this.toggleMute() },
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
