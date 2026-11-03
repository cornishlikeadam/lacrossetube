// The /key test page: make a key on this device, sign in with it, sign out, or remove it.
import { status, removeKey, isPin, prfAvailable } from './keyring.js';
import { makeKey, logInWithKey, currentUser, logOut } from './auth.js';

const $ = id => document.getElementById(id);
const short = pub => `${pub.slice(0, 8)}…${pub.slice(-8)}`;
function say(text, kind = '') { const m = $('msg'); m.textContent = text; m.className = 'msg ' + kind; }
async function busy(btn, fn) {
  btn.disabled = true;
  try { await fn(); } catch (e) { say(e.message || String(e), 'err'); } finally { btn.disabled = false; }
}

async function paint() {
  const key = await status(), user = key ? await currentUser() : null;
  $('make').hidden = !!key;
  $('login').hidden = !key;
  $('make-passkey').hidden = !(await prfAvailable());
  if (!key) { $('state').textContent = 'No key on this device yet.'; return; }
  $('pin-row').hidden = key.method !== 'pin';
  $('sign-in').hidden = !!user || key.outdated;
  $('sign-out').hidden = !user;
  $('state').textContent = key.outdated
    ? `Key ${short(key.pubkey)} was made with an older version. Remove it and make a new one.`
    : `Key ${short(key.pubkey)}, protected by ${key.method === 'prf' ? 'a passkey' : 'a PIN'}. ${user ? 'Signed in.' : 'Signed out.'}`;
}

$('make-passkey').addEventListener('click', e => busy(e.currentTarget, async () => {
  const k = await makeKey({ method: 'prf' });
  if (k.method !== 'prf') throw new Error('This browser has no passkey key support. Use a PIN instead.');
  say('Key made. Sign in with it below.', 'ok'); await paint();
}));
$('make-pin').addEventListener('click', e => busy(e.currentTarget, async () => {
  const pin = $('new-pin').value;
  if (!isPin(pin)) throw new Error('Choose exactly 6 digits.');
  await makeKey({ method: 'pin', pin });
  $('new-pin').value = '';
  say('Key made. Sign in with it below.', 'ok'); await paint();
}));
$('sign-in').addEventListener('click', e => busy(e.currentTarget, async () => {
  const { personId } = await logInWithKey({ pin: $('pin').value });
  $('pin').value = '';
  say(`Signed in. Person ${personId.slice(0, 8)}.`, 'ok'); await paint();
}));
$('sign-out').addEventListener('click', e => busy(e.currentTarget, async () => { await logOut(); say('Signed out.'); await paint(); }));
$('remove').addEventListener('click', e => busy(e.currentTarget, async () => {
  if (!confirm('Remove this key from this device? Without it you cannot sign in here until you get a new one.')) return;
  await logOut(); await removeKey(); say('Key removed from this device.'); await paint();
}));

paint().catch(e => say(e.message, 'err'));
