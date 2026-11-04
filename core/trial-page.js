// /trial (preview trial builds only): one page to try the whole flow in one browser. Each person
// (Coach, Player 1-3) has their own slot here: their own key store and session. Every step uses
// the real pages: the coach desk, the owner page, and the invite link a player opens.
import { TRIAL, PEOPLE, useSlot, trialInvites, rememberInvite } from './trial.js';
import { statusOf, wipeSlot } from './keyring.js';
import { clientFor, sessionKey, SUPABASE_URL } from './supabase.js';
import { CHAIN } from '../supabase/functions/_shared/chain.js';
import { $, esc, busy } from './ui.js';

const root = $('trial');
const PLAYERS = [
  { first: 'Riley', last: 'A', number: '4', position: 'attack' },
  { first: 'Morgan', last: 'B', number: '12', position: 'midfield' },
  { first: 'Jamie', last: 'C', number: '21', position: 'defense' },
];
const short = a => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
const go = (slotId, url) => { useSlot(slotId); location.assign(url); };

async function slotState(id) {
  const key = await statusOf(id);
  if (!key || !localStorage.getItem(sessionKey(id))) return { id, key, home: null };
  const { data } = await clientFor(id).rpc('team_home');
  return { id, key, home: data };
}
async function coachRpc(name, args) {
  const { data, error } = await clientFor('coach').rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}
const inviteUrl = code => `${location.origin}/join#i=${code}`;
const remember = (team, inv, name) => rememberInvite({ person: inv.person_id, name, link: inviteUrl(inv.code), expires: inv.expires_at, team: team.name });

