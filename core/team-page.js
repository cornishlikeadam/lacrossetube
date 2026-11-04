// /team: the signed-in person's team home. Their roster identity, seed rating and team rank,
// streak (if this device has one), the coach's latest session (an empty state until the coach
// desk goes live), their DogeOS wallet and points, and profile edits.
import { supabase } from './supabase.js';
import { status, isPin } from './keyring.js';
import { rpc, logOut, keyFile, redeemStatus, redeemPoints } from './auth.js';
import { liveStreak } from '../field/progress.js';
import { loadProfile } from '../field/db.js';
import { CHAIN, POINTS, addressUrl, txUrl, pointsToWei, formatDoge } from '../supabase/functions/_shared/chain.js';
import { download } from './keyfile.js';
import { TRIAL, slot, slotLabel } from './trial.js';
import { mountPortal, signInChoice } from './portal.js';
import { $, esc, say, busy, ensureSignedIn, ROLE, positionLabel, avatarGlyph, presetPickers, socialsFields, readSocials } from './ui.js';

const root = $('team');
const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const trialLine = TRIAL ? `<p class="trial-line">Preview trial · ${esc(slotLabel(slot))}</p>` : '';
mountPortal('player');

async function start() {
  if (!supabase) return paint('<p class="msg err">Team accounts are not switched on for this site.</p>');
  if (!(await status())) return signInChoice(root, TRIAL ? `${slotLabel(slot)} has no key yet. Open an invite for them on the trial page, or pick someone else.` : 'Players join from the invite their coach gives them. Coaches use the coach desk.');
  if (!(await ensureSignedIn(root))) return;
  const [home, device, key, redeem, tiers] = await Promise.all([rpc('team_home'), loadProfile(), status(), redeemStatus().catch(() => ({ configured: false })), rpc('warrior_board')]);
  const p = home.person, w = home.wallet, teams = home.teams;
  const t = teams.find(x => x.role === 'player') || teams[0];
  const isPlayer = t?.role === 'player', streak = liveStreak(device);
  document.documentElement.dataset.skin = p.skin || 'default';
  const redeemable = Math.floor(w.points / POINTS.minRedeem) * POINTS.minRedeem;

  paint(`${trialLine}<div class="id-card filled"><span class="glyph" aria-hidden="true">${avatarGlyph(p.avatar)}</span><div>
      <b>${esc(p.display_name)}</b>
      <span>${[t?.number ? `#${esc(t.number)}` : '', esc(positionLabel(t?.position)), esc(t?.name), t?.verified ? '' : '(not approved yet)'].filter(Boolean).join(' · ')}</span>
      <small>${ROLE[t?.role] || ''}</small></div></div>
    ${isPlayer ? `<div class="stat-grid">
      <div class="stat"><b>${p.placed ? Math.round(p.seed_rating) : '—'}</b><small>seed rating</small></div>
      <div class="stat"><b>${p.placed ? ordinal(t.seed_rank) : '—'}</b><small>${p.placed ? `on your team · ${t.placed_count} placed` : 'team rank after placement'}</small></div>
      <div class="stat"><b>${w.points}</b><small>points</small></div>
      ${streak ? `<div class="stat"><b>${streak}</b><small>day streak on this device</small></div>` : ''}
    </div>
    <h2 class="sub">Warrior Tests</h2>
    <p class="tier-total">Five tiers, five questions each. Pass a tier to open the next. All five pay ${(tiers.reduce((n, x) => n + x.reward_points, 0) / POINTS.perDoge).toLocaleString()} DOGE in points (testnet).</p>
    <ol class="tiers">${tiers.map(x => `<li class="${x.passed ? 'passed' : x.unlocked ? '' : 'locked'}">
      <div><b>Tier ${x.level} · ${esc(x.name)}</b><small>${x.kind === 'quiz' ? 'Quiz' : 'Field games'} · ${(x.reward_points / POINTS.perDoge).toLocaleString()} DOGE · ${x.passed ? `passed, best ${x.best_score} of 5` : x.unlocked ? `pass with ${x.pass_score} of 5` : `pass tier ${x.level - 1} first`}</small></div>
      ${x.unlocked ? `<a class="btn${x.passed ? ' alt' : ''}" href="${x.level === 1 ? (p.placed ? '/team' : '/placement') : `/test?tier=${x.level}`}">${x.passed ? (x.level === 1 ? 'DONE' : 'PLAY AGAIN') : 'START ▶'}</a>` : '<span aria-label="Locked">🔒</span>'}
    </li>`).join('')}</ol>` : ''}
    ${t ? `<h2 class="sub">From your coach</h2>
      ${t.has_session ? '<p>Your coach posted a session. It opens here when the coach desk goes live.</p>' : '<p class="empty">No session from your coach yet. When they post one after a meeting, it shows up here.</p>'}` : ''}

    <h2 class="sub">DogeOS wallet · ${esc(CHAIN.name)}</h2>
    <div class="wallet">
      <p>Your login key is also your wallet. Its address:</p>
      <p class="addr"><code id="wl-addr">${esc(w.address || key?.address || 'Sign in again to show it')}</code>
        ${w.address ? `<a class="ghost" href="${addressUrl(w.address)}" target="_blank" rel="noopener noreferrer">Explorer</a>` : ''}</p>
      <p><b>${w.points}</b> points · ${POINTS.perDoge} points = 1 ${CHAIN.currency.symbol} (testnet)</p>
      ${redeem.configured
        ? `<div class="row"><button class="btn alt" type="button" id="wl-redeem"${redeemable ? '' : ' disabled'}>REDEEM ${redeemable} POINTS FOR ${esc(formatDoge(pointsToWei(redeemable || 0)))}</button></div>
           ${redeemable ? '' : `<p class="hint">You need ${POINTS.minRedeem} points to redeem.</p>`}`
        : '<p class="not-configured">Redeem: not configured</p>'}
      <p class="msg" id="wl-msg" role="status" hidden></p>
      ${w.receipts.length ? `<ul class="receipts">${w.receipts.map(r => `<li>${new Date(r.created_at).toLocaleDateString()} · ${r.points} points · ${esc(formatDoge(r.amount_wei))} · ${r.status}${r.tx_hash ? ` · <a href="${txUrl(r.tx_hash)}" target="_blank" rel="noopener noreferrer">receipt on explorer</a>` : ''}</li>`).join('')}</ul>` : ''}
      <p class="warn-line">If your coach reissues your login, you get a new key and a new address. DOGE already sent to this address is not recovered by a reissued login. Only this key, or the key file below, can reach it.</p>
      <details class="edit"><summary>Download my encrypted key file</summary>
        <p class="hint">The file holds this key, locked with a passphrase you choose now. Anyone with the file and the passphrase controls this wallet. Neither can be recovered by LacrosseTube.</p>
        ${key?.method === 'pin' ? '<label class="field" for="kf-pin">Your PIN<input id="kf-pin" type="password" inputmode="numeric" maxlength="6" autocomplete="current-password"></label>' : ''}
        <label class="field" for="kf-pass">File passphrase (12+ characters)<input id="kf-pass" type="password" autocomplete="new-password"></label>
        <label class="field" for="kf-pass2">Type it again<input id="kf-pass2" type="password" autocomplete="new-password"></label>
        <div class="row"><button class="btn alt" type="button" id="kf-go">DOWNLOAD KEY FILE</button></div>
        <p class="msg" id="kf-msg" role="status" hidden></p>
      </details>
    </div>

    <details class="edit"><summary>Edit my profile</summary>
      ${presetPickers({ avatar: p.avatar, skin: p.skin, xp: p.xp })}
      ${socialsFields(p)}
      <div class="row"><button class="btn alt" type="button" id="tm-save">SAVE</button></div>
      <p class="msg" id="tm-msg" role="status" hidden></p>
    </details>
    <div class="row">${teams.some(x => x.role === 'coach' || x.role === 'admin') ? '<a class="btn alt" href="/coach">COACH DESK</a>' : ''}<a class="ghost" href="/">Film room</a><button class="ghost" type="button" id="tm-out">Sign out</button></div>`);

  $('tm-save').addEventListener('click', e => busy(e.currentTarget, $('tm-msg'), async () => {
    const patch = { avatar: root.querySelector('input[name="avatar"]:checked').value, skin: root.querySelector('input[name="skin"]:checked').value,
      socials: readSocials(root), socials_public_self: $('so-public').checked };
    const { error } = await supabase.from('people').update(patch).eq('id', p.id);
    if (error) throw new Error(/socials/.test(error.message) ? 'Links must be full profile links on Instagram, TikTok, YouTube, X or Hudl.' : error.message);
    say($('tm-msg'), 'Saved.', 'ok');
    start();
  }));
  $('wl-redeem')?.addEventListener('click', e => busy(e.currentTarget, $('wl-msg'), async () => {
    const out = await redeemPoints();
    if (!out.receipt) throw new Error(out.error || 'Redeem is not configured.');
    say($('wl-msg'), `Sent ${formatDoge(out.receipt.amount_wei)}. The receipt is below.`, 'ok');
    start();
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
  $('tm-out').addEventListener('click', async () => { await logOut(); signInChoice(root); });
}

function paint(html) { root.innerHTML = html; }
start().catch(e => paint(`<p class="msg err">${esc(e.message)}</p>`));
