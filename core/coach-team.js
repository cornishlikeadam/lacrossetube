// Coach desk, "Your team": apply for a team, wait for the owner to verify it, then keep the
// roster (the team ledger), make one-time invites and print the QR sheet for practice.
// The device-only roster and the #t= / #r= links below it stay as the offline fallback.
import qrcode from 'qrcode-generator';
import { supabase } from './supabase.js';
import { status } from './keyring.js';
import { applyAsCoach, rpc, logOut } from './auth.js';
import { $, esc, say, busy, keyMaker, ensureSignedIn, BAND, ROLE, positionLabel } from './ui.js';
import { POSITIONS } from '../field/positions.js';

const root = $('team-body');
const day = iso => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const inviteUrl = code => `${location.origin}/join#i=${code}`;

async function boot() {
  if (!supabase) { root.innerHTML = '<p class="hint">Team accounts are not switched on for this site. The offline tools below still work.</p>'; return; }
  if (!(await status())) return paintApply();
  if (!(await ensureSignedIn(root))) return paintApply();
  const home = await rpc('team_home');
  const team = home?.teams.find(t => t.role === 'coach' || t.role === 'admin');
  if (!team) { root.innerHTML = `<p class="hint">The key on this device is not a coach on any team. <a href="/team">Go to your team page</a>.</p>`; return; }
  if (!team.verified) return paintPending(team);
  paintRoster(team);
}

/* ---------- apply ---------- */
function paintApply() {
  root.innerHTML = `<p class="hint">Coaches apply once. LacrosseTube checks every team by hand before it can add players. Players never sign up on their own: they join from your roster.</p>
    <div class="grid2">
      <label class="field" for="ap-first">Your first name<input id="ap-first" maxlength="24" autocomplete="given-name"></label>
      <label class="field" for="ap-last">Last initial<input id="ap-last" maxlength="1" autocomplete="off"></label>
      <label class="field" for="ap-email">Email (so we can reach you)<input id="ap-email" type="email" maxlength="120" autocomplete="email"></label>
      <label class="field" for="ap-team">Team name<input id="ap-team" maxlength="80" placeholder="Riverside U14"></label>
      <label class="field" for="ap-city">City<input id="ap-city" maxlength="60"></label>
    </div>
    <p class="hint">Applying makes your key on this device. It is your login. No password.</p>
    <div id="ap-key"></div>`;
  keyMaker($('ap-key'), {
    label: 'APPLY',
    make: async opts => {
      await applyAsCoach(opts, { first_name: $('ap-first').value.trim(), last_initial: $('ap-last').value.trim(), email: $('ap-email').value.trim() },
        { name: $('ap-team').value.trim(), city: $('ap-city').value.trim() });
      boot();
    },
  });
}

function paintPending(team) {
  root.innerHTML = `<p><b>${esc(team.name)}</b>${team.city ? ` · ${esc(team.city)}` : ''}</p>
    <p class="hint">Your application is in. LacrosseTube verifies teams by hand. Once it is verified, you can add players here.</p>
    <div class="row"><button class="btn alt" type="button" id="pd-check">CHECK AGAIN</button><button class="ghost" type="button" id="pd-out">Sign out</button></div>`;
  $('pd-check').addEventListener('click', boot);
  $('pd-out').addEventListener('click', async () => { await logOut(); boot(); });
}

