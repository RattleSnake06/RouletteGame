import { betCovers, betOdds, getBet } from './bets.js';
import { add, mul, floor } from './num.js';
import { drawPocket } from './wheel.js';

/**
 * Payout of one winning chip (design doc 5.5):
 *   chip value × Stake × odds × Odds mult × pocket mult × talismans.
 * Stake, Odds mult, pocket and talisman factors are all 1 until later phases.
 */
export function chipPayout(chip, bet) {
  return floor(mul(chip.value, betOdds(bet)));
}

/**
 * Settles one spin. The outcome is decided here, before anything is animated.
 * Chips are settled in chip order, which later becomes rail order for talismans.
 */
export function resolveSpin({ wheel, chips, placements }, rngWheel) {
  const pocketIndex = drawPocket(wheel, rngWheel);
  const pocket = wheel.pockets[pocketIndex];
  const wins = [];
  const losses = [];
  let total = 0;
  for (const chip of chips) {
    const betId = placements[chip.id];
    if (!betId) continue;
    const bet = getBet(betId);
    if (betCovers(bet, pocket)) {
      const amount = chipPayout(chip, bet);
      wins.push({ chipId: chip.id, betId, amount });
      total = add(total, amount);
    } else {
      losses.push({ chipId: chip.id, betId });
    }
  }
  return {
    pocketIndex,
    number: pocket.number,
    color: pocket.color,
    wins,
    losses,
    total,
    miss: wins.length === 0,
  };
}
