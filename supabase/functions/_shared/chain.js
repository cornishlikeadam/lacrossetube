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
export const POINTS = { perDoge: 1000, minRedeem: 100 };

export const txUrl = hash => `${CHAIN.explorer}/tx/${hash}`;
export const addressUrl = address => `${CHAIN.explorer}/address/${address}`;
// Whole points to the chain's smallest unit (wei), as a BigInt.
export const pointsToWei = points => (BigInt(points) * 10n ** BigInt(CHAIN.currency.decimals)) / BigInt(POINTS.perDoge);
export const formatDoge = wei => {
  const d = 10n ** BigInt(CHAIN.currency.decimals), w = BigInt(wei);
  const frac = (w % d).toString().padStart(CHAIN.currency.decimals, '0').replace(/0+$/, '').slice(0, 4);
  return `${w / d}${frac ? '.' + frac : ''} ${CHAIN.currency.symbol}`;
};