/* ---------- roster ---------- */
async function paintRoster(team) {
  const rows = await rpc('roster_for_coach', { p_org: team.org_id });
  const live = r => r.active_keys > 0;
  const state = r => live(r) ? 'Joined' : r.invite_expires_at ? `Invite until ${day(r.invite_expires_at)}` : 'No invite';
  const consent = r => r.role === 'parent' ? (r.consent_at ? 'Consent given' : 'Consent pending')
    : r.age_band === 'u13' ? (r.consent_at ? 'Parent consented' : 'Waiting for parent') : r.has_parent ? (r.consent_at ? 'Parent linked' : 'Parent invited') : '';
  root.innerHTML = `<p><b>${esc(team.name)}</b>${team.city ? ` · ${esc(team.city)}` : ''} <span class="badge ok">VERIFIED</span></p>
    <div class="tablewrap"><table class="roster team-roster"><thead><tr><th>Name</th><th>#</th><th>Position</th><th>Age</th><th>Role</th><th>Status</th><th>Parent</th><th><span class="sr">Actions</span></th></tr></thead><tbody>
    ${rows.map(r => `<tr data-person="${r.person_id}"><td>${esc(r.display_name)}</td><td>${esc(r.number || '')}</td><td>${esc(positionLabel(r.position))}</td>
      <td>${BAND[r.age_band] || ''}</td><td>${ROLE[r.role] || r.role}</td><td>${esc(state(r))}${r.placed ? ' · placed' : ''}</td><td>${esc(consent(r))}</td>
      <td class="acts-cell">${r.role === 'coach' ? '' : `<button class="ghost" type="button" data-invite>New invite</button>${live(r) ? '<button class="ghost" type="button" data-revoke>Turn off key</button>' : ''}`}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="row"><button class="btn" type="button" id="rs-sheet">MAKE INVITE SHEET</button><span class="hint">Fresh invites for everyone who has not joined. Each works once and lasts 7 days.</span></div>
    <p class="msg" id="rs-msg" role="status" hidden></p>
    <h3 class="sub">Add to roster</h3>
    <div class="grid2">
      <label class="field" for="ad-first">First name<input id="ad-first" maxlength="24" autocomplete="off"></label>
      <label class="field" for="ad-last">Last initial<input id="ad-last" maxlength="1" autocomplete="off"></label>
      <label class="field" for="ad-num">Number<input id="ad-num" maxlength="4" inputmode="numeric" autocomplete="off"></label>
      <label class="field" for="ad-pos">Position<select id="ad-pos">${POSITIONS.lacrosse.map(p => `<option value="${p.id}">${esc(p.label)}</option>`).join('')}</select></label>
      <label class="field" for="ad-band">Age<select id="ad-band"><option value="u13">Under 13</option><option value="13_17" selected>13–17</option><option value="18_plus">18+</option></select></label>
      <label class="field" for="ad-role">Role<select id="ad-role"><option value="player">Player</option><option value="coach">Assistant coach (18+)</option><option value="treasurer">Treasurer (18+)</option></select></label>
      <label class="field" for="ad-parent" id="ad-parent-wrap">Parent email<input id="ad-parent" type="email" maxlength="120" autocomplete="off"></label>
    </div>
    <p class="hint" id="ad-parent-hint"></p>
    <div class="row"><button class="btn alt" type="button" id="ad-go">ADD</button></div>
    <p class="msg" id="ad-msg" role="status" hidden></p>
    <div class="row"><button class="ghost" type="button" id="rs-out">Sign out</button></div>`;

  const band = $('ad-band'), role = $('ad-role'), parentHint = () => {
    const b = band.value;
    $('ad-parent-wrap').hidden = b === '18_plus';
    $('ad-parent-hint').textContent = b === 'u13' ? 'Required for under 13. Their parent gets an invite and gives consent before the player can join. No photo is ever collected.'
      : b === '13_17' ? 'Optional. A linked parent can let this player show their links outside the team.' : '';
    if (role.value !== 'player' && b !== '18_plus') band.value = '18_plus', parentHint();
  };
  band.addEventListener('change', parentHint); role.addEventListener('change', parentHint); parentHint();

  $('ad-go').addEventListener('click', e => busy(e.currentTarget, $('ad-msg'), async () => {
    const b = band.value;
    await rpc('roster_add', { p_org: team.org_id, p_first_name: $('ad-first').value.trim(), p_last_initial: $('ad-last').value.trim(),
      p_number: $('ad-num').value.trim(), p_position: $('ad-pos').value, p_age_band: b, p_role: role.value,
      p_parent_email: b === '18_plus' ? null : ($('ad-parent').value.trim() || null) });
    await paintRoster(team);
    say($('ad-msg'), 'Added. Make an invite sheet when your roster is ready.', 'ok');
  }));
  root.querySelectorAll('[data-invite]').forEach(b => b.addEventListener('click', e => busy(e.currentTarget, $('rs-msg'), async () => {
    const r = rows.find(x => x.person_id === e.currentTarget.closest('tr').dataset.person);
    const [inv] = await rpc('invite_create', { p_org: team.org_id, p_person: r.person_id });
    showSheet(team, [{ ...r, ...inv }]);
    await paintRoster(team);
  })));
  root.querySelectorAll('[data-revoke]').forEach(b => b.addEventListener('click', e => busy(e.currentTarget, $('rs-msg'), async () => {
    const r = rows.find(x => x.person_id === e.currentTarget.closest('tr').dataset.person);
    if (!confirm(`Turn off ${r.display_name}'s key? Their profile, XP and rating stay. Give them a new invite to get back in.`)) return;
    await rpc('keys_revoke', { p_org: team.org_id, p_person: r.person_id });
    await paintRoster(team);
  })));
  $('rs-sheet').addEventListener('click', e => busy(e.currentTarget, $('rs-msg'), async () => {
    const todo = rows.filter(r => r.role !== 'coach' && !live(r));
    if (!todo.length) throw new Error('Everyone on the roster has joined.');
    const made = [];
    for (const r of todo) made.push({ ...r, ...(await rpc('invite_create', { p_org: team.org_id, p_person: r.person_id }))[0] });
    showSheet(team, made);
    await paintRoster(team);
  }));
  $('rs-out').addEventListener('click', async () => { await logOut(); boot(); });
}

