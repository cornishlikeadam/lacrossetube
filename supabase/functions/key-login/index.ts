// Key login. No password and no email:
//   POST { step: 'challenge', pubkey }                        -> { challenge, expiresAt }
//   POST { step: 'verify', pubkey, challenge, sig }           -> { session, personId, pubkey }
//   POST { step: 'enroll', pubkey, challenge, sig, verifier } -> { pepper }   (PIN keys, once)
//   POST { step: 'pin', pubkey, verifier }                    -> { pepper }   (unlock a PIN key)
//   POST { step: 'apply', pubkey, challenge, sig, verifier?, coach, team } -> { pepper?, session, personId, orgId }
//   POST { step: 'invite-info', code }                        -> { invite }
//   POST { step: 'invite-accept', code, pubkey, challenge, sig, verifier?, consent? } -> { pepper?, session, personId }
// `apply` is how a coach starts: it registers their first key and an unverified team, which the
// owner then verifies with the owner key (owner-verify). Everyone else joins from a roster invite.
// Signatures are checked by _shared/key-login-core.js. The session is a normal Supabase session for
// the person's auth user, minted server-side (generateLink + verifyOtp); no email is sent. The auth
// user's address is a placeholder on the reserved .invalid domain, tied to the person, not the key,
// so a coach can re-issue a lost key and the person keeps their account.
//
// A PIN key is encrypted on the device with the PIN and a pepper only this server holds. The
// server hands the pepper back for the right PIN verifier and locks the key after repeated misses
// (public.key_pin_check), so a copy of the device's storage cannot be guessed offline.
// Every step is rate-limited per IP address, and logins also per key (public.rate_limit_hit).
//
// Keys come from team rosters (Phase 1). Until then an unknown key is refused unless the
// ALLOW_OPEN_KEY_SIGNUP secret equals this project's own ref (or "true" on a local stack), so the
// switch cannot be copied to another project by accident. Test projects only.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { schnorr, secp256k1 } from 'npm:@noble/curves@2.4.0/secp256k1.js';
import { sha256 } from 'npm:@noble/hashes@2.4.0/sha2.js';
import { hmac } from 'npm:@noble/hashes@2.4.0/hmac.js';
import { keccak_256 } from 'npm:@noble/hashes@2.4.0/sha3.js';
import { bytesToHex, hexToBytes } from 'npm:@noble/hashes@2.4.0/utils.js';
import { keyLoginCore, KeyLoginError } from '../_shared/key-login-core.js';
import { addressesForXOnly, isAddress } from '../_shared/evm.js';

const URL = Deno.env.get('SUPABASE_URL');
const firstSecret = (json?: string) => { try { return Object.values(JSON.parse(json || '{}'))[0] as string | undefined; } catch { return undefined; } };
const SECRET = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY') || firstSecret(Deno.env.get('SUPABASE_SECRET_KEYS'));
const PROJECT_REF = URL?.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/)?.[1];
const OPEN_FLAG = Deno.env.get('ALLOW_OPEN_KEY_SIGNUP');
const OPEN_SIGNUP = PROJECT_REF ? OPEN_FLAG === PROJECT_REF : OPEN_FLAG === 'true';
const HEX64 = /^[0-9a-f]{64}$/;

