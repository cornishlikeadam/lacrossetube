// The one place the chain is defined. The browser (profile, explorer links) and the redeem Edge
// Function both read it. Moving to DogeOS mainnet is a change to this file, not a rewrite.
export const CHAIN = {
  id: 6281971,
  name: 'DogeOS Chikyū Testnet',
  rpcUrl: 'https://rpc.testnet.dogeos.com/',
  explorer: 'https://dogeos-testnet.l2scan.co',
  faucet: 'https://faucet.testnet.dogeos.com',
  currency: { name: 'Dogecoin', symbol: 'DOGE', decimals: 18 },
  testnet: true,
};

// Points earned in LacrosseTube (stored in Supabase) and what they redeem for.
// earn: the only automatic daily earnings. 500 points per minute the film clock is advancing (at
// most 30 minutes) and 1,000 points for the first finish of a What Coach Said game (at most 7),
// under a 25,000-point daily ceiling that is room, not a third payout. Warrior Tests, tips,
// services, donations and session payouts never count toward it.
// payout: the fixed amounts of a coach's session payouts (A open, B finish, C watch per minute,
// D present). The coach picks the condition, never the amount.
// The database enforces the same numbers in public.earn_rules(); tests/phase2-db.test.mjs checks
// that the two agree.
export const POINTS = {
  perDoge: 1000,
  minRedeem: 100,
  earn: { perMinute: 500, maxMinutes: 30, perGame: 1000, maxGames: 7, dailyCap: 25000, dayZone: 'America/New_York' },
  payout: { open: 100, finish: 500, watchPerMinute: 100, maxWatchMinutes: 30, present: 500 },
};

export const txUrl = hash => `${CHAIN.explorer}/tx/${hash}`;
export const addressUrl = address => `${CHAIN.explorer}/address/${address}`;
// Whole points to the chain's smallest unit (wei), as a BigInt.
export const pointsToWei = points => (BigInt(points) * 10n ** BigInt(CHAIN.currency.decimals)) / BigInt(POINTS.perDoge);
export const formatDoge = wei => {
  const d = 10n ** BigInt(CHAIN.currency.decimals), w = BigInt(wei);
  const frac = (w % d).toString().padStart(CHAIN.currency.decimals, '0').replace(/0+$/, '').slice(0, 4);
  return `${w / d}${frac ? '.' + frac : ''} ${CHAIN.currency.symbol}`;
};
