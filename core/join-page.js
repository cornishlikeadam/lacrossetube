// /join#i=<code>: open a roster invite. Read what it is for, take a parent's consent when it is a
// parent invite, make this device's key, then land on a profile already filled from the roster.
import { status } from './keyring.js';
import { inviteInfo, joinWithInvite, rpc } from './auth.js';
import { supabase } from './supabase.js';
import { $, esc, say, busy, keyMaker, BAND, ROLE, positionLabel, avatarGlyph, presetPickers, socialsFields, readSocials } from './ui.js';

const root = $('join');
const KEEP = 'lt-invite';
const code = (() => {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('i');
  if (fromHash) { sessionStorage.setItem(KEEP, fromHash); history.replaceState(null, '', location.pathname); }
  return fromHash || sessionStorage.getItem(KEEP);
})();

async function start() {
  if (!supabase) return fail('Team accounts are not switched on for this site.');
  if (!code) return fail('This page needs the invite link from your coach. Scan your code on the team sheet again.');
  if (await status()) return fail('This device already has a LacrosseTube key. One device holds one key. Open your team page instead, or use another device.', true);
  const inv = await inviteInfo(code);
  if (!inv.verified) return fail('This team is not verified yet. Ask your coach.');
  const parent = inv.role === 'parent';
  if (inv.needs_parent) {
    return paint(`<h1>Almost there, ${esc(inv.first_name)}</h1>
      <p>${esc(inv.team)} needs a parent or guardian to say yes before you join. Ask them to scan their code on the team sheet first, then open your link again.</p>`);
  }
  paint(`<p class="kicker">${esc(inv.team)}${inv.city ? ` · ${esc(inv.city)}` : ''}</p>
    <h1>${parent ? `Parent of ${esc(String(inv.child || '').replace(/\.$/, ''))}` : `Welcome, ${esc(inv.first_name)}`}</h1>
    <div class="id-card"><span class="glyph" aria-hidden="true">🥍</span><div>
      <b>${esc(parent ? inv.display_name : inv.display_name)}</b>
      <span>${parent ? 'Parent or guardian' : [inv.number ? `#${esc(inv.number)}` : '', esc(positionLabel(inv.position)), ROLE[inv.role] !== 'Player' ? ROLE[inv.role] : ''].filter(Boolean).join(' · ')}</span>
      ${parent ? '' : `<small>${BAND[inv.age_band]}</small>`}</div></div>
    ${parent ? `<label class="check consent"><input type="checkbox" id="jn-consent">
      I am ${esc(inv.child)}'s parent or guardian. I agree that ${esc(inv.child)} can use LacrosseTube with ${esc(inv.team)}. Their first name, last initial, number, position and practice results are kept for their team.${inv.child_age_band === 'u13' ? ' They stay off every board outside the team unless I switch it on.' : ''}</label>` : ''}
    <p class="hint">Joining makes your key on this device. It is your login: no password, no email.</p>
    <div id="jn-key"></div>`);
  keyMaker($('jn-key'), {
    label: 'JOIN',
    make: async opts => {
      if (parent && !$('jn-consent').checked) throw new Error('Tick the box to give consent first.');
      await joinWithInvite(opts, code, parent);
      sessionStorage.removeItem(KEEP);
      await profile();
    },
  });
}

// The profile, filled from the roster. The person picks only an avatar preset and a field skin,
// plus links if they are 13 or older.
async function profile() {
  const home = await rpc('team_home'), p = home.person, t = home.teams[0];
  const player = t?.role === 'player';
  paint(`<p class="kicker">YOUR PROFILE</p>
    <div class="id-card filled" data-filled="true"><span class="glyph" aria-hidden="true" id="pf-glyph">${avatarGlyph(p.avatar)}</span><div>
      <b>${esc(p.display_name)}</b>
      <span>${[t?.number ? `#${esc(t.number)}` : '', esc(positionLabel(t?.position)), esc(t?.name)].filter(Boolean).join(' · ')}</span>
      <small>${BAND[p.age_band]} · ${ROLE[t?.role] || ''}</small></div></div>
    <p class="hint">Your name, number, position and team come from your coach's roster.</p>
    ${presetPickers({ avatar: p.avatar, skin: p.skin, xp: p.xp })}
    ${socialsFields(p)}
    <div class="row"><button class="btn" type="button" id="pf-save">${player && !p.placed ? 'SAVE AND START PLACEMENT' : 'SAVE'}</button></div>
    <p class="msg" id="pf-msg" role="status" hidden></p>`);
  root.querySelectorAll('input[name="avatar"]').forEach(r => r.addEventListener('change', () => { $('pf-glyph').textContent = avatarGlyph(r.value); }));
  $('pf-save').addEventListener('click', e => busy(e.currentTarget, $('pf-msg'), async () => {
    const patch = { avatar: root.querySelector('input[name="avatar"]:checked').value, skin: root.querySelector('input[name="skin"]:checked').value };
    if (p.age_band !== 'u13') Object.assign(patch, { socials: readSocials(root), socials_public_self: $('so-public').checked });
    const { error } = await supabase.from('people').update(patch).eq('id', p.id);
    if (error) throw new Error(/socials/.test(error.message) ? 'Links must be full profile links on Instagram, TikTok, YouTube, X or Hudl.' : error.message);
    location.assign(player && !p.placed ? '/placement' : '/team');
  }));
}

function paint(html) { root.innerHTML = html; }
function fail(text, haveKey = false) {
  paint(`<h1>Join your team</h1><p class="msg err">${esc(text)}</p>${haveKey ? '<p><a class="btn alt" href="/team">MY TEAM PAGE</a></p>' : ''}`);
}

start().catch(e => fail(e.message));
