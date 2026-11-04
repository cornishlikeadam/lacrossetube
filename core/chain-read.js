// Reads a DogeOS testnet balance straight from the chain's public RPC (chain.js), for showing
// what an address holds. Read-only: no keys, nothing signed. Returns null when the RPC cannot be
// reached, so a page never fails because of it.
import { CHAIN } from '../supabase/functions/_shared/chain.js';

export async function balanceOf(address) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(address))) return null;
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(CHAIN.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl.signal,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] }) });
    const j = await r.json();
    return typeof j.result === 'string' ? BigInt(j.result) : null;
  } catch { return null; } finally { clearTimeout(timer); }
}
