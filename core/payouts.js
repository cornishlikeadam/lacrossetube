// Session payouts. The coach attaches one What Coach Said session link (a team link, /play#t=...)
// and picks only the condition; the amount is fixed by the rules in chain.js and the database:
//   A  open     the player opened the session
//   B  finish   the player finished the session's What Coach Said game
//   C  watch    the player watched the assigned film for the minutes the coach set
//   D  present  the coach marks the player present
// Points leave the team pool only when the condition is true and the player confirms.
import { rpc, redeemStatus, teamWallet } from './auth.js';
import { balanceOf } from './chain-read.js';
import { readHash } from '../field/share.js';
import { loadCoach } from '../field/db.js';
import { POINTS, txUrl, addressUrl, formatDoge, CHAIN } from '../supabase/functions/_shared/chain.js';
import { $, esc, say, busy } from './ui.js';

const P = POINTS.payout;
const n = x => Number(x || 0).toLocaleString();
const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
export const CONDITIONS = {
  open: { letter: 'A', label: 'Opened the session', points: () => P.open },
  finish: { letter: 'B', label: 'Finished the What Coach Said game for that session', points: () => P.finish },
  watch: { letter: 'C', label: 'Watched the assigned film for the minutes you set', points: m => P.watchPerMinute * (m || 0) },
  present: { letter: 'D', label: 'You mark them present', points: () => P.present },
};
const ask = p => ({
  open: 'Open the session',
  finish: 'Finish the session\'s What Coach Said game',
  watch: `Watch ${p.film_title ? `“${p.film_title}”` : 'the assigned film'} for ${p.minutes} minute${p.minutes === 1 ? '' : 's'}`,
  present: 'Your coach marks you present',
}[p.condition]);

/* ---------- player: what each open payout needs, and the confirm button ---------- */
export function playerPayouts(el, list, { onChange, claim = id => rpc('payout_claim', { p_payout: id }) } = {}) {
  if (!list.length) { el.innerHTML = '<p class="empty">No session payouts from your coach yet. When your coach attaches a session, it shows up here.</p>'; return; }
  el.innerHTML = `<ul class="payouts">${list.map(p => {
    const c = CONDITIONS[p.condition], done = p.claim;
    const progress = p.condition === 'watch' ? `<small>Watched ${mmss(Math.min(p.watched || 0, p.minutes * 60))} of ${p.minutes}:00</small>` : '';
    const go = p.condition === 'watch' ? `<a class="ghost" href="/?watch=${encodeURIComponent(p.film_id)}">Watch the film</a>`
      : p.condition === 'present' ? '' : `<a class="ghost" href="${esc(p.session_link)}">Open the session</a>`;
    return `<li class="${done ? 'claimed' : p.met ? 'met' : ''}" data-payout="${esc(p.id)}">
      <div><b>${c.letter} · ${esc(ask(p))}</b>
        <span>${esc(p.team)}${p.session_label ? ` · ${esc(p.session_label)}` : ''} · ${n(p.points)} points</span>${progress}
        ${done ? `<small>${done.settle === 'chain' ? (done.status === 'sent' ? 'Sent to your address on chain' : 'Sending…') : 'Confirmed · in your site balance'}${done.tx_hash ? ` · <a href="${txUrl(done.tx_hash)}" target="_blank" rel="noopener noreferrer">receipt on explorer</a>` : ''}</small>`
          : p.met ? '<small>Done. Confirm it to take the points.</small>' : '<small>Not yet.</small>'}</div>
      <div class="row">${done ? '<span class="badge ok">CONFIRMED</span>' : `${go}${p.met ? `<button class="btn" type="button" data-claim>CONFIRM +${n(p.points)}</button>` : ''}`}</div>
    </li>`;
  }).join('')}</ul><p class="msg" id="po-msg" role="status" hidden></p>`;
  el.querySelectorAll('[data-claim]').forEach(b => b.addEventListener('click', e => busy(e.currentTarget, $('po-msg'), async () => {
    const id = e.currentTarget.closest('li').dataset.payout;
    const r = await claim(id);
    say($('po-msg'), r?.settle === 'chain' ? 'Sent from the team address to yours. The receipt is on the card.' : `+${n(r?.points)} points are in your site balance.`, 'ok');
    onChange?.();
  })));
}

