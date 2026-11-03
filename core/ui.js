// Small shared pieces for the team pages: escaping, the key maker (passkey or PIN), sign-in,
// avatar presets, field skins and the socials fields. No photos anywhere: avatars are presets.
import { status, isPin, prfAvailable } from './keyring.js';
import { logInWithKey, currentUser } from './auth.js';
import { UNLOCKS, tierOf } from '../field/progress.js';
import { positionOf } from '../field/positions.js';

export const $ = id => document.getElementById(id);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const BAND = { u13: 'U13', '13_17': '13–17', '18_plus': '18+' };
export const ROLE = { player: 'Player', coach: 'Coach', treasurer: 'Treasurer', parent: 'Parent', admin: 'Admin' };
export const positionLabel = id => (id ? positionOf('lacrosse', id).label : '');

export const AVATARS = { stick: '🥍', goal: '🥅', ball: '🟠', crown: '👑', flower: '🌸', bolt: '⚡', shield: '🛡️', target: '🎯' };
export const avatarGlyph = id => AVATARS[id] || '🥍';

export const SKINS = [{ id: 'default', name: 'Day field', tier: 1 }, ...UNLOCKS.filter(u => u.kind === 'Field skin').map(u => ({ id: u.id, name: u.name, tier: u.tier }))];
export const skinUnlocked = (skin, xp) => skin.tier <= tierOf(xp).tier;

export const SOCIALS = [
  { id: 'instagram', label: 'Instagram', hint: 'https://instagram.com/yourname' },
  { id: 'tiktok', label: 'TikTok', hint: 'https://tiktok.com/@yourname' },
  { id: 'youtube', label: 'YouTube', hint: 'https://youtube.com/@yourname' },
  { id: 'x', label: 'X', hint: 'https://x.com/yourname' },
  { id: 'hudl', label: 'Hudl', hint: 'https://hudl.com/profile/123456' },
];

export function say(el, text, kind = '') { el.textContent = text; el.className = `msg ${kind}`; el.hidden = !text; }
export async function busy(btn, msgEl, fn) {
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  try { await fn(); } catch (e) { say(msgEl, e.message || String(e), 'err'); } finally { btn.disabled = false; btn.removeAttribute('aria-busy'); }
}

// The key maker: a passkey where this browser supports passkey keys, else a 6-digit PIN.
// Calls make({ method, pin }) and shows its errors.
export async function keyMaker(root, { label, make }) {
  const passkey = await prfAvailable();
  root.innerHTML = `
    ${passkey ? `<button class="btn" type="button" data-k="passkey">${esc(label)} WITH A PASSKEY</button><p class="hint">Face ID, fingerprint or your device PIN protects your key. Or use a 6-digit PIN instead:</p>` : ''}
    <label class="field" for="km-pin">${passkey ? '6-digit PIN' : 'Choose a 6-digit PIN for this device'}<input id="km-pin" type="password" inputmode="numeric" pattern="\\d{6}" maxlength="6" autocomplete="new-password"></label>
    <button class="btn${passkey ? ' alt' : ''}" type="button" data-k="pin">${esc(label)} WITH THIS PIN</button>
    <p class="msg" role="status" hidden></p>`;
  const msg = root.querySelector('.msg');
  root.querySelector('[data-k="passkey"]')?.addEventListener('click', e => busy(e.currentTarget, msg, () => make({ method: 'prf' })));
  root.querySelector('[data-k="pin"]').addEventListener('click', e => busy(e.currentTarget, msg, async () => {
    const pin = root.querySelector('#km-pin').value;
    if (!isPin(pin)) throw new Error('Choose exactly 6 digits.');
    await make({ method: 'pin', pin });
  }));
}

// Signs in with this device's key if needed. Resolves true once signed in; renders a sign-in
// form into `root` and resolves after the person signs in. Resolves false when there is no key.
export async function ensureSignedIn(root) {
  if (await currentUser()) return true;
  const key = await status();
  if (!key) return false;
  if (key.outdated) { root.innerHTML = '<p class="msg err">This device has a key from an older version. Ask your coach for a new invite.</p>'; return new Promise(() => {}); }
  return new Promise(resolve => {
    root.innerHTML = `<p class="hint">Sign in with the key on this device.</p>
      ${key.method === 'pin' ? '<label class="field" for="si-pin">PIN<input id="si-pin" type="password" inputmode="numeric" pattern="\\d{6}" maxlength="6" autocomplete="current-password"></label>' : ''}
      <button class="btn" type="button" id="si-go">SIGN IN</button><p class="msg" role="status" hidden></p>`;
    const msg = root.querySelector('.msg');
    root.querySelector('#si-go').addEventListener('click', e => busy(e.currentTarget, msg, async () => {
      await logInWithKey({ pin: root.querySelector('#si-pin')?.value });
      resolve(true);
    }));
  });
}

// Avatar presets and field skins, as radio groups.
export function presetPickers({ avatar, skin, xp }) {
  return `<fieldset class="presets"><legend>Avatar</legend><div class="avatars">${Object.entries(AVATARS).map(([id, g]) =>
      `<label class="avatar-opt"><input type="radio" name="avatar" value="${id}"${id === (avatar || 'stick') ? ' checked' : ''}><span aria-hidden="true">${g}</span><span class="sr">${id}</span></label>`).join('')}</div></fieldset>
    <fieldset class="presets"><legend>Field skin</legend><div class="skins">${SKINS.map(s => {
      const open = skinUnlocked(s, xp);
      return `<label class="skin-opt${open ? '' : ' locked'}"><input type="radio" name="skin" value="${s.id}"${s.id === (skin || 'default') ? ' checked' : ''}${open ? '' : ' disabled'}><span>${esc(s.name)}</span>${open ? '' : `<small>Tier ${s.tier}</small>`}</label>`;
    }).join('')}</div></fieldset>`;
}

// Socials: links only, 13+ only. 13-17 are team-only until the player and a parent both say public.
export function socialsFields(person) {
  if (person.age_band === 'u13') return '';
  const teen = person.age_band === '13_17';
  return `<fieldset class="presets"><legend>Links (optional)</legend>
    <p class="hint">Links only. Nobody can message you here.${teen ? ' Your teammates see them. Showing them outside your team needs you and a parent to switch it on.' : ''}</p>
    ${SOCIALS.map(s => `<label class="field" for="so-${s.id}">${s.label}<input id="so-${s.id}" type="url" inputmode="url" autocomplete="off" placeholder="${s.hint}" value="${esc(person.socials?.[s.id] || '')}"></label>`).join('')}
    <label class="check"><input type="checkbox" id="so-public"${person.socials_public_self ? ' checked' : ''}> Show my links outside my team${teen ? ' (a parent also has to agree)' : ''}</label>
    </fieldset>`;
}
export function readSocials(root) {
  const out = {};
  for (const s of SOCIALS) { const v = root.querySelector(`#so-${s.id}`)?.value.trim(); if (v) out[s.id] = v; }
  return out;
}
