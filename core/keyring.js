// The player's one key: a secp256k1 (BIP-340 Schnorr) keypair made on this device. The secret
// never leaves the browser. It is stored in IndexedDB encrypted twice:
//   inner layer: AES-GCM under a key from a passkey's PRF output, or from a 6-digit PIN (PBKDF2);
//   outer layer: AES-GCM under a non-extractable device key that also lives in IndexedDB.
// A copied database file without this browser's device key, or without the PIN or passkey, is useless.
// The key is for login and signing only. It never holds funds.
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';

const DB = 'lacrossetube-keyring', STORE = 'kv', RECORD = 'key', DEVICE = 'device-key';
const PBKDF2_ITERATIONS = 600000;
const PIN = /^\d{6}$/;
const MAX_TRIES = 5, LOCKOUT_MS = 30000;
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
async function pinKey(pin, salt) {
  const base = await subtle().importKey('raw', te.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function prfKey(secret, salt) {
  const base = await subtle().importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: te.encode('lacrossetube keyring v1') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/* ---------- passkey PRF (WebAuthn) ---------- */
export function prfSupported() {
  return typeof globalThis.PublicKeyCredential === 'function' && globalThis.isSecureContext !== false;
}
const prfFirst = cred => { const r = cred?.getClientExtensionResults?.().prf?.results?.first; return r ? new Uint8Array(r) : null; };

// Makes a passkey and asks it for a PRF secret. Returns null when the browser or authenticator
// has no PRF, so the caller can fall back to a PIN.
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
  if (!secret) throw new Error('This passkey did not return a key. Use your PIN instead.');
  return secret;
}

/* ---------- public API ---------- */
export const isPin = s => PIN.test(String(s));
export const publicKeyOf = sk => bytesToHex(schnorr.getPublicKey(sk));

export async function status() {
  const r = await get(RECORD);
  return r ? { pubkey: r.pub, method: r.method, created: r.created } : null;
}

// Creates and stores a new key. method: 'prf' tries a passkey first and falls back to the PIN
// when the browser has no PRF; 'pin' uses the PIN only. Returns { pubkey, method }.
export async function createKey({ pin, method = 'prf' } = {}) {
  if (await get(RECORD)) throw new Error('This device already has a key. Remove it before making another.');
  const sk = schnorr.utils.randomSecretKey(), salt = random(32), pub = publicKeyOf(sk);
  let inner, used = 'pin', credId = null;
  if (method === 'prf' && prfSupported()) {
    try {
      const p = await createPrfSecret(salt, `LacrosseTube ${pub.slice(0, 8)}`);
      if (p?.secret) { inner = await prfKey(p.secret, salt); used = 'prf'; credId = p.credId; }
    } catch { /* user cancelled or no PRF: fall back to the PIN */ }
  }
  if (used === 'pin') {
    if (!isPin(pin)) throw new Error('Choose a 6-digit PIN.');
    inner = await pinKey(pin, salt);
  }
  const sealed = await seal(inner, sk);
  const outer = await seal(await deviceKey(), new Uint8Array([...sealed.iv, ...sealed.ct]));
  sk.fill(0);
  await put(RECORD, { v: 1, pub, method: used, salt, credId, outer, created: new Date().toISOString(), tries: 0, lockedUntil: 0 });
  return { pubkey: pub, method: used };
}

// Opens the key with the PIN (or the passkey) and passes the secret to fn, then wipes it.
export async function withSecret({ pin } = {}, fn) {
  const r = await get(RECORD);
  if (!r) throw new Error('No key on this device.');
  if (r.lockedUntil > Date.now()) throw new Error(`Too many wrong PINs. Try again in ${Math.ceil((r.lockedUntil - Date.now()) / 1000)} seconds.`);
  const inner = r.method === 'prf' ? await prfKey(await getPrfSecret(r.credId, r.salt), r.salt) : (isPin(pin) ? await pinKey(pin, r.salt) : null);
  if (!inner) throw new Error('Enter your 6-digit PIN.');
  const packed = await unseal(await deviceKey(), r.outer);
  let sk;
  try { sk = await unseal(inner, { iv: packed.slice(0, 12), ct: packed.slice(12) }); }
  catch {
    const tries = (r.tries || 0) + 1;
    await put(RECORD, { ...r, tries: tries >= MAX_TRIES ? 0 : tries, lockedUntil: tries >= MAX_TRIES ? Date.now() + LOCKOUT_MS : 0 });
    throw new Error(r.method === 'prf' ? 'The passkey did not unlock this key.' : 'Wrong PIN.');
  }
  if (r.tries) await put(RECORD, { ...r, tries: 0, lockedUntil: 0 });
  try { return await fn(sk, r.pub); } finally { sk.fill(0); }
}

export async function sign(message, unlock) {
  return withSecret(unlock, sk => bytesToHex(schnorr.sign(message, sk)));
}

export async function removeKey() { await del(RECORD); }
export { hexToBytes };
