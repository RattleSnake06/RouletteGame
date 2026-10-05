import * as THREE from 'three';
import { BET_KINDS, getBet } from './core/bets.js';
import { ECONOMY } from './core/economy.js';
import { add, format, gt, gte, isBig, sub } from './core/num.js';
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
      this.hud.toast(rejected.reason);
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
    this.hud.setSpins(s.spinsLeft);
    if (s.phase === PHASE.ROUND_START && !this.busy) this.table.showPackages(s);
    else this.table.hidePackages();
    if (s.phase === PHASE.NIGHT_OVER && !this.busy) this.table.showEndCard(this.endCardLine());
    else this.table.hideEndCard();
    this.syncStatus();
  }

  /** HUD debt line, the Cage's counters, hints and navigation. */
  syncStatus() {
    const s = this.state;
    this.hud.setDebt(`DEBT ${s.debt} · OWED ${format(owed(s))} · NIGHT ${s.round} OF ${ECONOMY.roundsPerDebt}`);
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
    else if (s.phase === PHASE.ROUND_START) hint = 'Choose how to spend the night: click a card, or press 1, 2 or 3.';
    else if (s.phase === PHASE.BETTING && chipsOnTable(s).length === 0) hint = 'Click the felt to place a chip.';
    else if (s.phase === PHASE.BETTING) hint = 'Fling the wheel, or press Space to spin.';
    else if (s.phase === PHASE.NIGHT_OVER) hint = 'The night is over. Bank your coins at the Cage, then end the night.';
    this.hud.setHint(hint);
  }

  updateNav() {
    if (this.busy) this.hud.setNav(null, null);
    else if (this.view === 'table') this.hud.setNav('◀ CAGE', null);
    else this.hud.setNav(null, 'TABLE ▶');
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

  onHoverBet(betId, ev) {
    if (!betId) {
      this.hud.tooltip(null);
      return;
    }
    const bet = getBet(betId);
    this.hud.tooltip(`<b>${bet.label}</b><span class="odds">pays ${BET_KINDS[bet.kind].odds}×</span>`, ev.clientX, ev.clientY);
  }

  onHoverMove(ev) {
    if (this.hud.refs.tooltip.classList.contains('show')) {
      this.hud.tooltip(this.hud.refs.tooltip.innerHTML, ev.clientX, ev.clientY);
    }
  }

  // ---- Nights ---------------------------------------------------------------

  choosePackage(packageId) {
    if (this.busy || this.state.phase !== PHASE.ROUND_START) return;
    const events = this.dispatch({ type: 'choosePackage', packageId });
    if (!events) return;
    this.audio.card();
    const ev = events[0];
    if (ev.tokens) this.hud.toast(`+${ev.tokens} token`);
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
          title: 'The Cage collects tonight',
          body: `<p>You owe ${format(due)} and have banked ${format(s.deposited)}. You still hold ${format(s.coins)} coins.</p>`,
          actions: [
            { label: 'NOT YET' },
            { label: 'END ANYWAY', onClick: () => this.endNight() },
            {
              label: 'BANK ALL AND END',
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
          title: 'You cannot cover the debt',
          body: `<p>You owe ${format(due)}. Even with every coin you hold, you are ${format(sub(due, add(s.deposited, s.coins)))} short.</p>`,
          actions: [{ label: 'NOT YET' }, { label: 'END THE NIGHT', primary: true, onClick: () => this.endNight() }],
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
        title: `Debt ${paid.debt} paid`,
        body: `
          <p>The Cage takes its ${format(paid.owed)}. Debt ${paid.debt + 1} is ${format(owed(this.state))}.</p>
          <dl>
            <dt>Left in the Cage</dt><dd>${format(paid.surplus)}</dd>
            <dt>Tokens</dt><dd>+${paid.rewardTokens}${paid.satOut ? ` (${paid.satOut} night${paid.satOut > 1 ? 's' : ''} sat out)` : ''}</dd>
            <dt>Coins for the next nights</dt><dd>+${format(paid.rewardCoins)}</dd>
          </dl>`,
        actions: [{ label: 'CONTINUE', primary: true, onClick: () => this.syncAll() }],
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
      title: 'Collected',
      body: `
        <p>You owed ${format(o.owed)} and had ${format(o.deposited)} in the Cage. The House took the rest.</p>
        <dl>
          <dt>Debts paid</dt><dd>${s.stats.debtsPaid}</dd>
          <dt>Spins</dt><dd>${s.stats.spins}</dd>
          <dt>Best spin</dt><dd>${format(s.stats.bestSpin)}</dd>
          <dt>Seed</dt><dd>${s.seed}</dd>
        </dl>`,
      actions: [{ label: 'BEGIN AGAIN', primary: true, onClick: () => this.newRun() }],
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
    this.hud.setSpins(this.state.spinsLeft);
    this.updateHint();
    this.updateNav();
    this.hud.flavor('Rien ne va plus.', 1300);
    this.spin.boost(3.4);
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
    this.hud.flavor(`${result.number} ${result.color}`, 1300);
    await wait(fast ? 0.2 : 0.6);
    // Attention returns to the felt; the wheel fades back into the dark slowly.
    this.lighting.set('table');
    if (!fast) {
      await this.director.goTo('table', { duration: 0.8, onProgress: (e) => e > 0.7 && this.stage.setFigureGhost(true) });
    }

    let running = coinsBefore;
    for (const [i, w] of result.wins.entries()) {
      this.table.glowChip(w.chipId);
      this.audio.coin(i);
      const p = this.screenPosition(this.table.chipWorldPosition(w.chipId));
      if (p) this.hud.popup(`+${format(w.amount)}`, p.x, p.y);
      running = add(running, w.amount);
      this.hud.setCoins(running, { animate: true });
      await wait(fast ? 0.08 : 0.22);
    }
    if (result.miss) {
      this.audio.miss();
      this.hud.showPayout('nothing', 'miss');
    } else {
      this.hud.showPayout(`+${format(result.total)}`);
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
      title: 'Paused',
      body: `<p>Debt ${s.debt}, night ${s.round}. Seed ${s.seed}.</p>
        <p>Space spins · A/D turn · 1/2/3 choose a night · E ends the night · F fast spins · M sound</p>`,
      actions: [
        { label: 'ABANDON RUN', onClick: () => ((this.menuClose = null), this.confirmAbandon()) },
        { label: this.settings.fast ? 'FAST SPINS: ON' : 'FAST SPINS: OFF', onClick: () => ((this.menuClose = null), this.toggleFast()) },
        { label: this.settings.muted ? 'SOUND: OFF' : 'SOUND: ON', onClick: () => ((this.menuClose = null), this.toggleMute()) },
        { label: 'RESUME', primary: true, onClick: () => (this.menuClose = null) },
      ],
    });
    this.menuClose = close;
  }

  confirmAbandon() {
    showModal({
      title: 'Abandon this run?',
      body: '<p>The run ends here and a new one begins. There is no undo.</p>',
      actions: [
        { label: 'KEEP PLAYING', primary: true },
        { label: 'ABANDON', onClick: () => this.newRun() },
      ],
    });
  }
}
