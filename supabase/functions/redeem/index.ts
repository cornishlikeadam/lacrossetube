// Points to testnet DOGE. Called by a signed-in person (their Supabase session):
//   POST { action: 'status' } -> { configured, chain, treasury? }
//   POST { action: 'redeem' } -> { receipt }
// Redeeming reserves the person's points, sends DOGE on the chain in _shared/chain.js from the
// treasury to the person's current wallet address, and records the receipt (point_redemptions).
// A failed transfer gives the points back. Until DOGEOS_CLIENT_ID and TREASURY_PRIVATE_KEY are
// both set, redeem reports "not configured" and nothing else changes.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { createWalletClient, http, defineChain } from 'npm:viem@2.57.7';
import { privateKeyToAccount } from 'npm:viem@2.57.7/accounts';
import { CHAIN, POINTS, pointsToWei, txUrl } from '../_shared/chain.js';

const URL = Deno.env.get('SUPABASE_URL');
const ANON = Deno.env.get('SUPABASE_ANON_KEY');
const firstSecret = (json?: string) => { try { return Object.values(JSON.parse(json || '{}'))[0] as string | undefined; } catch { return undefined; } };
const SECRET = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY') || firstSecret(Deno.env.get('SUPABASE_SECRET_KEYS'));
const CLIENT_ID = Deno.env.get('DOGEOS_CLIENT_ID');
const TREASURY_KEY = Deno.env.get('TREASURY_PRIVATE_KEY');
const treasury = TREASURY_KEY && /^0x[0-9a-fA-F]{64}$/.test(TREASURY_KEY) ? privateKeyToAccount(TREASURY_KEY as `0x${string}`) : null;
const CONFIGURED = Boolean(CLIENT_ID && treasury);

const chain = defineChain({
  id: CHAIN.id, name: CHAIN.name, nativeCurrency: CHAIN.currency,
  rpcUrls: { default: { http: [CHAIN.rpcUrl] } }, blockExplorers: { default: { name: 'L2Scan', url: CHAIN.explorer } }, testnet: CHAIN.testnet,
});
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
  let body: { action?: string };
  try { body = await req.json(); } catch { return reply({ error: 'Send JSON.' }, 400); }
  const status = { configured: CONFIGURED, chain: { id: CHAIN.id, name: CHAIN.name }, treasury: treasury?.address ?? null, perDoge: POINTS.perDoge, minRedeem: POINTS.minRedeem };
  if (body.action === 'status') return reply(status);
  if (body.action !== 'redeem') return reply({ error: 'Unknown action.' }, 400);
  if (!CONFIGURED) return reply({ error: 'Redeem is not configured.', ...status }, 503);

  // Who is asking, through their own session (this also checks the session is still live).
  const user = createClient(URL, ANON ?? SECRET, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: home, error: homeErr } = await user.rpc('team_home');
  if (homeErr || !home) return reply({ error: 'Sign in again first.' }, 401);
  const address = home.wallet?.address, points = Math.floor((home.wallet?.points ?? 0) / POINTS.minRedeem) * POINTS.minRedeem;
  if (!address) return reply({ error: 'Your key has no wallet address yet. Sign in again on the device that holds your key.' }, 400);
  if (points < POINTS.minRedeem) return reply({ error: `You need at least ${POINTS.minRedeem} points to redeem.` }, 400);

  const db = createClient(URL, SECRET, { auth: { persistSession: false } });
  const { data: allowed } = await db.rpc('rate_limit_hit', { p_bucket: `person:${home.person.id}:redeem`, p_max: 3, p_window_seconds: 3600 });
  if (allowed === false) return reply({ error: 'Too many redeems this hour. Try again later.' }, 429);
  const wei = pointsToWei(points);
  const { data: id, error: reserveErr } = await db.rpc('redeem_reserve', { p_person: home.person.id, p_points: points, p_amount_wei: wei.toString(), p_to: address, p_chain: CHAIN.id });
  if (reserveErr) return reply({ error: reserveErr.message }, 400);

  try {
    const wallet = createWalletClient({ account: treasury!, chain, transport: http(CHAIN.rpcUrl) });
    const hash = await wallet.sendTransaction({ to: address, value: wei });
    await db.rpc('redeem_finish', { p_id: id, p_tx_hash: hash, p_error: null });
    return reply({ receipt: { id, points, amount_wei: wei.toString(), to_address: address, tx_hash: hash, explorer: txUrl(hash), status: 'sent' } });
  } catch (e) {
    const msg = (e as Error).message?.split('\n')[0] ?? 'transfer failed';
    await db.rpc('redeem_finish', { p_id: id, p_tx_hash: null, p_error: msg });
    console.error('redeem failed', msg);
    return reply({ error: `The transfer did not go through, so your points are back. ${/insufficient funds/i.test(msg) ? 'The treasury needs testnet DOGE from the faucet.' : ''}`.trim() }, 502);
  }
});
