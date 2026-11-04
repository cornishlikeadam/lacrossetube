// The DogeOS wallet that is also the login key: its address, the chain config, points to DOGE,
// and encrypted key files that the owner CLI (Node) and the browser can both open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex } from '@noble/curves/utils.js';
import { addressFromSecret, addressesForXOnly, checksum } from '../supabase/functions/_shared/evm.js';
import { CHAIN, POINTS, pointsToWei, formatDoge, txUrl } from '../supabase/functions/_shared/chain.js';
import { sealKeyFile, openKeyFile } from '../core/keyfile.js';
import { newOwnerKey, openOwnerKey } from '../scripts/owner-lib.mjs';
import * as keyring from '../core/keyring.js';

const deps = { secp256k1, keccak: keccak_256 };

test('the 0x address follows Ethereum rules (known vector, EIP-55 checksum)', () => {
  const one = new Uint8Array(32); one[31] = 1;
  assert.equal(addressFromSecret(one, deps), '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf');
  assert.equal(checksum('0x7e5f4552091a69125d5dfcb7b8c2659029395bdf', keccak_256), '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf');
});

test('the server can check a claimed address against the login key', () => {
  for (let i = 0; i < 10; i++) {
    const sk = schnorr.utils.randomSecretKey(), mine = addressFromSecret(sk, deps);
    const allowed = addressesForXOnly(bytesToHex(schnorr.getPublicKey(sk)), deps);
    assert.ok(allowed.includes(mine));
    assert.ok(!allowed.includes(addressFromSecret(schnorr.utils.randomSecretKey(), deps)));
  }
});

test('one chain config: DogeOS Chikyū Testnet, points to DOGE', () => {
  assert.equal(CHAIN.id, 6281971);
  assert.equal(CHAIN.rpcUrl, 'https://rpc.testnet.dogeos.com/');
  assert.equal(CHAIN.explorer, 'https://dogeos-testnet.l2scan.co');
  assert.equal(CHAIN.testnet, true);
  assert.equal(pointsToWei(POINTS.perDoge), 10n ** 18n);
  assert.equal(formatDoge(pointsToWei(250)), '0.25 DOGE');
  assert.match(txUrl('0xab'), /^https:\/\/dogeos-testnet\.l2scan\.co\/tx\/0xab$/);
});

test('a new key carries its wallet address and registers it with the server', async () => {
  await keyring.removeKey();
  let sent = null;
  const server = { register: async (pub, sign, verifier, address) => { sent = address; return bytesToHex(crypto.getRandomValues(new Uint8Array(32))); }, pepper: async () => 'x' };
  const { address } = await keyring.createKey({ method: 'pin', pin: '246810' }, server);
  assert.match(address, /^0x[0-9a-fA-F]{40}$/);
  assert.equal(sent, address);
  assert.equal((await keyring.status()).address, address);
  await keyring.removeKey();
});

test('key files: the browser opens what the owner CLI writes, and the CLI opens what the browser writes', async () => {
  const fast = { N: 2 ** 10, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };
  const cliFile = newOwnerKey('owner passphrase 1', fast);
  const sk = await openKeyFile(cliFile, 'owner passphrase 1');
  assert.equal(bytesToHex(schnorr.getPublicKey(sk)), cliFile.pubkey);
  await assert.rejects(openKeyFile(cliFile, 'wrong passphrase'), /Wrong passphrase/);

  const mine = schnorr.utils.randomSecretKey();
  const browserFile = await sealKeyFile(mine, 'player passphrase', { kind: 'lacrossetube-key', address: addressFromSecret(mine, deps) });
  assert.equal(browserFile.kdf.N, 2 ** 17);
  assert.ok(!JSON.stringify(browserFile).includes(bytesToHex(mine)));
  assert.equal(bytesToHex(openOwnerKey(browserFile, 'player passphrase')), bytesToHex(mine));
});

test('trial and owner pages carry no pay controls either', () => {
  for (const f of ['trial.html', 'owner.html', 'core/trial-page.js', 'core/owner-page.js', 'core/team-page.js']) {
    const text = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    const labels = [...text.matchAll(/<(button|a)\b[^>]*>([^<]*)</g)].map(m => m[2]);
    assert.ok(!labels.some(l => /\b(pay|tip|invoice|donate|checkout|buy)\b/i.test(l)), `${f}: ${labels.join(' | ')}`);
  }
});
