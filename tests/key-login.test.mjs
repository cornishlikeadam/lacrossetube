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

test('keyring: a PIN key signs, a wrong PIN fails, and five wrong PINs lock it', async () => {
  await keyring.removeKey();
  const { pubkey, method } = await keyring.createKey({ method: 'pin', pin: '482915' });
  assert.equal(method, 'pin');
  assert.match(pubkey, /^[0-9a-f]{64}$/);
  await assert.rejects(keyring.createKey({ method: 'pin', pin: '111111' }), /already has a key/);

  const c = core(), { challenge } = c.issue(pubkey);
  const sig = await keyring.sign(loginMessage(challenge, sha256), { pin: '482915' });
  assert.equal(c.check(challenge, sig, pubkey).pub, pubkey);

  await assert.rejects(keyring.sign(new Uint8Array(32), { pin: '000000' }), /Wrong PIN/);
  for (let i = 0; i < 4; i++) await keyring.sign(new Uint8Array(32), { pin: '000000' }).catch(() => {});
  await assert.rejects(keyring.sign(new Uint8Array(32), { pin: '482915' }), /Too many wrong PINs/);
  await keyring.removeKey();
  assert.equal(await keyring.status(), null);
});

test('keyring: only exactly six digits count as a PIN', async () => {
  assert.equal(keyring.isPin('123456'), true);
  for (const bad of ['12345', '1234567', '12a456', '', ' 123456']) assert.equal(keyring.isPin(bad), false);
  await keyring.removeKey();
  await assert.rejects(keyring.createKey({ method: 'pin', pin: '1234' }), /6-digit PIN/);
});
