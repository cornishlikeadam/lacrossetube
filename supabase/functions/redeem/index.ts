// Every chain transfer: redeem, send to a teammate, give to a team pool, and session payouts from
// the team address. The rules are in _shared/wallet-core.js (tested in Node); this file wires in
// Supabase and DogeOS Chikyū Testnet (_shared/chain.js). Called by a signed-in person:
//   POST { action: 'status' }                    -> { configured, chain, treasury, perDoge, minRedeem }
//   POST { action: 'redeem' }                    -> { receipt }
//   POST { action: 'send', to, points, note? }   -> { transfer }
//   POST { action: 'donate', org, points, note? }-> { transfer }
//   POST { action: 'claim', payout }             -> { transfer }   (site balance until the team address holds DOGE)
//   POST { action: 'team', org }                 -> { address, balance_wei }
// Until DOGEOS_CLIENT_ID and TREASURY_PRIVATE_KEY are both set, everything but status answers
// "not configured" (503) and nothing changes. The treasury key and the team keys derived from it
// never leave this function.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { createWalletClient, createPublicClient, http, defineChain } from 'npm:viem@2.57.7';
import { privateKeyToAccount } from 'npm:viem@2.57.7/accounts';
import { secp256k1 } from 'npm:@noble/curves@2.4.0/secp256k1.js';
import { sha256 } from 'npm:@noble/hashes@2.4.0/sha2.js';
import { hmac } from 'npm:@noble/hashes@2.4.0/hmac.js';
import { bytesToHex, hexToBytes } from 'npm:@noble/hashes@2.4.0/utils.js';
import { CHAIN, POINTS, pointsToWei, txUrl } from '../_shared/chain.js';
import { teamSecret } from '../_shared/team-key.js';
import { walletAction, WalletError } from '../_shared/wallet-core.js';

const URL = Deno.env.get('SUPABASE_URL');
const ANON = Deno.env.get('SUPABASE_ANON_KEY');
const firstSecret = (json?: string) => { try { return Object.values(JSON.parse(json || '{}'))[0] as string | undefined; } catch { return undefined; } };
const SECRET = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY') || firstSecret(Deno.env.get('SUPABASE_SECRET_KEYS'));
const CLIENT_ID = Deno.env.get('DOGEOS_CLIENT_ID');
const TREASURY_KEY = Deno.env.get('TREASURY_PRIVATE_KEY');
const treasuryOk = Boolean(TREASURY_KEY && /^0x[0-9a-fA-F]{64}$/.test(TREASURY_KEY));
const treasury = treasuryOk ? privateKeyToAccount(TREASURY_KEY as `0x${string}`) : null;
const CONFIGURED = Boolean(CLIENT_ID && treasury);

const chain = defineChain({
  id: CHAIN.id, name: CHAIN.name, nativeCurrency: CHAIN.currency,
  rpcUrls: { default: { http: [CHAIN.rpcUrl] } }, blockExplorers: { default: { name: 'L2Scan', url: CHAIN.explorer } }, testnet: CHAIN.testnet,
});
const transport = http(CHAIN.rpcUrl, { timeout: 20_000 });
const reader = createPublicClient({ chain, transport });
const onChain = {
  send: (account: ReturnType<typeof privateKeyToAccount>, to: `0x${string}`, value: bigint) =>
    createWalletClient({ account, chain, transport }).sendTransaction({ to, value }),
  balance: (address: `0x${string}`) => reader.getBalance({ address }),
  gasCost: async () => 21000n * (await reader.getGasPrice()) * 2n,
};
const teamAccount = (orgId: string) => {
  const sk = teamSecret(hexToBytes(TREASURY_KEY!.slice(2)), orgId, { hmac, sha256, secp256k1 });
  try { const account = privateKeyToAccount(`0x${bytesToHex(sk)}`); return { address: account.address, account }; } finally { sk.fill(0); }
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405);
  if (!URL || !SECRET) return reply({ error: 'Redeem is not set up on this server.' }, 503);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply({ error: 'Send JSON.' }, 400); }
  const db = createClient(URL, SECRET, { auth: { persistSession: false } });
  const user = createClient(URL, ANON ?? SECRET, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  try {
    return reply(await walletAction(body, { CHAIN, POINTS, pointsToWei, txUrl, configured: CONFIGURED, treasury, db, user, chain: onChain, teamAccount }));
  } catch (e) {
    if (e instanceof WalletError) return reply({ error: e.message, ...e.extra }, e.status);
    console.error('wallet action failed', (e as Error).message?.split('\n')[0]);
    return reply({ error: 'The wallet action failed on the server.' }, 500);
  }
});
