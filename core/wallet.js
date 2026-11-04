// The Wallet section, the same on the player page (/team) and the coach desk (/coach): one account,
// one wallet. It shows the site balance (points in LacrosseTube, not on chain), the DogeOS address
// made from this device's key, and today's automatic earnings against their caps. From here a
// member sends points to a teammate, gives to a team pool, and redeems points for testnet DOGE.
// The profile edits stay on each page, under this section.
import { rpc, keyFile, redeemPoints } from './auth.js';
import { supabase } from './supabase.js';
import { isPin } from './keyring.js';
import { download } from './keyfile.js';
import { CHAIN, POINTS, addressUrl, txUrl, pointsToWei, formatDoge } from '../supabase/functions/_shared/chain.js';
import { $, esc, say, busy } from './ui.js';

const E = POINTS.earn;
const n = x => Number(x || 0).toLocaleString();
const doge = points => formatDoge(pointsToWei(points || 0));
const short = a => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
const day = iso => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// One activity line: who, what, how much, and the chain receipt when there is one.
function activityLine(a) {
  const out = a.direction === 'out', who = esc(a.other || 'someone');
  const what = {
    send: out ? `Sent to ${who}` : `${who} sent you`,
    tip: out ? `Tipped ${who}'s post` : `${who} tipped your post`,
    service: out ? `Bought from ${who}: ${esc(a.note || 'a service')}` : `${who} bought ${esc(a.note || 'your service')}`,
    donation: `Gave to the ${who} team pool`,
    payout: `Session payout from ${who}`,
  }[a.kind] || esc(a.kind);
  const chain = a.settle === 'chain'
    ? ` · ${a.status === 'sent' ? `${esc(formatDoge(a.amount_wei))} on chain` : a.status === 'failed' ? 'transfer failed, points returned' : 'sending…'}${a.tx_hash ? ` · <a href="${txUrl(a.tx_hash)}" target="_blank" rel="noopener noreferrer">receipt on explorer</a>` : ''}`
    : '';
  return `<li class="${out ? 'out' : 'in'}"><span>${day(a.created_at)} · ${what}</span><b>${out ? '−' : '+'}${n(a.points)}</b>${chain ? `<small>${chain.slice(3)}</small>` : ''}</li>`;
}

