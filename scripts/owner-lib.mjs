// The owner key, as the owner CLI keeps it: a secp256k1 key encrypted with a passphrase
// (scrypt + AES-256-GCM) in a file outside the repo. Only the public key is ever shared.
import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { ownerMessage } from '../supabase/functions/_shared/owner-core.js';

const KDF = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const kek = (passphrase, salt, kdf) => scryptSync(passphrase.normalize('NFKC'), salt, 32, kdf);

export function newOwnerKey(passphrase, kdf = KDF) {
  if (String(passphrase).length < 12) throw new Error('Use a passphrase of at least 12 characters.');
  const sk = schnorr.utils.randomSecretKey(), salt = randomBytes(16), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', kek(passphrase, salt, kdf), iv);
  const ct = Buffer.concat([cipher.update(sk), cipher.final()]);
  const file = { v: 1, pubkey: bytesToHex(schnorr.getPublicKey(sk)), kdf: { N: kdf.N, r: kdf.r, p: kdf.p, salt: salt.toString('hex') },
    iv: iv.toString('hex'), ct: ct.toString('hex'), tag: cipher.getAuthTag().toString('hex') };
  sk.fill(0);
  return file;
}

export function openOwnerKey(file, passphrase) {
  const { N, r, p, salt } = file.kdf;
  const d = createDecipheriv('aes-256-gcm', kek(passphrase, Buffer.from(salt, 'hex'), { N, r, p, maxmem: KDF.maxmem }), Buffer.from(file.iv, 'hex'));
  d.setAuthTag(Buffer.from(file.tag, 'hex'));
  let sk;
  try { sk = new Uint8Array(Buffer.concat([d.update(Buffer.from(file.ct, 'hex')), d.final()])); }
  catch { throw new Error('Wrong passphrase.'); }
  if (bytesToHex(schnorr.getPublicKey(sk)) !== file.pubkey) throw new Error('The key file is damaged.');
  return sk;
}

// A signed owner request body for the owner-verify function.
export function signOwnerRequest(sk, action, payload, ts = Date.now()) {
  return { action, payload, ts, sig: bytesToHex(schnorr.sign(ownerMessage(action, payload, ts, sha256), sk)) };
}

export { hexToBytes };
