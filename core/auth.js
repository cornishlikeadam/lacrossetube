// Logging in with the device key: ask the key-login function for a one-time challenge, sign it on
// this device, send back the signature, and store the Supabase session it returns.
// PIN keys also enroll once with the server and fetch their pepper on each unlock.
import { sha256 } from '@noble/hashes/sha2.js';
import { loginMessage } from '../supabase/functions/_shared/key-login-core.js';
import { createKey, sign, status } from './keyring.js';
import { supabase } from './supabase.js';

async function keyLogin(body) {
  if (!supabase) throw new Error('Key login is not set up on this site yet.');
  const { data, error } = await supabase.functions.invoke('key-login', { body });
  if (!error) return data;
  const detail = await error.context?.json?.().catch(() => null);
  throw new Error(detail?.error || 'Could not reach key login. Check your connection and try again.');
}

const pins = {
  async enroll(pubkey, signWithNewKey, verifier) {
    const { challenge } = await keyLogin({ step: 'challenge', pubkey });
    const sig = signWithNewKey(loginMessage(challenge, sha256));
    return (await keyLogin({ step: 'enroll', pubkey, challenge, sig, verifier })).pepper;
  },
  async pepper(pubkey, verifier) {
    return (await keyLogin({ step: 'pin', pubkey, verifier })).pepper;
  },
};

// opts: { method: 'prf' } or { method: 'pin', pin }
export const makeKey = opts => createKey(opts, pins);

// unlock: { pin } for a PIN key; {} for a passkey key (the browser asks for the passkey).
export async function logInWithKey(unlock = {}) {
  const key = await status();
  if (!key) throw new Error('Make a key on this device first.');
  const { challenge } = await keyLogin({ step: 'challenge', pubkey: key.pubkey });
  const sig = await sign(loginMessage(challenge, sha256), unlock, pins);
  const { session, personId } = await keyLogin({ step: 'verify', pubkey: key.pubkey, challenge, sig });
  const { error } = await supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  if (error) throw new Error('The server signed you in, but this browser could not keep the session.');
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