// el: where to draw. ctx: { home (team_home), key (keyring status), redeem (redeem status),
// donateTo (an org id from a ?donate= link), onChange() to redraw the page }.
export async function mountWallet(el, ctx) {
  let w;
  try { w = await rpc('wallet_home'); }
  catch (e) {
    // The page still works on a database without Phase 2 yet: show the Phase 1 wallet card.
    w = { points: ctx.home.wallet.points, address: ctx.home.wallet.address, today: null, teammates: [], teams: [], activity: [], missing: e.message };
  }
  const { key, redeem } = ctx, receipts = ctx.home.wallet.receipts || [];
  const address = w.address || key?.address;
  const redeemable = Math.floor(w.points / POINTS.minRedeem) * POINTS.minRedeem;
  let donateTeam = null;
  if (ctx.donateTo && !w.teams.some(t => t.org_id === ctx.donateTo)) {
    const { data } = await supabase.from('orgs').select('id, name, city, state').eq('id', ctx.donateTo).not('verified_at', 'is', null).maybeSingle();
    if (data) donateTeam = { org_id: data.id, name: data.name, state: data.state, outside: true };
  }
  const poolTeams = [...(donateTeam ? [donateTeam] : []), ...w.teams];
  const t = w.today;

  el.innerHTML = `<h2 class="sub" id="wallet">Wallet</h2>
    <div class="wallet">
      <div class="bal"><b>${n(w.points)}</b><span>points · site balance</span>
        <small>Points live in LacrosseTube, not on the chain. ${POINTS.perDoge.toLocaleString()} points = 1 ${CHAIN.currency.symbol} when you redeem (testnet).</small></div>
      ${t ? `<ul class="today" aria-label="Today's automatic earnings">
        <li><b>${t.minutes_paid} of ${E.maxMinutes}</b> film minutes paid today · ${E.perMinute} points a minute while a film plays</li>
        <li><b>${t.games} of ${E.maxGames}</b> games paid today · ${n(E.perGame)} points for the first finish of each What Coach Said game</li>
        <li><b>${n(t.watch_points + t.game_points)}</b> automatic points today · they stop at ${n(E.dailyCap)}. Warrior Tests, tips and payouts are extra.</li>
      </ul>` : `<p class="hint">${esc(w.missing ? 'Earnings, sending and the team pool open once this site\'s database has the Phase 2 update.' : '')}</p>`}

      <p>Your DogeOS address (${esc(CHAIN.name)}). Your login key is also this wallet:</p>
      <p class="addr"><code id="wl-addr">${esc(address || 'Sign in again to show it')}</code>
        ${address ? `<a class="ghost" href="${addressUrl(address)}" target="_blank" rel="noopener noreferrer">Explorer</a>` : ''}</p>

      ${w.teammates.length ? `<details class="edit" id="wl-send-box"><summary>Send points to a teammate</summary>
        <label class="field" for="wl-to">Teammate<select id="wl-to">${w.teammates.map(m => `<option value="${esc(m.id)}">${esc(m.display_name)} · ${esc(m.team)}</option>`).join('')}</select></label>
        <label class="field" for="wl-amt">Points<input id="wl-amt" type="number" inputmode="numeric" min="1" max="${w.points}" step="1" value="${Math.min(100, w.points) || ''}"></label>
        <label class="field" for="wl-note">Note (optional)<input id="wl-note" maxlength="140" autocomplete="off"></label>
        <div class="row"><button class="btn alt" type="button" id="wl-send"${w.points ? '' : ' disabled'}>SEND</button></div>
        <p class="msg" id="wl-send-msg" role="status" hidden></p></details>` : ''}

      ${poolTeams.length ? `<details class="edit" id="wl-give-box"${donateTeam ? ' open' : ''}><summary>Give to a team pool</summary>
        <p class="hint">A team pool pays the coach's session payouts. Anyone can give to any approved team.</p>
        <label class="field" for="wl-team">Team<select id="wl-team">${poolTeams.map(x => `<option value="${esc(x.org_id)}">${esc(x.name)}${x.state ? ` · ${esc(x.state)}` : ''}${x.outside ? '' : ` · pool ${n(x.pool)} points`}</option>`).join('')}</select></label>
        <label class="field" for="wl-gamt">Points<input id="wl-gamt" type="number" inputmode="numeric" min="1" max="${w.points}" step="1" value="${Math.min(500, w.points) || ''}"></label>
        <div class="row"><button class="btn alt" type="button" id="wl-give"${w.points ? '' : ' disabled'}>GIVE TO POOL</button></div>
        <p class="msg" id="wl-give-msg" role="status" hidden></p></details>` : ''}

      ${redeem.configured
        ? `<div class="row"><button class="btn alt" type="button" id="wl-redeem"${redeemable ? '' : ' disabled'}>REDEEM ${n(redeemable)} POINTS FOR ${esc(doge(redeemable))}</button></div>
           ${redeemable ? '' : `<p class="hint">You need ${POINTS.minRedeem} points to redeem.</p>`}`
        : '<p class="not-configured">Redeem: not configured</p>'}
      <p class="msg" id="wl-msg" role="status" hidden></p>

      ${w.activity.length || receipts.length ? `<h3 class="sub">Activity</h3><ul class="activity">${w.activity.map(activityLine).join('')}
        ${receipts.map(r => `<li class="out"><span>${day(r.created_at)} · Redeemed for ${esc(formatDoge(r.amount_wei))} · ${esc(r.status === 'failed' ? 'transfer failed, points returned' : r.status)}</span><b>−${n(r.points)}</b>${r.tx_hash ? `<small><a href="${txUrl(r.tx_hash)}" target="_blank" rel="noopener noreferrer">receipt on explorer</a></small>` : ''}</li>`).join('')}</ul>` : ''}

      <p class="warn-line">If your login is reissued, you get a new key and a new address. DOGE already sent to this address is not recovered by a reissued login. Only this key, or the key file below, can reach it.</p>
      <details class="edit"><summary>Download my encrypted key file</summary>
        <p class="hint">The file holds this key, locked with a passphrase you choose now. Anyone with the file and the passphrase controls this wallet. Neither can be recovered by LacrosseTube.</p>
        ${key?.method === 'pin' ? '<label class="field" for="kf-pin">Your PIN<input id="kf-pin" type="password" inputmode="numeric" maxlength="6" autocomplete="current-password"></label>' : ''}
        <label class="field" for="kf-pass">File passphrase (12+ characters)<input id="kf-pass" type="password" autocomplete="new-password"></label>
        <label class="field" for="kf-pass2">Type it again<input id="kf-pass2" type="password" autocomplete="new-password"></label>
        <div class="row"><button class="btn alt" type="button" id="kf-go">DOWNLOAD KEY FILE</button></div>
        <p class="msg" id="kf-msg" role="status" hidden></p>
      </details>
    </div>`;

  const amount = id => { const v = Number($(id).value); if (!Number.isInteger(v) || v < 1) throw new Error('Give a whole number of points.'); if (v > w.points) throw new Error(`You have ${n(w.points)} points.`); return v; };
  $('wl-send')?.addEventListener('click', e => busy(e.currentTarget, $('wl-send-msg'), async () => {
    const points = amount('wl-amt'), to = w.teammates.find(m => m.id === $('wl-to').value);
    if (!confirm(`Send ${n(points)} points to ${to.display_name}?`)) return;
    await rpc('points_send', { p_to: to.id, p_points: points, p_note: $('wl-note').value.trim() || null });
    say($('wl-send-msg'), `Sent ${n(points)} points to ${to.display_name}.`, 'ok');
    ctx.onChange?.();
  }));
  $('wl-give')?.addEventListener('click', e => busy(e.currentTarget, $('wl-give-msg'), async () => {
    const points = amount('wl-gamt'), team = poolTeams.find(x => x.org_id === $('wl-team').value);
    if (!confirm(`Give ${n(points)} points to the ${team.name} team pool? Its coach pays session payouts from it.`)) return;
    await rpc('team_donate', { p_org: team.org_id, p_points: points, p_note: null });
    say($('wl-give-msg'), `Thank you. ${n(points)} points went to the ${team.name} pool.`, 'ok');
    ctx.onChange?.();
  }));
  $('wl-redeem')?.addEventListener('click', e => busy(e.currentTarget, $('wl-msg'), async () => {
    const out = await redeemPoints();
    if (!out.receipt) throw new Error(out.error || 'Redeem is not configured.');
    say($('wl-msg'), `Sent ${formatDoge(out.receipt.amount_wei)}. The receipt is below.`, 'ok');
    ctx.onChange?.();
  }));
  $('kf-go').addEventListener('click', e => busy(e.currentTarget, $('kf-msg'), async () => {
    const pass = $('kf-pass').value;
    if (pass.length < 12) throw new Error('Use a passphrase of at least 12 characters.');
    if (pass !== $('kf-pass2').value) throw new Error('The passphrases do not match.');
    const pin = $('kf-pin')?.value;
    if (key.method === 'pin' && !isPin(pin)) throw new Error('Enter your 6-digit PIN.');
    say($('kf-msg'), 'Locking the file. This takes a few seconds…');
    const file = await keyFile({ pin }, pass);
    download(`lacrossetube-key-${file.address.slice(2, 10).toLowerCase()}.json`, file);
    say($('kf-msg'), 'Downloaded. Keep the file and its passphrase somewhere safe.', 'ok');
  }));
  return w;
}

export { short, n, doge };
