// The player's one key: a secp256k1 (BIP-340 Schnorr) keypair made on this device. The secret
// never leaves the browser. It is stored in IndexedDB encrypted twice:
//   inner layer: AES-GCM under a key from a passkey's PRF output, or from a 6-digit PIN plus a
//                pepper that only the server holds;
//   outer layer: AES-GCM under a non-extractable device key that also lives in IndexedDB.
// The server releases a PIN key's pepper only for the right PIN and locks the key after repeated
// misses, so a copy of this browser's storage cannot be brute-forced offline.
// The key is for login and signing only. It never holds funds.
//
// PIN keys talk to the server through a `pins` service the caller passes in (core/auth.js does):
//   pins.enroll(pubkey, signWithNewKey, verifierHex) -> pepperHex   (once, when the key is made)
//   pins.pepper(pubkey, verifierHex)                 -> pepperHex   (each unlock)
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

const DB = 'lacrossetube-keyring', STORE = 'kv', RECORD = 'key', DEVICE = 'device-key';
const VERSION = 2;
const PBKDF2_ITERATIONS = 600000;
const PIN = /^\d{6}$/;
const te = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;
const random = n => globalThis.crypto.getRandomValues(new Uint8Array(n));

/* ---------- storage (IndexedDB, with a memory fallback for tests) ---------- */
const mem = new Map();
let dbp = null;
function open() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  return dbp ??= new Promise(resolve => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = req.onblocked = () => resolve(null);
  });
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
  return r ? { pubkey: r.pub, method: r.method, created: r.created, outdated: r.v !== VERSION } : null;
}

// Creates and stores a new key. method 'prf' uses a passkey and falls back to the PIN when the
// browser cannot; 'pin' uses the PIN. A PIN key is enrolled with the server before it is stored.
export async function createKey({ pin, method = 'prf' } = {}, pins) {
  if (await get(RECORD)) throw new Error('This device already has a key. Remove it before making another.');
  const sk = schnorr.utils.randomSecretKey(), salt = random(32), pub = publicKeyOf(sk);
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
      if (!pins) throw new Error('A PIN key needs the server to enroll it.');
      const { bits, verifier } = await stretchPin(pin, salt);
      const pepper = await pins.enroll(pub, msg => bytesToHex(schnorr.sign(msg, sk)), verifier);
      inner = await pinKey(bits, pepper, salt);
    }
    const sealed = await seal(inner, sk);
    const outer = await seal(await deviceKey(), new Uint8Array([...sealed.iv, ...sealed.ct]));
    await put(RECORD, { v: VERSION, pub, method: used, salt, credId, outer, created: new Date().toISOString() });
    return { pubkey: pub, method: used };
  } finally { sk.fill(0); }
}

// Opens the key with the PIN (or the passkey) and passes the secret to fn, then wipes it.
export async function withSecret({ pin } = {}, pins, fn) {
  const r = await get(RECORD);
  if (!r) throw new Error('No key on this device.');
  if (r.v !== VERSION) throw new Error('This key was made with an older version. Remove it and make a new one.');
  let inner;
  if (r.method === 'prf') inner = await hkdfKey(await getPrfSecret(r.credId, r.salt), r.salt);
  else {
    if (!isPin(pin)) throw new Error('Enter your 6-digit PIN.');
    const { bits, verifier } = await stretchPin(pin, r.salt);
    inner = await pinKey(bits, await pins.pepper(r.pub, verifier), r.salt);
  }
  const packed = await unseal(await deviceKey(), r.outer);
  let sk;
  try { sk = await unseal(inner, { iv: packed.slice(0, 12), ct: packed.slice(12) }); }
  catch { throw new Error('This key could not be opened on this device.'); }
  try { return await fn(sk, r.pub); } finally { sk.fill(0); }
}

export async function sign(message, unlock, pins) {
  return withSecret(unlock, pins, sk => bytesToHex(schnorr.sign(message, sk)));
}

export async function removeKey() { await del(RECORD); }
