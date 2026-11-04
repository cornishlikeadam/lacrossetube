// /team: the signed-in person's team home. Their roster identity, seed rating and team rank,
// streak (if this device has one), the Warrior Tests, session payouts from their coach, the Wallet
// (site balance, DogeOS address, sending, team pools, redeem) and profile edits.
import { supabase } from './supabase.js';
import { status } from './keyring.js';
import { rpc, logOut, redeemStatus, chainClaim } from './auth.js';
import { liveStreak } from '../field/progress.js';
import { loadProfile } from '../field/db.js';
import { POINTS } from '../supabase/functions/_shared/chain.js';
import { TRIAL, slot, slotLabel } from './trial.js';
import { mountPortal, signInChoice } from './portal.js';
import { mountWallet } from './wallet.js';
import { playerPayouts } from './payouts.js';
import { $, esc, say, busy, ensureSignedIn, ROLE, positionLabel, avatarGlyph, presetPickers, socialsFields, readSocials } from './ui.js';

const root = $('team');
// A donate link (/team?donate=<team id>) opens the Wallet on that team's pool.
const donateTo = (q => (/^[0-9a-f-]{36}$/.test(q || '') ? q : null))(new URLSearchParams(location.search).get('donate'));
const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const trialLine = TRIAL ? `<p class="trial-line">Preview trial · ${esc(slotLabel(slot))}</p>` : '';
mountPortal('player');

async function start() {
  if (!supabase) return paint('<p class="msg err">Team accounts are not switched on for this site.</p>');
  if (!(await status())) return signInChoice(root, TRIAL ? `${slotLabel(slot)} has no key yet. Open an invite for them on the trial page, or pick someone else.` : 'Players join from the invite their coach gives them. Coaches use the coach desk.');
  if (!(await ensureSignedIn(root))) return;
  const [home, device, key, redeem, tiers, payouts] = await Promise.all([rpc('team_home'), loadProfile(), status(), redeemStatus().catch(() => ({ configured: false })),
    rpc('warrior_board'), rpc('payouts_for_me').catch(() => null)]);
  const p = home.person, w = home.wallet, teams = home.teams;
  const t = teams.find(x => x.role === 'player') || teams[0];
  const isPlayer = t?.role === 'player', streak = liveStreak(device);
  document.documentElement.dataset.skin = p.skin || 'default';

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
    ${isPlayer ? `<h2 class="sub">From your coach</h2><div id="tm-payouts"></div>` : ''}

    <div id="tm-wallet"></div>

    <details class="edit"><summary>Edit my profile</summary>
      ${presetPickers({ avatar: p.avatar, skin: p.skin, xp: p.xp })}
      ${socialsFields(p)}
      <div class="row"><button class="btn alt" type="button" id="tm-save">SAVE</button></div>
      <p class="msg" id="tm-msg" role="status" hidden></p>
    </details>
    <div class="row">${teams.some(x => x.role === 'coach' || x.role === 'admin') ? '<a class="btn alt" href="/coach">COACH DESK</a>' : ''}<a class="ghost" href="/forum">Forum</a><a class="ghost" href="/">Film room</a><button class="ghost" type="button" id="tm-out">Sign out</button></div>`);

  $('tm-save').addEventListener('click', e => busy(e.currentTarget, $('tm-msg'), async () => {
    const patch = { avatar: root.querySelector('input[name="avatar"]:checked').value, skin: root.querySelector('input[name="skin"]:checked').value,
      socials: readSocials(root), socials_public_self: $('so-public').checked };
    const { error } = await supabase.from('people').update(patch).eq('id', p.id);
    if (error) throw new Error(/socials/.test(error.message) ? 'Links must be full profile links on Instagram, TikTok, YouTube, X or Hudl.' : error.message);
    say($('tm-msg'), 'Saved.', 'ok');
    start();
  }));
  $('tm-out').addEventListener('click', async () => { await logOut(); signInChoice(root); });

  if (isPlayer) {
    // With the chain on, a confirmed payout leaves from the team address once it holds DOGE.
    const claim = redeem.configured ? async id => { const out = await chainClaim(id); if (!out.transfer) throw new Error(out.error || 'Could not confirm.'); return out.transfer; } : undefined;
    if (payouts) playerPayouts($('tm-payouts'), payouts, { onChange: start, ...(claim ? { claim } : {}) });
    else $('tm-payouts').innerHTML = '<p class="empty">Session payouts open here once this site\'s database has the Phase 2 update.</p>';
  }
  await mountWallet($('tm-wallet'), { home, key, redeem, donateTo, onChange: start });
  if (donateTo) $('wallet')?.scrollIntoView({ block: 'start' });
}

function paint(html) { root.innerHTML = html; }
start().catch(e => paint(`<p class="msg err">${esc(e.message)}</p>`));
