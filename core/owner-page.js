// /owner (preview trial builds only): approve team applications with a button. The button signs
// with the owner key that `node scripts/owner.mjs init` made. The key file is opened here, in the
// browser, with its passphrase once; it is never uploaded. This browser then keeps the key locked
// under a device key that cannot be exported, so each approval after that is one click. The server
// checks the owner signature exactly as it does for the CLI; nothing about that is relaxed.
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { ownerMessage } from '../supabase/functions/_shared/owner-core.js';
import { openKeyFile } from './keyfile.js';
import { supabase } from './supabase.js';
import { TRIAL } from './trial.js';
import { $, esc, say, busy } from './ui.js';

const root = $('owner');
const DB = 'lacrossetube-owner', STORE = 'kv';
const subtle = () => crypto.subtle;

function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => { const tx = req.result.transaction(STORE, mode), r = fn(tx.objectStore(STORE)); tx.oncomplete = () => resolve(r?.result); tx.onerror = () => reject(tx.error); };
  });
}
const kept = () => idb('readonly', s => s.get('owner'));
async function keep(sk, pubkey) {
  const device = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, device, sk));
  await idb('readwrite', s => s.put({ pubkey, device, iv, ct }, 'owner'));
}
async function withOwnerKey(fn) {
  const k = await kept();
  const sk = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: k.iv }, k.device, k.ct));
  try { return await fn(sk); } finally { sk.fill(0); }
}

async function ownerCall(sk, action, payload) {
  const ts = Date.now();
  const body = { action, payload, ts, sig: bytesToHex(schnorr.sign(ownerMessage(action, payload, ts, sha256), sk)) };
  const { data, error } = await supabase.functions.invoke('owner-verify', { body });
  if (!error) return data;
  const detail = await error.context?.json?.().catch(() => null);
  const e = new Error(detail?.error || 'Could not reach the server.'); e.status = error.context?.status;
  throw e;
}

async function start() {
  if (!TRIAL || !supabase) { root.innerHTML = '<p class="msg err">The owner page is only on the preview trial.</p>'; return; }
  const k = await kept();
  if (!k) return paintLoad();
  paintPending(k.pubkey);
}

function paintLoad() {
  root.innerHTML = `<p class="kicker">OWNER</p><h1>Approve teams</h1>
    <p>Once per browser, give this page the owner key that <code>node scripts/owner.mjs init</code> made, and its passphrase. It is the file <code>~/.lacrossetube/owner-key.json</code>, still locked with your passphrase.</p>
    <p class="hint">The easy way: in Terminal run <code>pbcopy &lt; ~/.lacrossetube/owner-key.json</code>, then paste below. The key is opened here and never uploaded. After this, this browser keeps it locked to itself, so approving is one click.</p>
    <label class="field" for="ow-paste">Paste the owner key file<textarea id="ow-paste" rows="4" spellcheck="false" autocomplete="off" placeholder='{ "v": 1, "pubkey": "…" }'></textarea></label>
    <label class="field" for="ow-file">Or choose the file<input id="ow-file" type="file" accept=".json,application/json"></label>
    <label class="field" for="ow-pass">Owner passphrase<input id="ow-pass" type="password" autocomplete="current-password"></label>
    <div class="row"><button class="btn" type="button" id="ow-go">UNLOCK</button></div>
    <p class="msg" id="ow-msg" role="status" hidden></p>`;
  $('ow-go').addEventListener('click', e => busy(e.currentTarget, $('ow-msg'), async () => {
    const f = $('ow-file').files[0], pasted = $('ow-paste').value.trim();
    if (!f && !pasted) throw new Error('Paste the owner key file, or choose it.');
    let file;
    try { file = JSON.parse(pasted || await f.text()); } catch { throw new Error('That is not a LacrosseTube key file. Copy the whole file and paste again.'); }
    say($('ow-msg'), 'Opening the key file. This takes a few seconds…');
    const sk = await openKeyFile(file, $('ow-pass').value);
    try {
      await ownerCall(sk, 'list', {});
      await keep(sk, file.pubkey);
    } catch (err) {
      if (err.status === 503) throw new Error(`The server has no owner key yet. Run once in Terminal: npx supabase secrets set OWNER_PUBKEY=${file.pubkey}`);
      if (err.status === 401) throw new Error('This key is not the owner key the server knows. Check OWNER_PUBKEY on lacrossetube-dev.');
      throw err;
    } finally { sk.fill(0); }
    start();
  }));
}

async function paintPending(pubkey) {
  root.innerHTML = `<p class="kicker">OWNER</p><h1>Approve teams</h1><p class="hint">Loading applications…</p>`;
  const { applications } = await withOwnerKey(sk => ownerCall(sk, 'list', {}));
  root.innerHTML = `<p class="kicker">OWNER</p><h1>Approve teams</h1>
    <p class="hint">Signed with owner key ${esc(pubkey.slice(0, 8))}…${esc(pubkey.slice(-8))}.</p>
    ${applications.length ? `<ul class="apps">${applications.map(a => `<li data-org="${esc(a.org_id)}">
        <div><b>${esc(a.team)}</b>${a.city ? ` · ${esc(a.city)}` : ''}<br><small>Coach ${esc(a.coach || '')}${a.email ? ` · ${esc(a.email)}` : ''} · applied ${esc(a.applied.slice(0, 10))}</small></div>
        <button class="btn" type="button" data-approve>APPROVE</button></li>`).join('')}</ul>`
      : '<p class="empty">No teams waiting. When a coach applies on the coach desk, it shows up here.</p>'}
    <p class="msg" id="ow-msg" role="status" hidden></p>
    <div class="row"><button class="ghost" type="button" id="ow-refresh">Refresh</button><a class="ghost" href="/trial">Trial page</a><button class="ghost" type="button" id="ow-forget">Forget owner key on this browser</button></div>`;
  root.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', e => busy(e.currentTarget, $('ow-msg'), async () => {
    const li = e.currentTarget.closest('li');
    const { verified } = await withOwnerKey(sk => ownerCall(sk, 'verify_org', { org_id: li.dataset.org }));
    li.innerHTML = `<div><b>${esc(verified)}</b><br><small>Approved. The coach can add players now.</small></div>`;
  })));
  $('ow-refresh').addEventListener('click', () => paintPending(pubkey));
  $('ow-forget').addEventListener('click', async () => { await idb('readwrite', s => s.delete('owner')); start(); });
}

start().catch(e => { root.innerHTML = `<p class="msg err">${esc(e.message)}</p>`; });
