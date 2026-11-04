// Redeem against the LOCAL stack, with the functions served from an env file that sets
// DOGEOS_CLIENT_ID and an EMPTY throwaway TREASURY_PRIVATE_KEY. A player earns points in placement,
// redeems, the transfer reaches the real DogeOS testnet RPC and fails for lack of funds, and the
// points come back with a "failed" receipt. Fake people only; nothing is sent.
import { execSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { loginMessage } from '../supabase/functions/_shared/key-login-core.js';
import { addressFromSecret } from '../supabase/functions/_shared/evm.js';
import { signOwnerRequest } from './owner-lib.mjs';

const env = Object.fromEntries(execSync('npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  .split('\n').map(l => l.match(/^(\w+)="?(.*?)"?$/)).filter(Boolean).map(m => [m[1], m[2]]));
process.loadEnvFile(new URL('../supabase/.env.owner-test', import.meta.url));
const url = env.API_URL, key = env.PUBLISHABLE_KEY, ownerSk = hexToBytes(process.env.LT_TEST_OWNER_SK);
const fn = async (name, body, token) => {
  const r = await fetch(`${url}/functions/v1/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: key, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const device = () => { const sk = schnorr.utils.randomSecretKey(); return { sk, pub: bytesToHex(schnorr.getPublicKey(sk)), address: addressFromSecret(sk, { secp256k1, keccak: keccak_256 }) }; };
async function signed(d, extra) {
  const { body: { challenge } } = await fn('key-login', { step: 'challenge', pubkey: d.pub });
  return { pubkey: d.pub, challenge, sig: bytesToHex(schnorr.sign(loginMessage(challenge, sha256), d.sk)), verifier: bytesToHex(crypto.getRandomValues(new Uint8Array(32))), address: d.address, ...extra };
}
const client = async session => { const c = createClient(url, key, { auth: { persistSession: false } }); await c.auth.setSession(session); return c; };

const coachRes = await fn('key-login', { step: 'apply', ...(await signed(device(), { coach: { first_name: 'Redeem', last_initial: 'T' }, team: { name: `Redeem Test ${Date.now().toString(36)}`, city: 'Lab' } })) });
assert.equal(coachRes.status, 200, JSON.stringify(coachRes.body));
const coach = await client(coachRes.body.session);
assert.equal((await fn('owner-verify', signOwnerRequest(ownerSk, 'verify_org', { org_id: coachRes.body.orgId }))).status, 200);
await coach.rpc('roster_add', { p_org: coachRes.body.orgId, p_first_name: 'Pat', p_last_initial: 'Q', p_number: '9', p_position: 'attack', p_age_band: '18_plus' });
const { data: roster } = await coach.rpc('roster_for_coach', { p_org: coachRes.body.orgId });
const { data: [inv] } = await coach.rpc('invite_create', { p_org: coachRes.body.orgId, p_person: roster.find(r => r.role === 'player').person_id });

const pat = device();
const bad = await fn('key-login', { step: 'invite-accept', code: inv.code, ...(await signed(pat, { address: device().address })) });
assert.equal(bad.status, 400, 'an address that is not this key\'s is refused');
const joined = await fn('key-login', { step: 'invite-accept', code: inv.code, ...(await signed(pat)) });
assert.equal(joined.status, 200, JSON.stringify(joined.body));
const player = await client(joined.body.session), token = joined.body.session.access_token;
console.log('ok  the key\'s own address is stored; a wrong address is refused');

await player.rpc('placement_submit', { p_results: ['help', 'talk', 'slide', 'angle', 'hustle'].map(concept => ({ concept, idea_id: `fake-${concept}`, grade: 'perfect' })) });
const before = (await player.rpc('team_home')).data.wallet;
assert.equal(before.address, pat.address); assert.equal(before.points, 750);
console.log(`ok  placement earned ${before.points} points in Supabase; wallet ${before.address.slice(0, 10)}…`);

const st = await fn('redeem', { action: 'status' }, token);
assert.equal(st.body.configured, true, JSON.stringify(st.body));
const res = await fn('redeem', { action: 'redeem' }, token);
assert.equal(res.status, 502, JSON.stringify(res.body));
assert.match(res.body.error, /points are back/);
const after = (await player.rpc('team_home')).data.wallet;
assert.equal(after.points, 750);
assert.equal(after.receipts[0].status, 'failed'); assert.equal(after.receipts[0].points, 700); assert.equal(after.receipts[0].to_address, pat.address);
console.log(`ok  redeem reserved 700 points, the empty treasury could not pay on chain ${st.body.chain.id}, the points came back and a failed receipt was written`);
assert.equal((await fn('redeem', { action: 'redeem' })).status, 401);
console.log('ok  redeem needs a signed-in person');
console.log('\nRedeem checks passed against', url);
