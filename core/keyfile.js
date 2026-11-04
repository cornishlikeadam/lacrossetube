// Encrypted key files, in the browser. Same format as scripts/owner-lib.mjs writes in Node:
// { v: 1, pubkey, kdf: { N, r, p, salt }, iv, ct, tag } with scrypt + AES-256-GCM, all hex.
// Used to open the owner key file (from `node scripts/owner.mjs init`) on the owner page, and to
// download a player's own key as a backup file.
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { schnorr } from '@noble/curves/secp256k1.js';

const KDF = { N: 2 ** 17, r: 8, p: 1 };
const subtle = () => globalThis.crypto.subtle;
const kek = (passphrase, salt, { N, r, p }) =>
  scryptAsync(new TextEncoder().encode(String(passphrase).normalize('NFKC')), salt, { N, r, p, dkLen: 32, maxmem: 256 * 1024 * 1024 });

export async function sealKeyFile(sk, passphrase, extra = {}) {
  if (String(passphrase).length < 12) throw new Error('Use a passphrase of at least 12 characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await subtle().importKey('raw', await kek(passphrase, salt, KDF), 'AES-GCM', false, ['encrypt']);
  const sealed = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, sk));
  return { v: 1, ...extra, pubkey: bytesToHex(schnorr.getPublicKey(sk)), kdf: { ...KDF, salt: bytesToHex(salt) },
    iv: bytesToHex(iv), ct: bytesToHex(sealed.slice(0, -16)), tag: bytesToHex(sealed.slice(-16)) };
}

export async function openKeyFile(file, passphrase) {
  if (file?.v !== 1 || !file.kdf || !file.ct || !file.tag) throw new Error('That is not a LacrosseTube key file.');
  const { N, r, p, salt } = file.kdf;
  const key = await subtle().importKey('raw', await kek(passphrase, hexToBytes(salt), { N, r, p }), 'AES-GCM', false, ['decrypt']);
  let sk;
  try { sk = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: hexToBytes(file.iv) }, key, new Uint8Array([...hexToBytes(file.ct), ...hexToBytes(file.tag)]))); }
  catch { throw new Error('Wrong passphrase.'); }
  if (bytesToHex(schnorr.getPublicKey(sk)) !== file.pubkey) throw new Error('The key file is damaged.');
  return sk;
}

export function download(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
