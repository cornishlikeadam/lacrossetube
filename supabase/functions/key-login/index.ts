// Key login. Two calls, no password and no email:
//   POST { step: 'challenge', pubkey }            -> { challenge, expiresAt }
//   POST { step: 'verify', pubkey, challenge, sig } -> { session, personId, pubkey }
// The signature is checked by _shared/key-login-core.js. The session is a normal Supabase session
// for the person's auth user, minted server-side (generateLink + verifyOtp); no email is sent.
// The auth user's address is a placeholder on the reserved .invalid domain, tied to the person,
// not the key, so a coach can re-issue a lost key and the person keeps their account.
//
// Keys come from team rosters (Phase 1). Until then an unknown key is refused unless the
// ALLOW_OPEN_KEY_SIGNUP secret is "true", which is for local and preview testing only.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { schnorr } from 'npm:@noble/curves@2.4.0/secp256k1.js';
import { sha256 } from 'npm:@noble/hashes@2.4.0/sha2.js';
import { hmac } from 'npm:@noble/hashes@2.4.0/hmac.js';
import { keyLoginCore, KeyLoginError } from '../_shared/key-login-core.js';

const URL = Deno.env.get('SUPABASE_URL');
const firstSecret = (json?: string) => { try { return Object.values(JSON.parse(json || '{}'))[0] as string | undefined; } catch { return undefined; } };
const SECRET = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY') || firstSecret(Deno.env.get('SUPABASE_SECRET_KEYS'));
const OPEN_SIGNUP = Deno.env.get('ALLOW_OPEN_KEY_SIGNUP') === 'true';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });
const core = keyLoginCore({ schnorr, sha256, hmac, secret: SECRET });
const admin = () => createClient(URL!, SECRET!, { auth: { autoRefreshToken: false, persistSession: false } });
const placeholderEmail = (personId: string) => `${personId}@people.lacrossetube.invalid`;

async function authUserFor(db: ReturnType<typeof admin>, person: { id: string; auth_user_id: string | null }) {
  if (person.auth_user_id) return person.auth_user_id;
  const { data, error } = await db.auth.admin.createUser({ email: placeholderEmail(person.id), email_confirm: true, app_metadata: { person_id: person.id } });
  if (error) throw error;
  const { error: linkErr } = await db.from('people').update({ auth_user_id: data.user.id }).eq('id', person.id);
  if (linkErr) throw linkErr;
  return data.user.id;
}

// First login of a key nobody issued: only with ALLOW_OPEN_KEY_SIGNUP (testing).
async function openSignup(db: ReturnType<typeof admin>, pub: string, iat: number) {
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

// Accept this challenge once: it must be newer than the key's last accepted login.
async function claimLogin(db: ReturnType<typeof admin>, pub: string, iat: number) {
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

async function sessionFor(db: ReturnType<typeof admin>, userId: string, personId: string) {
  const { data: link, error } = await db.auth.admin.generateLink({ type: 'magiclink', email: placeholderEmail(personId) });
  if (error) throw error;
  if (link.user?.id !== userId) throw new Error('auth user mismatch');
  const { data, error: otpErr } = await db.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' });
  if (otpErr || !data.session) throw otpErr ?? new Error('no session');
  const { access_token, refresh_token, expires_in, expires_at, token_type } = data.session;
  return { access_token, refresh_token, expires_in, expires_at, token_type };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405);
  if (!URL || !SECRET) return reply({ error: 'Key login is not configured on this server.' }, 503);
  let body: { step?: string; pubkey?: string; challenge?: string; sig?: string };
  try { body = await req.json(); } catch { return reply({ error: 'Send JSON.' }, 400); }
  try {
    if (body.step === 'challenge') return reply(core.issue(String(body.pubkey ?? '')));
    if (body.step !== 'verify') return reply({ error: 'Unknown step.' }, 400);
    const { pub, iat } = core.check(body.challenge, body.sig, body.pubkey);
    const db = admin();
    const person = await claimLogin(db, pub, iat);
    const userId = await authUserFor(db, person);
    return reply({ session: await sessionFor(db, userId, person.id), personId: person.id, pubkey: pub });
  } catch (e) {
    if (e instanceof KeyLoginError) return reply({ error: e.message }, e.status);
    console.error('key-login failed', e);
    return reply({ error: 'Key login failed on the server.' }, 500);
  }
});
