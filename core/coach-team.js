// Coach desk, "Your team": apply for a team, wait for the owner to verify it, then keep the
// roster (the team ledger), make one-time invites and print the QR sheet for practice.
// The device-only roster and the #t= / #r= links below it stay as the offline fallback.
import qrcode from 'qrcode-generator';
import { supabase } from './supabase.js';
import { status } from './keyring.js';
import { applyAsCoach, rpc, logOut } from './auth.js';
import { $, esc, say, busy, keyMaker, ensureSignedIn, ROLE, positionLabel } from './ui.js';
import { TRIAL, slot, slotLabel, rememberInvite } from './trial.js';
import { POSITIONS } from '../field/positions.js';

const root = $('team-body');
if (TRIAL) root.insertAdjacentHTML('beforebegin', `<p class="trial-line">Preview trial · ${esc(slotLabel(slot))} on this browser · <a href="/trial">trial page</a></p>`);
const day = iso => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const inviteUrl = code => `${location.origin}/join#i=${code}`;
// In the preview trial the coach desk remembers the links it makes, so the trial page can open them.
const made = (team, inv) => { if (TRIAL) rememberInvite({ person: inv.person_id, name: inv.display_name, link: inviteUrl(inv.code), expires: inv.expires_at, team: team.name }); return inv; };

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
  const t = TRIAL ? { first: 'Casey', last: 'R', email: 'coach.trial@example.com', team: `Trial Team ${new Date().toISOString().slice(5, 16).replace('T', ' ')}`, city: 'College Park' } : {};
  root.innerHTML = `<p class="hint">Coaches apply once. LacrosseTube checks every team before it can add players. Players never sign up on their own: they join from your roster.</p>
    <div class="grid2">
      <label class="field" for="ap-first">Your first name<input id="ap-first" maxlength="24" autocomplete="given-name" value="${esc(t.first || '')}"></label>
      <label class="field" for="ap-last">Last initial<input id="ap-last" maxlength="1" autocomplete="off" value="${esc(t.last || '')}"></label>
      <label class="field" for="ap-email">Email (so we can reach you)<input id="ap-email" type="email" maxlength="120" autocomplete="email" value="${esc(t.email || '')}"></label>
      <label class="field" for="ap-team">Team name<input id="ap-team" maxlength="80" placeholder="State Club Lacrosse" value="${esc(t.team || '')}"></label>
      <label class="field" for="ap-city">City<input id="ap-city" maxlength="60" value="${esc(t.city || '')}"></label>
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
    <p class="hint">Your application is in. Once LacrosseTube approves it, you can add players here.</p>
    ${TRIAL ? '<p><a class="btn" href="/owner">APPROVE IT ON THE OWNER PAGE</a></p>' : ''}
    <div class="row"><button class="btn alt" type="button" id="pd-check">CHECK AGAIN</button><button class="ghost" type="button" id="pd-out">Sign out</button></div>`;
  $('pd-check').addEventListener('click', boot);
  $('pd-out').addEventListener('click', async () => { await logOut(); boot(); });
}

/* ---------- roster ---------- */
async function paintRoster(team) {
  const rows = await rpc('roster_for_coach', { p_org: team.org_id });
  const live = r => r.active_keys > 0;
  const state = r => live(r) ? 'Joined' : r.invite_expires_at ? `Invite until ${day(r.invite_expires_at)}` : 'No invite';
  root.innerHTML = `<p><b>${esc(team.name)}</b>${team.city ? ` · ${esc(team.city)}` : ''} <span class="badge ok">VERIFIED</span></p>
    <div class="tablewrap"><table class="roster team-roster"><thead><tr><th>Name</th><th>#</th><th>Position</th><th>Role</th><th>Status</th><th><span class="sr">Actions</span></th></tr></thead><tbody>
    ${rows.map(r => `<tr data-person="${r.person_id}"><td>${esc(r.display_name)}</td><td>${esc(r.number || '')}</td><td>${esc(positionLabel(r.position))}</td>
      <td>${ROLE[r.role] || r.role}</td><td>${esc(state(r))}${r.placed ? ' · placed' : ''}</td>
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
      <label class="field" for="ad-role">Role<select id="ad-role"><option value="player">Player</option><option value="coach">Assistant coach</option><option value="treasurer">Treasurer</option></select></label>
    </div>
    <p class="hint">Players are college students, 18 or older.</p>
    <div class="row"><button class="btn alt" type="button" id="ad-go">ADD</button></div>
    <p class="msg" id="ad-msg" role="status" hidden></p>
    <div class="row"><button class="ghost" type="button" id="rs-out">Sign out</button></div>`;

  $('ad-go').addEventListener('click', e => busy(e.currentTarget, $('ad-msg'), async () => {
    // This version is for college players, 18+. Under-18 checks (age bands, parent email and
    // consent, team-only rules) go here later; the database already refuses unsafe rows.
    await rpc('roster_add', { p_org: team.org_id, p_first_name: $('ad-first').value.trim(), p_last_initial: $('ad-last').value.trim(),
      p_number: $('ad-num').value.trim(), p_position: $('ad-pos').value, p_age_band: '18_plus', p_role: $('ad-role').value, p_parent_email: null });
    await paintRoster(team);
    say($('ad-msg'), 'Added. Make an invite sheet when your roster is ready.', 'ok');
  }));
  root.querySelectorAll('[data-invite]').forEach(b => b.addEventListener('click', e => busy(e.currentTarget, $('rs-msg'), async () => {
    const r = rows.find(x => x.person_id === e.currentTarget.closest('tr').dataset.person);
    const [inv] = await rpc('invite_create', { p_org: team.org_id, p_person: r.person_id });
    showSheet(team, [made(team, { ...r, ...inv })]);
    await paintRoster(team);
  })));
  root.querySelectorAll('[data-revoke]').forEach(b => b.addEventListener('click', e => busy(e.currentTarget, $('rs-msg'), async () => {
    const r = rows.find(x => x.person_id === e.currentTarget.closest('tr').dataset.person);
    if (!confirm(`Turn off ${r.display_name}'s key? Their profile, points and rating stay, and a new invite gives them a new key. Their new key has a new DogeOS address: DOGE already sent to the old address is not recovered.`)) return;
    await rpc('keys_revoke', { p_org: team.org_id, p_person: r.person_id });
    await paintRoster(team);
  })));
  $('rs-sheet').addEventListener('click', e => busy(e.currentTarget, $('rs-msg'), async () => {
    const todo = rows.filter(r => r.role !== 'coach' && !live(r));
    if (!todo.length) throw new Error('Everyone on the roster has joined.');
    const sheet = [];
    for (const r of todo) sheet.push(made(team, { ...r, ...(await rpc('invite_create', { p_org: team.org_id, p_person: r.person_id }))[0] }));
    showSheet(team, sheet);
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
  sheet.innerHTML = `<div class="sheet-head no-print-hide">
      <h2>${esc(team.name)} · invites</h2>
      <p>Each code works once, for one person, until the date on it. Point a phone camera at your own code.</p>
      <div class="row screen-only"><button class="btn" type="button" id="sh-print">PRINT SHEET</button><button class="ghost" type="button" id="sh-close">Close</button></div>
    </div>
    <div class="sheet-grid">${invites.map(i => `<article class="invite-card">
      <div class="qr">${qrSvg(inviteUrl(i.code))}</div>
      <div class="who"><b>${esc(i.display_name)}</b>
        <span>${[i.number ? `#${esc(i.number)}` : '', esc(positionLabel(i.position)), ROLE[i.role] !== 'Player' ? ROLE[i.role] : ''].filter(Boolean).join(' · ')}</span>
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
