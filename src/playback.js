import { contentName, getEnhancement, getTalisman } from './core/content/index.js';
import { add, format } from './core/num.js';
import { baseFactors } from './core/payout.js';
import { effectText } from './ui/notes.js';

// Payout playback (design doc 8.3): walks a spin's detail events in order and
// shows them. Talismans shake and flash left to right as they act, the plaques
// tick through each chip's factors, chips glow and pop their payouts, and the
// coin counter rolls up. It never changes the run: the core already has.

const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));

const PAYOUT_HOOKS = new Set(['hits', 'ballLanded', 'covers', 'chipStake', 'chipOdds', 'chipMult', 'pocketMult', 'chipPaid', 'chipLost', 'spinPaid']);
// Luck acts before the payout and is shown where it acts: Nudge during the
// hops, the Devil's chance and the wheel's widths as the ball is thrown.
const SHOWN_BEFORE = new Set(['nudge', 'devilChance', 'widths']);

/** Seconds each step takes, compressed so a long cascade stays short (pillar 3). */
function pacing(steps, fast) {
  const per = { paid: fast ? 0.08 : 0.22, trigger: fast ? 0.05 : 0.12 };
  const total = steps.reduce((t, e) => t + (e.type === 'chipPaid' ? per.paid : e.type === 'trigger' ? per.trigger : 0), 0);
  const budget = fast ? 1.2 : 2.5;
  const k = steps.length > 14 && total > budget ? budget / total : 1;
  return { paid: per.paid * k, trigger: per.trigger * k };
}

/**
 * deps: { table, rail, hud, audio, screenPosition }
 * `alive()` turning false (a new run began) stops the playback where it is.
 * Returns the running coin total when it is done.
 */
export async function playPayout(deps, events, { fast, coinsBefore, alive = () => true }) {
  const { table, rail, hud, audio, screenPosition } = deps;
  events = events.filter((e) => !(e.type === 'trigger' && SHOWN_BEFORE.has(e.hook)));
  const steps = events.filter((e) => e.type === 'trigger' || e.type === 'chipPaid');
  const pace = pacing(steps, fast);
  const base = baseFactors();
  let live = { ...base };
  let running = coinsBefore;
  let wins = 0;
  let k = 0; // triggers within the current line: the tick climbs

  const popAt = (world, text, kind) => {
    const p = screenPosition(world);
    if (p) hud.popup(text, p.x, p.y, kind);
  };

  for (const e of events) {
    if (e.type === 'trigger') {
      const label = effectText(e);
      rail.pulse(e.src.uid, label ? 1 : 0.5);
      // A Tuning Fork's echo: the fork rings and the talisman it repeats stirs.
      if (e.src.echo) {
        rail.pulse(e.src.echo, 0.4);
        audio.fork(k);
      }
      if (e.effect === 'stake' || e.effect === 'oddsMult') {
        live = { ...live, [e.effect]: live[e.effect] + e.amount };
        rail.setPlaques(live, true);
      }
      if (e.effect === 'coins') {
        running = add(running, e.amount);
        hud.setCoins(running, { animate: true });
      }
      if (label) {
        // Coins refunded for a chip pop at the chip; everything else at the
        // talisman. A record or a lasting fortune hangs nowhere: it pops over
        // the board, named, and so is an engraving, at its talisman.
        // A chip's material pops at the chip, unnamed: the chip is what acts.
        // A pocket's enhancement pops at the chip it pays, named (×2 gilded),
        // or over the board when it pays whatever was bet (a Bone pocket).
        const onRail = rail.talismanWorldPosition(e.src.uid);
        const atChip = (e.effect === 'coins' || e.src.chip || e.src.pocket) && e.chipId;
        const at = atChip ? table.chipWorldPosition(e.chipId) : (onRail ?? table.boardWorldPosition());
        let name = e.src.as !== e.src.id ? ` (${contentName(e.src.as)})` : '';
        if (!getTalisman(e.src.id)) name = e.src.chip ? '' : ` ${contentName(e.src.id)}`;
        if (e.src.pocket) name = ` ${getEnhancement(e.src.id)?.name.toLowerCase() ?? ''}${e.chipId ? '' : ' pocket'}`;
        popAt(at, `${label}${name}`, e.effect === 'tokens' ? 'tok' : 'trigger');
      }
      audio.trigger(k);
      k += 1;
      if (PAYOUT_HOOKS.has(e.hook)) await wait(pace.trigger);
      if (!alive()) return running;
      continue;
    }
    if (e.type === 'chipPaid') {
      table.glowChip(e.chipId);
      audio.coin(wins);
      const quarter = e.hit.mult < 1 ? ' ×¼' : '';
      popAt(table.chipWorldPosition(e.chipId), `+${format(e.amount)}${quarter}`, 'win');
      running = add(running, e.amount);
      wins += 1;
      hud.setCoins(running, { animate: true });
      await wait(pace.paid);
      if (!alive()) return running;
      // The next chip's line starts from the plain factors again.
      live = { ...base };
      rail.setPlaques(live);
      k = 0;
    }
  }
  rail.setPlaques(base);
  return running;
}
