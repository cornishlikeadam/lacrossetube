// Key login without a server: the challenge/signature core the Edge Function runs, and the
// device keyring (in Node it falls back to memory storage instead of IndexedDB).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { keyLoginCore, loginMessage, KeyLoginError, CHALLENGE_TTL_MS } from '../supabase/functions/_shared/key-login-core.js';
import * as keyring from '../core/keyring.js';

const newKey = () => { const sk = schnorr.utils.randomSecretKey(); return { sk, pub: bytesToHex(schnorr.getPublicKey(sk)) }; };
const signFor = (challenge, sk) => bytesToHex(schnorr.sign(loginMessage(challenge, sha256), sk));
const core = (opts = {}) => keyLoginCore({ schnorr, sha256, hmac, secret: 'test-secret', ...opts });
const rejects = (fn, status) => assert.throws(fn, e => e instanceof KeyLoginError && e.status === status);

test('a signed challenge is accepted and returns the issue time', () => {
  const { sk, pub } = newKey(), c = core(), { challenge } = c.issue(pub);
  const out = c.check(challenge, signFor(challenge, sk), pub);
  assert.equal(out.pub, pub);
  assert.equal(typeof out.iat, 'number');
});

test('another key, a tampered challenge, or another server secret is refused', () => {
  const a = newKey(), b = newKey(), c = core(), { challenge } = c.issue(a.pub);
  rejects(() => c.check(challenge, signFor(challenge, b.sk), a.pub), 401);
  rejects(() => c.check(challenge, signFor(challenge, b.sk), b.pub), 401);
  const [payload, mac] = challenge.split('.');
  const forged = `${payload.slice(0, -2)}AA.${mac}`;
  rejects(() => c.check(forged, signFor(forged, a.sk), a.pub), 401);
  rejects(() => core({ secret: 'other' }).check(challenge, signFor(challenge, a.sk), a.pub), 401);
});

test('an expired challenge is refused', () => {
  let t = 1_800_000_000_000;
  const { sk, pub } = newKey(), c = core({ now: () => t }), { challenge } = c.issue(pub);
  t += CHALLENGE_TTL_MS + 1;
  rejects(() => c.check(challenge, signFor(challenge, sk), pub), 401);
});

test('malformed input is a 400, not a crash', () => {
  const { pub } = newKey(), c = core();
  rejects(() => c.issue('not-a-key'), 400);
  rejects(() => c.check('x', 'y', pub), 400);
  rejects(() => c.check('a.b.c', '0'.repeat(128), pub), 400);
});

// Stands in for the key-login function's enroll and pin steps (the real lockout is tested
// against Supabase by scripts/check-key-login.mjs).
function fakePinServer() {
  const keys = new Map(), c = core();
  return {
    keys,
    async register(pub, signWithNewKey, verifier) {
      const { challenge } = c.issue(pub);
      c.check(challenge, signWithNewKey(loginMessage(challenge, sha256)), pub);
      const pepper = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
      keys.set(pub, { verifier, pepper });
      return pepper;
    },
    async pepper(pub, verifier) {
      const k = keys.get(pub);
      if (!k || k.verifier !== verifier) throw new Error('Wrong PIN.');
      return k.pepper;
    },
  };
}

test('keyring: a PIN key needs both the PIN and the server pepper', async () => {
  await keyring.removeKey();
  const server = fakePinServer();
  const { pubkey, method } = await keyring.createKey({ method: 'pin', pin: '482915' }, server);
  assert.equal(method, 'pin');
  assert.match(pubkey, /^[0-9a-f]{64}$/);
  assert.match(server.keys.get(pubkey).verifier, /^[0-9a-f]{64}$/);
  assert.notEqual(server.keys.get(pubkey).verifier, '482915');
  await assert.rejects(keyring.createKey({ method: 'pin', pin: '111111' }, server), /already has a key/);

  const c = core(), { challenge } = c.issue(pubkey);
  const sig = await keyring.sign(loginMessage(challenge, sha256), { pin: '482915' }, server);
  assert.equal(c.check(challenge, sig, pubkey).pub, pubkey);

  await assert.rejects(keyring.sign(new Uint8Array(32), { pin: '000000' }, server), /Wrong PIN/);
  // The right PIN with a different pepper (a copied device, no server) does not open the key.
  const liar = { pepper: async () => bytesToHex(crypto.getRandomValues(new Uint8Array(32))) };
  await assert.rejects(keyring.sign(new Uint8Array(32), { pin: '482915' }, liar), /could not be opened/);
  await keyring.removeKey();
  assert.equal(await keyring.status(), null);
});

test('keyring: only exactly six digits count as a PIN', async () => {
  assert.equal(keyring.isPin('123456'), true);
  for (const bad of ['12345', '1234567', '12a456', '', ' 123456']) assert.equal(keyring.isPin(bad), false);
  await keyring.removeKey();
  await assert.rejects(keyring.createKey({ method: 'pin', pin: '1234' }, fakePinServer()), /6-digit PIN/);
});

test('keyring: no passkeys in this runtime, so a passkey request falls back to the PIN', async () => {
  assert.equal(await keyring.prfAvailable(), false);
  await keyring.removeKey();
  const { method } = await keyring.createKey({ method: 'prf', pin: '135790' }, fakePinServer());
  assert.equal(method, 'pin');
  await keyring.removeKey();
});
