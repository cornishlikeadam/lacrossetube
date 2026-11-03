// /team: the signed-in person's team home. Their roster identity, streak (if this device has one),
// seed rating and team rank, the coach's latest session (an empty state until the coach desk goes
// live), profile edits, and for parents, consent and the switches for their child.
import { supabase } from './supabase.js';
import { status } from './keyring.js';
import { rpc, logOut } from './auth.js';
import { liveStreak } from '../field/progress.js';
import { loadProfile } from '../field/db.js';
import { $, esc, say, busy, ensureSignedIn, BAND, ROLE, positionLabel, avatarGlyph, presetPickers, socialsFields, readSocials } from './ui.js';

const root = $('team');
const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

async function start() {
  if (!supabase) return paint('<p class="msg err">Team accounts are not switched on for this site.</p>');
  if (!(await status())) return paint('<h1>My team</h1><p>Join from the invite your coach gives you. Coaches start on the <a href="/coach">coach desk</a>.</p>');
  if (!(await ensureSignedIn(root))) return;
  const home = await rpc('team_home'), p = home.person, device = await loadProfile();
  document.documentElement.dataset.skin = p.skin || 'default';
  const streak = liveStreak(device);
  const teams = home.teams;
  const t = teams.find(x => x.role === 'player') || teams[0];
  const isPlayer = t?.role === 'player';

  paint(`<div class="id-card filled"><span class="glyph" aria-hidden="true">${avatarGlyph(p.avatar)}</span><div>
      <b>${esc(p.display_name)}</b>
      <span>${[t?.number ? `#${esc(t.number)}` : '', esc(positionLabel(t?.position)), esc(t?.name), t?.verified ? '' : '(not verified yet)'].filter(Boolean).join(' · ')}</span>
      <small>${BAND[p.age_band] || ''} · ${ROLE[t?.role] || ''}</small></div></div>
    ${isPlayer ? `<div class="stat-grid">
      <div class="stat"><b>${p.placed ? Math.round(p.seed_rating) : '—'}</b><small>seed rating</small></div>
      <div class="stat"><b>${p.placed ? `${ordinal(t.seed_rank)}` : '—'}</b><small>${p.placed ? `on your team · ${t.placed_count} placed` : 'team rank after placement'}</small></div>
      <div class="stat"><b>${p.xp}</b><small>XP on your profile</small></div>
      ${streak ? `<div class="stat"><b>${streak}</b><small>day streak on this device</small></div>` : ''}
    </div>
    ${p.placed ? '' : '<div class="row"><a class="btn" href="/placement">START PLACEMENT ▶</a></div>'}` : ''}
    ${t ? `<h2 class="sub">From your coach</h2>
      ${t.has_session ? '<p>Your coach posted a session. It opens here when the coach desk goes live.</p>' : '<p class="empty">No session from your coach yet. When they post one after a meeting, it shows up here.</p>'}` : ''}
    ${home.children.length ? `<h2 class="sub">Your player${home.children.length > 1 ? 's' : ''}</h2>${home.children.map(childCard).join('')}` : ''}
    <details class="edit"><summary>Edit my profile</summary>
      ${presetPickers({ avatar: p.avatar, skin: p.skin, xp: p.xp })}
      ${socialsFields(p)}
      ${p.age_band === '13_17' ? `<p class="hint">Links outside the team: you ${p.socials_public_self ? 'said yes' : 'said no'}, a parent ${p.socials_public_parent ? 'said yes' : 'has not said yes'}. They stay team-only until both say yes.</p>` : ''}
      <div class="row"><button class="btn alt" type="button" id="tm-save">SAVE</button></div>
      <p class="msg" id="tm-msg" role="status" hidden></p>
    </details>
    <div class="row">${teams.some(x => x.role === 'coach' || x.role === 'admin') ? '<a class="btn alt" href="/coach">COACH DESK</a>' : ''}<a class="ghost" href="/">Film room</a><button class="ghost" type="button" id="tm-out">Sign out</button></div>`);

  $('tm-save').addEventListener('click', e => busy(e.currentTarget, $('tm-msg'), async () => {
    const patch = { avatar: root.querySelector('input[name="avatar"]:checked').value, skin: root.querySelector('input[name="skin"]:checked').value };
    if (p.age_band !== 'u13') Object.assign(patch, { socials: readSocials(root), socials_public_self: $('so-public').checked });
    const { error } = await supabase.from('people').update(patch).eq('id', p.id);
    if (error) throw new Error(/socials/.test(error.message) ? 'Links must be full profile links on Instagram, TikTok, YouTube, X or Hudl.' : error.message);
    say($('tm-msg'), 'Saved.', 'ok');
    start();
  }));
  root.querySelectorAll('[data-child]').forEach(box => box.addEventListener('change', e => {
    const input = e.target, field = input.dataset.field;
    busy(input, box.querySelector('.msg'), async () => {
      await rpc('guardian_set', { p_child: box.dataset.child, [field]: input.checked });
      say(box.querySelector('.msg'), 'Saved.', 'ok');
    });
  }));
  $('tm-out').addEventListener('click', async () => { await logOut(); start(); });
}

function childCard(c) {
  const u13 = c.age_band === 'u13';
  return `<div class="child" data-child="${c.id}">
    <p><b>${esc(c.display_name)}</b> · ${BAND[c.age_band]} · ${c.consent_at ? `consent given ${new Date(c.consent_at).toLocaleDateString()}` : 'consent not given'}${c.placed ? ` · seed ${Math.round(c.seed_rating)}` : ''}</p>
    ${c.consent_at ? `
      <label class="check"><input type="checkbox" data-field="p_global_board"${c.global_board_consent ? ' checked' : ''}> Show ${esc(c.display_name)} on boards outside the team${u13 ? ' (off by default for under 13)' : ''}</label>
      ${c.age_band === '13_17' ? `<label class="check"><input type="checkbox" data-field="p_public_socials"${c.socials_public_parent ? ' checked' : ''}> Let their links show outside the team, if they also choose it</label>` : ''}` : ''}
    <p class="msg" role="status" hidden></p></div>`;
}

function paint(html) { root.innerHTML = html; }
start().catch(e => paint(`<p class="msg err">${esc(e.message)}</p>`));
