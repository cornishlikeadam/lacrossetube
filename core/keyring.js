// The player's one key: a secp256k1 (BIP-340 Schnorr) keypair made on this device. The secret
// never leaves the browser. It is stored in IndexedDB encrypted twice:
//   inner layer: AES-GCM under a key from a passkey's PRF output, or from a 6-digit PIN plus a
//                pepper that only the server holds;
//   outer layer: AES-GCM under a non-extractable device key that also lives in IndexedDB.
// The server releases a PIN key's pepper only for the right PIN and locks the key after repeated
// misses, so a copy of this browser's storage cannot be brute-forced offline.
// The same key is the person's DogeOS wallet: its 0x address is derived from it and stored with it.
//
// The caller passes a `server` (core/auth.js builds one per flow):
//   server.register(pubkey, signWithNewKey, verifierHex | null, address) -> pepperHex | null
//       once, when the key is made: joining from an invite, applying as a coach, or the /key test
//       page. A PIN key sends its verifier and gets its pepper; a passkey key sends null.
//   server.pepper(pubkey, verifierHex) -> pepperHex   (each unlock of a PIN key)
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { addressFromSecret } from '../supabase/functions/_shared/evm.js';
import { sealKeyFile } from './keyfile.js';
import { slot, suffix } from './trial.js';

// One key store per browser. In a preview trial build, one per trial slot (see core/trial.js).
const dbName = id => `lacrossetube-keyring${suffix(id)}`;
const STORE = 'kv', RECORD = 'key', DEVICE = 'device-key';
const addressOf = sk => addressFromSecret(sk, { secp256k1, keccak: keccak_256 });
const VERSION = 2;
const PBKDF2_ITERATIONS = 600000;
const PIN = /^\d{6}$/;
const te = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;
const random = n => globalThis.crypto.getRandomValues(new Uint8Array(n));

/* ---------- storage (IndexedDB, with a memory fallback for tests) ---------- */
const mem = new Map();
const dbs = new Map();
function open(id = slot) {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  if (!dbs.has(id)) dbs.set(id, new Promise(resolve => {
    const req = indexedDB.open(dbName(id), 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = req.onblocked = () => resolve(null);
  }));
  return dbs.get(id);
}
function idb(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode), r = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(r.result);
    tx.onerror = () => reject(tx.error);
  });
}
const get = async k => { const db = await open(); return db ? idb(db, 'readonly', s => s.get(k)) : mem.get(k); };
const put = async (k, v) => { const db = await open(); if (db) await idb(db, 'readwrite', s => s.put(v, k)); else mem.set(k, v); };
const del = async k => { const db = await open(); if (db) await idb(db, 'readwrite', s => s.delete(k)); else mem.delete(k); };

async function deviceKey() {
  let k = await get(DEVICE);
  if (!k) { k = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); await put(DEVICE, k); }
  return k;
}

/* ---------- crypto helpers ---------- */
async function seal(key, bytes) { const iv = random(12); return { iv, ct: new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, bytes)) }; }
async function unseal(key, { iv, ct }) { return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv }, key, ct)); }
async function hkdfKey(secret, salt) {
  const base = await subtle().importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: te.encode('lacrossetube keyring v2') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
// From a PIN: 32 stretched bytes, the verifier the server checks, and (with the server's pepper)
// the AES key. The server only ever sees the verifier, never the PIN or the stretched bytes.
async function stretchPin(pin, salt) {
  const base = await subtle().importKey('raw', te.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, base, 256));
  return { bits, verifier: bytesToHex(hmac(sha256, bits, te.encode('lacrossetube pin verifier v1'))) };
}
const pinKey = (bits, pepperHex, salt) => hkdfKey(new Uint8Array([...bits, ...hexToBytes(pepperHex)]), salt);

/* ---------- passkey PRF (WebAuthn) ---------- */
// Asks the browser whether passkeys can return a PRF secret. Browsers without
// getClientCapabilities get one try, and the PIN if that fails.
export async function prfAvailable() {
  const PKC = globalThis.PublicKeyCredential;
  if (typeof PKC !== 'function' || globalThis.isSecureContext === false) return false;
  if (typeof PKC.getClientCapabilities !== 'function') return true;
  try { return (await PKC.getClientCapabilities())['extension:prf'] === true; } catch { return false; }
}
const prfFirst = cred => { const r = cred?.getClientExtensionResults?.().prf?.results?.first; return r ? new Uint8Array(r) : null; };