// [max hits, window in seconds]
const LIMITS = {
  challenge: [30, 60], verify: [20, 60], enroll: [10, 3600], pin: [20, 60],
  keyVerify: [10, 60], keyPin: [10, 60],
  apply: [5, 3600], inviteInfo: [30, 60], inviteAccept: [10, 60],
} as const;
const NAME = /^[^\s<>"]{1,24}( [^\s<>"]{1,24})?$/, INITIAL = /^[A-Za-z]$/, EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const TEAM = /^[^<>"]{2,80}$/, CITY = /^[^<>"]{0,60}$/, CODE = /^[A-Za-z0-9_-]{20,40}$/;
const codeHash = (code: unknown) => {
  if (!CODE.test(String(code))) throw new KeyLoginError('That invite link is not complete. Open it again from the sheet or message.', 400);
  return bytesToHex(sha256(new TextEncoder().encode(String(code))));
};
// A new PIN key gets its verifier hash and pepper stored with the key; a passkey key gets neither.
function pinFields(verifier: unknown) {
  if (verifier == null) return { hash: null, pepper: null };
  return { hash: verifierHash(verifier), pepper: bytesToHex(crypto.getRandomValues(new Uint8Array(32))) };
}
// The key's DogeOS address, sent by the device that made the key. It must be one of the two
// addresses the key's x-only public key allows; anything else is refused.
function keyAddress(address: unknown, pub: string) {
  if (address == null) return null;
  if (!isAddress(address)) throw new KeyLoginError('Bad wallet address.', 400);
  const match = addressesForXOnly(pub, { secp256k1, keccak: keccak_256 }).find(a => a.toLowerCase() === String(address).toLowerCase());
  if (!match) throw new KeyLoginError('That wallet address does not belong to this key.', 400);
  return match;
}
async function recordAddress(db: Db, pub: string, address: string | null) {
  if (!address) return;
  const { error } = await db.from('keys').update({ evm_address: address }).eq('pubkey', pub).is('evm_address', null);
  if (error) throw error;
}

