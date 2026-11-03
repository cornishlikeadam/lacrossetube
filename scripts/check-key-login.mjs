// End-to-end check of key login and row-level security against a running Supabase
// (local by default). Uses throwaway keys and fake data only.
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/check-key-login.mjs
// With no env, it reads the local stack from `supabase status -o env`.
import { execSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { loginMessage } from '../supabase/functions/_shared/key-login-core.js';

function localEnv() {
  const out = execSync('npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const env = Object.fromEntries(out.split('\n').map(l => l.match(/^(\w+)="?(.*?)"?$/)).filter(Boolean).map(m => [m[1], m[2]]));
  return { url: env.API_URL, key: env.PUBLISHABLE_KEY || env.ANON_KEY };
}
const { url, key } = process.env.SUPABASE_URL ? { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_ANON_KEY } : localEnv();
const fn = `${url}/functions/v1/key-login`;

async function call(body) {
  const r = await fetch(fn, { method: 'POST', headers: { 'content-type': 'application/json', apikey: key }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}
async function login(sk, pub) {
  const { body: { challenge } } = await call({ step: 'challenge', pubkey: pub });
  const sig = bytesToHex(schnorr.sign(loginMessage(challenge, sha256), sk));
  return { challenge, sig, res: await call({ step: 'verify', pubkey: pub, challenge, sig }) };
}
const throwaway = () => { const sk = schnorr.utils.randomSecretKey(); return { sk, pub: bytesToHex(schnorr.getPublicKey(sk)) }; };
async function client(session) {
  const c = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.setSession(session);
  assert.ifError(error);
  return c;
}

const a = throwaway(), b = throwaway();
const first = await login(a.sk, a.pub);
assert.equal(first.res.status, 200, JSON.stringify(first.res.body));
console.log('ok  throwaway key A logs in, person', first.res.body.personId.slice(0, 8));

const replay = await call({ step: 'verify', pubkey: a.pub, challenge: first.challenge, sig: first.sig });
assert.equal(replay.status, 409);
console.log('ok  the same challenge cannot be used twice');

const again = await login(a.sk, a.pub);
assert.equal(again.res.status, 200);
assert.equal(again.res.body.personId, first.res.body.personId);
console.log('ok  key A logs in again as the same person');

const wrong = await call({ step: 'verify', pubkey: a.pub, challenge: (await call({ step: 'challenge', pubkey: a.pub })).body.challenge, sig: bytesToHex(schnorr.sign(new Uint8Array(32), b.sk)) });
assert.equal(wrong.status, 401);
console.log('ok  a signature from another key is refused');

const second = await login(b.sk, b.pub);
assert.equal(second.res.status, 200);
const ca = await client(again.res.body.session), cb = await client(second.res.body.session);

const { data: myKeys } = await ca.from('keys').select('pubkey');
assert.deepEqual(myKeys.map(k => k.pubkey), [a.pub]);
const { data: people } = await ca.from('people').select('id');
assert.deepEqual(people.map(p => p.id), [first.res.body.personId]);
console.log('ok  A sees only A\'s person row and key');

assert.ifError((await ca.from('locker').insert({ person_id: first.res.body.personId, item_id: 'fake-film-1' })).error);
const sneak = await cb.from('locker').insert({ person_id: first.res.body.personId, item_id: 'fake-film-2' });
assert.ok(sneak.error, 'B must not write into A\'s locker');
const { data: bSees } = await cb.from('locker').select('item_id');
assert.equal(bSees.length, 0);
console.log('ok  A writes A\'s locker; B can neither read nor write it');

const ageEdit = await ca.from('people').update({ age_band: '18_plus' }).eq('id', first.res.body.personId);
assert.ok(ageEdit.error, 'age band must not be self-editable');
console.log('ok  A cannot change their own age band');

for (const t of ['invites', 'payments', 'board_cards', 'orders']) {
  const { data, error } = await ca.from(t).select('*').limit(1);
  assert.ok(error || data.length === 0, `${t} must be closed`);
}
const anon = createClient(url, key, { auth: { persistSession: false } });
const { error: anonPeople } = await anon.from('people').select('id').limit(1);
assert.ok(anonPeople, 'anon must not read people');
assert.ifError((await anon.from('catalog_items').select('id').limit(1)).error);
console.log('ok  money, invites and board tables are closed; anon reads only the shelf tables');

const signup = await anon.auth.signUp({ email: `fake-${Date.now()}@example.com`, password: 'not-a-real-password-1' });
assert.ok(signup.error, 'email signup must be off');
console.log('ok  email and password signup is refused');

// PIN keys: enroll once, get the pepper back only for the right verifier, lock after misses.
const c = throwaway(), hex32 = () => bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
const verifier = hex32();
async function enroll(k, v) {
  const { body: { challenge } } = await call({ step: 'challenge', pubkey: k.pub });
  return call({ step: 'enroll', pubkey: k.pub, challenge, sig: bytesToHex(schnorr.sign(loginMessage(challenge, sha256), k.sk)), verifier: v });
}
const enrolled = await enroll(c, verifier);
assert.equal(enrolled.status, 200, JSON.stringify(enrolled.body));
assert.match(enrolled.body.pepper, /^[0-9a-f]{64}$/);
assert.equal((await enroll(c, hex32())).status, 409);
const pin = v => call({ step: 'pin', pubkey: c.pub, verifier: v });
assert.equal((await pin(verifier)).body.pepper, enrolled.body.pepper);
console.log('ok  a PIN key enrolls once and gets its pepper back for the right PIN');

const misses = [];
for (let i = 0; i < 5; i++) misses.push((await pin(hex32())).status);
assert.deepEqual(misses, [401, 401, 401, 401, 429]);
assert.equal((await pin(verifier)).status, 429, 'the right PIN must wait out the lock');
console.log('ok  five wrong PINs lock the key, even against the right PIN');

const ca2 = await client((await login(a.sk, a.pub)).res.body.session);
assert.ok((await ca2.from('keys').select('pin_pepper')).error, 'the pepper must not be readable');
assert.ok((await ca2.from('keys').select('*')).error, 'select * must fail on the hidden columns');
assert.ifError((await ca2.from('keys').select('pubkey, status')).error);
console.log('ok  the browser cannot read PIN verifiers or peppers, even for its own key');

let limited = false;
for (let i = 0; i < 40 && !limited; i++) limited = (await call({ step: 'challenge', pubkey: c.pub })).status === 429;
assert.ok(limited, 'challenges from one IP must hit the rate limit');
console.log('ok  challenge requests from one IP are rate-limited');
console.log('\nkey login and RLS checks passed against', url);
