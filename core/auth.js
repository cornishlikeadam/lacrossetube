// Logging in with the device key: ask the key-login function for a one-time challenge, sign it on
// this device, send back the signature, and store the Supabase session it returns.
// A new key is registered once, by the flow that made it: joining from a roster invite, applying
// as a coach, or the /key test page. PIN keys also fetch their pepper on each unlock.
import { sha256 } from '@noble/hashes/sha2.js';
import { loginMessage } from '../supabase/functions/_shared/key-login-core.js';
import { createKey, sign, status } from './keyring.js';
import { supabase } from './supabase.js';

async function keyLogin(body) {
  if (!supabase) throw new Error('Team accounts are not set up on this site yet.');
  const { data, error } = await supabase.functions.invoke('key-login', { body });
  if (!error) return data;
  const detail = await error.context?.json?.().catch(() => null);
  throw new Error(detail?.error || 'Could not reach LacrosseTube. Check your connection and try again.');
}
async function signedChallenge(pubkey, signWithKey) {
  const { challenge } = await keyLogin({ step: 'challenge', pubkey });
  return { pubkey, challenge, sig: signWithKey(loginMessage(challenge, sha256)) };
}
async function keepSession(session) {
  const { error } = await supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  if (error) throw new Error('The server signed you in, but this browser could not keep the session.');
}
const pepper = async (pubkey, verifier) => (await keyLogin({ step: 'pin', pubkey, verifier })).pepper;

// Registers a new key through one key-login step and keeps the session that step returns.
async function makeKeyVia(step, fields, opts) {
  let result = null;
  const server = {
    pepper,
    async register(pubkey, signWithKey, verifier) {
      result = await keyLogin({ step, ...(await signedChallenge(pubkey, signWithKey)), verifier, ...fields });
      return result.pepper ?? null;
    },
  };
  const key = await createKey(opts, server);
  await keepSession(result.session);
  return { ...result, method: key.method };
}

// The /key test page: a PIN key enrolls; a passkey key registers on its first sign-in.
export const makeKey = opts => createKey(opts, {
  pepper,
  async register(pubkey, signWithKey, verifier) {
    if (verifier == null) return null;
    return (await keyLogin({ step: 'enroll', ...(await signedChallenge(pubkey, signWithKey)), verifier })).pepper;
  },
});

// opts: { method: 'prf' } or { method: 'pin', pin }
export const applyAsCoach = (opts, coach, team) => makeKeyVia('apply', { coach, team }, opts);
export const joinWithInvite = (opts, code, consent = false) => makeKeyVia('invite-accept', { code, consent }, opts);
export const inviteInfo = async code => (await keyLogin({ step: 'invite-info', code })).invite;

// unlock: { pin } for a PIN key; {} for a passkey key (the browser asks for the passkey).
export async function logInWithKey(unlock = {}) {
  const key = await status();
  if (!key) throw new Error('Make a key on this device first.');
  const { challenge } = await keyLogin({ step: 'challenge', pubkey: key.pubkey });
  const sig = await sign(loginMessage(challenge, sha256), unlock, { pepper });
  const { session, personId } = await keyLogin({ step: 'verify', pubkey: key.pubkey, challenge, sig });
  await keepSession(session);
  return { personId, pubkey: key.pubkey };
}

export async function currentUser() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

export async function logOut() {
  await supabase?.auth.signOut();
}

// Calls a database function as the signed-in person and returns its data, or throws its message.
export async function rpc(name, args = {}) {
  if (!supabase) throw new Error('Team accounts are not set up on this site yet.');
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}