/* ---------- coach: the team pool, a new payout, and every payout's players ---------- */
let filmList = null;
async function films() {
  if (!filmList) {
    try { filmList = (await (await fetch('/data/catalog.json')).json()).filter(i => i.type === 'video' && /^[A-Za-z0-9_-]{1,80}$/.test(i.id)).map(i => ({ id: i.id, title: i.title })); }
    catch { filmList = []; }
  }
  return filmList;
}
const filmIdFrom = (text, list) => {
  const s = String(text || '').trim();
  const m = s.match(/[?&]watch=([A-Za-z0-9_-]{1,80})/) || s.match(/\[([A-Za-z0-9_-]{1,80})\]$/) || s.match(/^([A-Za-z0-9_-]{1,80})$/);
  if (m) return list.find(f => f.id === m[1]) || { id: m[1], title: '' };
  return list.find(f => f.title.toLowerCase() === s.toLowerCase()) || null;
};

export async function coachPayouts(el, team, { onChange } = {}) {
  const [view, coach, list, chain] = await Promise.all([rpc('payouts_for_coach', { p_org: team.org_id }), loadCoach().catch(() => ({ sessions: {} })), films(),
    redeemStatus().catch(() => ({ configured: false }))]);
  // Chain on: the team address is made (on the server) and recorded the first time it is needed.
  if (chain.configured && !view.address) view.address = (await teamWallet(team.org_id).catch(() => null))?.address || null;
  const made = Object.values(coach.sessions || {}).sort((a, b) => (b.made || 0) - (a.made || 0)).slice(0, 8);
  const donate = `${location.origin}/team?donate=${team.org_id}`;
  el.innerHTML = `<h2><i>$</i> TEAM POOL &amp; SESSION PAYOUTS</h2>
    <div class="pool"><b>${n(view.pool)}</b><span>points in the ${esc(team.name)} pool</span>
      <small>Anyone signed in can give to it from their wallet. Share this link: <code>${esc(donate)}</code> <button class="ghost" type="button" id="pl-copy">Copy</button></small>
      ${view.address ? `<small>Team address: <code>${esc(view.address)}</code> <a href="${addressUrl(view.address)}" target="_blank" rel="noopener noreferrer">Explorer</a> · separate from your own wallet</small>
        <small id="pl-onchain">${chain.configured ? 'On chain: checking…' : ''}</small>` : ''}
      ${chain.configured ? `<small>Payouts leave from the team address once it holds enough testnet DOGE (gifts and anyone's ${CHAIN.currency.symbol} sent to it). Until then they come from the points pool.</small>` : ''}</div>
    ${view.donations.length ? `<ul class="activity">${view.donations.map(d => `<li class="in"><span>${new Date(d.created_at).toLocaleDateString()} · ${esc(d.from || 'A member')}${d.note ? ` · “${esc(d.note)}”` : ''}${d.settle === 'chain' ? ' · on chain' : ''}</span><b>+${n(d.points)}</b>${d.tx_hash ? `<small><a href="${txUrl(d.tx_hash)}" target="_blank" rel="noopener noreferrer">receipt on explorer</a></small>` : ''}</li>`).join('')}</ul>` : ''}

    <h3 class="sub">New session payout</h3>
    <p class="hint">Attach one What Coach Said session link and pick what earns it. You do not type an amount: each condition pays a set amount to every player who does it and confirms.</p>
    <label class="field" for="py-link">Session link (…/play#t=…)<input id="py-link" autocomplete="off" placeholder="Make one under “Make a team link” below" value="${esc(made[0]?.url || '')}"></label>
    ${made.length > 1 ? `<label class="field" for="py-made">Or a link you made on this device<select id="py-made">${made.map(s => `<option value="${esc(s.url)}">${esc([s.team, s.date].filter(Boolean).join(' · ') || s.id)}</option>`).join('')}</select></label>` : ''}
    <fieldset class="presets conditions"><legend>Pays when the player…</legend>
      ${Object.entries(CONDITIONS).map(([id, c], i) => `<label class="check"><input type="radio" name="py-cond" value="${id}"${i ? '' : ' checked'}> <span><b>${c.letter}.</b> ${esc(c.label)} · <span data-amt="${id}">${id === 'watch' ? `${P.watchPerMinute} points a minute` : `${n(c.points())} points`}</span></span></label>`).join('')}
    </fieldset>
    <div class="grid2" id="py-watch" hidden>
      <label class="field" for="py-film">Assigned film<input id="py-film" list="py-films" autocomplete="off" placeholder="Film title or a /?watch= link"></label>
      <datalist id="py-films">${list.map(f => `<option value="${esc(f.title)} [${esc(f.id)}]"></option>`).join('')}</datalist>
      <label class="field" for="py-min">Minutes (1–${P.maxWatchMinutes})<input id="py-min" type="number" inputmode="numeric" min="1" max="${P.maxWatchMinutes}" value="5"></label>
    </div>
    <div class="row"><button class="btn" type="button" id="py-go">ATTACH SESSION</button></div>
    <p class="msg" id="py-msg" role="status" hidden></p>

    ${view.payouts.length ? `<h3 class="sub">Payouts</h3><ul class="payouts coach">${view.payouts.map(p => {
      const c = CONDITIONS[p.condition];
      return `<li data-payout="${esc(p.id)}" class="${p.status}"><div><b>${c.letter} · ${esc(ask(p).replace('Your coach marks you present', 'Marked present'))}</b>
        <span>${esc(p.session_label || 'Session')} · ${n(p.points)} points each · ${p.status === 'open' ? 'open' : 'closed'}</span></div>
        <div class="tablewrap"><table class="roster"><thead><tr><th>Player</th><th>${p.condition === 'present' ? 'Present' : 'Done'}</th><th>Confirmed</th></tr></thead><tbody>
        ${p.players.map(x => `<tr data-person="${esc(x.person_id)}"><td>${esc(x.display_name)}${x.number ? ` #${esc(x.number)}` : ''}</td>
          <td>${p.condition === 'present'
            ? `<label class="check"><input type="checkbox" data-present${x.present ? ' checked' : ''}${x.claim || p.status !== 'open' ? ' disabled' : ''}><span class="sr">Present</span></label>`
            : `${x.met ? '✓' : '—'}${p.condition === 'watch' ? ` <small>${mmss(Math.min(x.watched || 0, p.minutes * 60))}</small>` : ''}`}</td>
          <td>${x.claim ? (x.claim.tx_hash ? `<a href="${txUrl(x.claim.tx_hash)}" target="_blank" rel="noopener noreferrer">on chain</a>` : '✓') : ''}</td></tr>`).join('') || '<tr><td colspan="3">No players yet.</td></tr>'}
        </tbody></table></div>
        ${p.status === 'open' ? '<div class="row"><button class="ghost" type="button" data-close>Close this payout</button></div>' : ''}</li>`;
    }).join('')}</ul>` : ''}
    <p class="msg" id="pl-msg" role="status" hidden></p>`;

  if (chain.configured && view.address) balanceOf(view.address).then(b => { const x = $('pl-onchain'); if (x) x.textContent = b == null ? 'On chain: could not reach the DogeOS RPC.' : `On chain: ${formatDoge(b)}`; });
  const cond = () => el.querySelector('input[name="py-cond"]:checked').value;
  el.querySelectorAll('input[name="py-cond"]').forEach(r => r.addEventListener('change', () => { $('py-watch').hidden = cond() !== 'watch'; }));
  $('py-made')?.addEventListener('change', e => { $('py-link').value = e.target.value; });
  $('pl-copy').addEventListener('click', async e => { try { await navigator.clipboard.writeText(donate); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Select and copy'; } });
  $('py-go').addEventListener('click', e => busy(e.currentTarget, $('py-msg'), async () => {
    const link = $('py-link').value.trim();
    let session;
    try { session = await readHash(link); } catch (err) { throw new Error(`That session link did not open: ${err.message}`); }
    if (session?.kind !== 't' || !/^https?:\/\/[^\s]+\/play#t=/.test(link)) throw new Error('Attach a What Coach Said session link: make one under “Make a team link”, then paste it here.');
    if (!/^[A-Za-z0-9_-]{1,16}$/.test(session.data.id)) throw new Error('This session link is from an older version. Make a new team link.');
    const c = cond();
    let film = null, minutes = null;
    if (c === 'watch') {
      film = filmIdFrom($('py-film').value, list);
      if (!film) throw new Error('Pick the film from the list, or paste its /?watch= link.');
      minutes = Number($('py-min').value);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > P.maxWatchMinutes) throw new Error(`Set 1 to ${P.maxWatchMinutes} minutes.`);
    }
    await rpc('payout_create', { p_org: team.org_id, p_link: link, p_wcs_id: session.data.id, p_label: [session.data.team, session.data.date].filter(Boolean).join(' · ') || null,
      p_condition: c, p_film: film?.id ?? null, p_film_title: film?.title || null, p_minutes: minutes });
    onChange?.();
  }));
  el.querySelectorAll('[data-present]').forEach(b => b.addEventListener('change', e => busy(e.currentTarget, $('pl-msg'), async () => {
    const box = e.currentTarget;
    await rpc('payout_mark', { p_payout: box.closest('[data-payout]').dataset.payout, p_person: box.closest('tr').dataset.person, p_present: box.checked });
    say($('pl-msg'), box.checked ? 'Marked present. The player can confirm the payout now.' : 'Mark taken back.', 'ok');
  })));
  el.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', e => busy(e.currentTarget, $('pl-msg'), async () => {
    if (!confirm('Close this payout? Players who have not confirmed it can no longer take it.')) return;
    await rpc('payout_close', { p_payout: e.currentTarget.closest('[data-payout]').dataset.payout });
    onChange?.();
  })));
}
