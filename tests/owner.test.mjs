// The owner key: its encrypted file, and the signed requests the owner-verify function accepts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { newOwnerKey, openOwnerKey, signOwnerRequest } from '../scripts/owner-lib.mjs';
import { checkOwnerRequest, OWNER_TTL_MS } from '../supabase/functions/_shared/owner-core.js';

const FAST = { N: 2 ** 10, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };

test('the owner key file opens only with its passphrase and never holds the key in clear', () => {
  const file = newOwnerKey('correct horse battery', FAST);
  assert.match(file.pubkey, /^[0-9a-f]{64}$/);
  const sk = openOwnerKey(file, 'correct horse battery');
  assert.equal(Buffer.from(schnorr.getPublicKey(sk)).toString('hex'), file.pubkey);
  assert.ok(!JSON.stringify(file).includes(Buffer.from(sk).toString('hex')));
  assert.throws(() => openOwnerKey(file, 'wrong horse battery'), /Wrong passphrase/);
  assert.throws(() => newOwnerKey('short', FAST), /12 characters/);
});

test('owner requests verify only for the owner key, this action and payload, within five minutes', () => {
  const file = newOwnerKey('correct horse battery', FAST), sk = openOwnerKey(file, 'correct horse battery');
  const ctx = { ownerPubkey: file.pubkey, schnorr, sha256 };
  const req = signOwnerRequest(sk, 'verify_org', { org_id: 'a' });
  assert.equal(checkOwnerRequest(req, ctx), null);
  assert.match(checkOwnerRequest({ ...req, payload: { org_id: 'b' } }, ctx), /not signed by the owner/);
  assert.match(checkOwnerRequest({ ...req, action: 'list' }, ctx), /not signed by the owner/);
  assert.match(checkOwnerRequest(signOwnerRequest(schnorr.utils.randomSecretKey(), 'verify_org', { org_id: 'a' }), ctx), /not signed by the owner/);
  assert.match(checkOwnerRequest(signOwnerRequest(sk, 'verify_org', { org_id: 'a' }, Date.now() - OWNER_TTL_MS - 1000), ctx), /too old/);
  assert.match(checkOwnerRequest(req, { ...ctx, ownerPubkey: '' }), /no owner key/);
});

test('no team page shows a pay control (Phase 1 keeps money in the schema only)', () => {
  for (const f of ['coach.html', 'join.html', 'team.html', 'placement.html', 'core/coach-team.js', 'core/join-page.js', 'core/team-page.js', 'core/placement-page.js', 'core/ui.js']) {
    const text = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    const labels = [...text.matchAll(/<(button|a)\b[^>]*>([^<]*)</g)].map(m => m[2]);
    assert.ok(!labels.some(l => /\b(pay|tip|invoice|donate|sats|wallet|checkout|buy)\b/i.test(l)), `${f}: ${labels.join(' | ')}`);
  }
});
