// /join#i=<code>: open a roster invite. Read what it is for, make this device's key (it is the
// person's login and their DogeOS wallet), then land on a profile already filled from the roster.
import { status } from './keyring.js';
import { inviteInfo, joinWithInvite, rpc } from './auth.js';
import { supabase } from './supabase.js';
import { $, esc, busy, keyMaker, ROLE, positionLabel, avatarGlyph, presetPickers, socialsFields, readSocials } from './ui.js';
import { TRIAL, slot, slotLabel, markInviteUsed } from './trial.js';

const root = $('join');
const KEEP = 'lt-invite';
const link = location.href;
const code = (() => {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('i');
  if (fromHash) { sessionStorage.setItem(KEEP, fromHash); history.replaceState(null, '', location.pathname); }
  return fromHash || sessionStorage.getItem(KEEP);
})();
const trialLine = TRIAL ? `<p class="trial-line">Preview trial · joining as ${esc(slotLabel(slot))} on this browser · <a href="/trial">trial page</a></p>` : '';

async function start() {
  if (!supabase) return fail('Team accounts are not switched on for this site.');
  if (!code) return fail('This page needs the invite link from your coach. Scan your code on the team sheet again.');
  if (await status()) return fail(TRIAL ? `${slotLabel(slot)} already has a key on this browser. Pick an empty slot on the trial page.` : 'This device already has a LacrosseTube key. One device holds one key. Open your team page instead.', true);
  const inv = await inviteInfo(code);
  if (!inv.verified) return fail('This team is not approved yet. Ask your coach.');
  paint(`${trialLine}<p class="kicker">${esc(inv.team)}${inv.city ? ` · ${esc(inv.city)}` : ''}</p>
    <h1>Welcome, ${esc(inv.first_name)}</h1>
    <div class="id-card"><span class="glyph" aria-hidden="true">🥍</span><div>
      <b>${esc(inv.display_name)}</b>
      <span>${[inv.number ? `#${esc(inv.number)}` : '', esc(positionLabel(inv.position)), ROLE[inv.role] !== 'Player' ? ROLE[inv.role] : ''].filter(Boolean).join(' · ')}</span></div></div>
    <p class="hint">Joining makes your key on this device. It is your login and your DogeOS wallet: no password, no email.</p>
    <div id="jn-key"></div>`);
  keyMaker($('jn-key'), {
    label: 'JOIN',
    make: async opts => {
      await joinWithInvite(opts, code);
      sessionStorage.removeItem(KEEP);
      markInviteUsed(link, slot);
      await profile();
    },
  });
}

// The profile, filled from the roster. The person picks only an avatar preset and a field skin,
// plus links if they are 13 or older.
async function profile() {
  const home = await rpc('team_home'), p = home.person, t = home.teams[0];
  const player = t?.role === 'player';
  paint(`${trialLine}<p class="kicker">YOUR PROFILE</p>
    <div class="id-card filled" data-filled="true"><span class="glyph" aria-hidden="true" id="pf-glyph">${avatarGlyph(p.avatar)}</span><div>
      <b>${esc(p.display_name)}</b>
      <span>${[t?.number ? `#${esc(t.number)}` : '', esc(positionLabel(t?.position)), esc(t?.name)].filter(Boolean).join(' · ')}</span>
      <small>${ROLE[t?.role] || ''}</small></div></div>
    <p class="hint">Your name, number, position and team come from your coach's roster.</p>
    ${presetPickers({ avatar: p.avatar, skin: p.skin, xp: p.xp })}
    ${socialsFields(p)}
    <div class="row"><button class="btn" type="button" id="pf-save">${player && !p.placed ? 'SAVE AND START PLACEMENT' : 'SAVE'}</button></div>
    <p class="msg" id="pf-msg" role="status" hidden></p>`);
  root.querySelectorAll('input[name="avatar"]').forEach(r => r.addEventListener('change', () => { $('pf-glyph').textContent = avatarGlyph(r.value); }));
  $('pf-save').addEventListener('click', e => busy(e.currentTarget, $('pf-msg'), async () => {
    const patch = { avatar: root.querySelector('input[name="avatar"]:checked').value, skin: root.querySelector('input[name="skin"]:checked').value };
    Object.assign(patch, { socials: readSocials(root), socials_public_self: $('so-public').checked });
    const { error } = await supabase.from('people').update(patch).eq('id', p.id);
    if (error) throw new Error(/socials/.test(error.message) ? 'Links must be full profile links on Instagram, TikTok, YouTube, X or Hudl.' : error.message);
    location.assign(player && !p.placed ? '/placement' : '/team');
  }));
}

function paint(html) { root.innerHTML = html; }
function fail(text, haveKey = false) {
  paint(`${trialLine}<h1>Join your team</h1><p class="msg err">${esc(text)}</p>${haveKey ? `<p><a class="btn alt" href="${TRIAL ? '/trial' : '/team'}">${TRIAL ? 'TRIAL PAGE' : 'MY TEAM PAGE'}</a></p>` : ''}`);
}

start().catch(e => fail(e.message));
