import { add, ceil, floor, mul, mulFloor, num, pow } from './num.js';

// Numbers from design doc 5.1–5.2. All of them are first drafts, tuned with
// the balance simulator (npm run sim).

export const ECONOMY = {
  startCoins: 10,
  startTokens: 4,
  startChips: 3,
  startHooks: 6, // talisman hooks on the rail
  roundsPerDebt: 3,
  interestRate: 0.05,
  nightTokens: 1, // paid at the Cage with the interest, every night
  debtRewardTokens: 2,
  sitOutTokens: 3, // per sat-out round, paid when the debt is paid
  rewardSpins: 3, // coins worth this many spins at the next debt's cost
  restockGrowth: 1.2, // each paid restock costs 20% more (rounded up), reset each debt
};

/** Curio Cabinet prices (tokens) and reroll weights by rarity (doc 5.8). */
export const RARITY = {
  common: { price: 3, weight: 1 },
  uncommon: { price: 4, weight: 0.85 },
  rare: { price: 6, weight: 0.6 },
  legendary: { price: 9, weight: 0.3 },
};

export const PACKAGES = {
  long: { id: 'long', name: 'Long night', spins: 7, tokens: 0 },
  short: { id: 'short', name: 'Short night', spins: 3, tokens: 1 },
  sitout: { id: 'sitout', name: 'Sit out', spins: 0, tokens: 0 },
};

const DEBT_TABLE = [
  { owed: 60, restock: 2 },
  { owed: 180, restock: 5 },
  { owed: 666, restock: 15 },
  { owed: 2500, restock: 50 },
  { owed: 12000, restock: 200 },
  { owed: 36000, restock: 700 },
  { owed: 120000, restock: 2000 },
  { owed: 370000, restock: 6000 },
  { owed: 1300000, restock: 25000 },
];

/** What the Cage collects at the end of debt `n` (1-based). */
export function owedFor(n) {
  if (n <= DEBT_TABLE.length) return DEBT_TABLE[n - 1].owed;
  // From debt 10 the growth factor itself doubles each debt: ×6, ×12, ×24…
  let owed = num(DEBT_TABLE[DEBT_TABLE.length - 1].owed);
  for (let d = DEBT_TABLE.length + 1; d <= n; d++) owed = mul(owed, mul(6, pow(2, d - 10)));
  return owed;
}

/** Spin cost follows Fibonacci: 1, 2, 3, 5, 8, 13… */
export function spinCostFor(n) {
  let a = 1;
  let b = 2;
  if (n === 1) return a;
  for (let i = 2; i < n; i++) [a, b] = [b, add(a, b)];
  return b;
}

export function restockBaseFor(n) {
  if (n <= DEBT_TABLE.length) return DEBT_TABLE[n - 1].restock;
  return floor(mul(owedFor(n), 1 / 50));
}

export function packageCost(debt, packageId) {
  return mul(spinCostFor(debt), PACKAGES[packageId].spins);
}

export function interestOn(deposited, rate = ECONOMY.interestRate) {
  return mulFloor(deposited, rate);
}

/** Coins for the next paid restock, after `paid` paid restocks this debt. */
export function restockCost(debt, paid) {
  let cost = restockBaseFor(debt);
  for (let i = 0; i < paid; i++) cost = ceil(mul(cost, ECONOMY.restockGrowth));
  return cost;
}

export const priceOf = (rarity) => RARITY[rarity].price;

/** Selling returns half the rarity price, rounded down, and never nothing. */
export const sellValueOf = (price) => Math.max(1, Math.floor(price / 2));