// Postgres errors raised on purpose by the roster functions carry a message meant for people.
function sqlError(e: { code?: string; message?: string }) {
  if (e.code === '23505') return new KeyLoginError('This key is already registered. Remove it from this device and try again.', 409);
  if (e.code === 'P0002') return new KeyLoginError(e.message ?? 'Not found.', 404);
  if (e.code === '42501') return new KeyLoginError(e.message ?? 'Not allowed.', 403);
  if (e.code === '23514' || e.code === 'P0001') return new KeyLoginError(e.message ?? 'That was not accepted.', 400);
  return e;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(body, { status, headers: { ...CORS, ...extra } });
const core = keyLoginCore({ schnorr, sha256, hmac, secret: SECRET });
const admin = () => createClient(URL!, SECRET!, { auth: { autoRefreshToken: false, persistSession: false } });
type Db = ReturnType<typeof admin>;
const placeholderEmail = (personId: string) => `${personId}@people.lacrossetube.invalid`;
const verifierHash = (verifier: unknown) => {
  if (!HEX64.test(String(verifier))) throw new KeyLoginError('Bad PIN verifier.', 400);
  return bytesToHex(sha256(hexToBytes(String(verifier))));
};

class RateLimited extends KeyLoginError {
  constructor(public retryAfter: number) {
    super(`Too many tries. Try again in ${retryAfter < 120 ? `${retryAfter} seconds` : `${Math.ceil(retryAfter / 60)} minutes`}.`, 429);
  }
}
async function limit(db: Db, bucket: string, [max, windowSeconds]: readonly [number, number]) {
  const { data, error } = await db.rpc('rate_limit_hit', { p_bucket: bucket, p_max: max, p_window_seconds: windowSeconds });
  if (error) throw error;
  if (data === false) throw new RateLimited(windowSeconds);
}

async function authUserFor(db: Db, person: { id: string; auth_user_id: string | null }) {
  if (person.auth_user_id) return person.auth_user_id;
  const { data, error } = await db.auth.admin.createUser({ email: placeholderEmail(person.id), email_confirm: true, app_metadata: { person_id: person.id } });
  if (error) throw error;
  const { error: linkErr } = await db.from('people').update({ auth_user_id: data.user.id }).eq('id', person.id);
  if (linkErr) throw linkErr;
  return data.user.id;
}

// First use of a key nobody issued: only on a test project with open signup switched on.
async function openSignup(db: Db, pub: string, iat: number) {
  if (!OPEN_SIGNUP) throw new KeyLoginError('This key is not on a team roster yet.', 403);
  const { data: person, error } = await db.from('people').insert({}).select('id, auth_user_id').single();
  if (error) throw error;
  const { error: keyErr } = await db.from('keys').insert({ pubkey: pub, person_id: person.id, last_login_at: new Date(iat).toISOString() });
  if (keyErr) {
    await db.from('people').delete().eq('id', person.id);
    throw keyErr.code === '23505' ? new KeyLoginError('This challenge was already used.', 409) : keyErr;
  }
  return person;
}

// Accept this challenge once: it must be newer than the key's last accepted challenge.
async function claimChallenge(db: Db, pub: string, iat: number) {
  const { data: key, error } = await db.from('keys').select('status, person_id').eq('pubkey', pub).maybeSingle();
  if (error) throw error;
  if (!key) return openSignup(db, pub, iat);
  if (key.status !== 'active') throw new KeyLoginError('This key was turned off. Ask your coach for a new one.', 403);
  const at = new Date(iat).toISOString();
  const { data: claimed, error: claimErr } = await db.from('keys').update({ last_login_at: at })
    .eq('pubkey', pub).eq('status', 'active').or(`last_login_at.is.null,last_login_at.lt.${at}`).select('person_id');
  if (claimErr) throw claimErr;
  if (!claimed?.length) throw new KeyLoginError('This challenge was already used.', 409);
  const { data: person, error: personErr } = await db.from('people').select('id, auth_user_id').eq('id', key.person_id).single();
  if (personErr) throw personErr;
  return person;
}

async function sessionFor(db: Db, userId: string, personId: string) {
  const { data: link, error } = await db.auth.admin.generateLink({ type: 'magiclink', email: placeholderEmail(personId) });
  if (error) throw error;
  if (link.user?.id !== userId) throw new Error('auth user mismatch');
  const { data, error: otpErr } = await db.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' });
  if (otpErr || !data.session) throw otpErr ?? new Error('no session');
  const { access_token, refresh_token, expires_in, expires_at, token_type } = data.session;
  return { access_token, refresh_token, expires_in, expires_at, token_type };
}

type Body = {
  step?: string; pubkey?: string; challenge?: string; sig?: string; verifier?: string; code?: string; consent?: boolean; address?: string;
  coach?: { first_name?: string; last_initial?: string; email?: string }; team?: { name?: string; city?: string };
};

async function handle(body: Body, ip: string) {
  const db = admin();
  switch (body.step) {
    case 'challenge': {
      await limit(db, `ip:${ip}:challenge`, LIMITS.challenge);
      return core.issue(String(body.pubkey ?? ''));
    }
    case 'verify': {
      await limit(db, `ip:${ip}:verify`, LIMITS.verify);
      const { pub, iat } = core.check(body.challenge, body.sig, body.pubkey);
      const address = keyAddress(body.address, pub);
      await limit(db, `key:${pub}:verify`, LIMITS.keyVerify);
      const person = await claimChallenge(db, pub, iat);
      await recordAddress(db, pub, address);
      const userId = await authUserFor(db, person);
      return { session: await sessionFor(db, userId, person.id), personId: person.id, pubkey: pub };
    }
    case 'enroll': {
      await limit(db, `ip:${ip}:enroll`, LIMITS.enroll);
      const hash = verifierHash(body.verifier);
      const { pub, iat } = core.check(body.challenge, body.sig, body.pubkey);
      const address = keyAddress(body.address, pub);
      await claimChallenge(db, pub, iat);
      await recordAddress(db, pub, address);
      const pepper = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
      const { data, error } = await db.from('keys').update({ pin_verifier_hash: hash, pin_pepper: pepper, pin_fails: 0, pin_locked_until: null })
        .eq('pubkey', pub).is('pin_verifier_hash', null).select('pubkey');
      if (error) throw error;
      if (!data?.length) throw new KeyLoginError('This key already has a PIN. Ask your coach for a new key to change it.', 409);
      return { pepper };
    }
    case 'pin': {
      await limit(db, `ip:${ip}:pin`, LIMITS.pin);
      const hash = verifierHash(body.verifier), pub = String(body.pubkey ?? '');
      if (!HEX64.test(pub)) throw new KeyLoginError('Bad key.', 400);
      await limit(db, `key:${pub}:pin`, LIMITS.keyPin);
      const { data, error } = await db.rpc('key_pin_check', { p_pubkey: pub, p_verifier_hash: hash });
      if (error) throw error;
      const r = data?.[0];
      if (r?.ok) return { pepper: r.pepper };
      if (r?.retry_after > 0) throw new RateLimited(r.retry_after);
      throw new KeyLoginError(r?.attempts_left ? `Wrong PIN. ${r.attempts_left} ${r.attempts_left === 1 ? 'try' : 'tries'} left before a lockout.` : 'Wrong PIN.', 401);
    }
    case 'apply': {
      await limit(db, `ip:${ip}:apply`, LIMITS.apply);
      const coach = body.coach ?? {}, team = body.team ?? {};
      if (!NAME.test(String(coach.first_name ?? '').trim()) || !INITIAL.test(String(coach.last_initial ?? ''))) throw new KeyLoginError('Give your first name and last initial.', 400);
      if (coach.email && !EMAIL.test(String(coach.email))) throw new KeyLoginError('That email does not look right.', 400);
      if (!TEAM.test(String(team.name ?? '').trim()) || !CITY.test(String(team.city ?? ''))) throw new KeyLoginError('Give the team name and city.', 400);
      const pin = pinFields(body.verifier);
      const { pub, iat } = core.check(body.challenge, body.sig, body.pubkey);
      const address = keyAddress(body.address, pub);
      const { data, error } = await db.rpc('apply_team', {
        p_pubkey: pub, p_login_at: new Date(iat).toISOString(), p_verifier_hash: pin.hash, p_pepper: pin.pepper,
        p_first_name: String(coach.first_name).trim(), p_last_initial: String(coach.last_initial), p_email: String(coach.email ?? ''),
        p_team: String(team.name).trim(), p_city: String(team.city ?? ''),
      });
      if (error) throw sqlError(error);
      const { person_id: personId, org_id: orgId } = data[0];
      await recordAddress(db, pub, address);
      const userId = await authUserFor(db, { id: personId, auth_user_id: null });
      return { pepper: pin.pepper, session: await sessionFor(db, userId, personId), personId, orgId, pubkey: pub };
    }
    case 'invite-info': {
      await limit(db, `ip:${ip}:invite-info`, LIMITS.inviteInfo);
      const { data, error } = await db.rpc('invite_info', { p_code_hash: codeHash(body.code) });
      if (error) throw error;
      if (!data) throw new KeyLoginError('This invite was already used or has expired. Ask your coach for a new one.', 404);
      return { invite: data };
    }
    case 'invite-accept': {
      await limit(db, `ip:${ip}:invite-accept`, LIMITS.inviteAccept);
      const hash = codeHash(body.code), pin = pinFields(body.verifier);
      const { pub, iat } = core.check(body.challenge, body.sig, body.pubkey);
      const address = keyAddress(body.address, pub);
      const { data: personId, error } = await db.rpc('accept_invite', {
        p_code_hash: hash, p_pubkey: pub, p_login_at: new Date(iat).toISOString(),
        p_verifier_hash: pin.hash, p_pepper: pin.pepper, p_consent: body.consent === true,
      });
      if (error) throw sqlError(error);
      await recordAddress(db, pub, address);
      const { data: person, error: personErr } = await db.from('people').select('id, auth_user_id').eq('id', personId).single();
      if (personErr) throw personErr;
      const userId = await authUserFor(db, person);
      return { pepper: pin.pepper, session: await sessionFor(db, userId, person.id), personId: person.id, pubkey: pub };
    }
    default:
      throw new KeyLoginError('Unknown step.', 400);
  }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405);
  if (!URL || !SECRET) return reply({ error: 'Key login is not configured on this server.' }, 503);
  let body: Body;
  try { body = await req.json(); } catch { return reply({ error: 'Send JSON.' }, 400); }
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  try {
    return reply(await handle(body, ip));
  } catch (e) {
    if (e instanceof RateLimited) return reply({ error: e.message, retryAfter: e.retryAfter }, 429, { 'Retry-After': String(e.retryAfter) });
    if (e instanceof KeyLoginError) return reply({ error: e.message }, e.status);
    console.error('key-login failed', e);
    return reply({ error: 'Key login failed on the server.' }, 500);
  }
});