async function start() {
  if (!TRIAL) { root.innerHTML = '<p class="msg err">The trial page only exists on the preview build.</p>'; return; }
  const states = await Promise.all(PEOPLE.map(p => slotState(p.id)));
  const coach = states[0].home, team = coach?.teams.find(t => t.role === 'coach');
  const invites = trialInvites().filter(i => !team || i.team === team.name);
  const freeSlots = states.slice(1).filter(s => !s.key).map(s => s.id);
  const roster = team?.verified ? await coachRpc('roster_for_coach', { p_org: team.org_id }).catch(() => []) : [];
  const players = roster.filter(r => r.role === 'player');

  root.innerHTML = `<p class="kicker">PREVIEW TRIAL · ${esc(new URL(SUPABASE_URL).host.split('.')[0])}</p>
    <h1>Try the whole flow here</h1>
    <p>Each person below has their own slot in this browser: their own key and sign-in. The steps use the real pages.</p>
    <div class="slots">${states.map((s, i) => `<div class="slot">
      <b>${esc(PEOPLE[i].label)}</b>
      <span>${s.home ? esc(s.home.person.display_name) : s.key ? 'Key made, signed out' : 'Empty'}</span>
      ${s.key?.address ? `<code title="${esc(s.key.address)}">${esc(short(s.key.address))}</code>` : ''}
      ${s.home ? `<small>${s.home.wallet.points} points</small>` : ''}
    </div>`).join('')}</div>

    <ol class="steps">
      <li class="${team ? 'done' : ''}"><h2>Apply as a coach</h2>
        ${team ? `<p>${esc(team.name)} applied.</p>` : '<p>Make the coach key and apply. The form is filled in for the trial.</p>'}
        <button class="btn${team ? ' alt' : ''}" type="button" data-go="coach:/coach">${team ? 'OPEN COACH DESK' : 'APPLY AS COACH'}</button></li>
      <li class="${team?.verified ? 'done' : ''}"><h2>Approve the team</h2>
        <p>${team?.verified ? 'Approved with the owner key.' : 'On the owner page, approve it with your owner key.'}</p>
        <a class="btn${team?.verified ? ' alt' : ''}" href="/owner">OWNER PAGE</a></li>
      <li class="${players.length >= 3 ? 'done' : ''}"><h2>Add three players</h2>
        <p>${players.length ? players.map(r => esc(r.display_name)).join(', ') : 'Add them on the coach desk, or in one go here.'}</p>
        <div class="row"><button class="btn${players.length >= 3 ? ' alt' : ''}" type="button" id="tr-add"${team?.verified && players.length < 3 ? '' : ' disabled'}>ADD THREE PLAYERS WITH INVITES</button>
          <button class="ghost" type="button" data-go="coach:/coach">Coach desk</button></div></li>
      <li><h2>Open an invite</h2>
        <p>This is the link a player opens on their phone. Here it opens in that player's slot.</p>
        ${invites.length ? `<ul class="invites">${invites.map(i => {
          const target = i.by || freeSlots.shift();
          return `<li><span>${esc(i.name)} · ${i.used ? `joined as ${esc(PEOPLE.find(p => p.id === i.by)?.label || 'player')}` : `until ${new Date(i.expires).toLocaleDateString()}`}</span>
            ${i.used ? `<button class="ghost" type="button" data-go="${i.by}:/team">Open ${esc(PEOPLE.find(p => p.id === i.by)?.label)}</button>`
              : target ? `<button class="btn" type="button" data-go="${target}:${esc(i.link)}">OPEN AS ${esc(PEOPLE.find(p => p.id === target).label.toUpperCase())}</button>` : '<small>No empty slot</small>'}</li>`;
        }).join('')}</ul>` : '<p class="hint">Invites appear here once the coach makes them.</p>'}</li>
      <li><h2>Reissue a lost key</h2>
        <p>Wipes that player's slot (a lost phone), turns off their key, makes a new invite and opens it. Same person, points and rating; a new DogeOS address.</p>
        <div class="row">${invites.filter(i => i.used).map(i => `<button class="ghost" type="button" data-lose="${esc(i.person)}" data-slot="${i.by}" data-name="${esc(i.name)}">Lose ${esc(PEOPLE.find(p => p.id === i.by)?.label)}'s phone</button>`).join('') || '<span class="hint">After a player joins.</span>'}</div></li>
    </ol>
    <p class="msg" id="tr-msg" role="status" hidden></p>
    <p class="hint">Chain: ${esc(CHAIN.name)} (${CHAIN.id}). <button class="linkish" type="button" id="tr-reset">Start the trial over on this browser</button></p>`;

  root.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => { const [id, ...url] = b.dataset.go.split(':'); go(id, url.join(':')); }));
  $('tr-add').addEventListener('click', e => busy(e.currentTarget, $('tr-msg'), async () => {
    const have = new Set(players.map(r => r.display_name));
    for (const p of PLAYERS) {
      if (have.has(`${p.first} ${p.last}.`)) continue;
      await coachRpc('roster_add', { p_org: team.org_id, p_first_name: p.first, p_last_initial: p.last, p_number: p.number, p_position: p.position, p_age_band: '18_plus', p_role: 'player', p_parent_email: null });
    }
    for (const r of (await coachRpc('roster_for_coach', { p_org: team.org_id })).filter(r => r.role === 'player' && !r.active_keys)) {
      const [inv] = await coachRpc('invite_create', { p_org: team.org_id, p_person: r.person_id });
      remember(team, inv, r.display_name);
    }
    start();
  }));
  root.querySelectorAll('[data-lose]').forEach(b => b.addEventListener('click', e => busy(e.currentTarget, $('tr-msg'), async () => {
    const { lose: person, slot: id, name } = e.currentTarget.dataset;
    if (!confirm(`Lose ${name}'s phone? Their key is turned off and they get a new one with a new DogeOS address. DOGE already sent to the old address is not recovered.`)) return;
    await coachRpc('keys_revoke', { p_org: team.org_id, p_person: person });
    await wipeSlot(id); localStorage.removeItem(sessionKey(id));
    const [inv] = await coachRpc('invite_create', { p_org: team.org_id, p_person: person });
    remember(team, inv, name);
    go(id, inviteUrl(inv.code));
  })));
  $('tr-reset').addEventListener('click', async () => {
    if (!confirm('Start over on this browser? This empties every slot here. Teams and people already made stay in the dev database.')) return;
    for (const p of PEOPLE) { await wipeSlot(p.id); localStorage.removeItem(sessionKey(p.id)); }
    localStorage.removeItem('lt-trial-invites');
    start();
  });
}

start().catch(e => { root.innerHTML = `<p class="msg err">${esc(e.message)}</p>`; });