/* ---------- printable QR sheet ---------- */
function qrSvg(text) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true, alt: 'Invite QR code' });
}
function showSheet(team, invites) {
  const sheet = $('qr-sheet');
  const parentsFirst = [...invites].sort((a, b) => (b.role === 'parent') - (a.role === 'parent'));
  sheet.innerHTML = `<div class="sheet-head no-print-hide">
      <h2>${esc(team.name)} · invites</h2>
      <p>Each code works once, for one person, until the date on it. Point a phone camera at your own code. Parents of under-13 players go first.</p>
      <div class="row screen-only"><button class="btn" type="button" id="sh-print">PRINT SHEET</button><button class="ghost" type="button" id="sh-close">Close</button></div>
    </div>
    <div class="sheet-grid">${parentsFirst.map(i => `<article class="invite-card">
      <div class="qr">${qrSvg(inviteUrl(i.code))}</div>
      <div class="who"><b>${esc(i.display_name)}</b>
        <span>${i.role === 'parent' ? 'Parent or guardian' : [i.number ? `#${esc(i.number)}` : '', esc(positionLabel(i.position)), ROLE[i.role] !== 'Player' ? ROLE[i.role] : ''].filter(Boolean).join(' · ')}</span>
        <small>Expires ${day(i.expires_at)}</small>
        <code class="link screen-only">${esc(inviteUrl(i.code))}</code>
        <button class="ghost screen-only" type="button" data-copy="${esc(inviteUrl(i.code))}">Copy link</button></div>
    </article>`).join('')}</div>`;
  sheet.hidden = false;
  sheet.scrollIntoView({ block: 'start' });
  $('sh-print').addEventListener('click', () => {
    document.body.classList.add('print-sheet');
    window.print();
    setTimeout(() => document.body.classList.remove('print-sheet'), 500);
  });
  $('sh-close').addEventListener('click', () => { sheet.hidden = true; sheet.innerHTML = ''; });
  sheet.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copied'; } catch { b.textContent = 'Copy failed'; }
  }));
}

boot().catch(e => { root.innerHTML = `<p class="msg err">${esc(e.message)}</p>`; });