async function createPrfSecret(salt, label) {
  const cred = await navigator.credentials.create({ publicKey: {
    rp: { name: 'LacrosseTube' },
    user: { id: random(16), name: label, displayName: label },
    challenge: random(32),
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    extensions: { prf: { eval: { first: salt } } },
  } });
  if (!cred) return null;
  const ext = cred.getClientExtensionResults?.().prf;
  if (!ext || ext.enabled === false) return null;
  const credId = new Uint8Array(cred.rawId);
  return { credId, secret: prfFirst(cred) ?? await getPrfSecret(credId, salt) };
}
async function getPrfSecret(credId, salt) {
  const cred = await navigator.credentials.get({ publicKey: {
    challenge: random(32),
    allowCredentials: [{ type: 'public-key', id: credId }],
    userVerification: 'required',
    extensions: { prf: { eval: { first: salt } } },
  } });
  const secret = prfFirst(cred);
  if (!secret) throw new Error('This passkey did not return a key. Remove this key and make one with a PIN.');
  return secret;
}

/* ---------- public API ---------- */
export const isPin = s => PIN.test(String(s));
export const publicKeyOf = sk => bytesToHex(schnorr.getPublicKey(sk));

export async function status() {
  const r = await get(RECORD);
  return r ? { pubkey: r.pub, method: r.method, created: r.created, address: r.address || null, outdated: r.v !== VERSION } : null;
}

// Creates and stores a new key. method 'prf' uses a passkey and falls back to the PIN when the
// browser cannot; 'pin' uses the PIN. A PIN key is enrolled with the server before it is stored.
export async function createKey({ pin, method = 'prf' } = {}, server) {
  if (await get(RECORD)) throw new Error('This device already has a key. Remove it before making another.');
  const sk = schnorr.utils.randomSecretKey(), salt = random(32), pub = publicKeyOf(sk), address = addressOf(sk);
  const signWithKey = msg => bytesToHex(schnorr.sign(msg, sk));
  try {
    let inner, used = 'pin', credId = null;
    if (method === 'prf' && await prfAvailable()) {
      try {
        const p = await createPrfSecret(salt, `LacrosseTube ${pub.slice(0, 8)}`);
        if (p?.secret) { inner = await hkdfKey(p.secret, salt); used = 'prf'; credId = p.credId; }
      } catch { /* cancelled, or no PRF after all: fall back to the PIN */ }
    }
    if (used === 'pin') {
      if (!isPin(pin)) throw new Error(method === 'prf' ? 'A passkey did not work here. Choose a 6-digit PIN instead.' : 'Choose a 6-digit PIN.');
      const { bits, verifier } = await stretchPin(pin, salt);
      const pepper = await server.register(pub, signWithKey, verifier, address);
      inner = await pinKey(bits, pepper, salt);
    } else await server.register(pub, signWithKey, null, address);
    const sealed = await seal(inner, sk);
    const outer = await seal(await deviceKey(), new Uint8Array([...sealed.iv, ...sealed.ct]));
    await put(RECORD, { v: VERSION, pub, address, method: used, salt, credId, outer, created: new Date().toISOString() });
    return { pubkey: pub, address, method: used };
  } finally { sk.fill(0); }
}

// Opens the key with the PIN (or the passkey) and passes the secret to fn, then wipes it.
export async function withSecret({ pin } = {}, server, fn) {
  const r = await get(RECORD);
  if (!r) throw new Error('No key on this device.');
  if (r.v !== VERSION) throw new Error('This key was made with an older version. Remove it and make a new one.');
  let inner;
  if (r.method === 'prf') inner = await hkdfKey(await getPrfSecret(r.credId, r.salt), r.salt);
  else {
    if (!isPin(pin)) throw new Error('Enter your 6-digit PIN.');
    const { bits, verifier } = await stretchPin(pin, r.salt);
    inner = await pinKey(bits, await server.pepper(r.pub, verifier), r.salt);
  }
  const packed = await unseal(await deviceKey(), r.outer);
  let sk;
  try { sk = await unseal(inner, { iv: packed.slice(0, 12), ct: packed.slice(12) }); }
  catch { throw new Error('This key could not be opened on this device.'); }
  // Keys made before wallets existed learn their address on first unlock.
  if (!r.address) await put(RECORD, { ...r, address: addressOf(sk) });
  try { return await fn(sk, r.pub); } finally { sk.fill(0); }
}

export async function sign(message, unlock, server) {
  return withSecret(unlock, server, sk => bytesToHex(schnorr.sign(message, sk)));
}

// A backup of this key as a file, encrypted with a passphrase the person chooses. Anyone with the
// file and the passphrase controls this key and its DogeOS address.
export async function exportKeyFile(unlock, server, passphrase) {
  return withSecret(unlock, server, sk => sealKeyFile(sk, passphrase, { kind: 'lacrossetube-key', address: addressOf(sk) }));
}

export async function removeKey() { await del(RECORD); }

// Trial slots: what each slot holds, and wiping one to stand in for a lost phone.
export async function statusOf(id) {
  if (!globalThis.indexedDB) return null;
  const db = await open(id);
  const r = db ? await idb(db, 'readonly', st => st.get(RECORD)) : null;
  return r ? { pubkey: r.pub, address: r.address || null, method: r.method } : null;
}
export async function wipeSlot(id) {
  const db = await open(id);
  if (db) await idb(db, 'readwrite', st => st.clear());
}
