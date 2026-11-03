// Key login, the part with no I/O: issue a one-time challenge and check a BIP-340 Schnorr
// signature over it. The Edge Function (Deno) and the tests (Node) pass in the same @noble
// functions, so both run exactly this code.
//
// A challenge is `<payload>.<mac>`: base64url JSON { v, pub, iat, exp, n } and an HMAC-SHA256 of it
// under a server-only key, so the server needs no table to remember what it issued. Each challenge
// is used once because the function only accepts a login whose `iat` is newer than the key's
// last accepted login (keys.last_login_at).
export const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const SKEW_MS = 30 * 1000;
const PREFIX = 'lacrossetube-key-login:';
const HEX64 = /^[0-9a-f]{64}$/, HEX128 = /^[0-9a-f]{128}$/;
const te = new TextEncoder(), td = new TextDecoder();

const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const unhex = s => Uint8Array.from(s.match(/../g), h => parseInt(h, 16));
function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export class KeyLoginError extends Error {
  constructor(message, status = 401) { super(message); this.status = status; }
}

// The 32 bytes the player's key signs for a challenge. The browser and the server both use this.
export const loginMessage = (challenge, sha256) => sha256(te.encode(PREFIX + challenge));

export function keyLoginCore({ schnorr, sha256, hmac, secret, now = () => Date.now(), random = n => crypto.getRandomValues(new Uint8Array(n)) }) {
  if (!secret) throw new Error('key login needs a server secret');
  const macKey = hmac(sha256, te.encode(String(secret)), te.encode('lacrossetube key-login challenge v1'));
  const mac = payload => hmac(sha256, macKey, te.encode(payload));

  function issue(pub) {
    if (!HEX64.test(pub)) throw new KeyLoginError('That is not a public key.', 400);
    const iat = now();
    const payload = b64url(te.encode(JSON.stringify({ v: 1, pub, iat, exp: iat + CHALLENGE_TTL_MS, n: hex(random(16)) })));
    return { challenge: `${payload}.${b64url(mac(payload))}`, expiresAt: iat + CHALLENGE_TTL_MS };
  }

  // Returns { pub, iat } when the signature is good. Throws KeyLoginError otherwise.
  function check(challenge, sig, pub) {
    if (typeof challenge !== 'string' || challenge.length > 512) throw new KeyLoginError('Bad challenge.', 400);
    if (!HEX64.test(String(pub)) || !HEX128.test(String(sig))) throw new KeyLoginError('Bad key or signature.', 400);
    const [payload, tag, extra] = challenge.split('.');
    if (!payload || !tag || extra !== undefined) throw new KeyLoginError('Bad challenge.', 400);
    let body;
    try {
      if (!same(unb64url(tag), mac(payload))) throw new Error('mac');
      body = JSON.parse(td.decode(unb64url(payload)));
    } catch { throw new KeyLoginError('This challenge was not issued here.'); }
    const t = now();
    if (body.v !== 1 || body.pub !== pub) throw new KeyLoginError('This challenge is for a different key.');
    if (!(body.exp > t) || body.iat > t + SKEW_MS) throw new KeyLoginError('This challenge has expired. Try again.');
    let ok = false;
    try { ok = schnorr.verify(unhex(sig), loginMessage(challenge, sha256), unhex(pub)); } catch { ok = false; }
    if (!ok) throw new KeyLoginError('The signature does not match this key.');
    return { pub, iat: body.iat };
  }

  return { issue, check };
}
