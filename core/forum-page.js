// /forum: any signed-in member posts text, a photo or a clip they upload. YouTube films are the
// library on the film site, not posts, so a YouTube link is refused here and in the database.
// A post can be tipped from site balance, and a post can be a service with a price, including a
// stick-doctor pattern from data/stick-patterns.js; paying it moves points to the seller and keeps
// a receipt. Photos and clips sit in a private bucket that only signed-in members can read.
import { supabase } from './supabase.js';
import { status } from './keyring.js';
import { rpc } from './auth.js';
import { TRIAL, slot, slotLabel } from './trial.js';
import { mountPortal, signInChoice } from './portal.js';
import { $, esc, say, busy, ensureSignedIn, avatarGlyph } from './ui.js';

mountPortal('player');
const root = $('forum');
const PATTERNS = (globalThis.LACROSSETUBE_PATTERNS || []).filter(p => /^[a-z0-9-]{1,60}$/.test(p.id));
const patternTitle = id => PATTERNS.find(p => p.id === id)?.title || id;
const YOUTUBE = /(youtube(-nocookie)?\.com|youtu\.be)/i;
const TYPES = { 'image/jpeg': ['photo', 'jpg'], 'image/png': ['photo', 'png'], 'image/webp': ['photo', 'webp'], 'video/mp4': ['clip', 'mp4'], 'video/webm': ['clip', 'webm'], 'video/quicktime': ['clip', 'mov'] };
const MAX_BYTES = 25 * 1024 * 1024;
const n = x => Number(x || 0).toLocaleString();
const when = iso => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const trialLine = TRIAL ? `<p class="trial-line">Preview trial · ${esc(slotLabel(slot))}</p>` : '';
const urls = new Map();

async function start() {
  if (!supabase) { root.innerHTML = '<p class="msg err">Team accounts are not switched on for this site.</p>'; return; }
  if (!(await status())) return signInChoice(root, 'The forum is for members. Coaches sign in at the coach desk; players join from their invite.');
  if (!(await ensureSignedIn(root))) return;
  const [home, wallet] = await Promise.all([rpc('team_home'), rpc('wallet_home').catch(() => null)]);
  root.innerHTML = `${trialLine}<p class="kicker">FORUM · MEMBERS ONLY</p><h1>Forum</h1>
    <p>Post text, a photo or a clip you took. Films from YouTube stay in the <a href="/">film library</a>. Your balance: <b id="fm-bal">${n(wallet?.points ?? home.wallet.points)}</b> points.</p>
    <details class="edit" open><summary>New post</summary>
      <label class="field" for="fm-body">What do you want to share?<textarea id="fm-body" rows="4" maxlength="2000"></textarea></label>
      <label class="field" for="fm-file">Photo or clip (optional, up to 25 MB)<input id="fm-file" type="file" accept="${Object.keys(TYPES).join(',')}"></label>
      <label class="check"><input type="checkbox" id="fm-svc"> Offer this as a service with a price</label>
      <div class="grid2" id="fm-svc-box" hidden>
        <label class="field" for="fm-title">Service name<input id="fm-title" maxlength="80" autocomplete="off" placeholder="I string your head, 3 days"></label>
        <label class="field" for="fm-price">Price in points<input id="fm-price" type="number" inputmode="numeric" min="1" max="1000000" step="1" value="500"></label>
        <label class="field" for="fm-pattern">Stick-doctor pattern (optional)<select id="fm-pattern"><option value="">None</option>${PATTERNS.map(p => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join('')}</select></label>
      </div>
      <div class="row"><button class="btn" type="button" id="fm-post">POST</button></div>
      <p class="msg" id="fm-msg" role="status" hidden></p>
    </details>
    <ul class="posts" id="fm-feed"><li class="hint">Loading posts…</li></ul>
    <div class="row"><a class="ghost" href="${home.teams.some(t => t.role === 'coach' || t.role === 'admin') ? '/coach' : '/team'}">My page</a><a class="ghost" href="/">Film room</a></div>`;

  $('fm-svc').addEventListener('change', e => { $('fm-svc-box').hidden = !e.target.checked; });
  $('fm-pattern').addEventListener('change', e => { if (e.target.value && !$('fm-title').value) $('fm-title').value = `${patternTitle(e.target.value)} stringing`; });
  $('fm-post').addEventListener('click', e => busy(e.currentTarget, $('fm-msg'), async () => {
    const body = $('fm-body').value.trim(), file = $('fm-file').files[0], svc = $('fm-svc').checked;
    if (YOUTUBE.test(body) || (svc && YOUTUBE.test($('fm-title').value))) throw new Error('YouTube films live in the film library, not the forum. Post text, a photo or your own clip.');
    if (!body && !file) throw new Error('Write something, or add a photo or clip.');
    let media = null;
    if (file) {
      const type = TYPES[file.type];
      if (!type) throw new Error('Photos: JPEG, PNG or WebP. Clips: MP4, WebM or MOV.');
      if (file.size > MAX_BYTES) throw new Error('That file is over 25 MB. Trim the clip and try again.');
      const path = `${home.person.id}/${crypto.randomUUID()}.${type[1]}`;
      say($('fm-msg'), 'Uploading…');
      const { error } = await supabase.storage.from('forum').upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw new Error(`The upload did not go through: ${error.message}`);
      media = { path, kind: type[0] };
    }
    const price = svc ? Number($('fm-price').value) : null;
    if (svc && (!Number.isInteger(price) || price < 1)) throw new Error('Set a price in whole points.');
    if (svc && !$('fm-title').value.trim()) throw new Error('Name the service.');
    await rpc('forum_post', { p_body: body, p_media_path: media?.path ?? null, p_media_kind: media?.kind ?? null,
      p_title: svc ? $('fm-title').value.trim() : null, p_price: price, p_pattern: svc ? $('fm-pattern').value || null : null });
    $('fm-body').value = ''; $('fm-file').value = ''; $('fm-svc').checked = false; $('fm-svc-box').hidden = true;
    say($('fm-msg'), 'Posted.', 'ok');
    feed();
  }));
  feed();
}

async function feed() {
  const el = $('fm-feed');
  let posts;
  try { posts = await rpc('forum_feed', {}); }
  catch (e) { el.innerHTML = `<li class="empty">${esc(/function|schema cache/i.test(e.message) ? 'The forum opens once this site\'s database has the Phase 2 update.' : e.message)}</li>`; return; }
  if (!posts.length) { el.innerHTML = '<li class="empty">No posts yet. Be the first.</li>'; return; }
  el.innerHTML = posts.map(p => `<li class="post" data-post="${esc(p.id)}">
      <div class="post-head"><span class="glyph" aria-hidden="true">${avatarGlyph(p.author.avatar)}</span>
        <div><b>${esc(p.author.display_name)}</b><small>${esc(p.author.team || '')} · ${when(p.created_at)}</small></div></div>
      ${p.title ? `<h3 class="post-title">${esc(p.title)}</h3>` : ''}
      ${p.body ? `<p class="post-body">${esc(p.body)}</p>` : ''}
      ${p.media_path ? `<div class="post-media" data-media="${esc(p.media_path)}" data-kind="${esc(p.media_kind)}"><span class="hint">Loading ${p.media_kind}…</span></div>` : ''}
      ${p.price_points ? `<p class="svc"><b>${n(p.price_points)} points</b>${p.pattern_id ? ` · pattern: ${esc(patternTitle(p.pattern_id))}` : ''}${p.sales ? ` · ${p.sales} sold` : ''}</p>` : ''}
      <div class="row post-acts">
        ${p.tips ? `<small>${n(p.tips)} points in tips</small>` : ''}
        ${p.mine
          ? '<button class="ghost" type="button" data-remove>Remove</button>'
          : `<label class="tip-amt"><span class="sr">Tip amount</span><select data-tip-amt><option>10</option><option selected>50</option><option>100</option><option>500</option></select></label>
             <button class="btn alt" type="button" data-tip>TIP</button>
             ${p.price_points ? (p.bought ? '<span class="badge ok">BOUGHT · RECEIPT IN YOUR WALLET</span>' : `<button class="btn" type="button" data-pay>PAY ${n(p.price_points)} POINTS</button>`) : ''}`}
      </div>
      <p class="msg" role="status" hidden></p>
    </li>`).join('');
  el.querySelectorAll('[data-media]').forEach(showMedia);
  el.querySelectorAll('[data-tip]').forEach(b => b.addEventListener('click', e => act(e, async li => {
    const points = Number(li.querySelector('[data-tip-amt]').value);
    await rpc('post_tip', { p_post: li.dataset.post, p_points: points });
    return `Tipped ${n(points)} points.`;
  })));
  el.querySelectorAll('[data-pay]').forEach(b => b.addEventListener('click', e => act(e, async li => {
    const post = posts.find(x => x.id === li.dataset.post);
    if (!confirm(`Pay ${n(post.price_points)} points to ${post.author.display_name} for “${post.title}”?`)) return null;
    const r = await rpc('service_pay', { p_post: post.id });
    return `Paid. Receipt ${r.id.slice(0, 8)} is in your wallet.`;
  })));
  el.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', e => act(e, async li => {
    if (!confirm('Remove this post?')) return null;
    await rpc('forum_remove', { p_post: li.dataset.post });
    return 'Removed.';
  })));
}

function act(e, fn) {
  const li = e.currentTarget.closest('li'), msg = li.querySelector('.msg');
  return busy(e.currentTarget, msg, async () => {
    const text = await fn(li);
    if (!text) return;
    const w = await rpc('wallet_home').catch(() => null);
    if (w) $('fm-bal').textContent = n(w.points);
    await feed();
    const again = $('fm-feed').querySelector(`[data-post="${li.dataset.post}"] .msg`);
    if (again) say(again, text, 'ok');
  });
}

// Photos and clips are read with the member's session and shown from memory (blob: URLs).
async function showMedia(box) {
  const path = box.dataset.media, kind = box.dataset.kind;
  try {
    if (!urls.has(path)) {
      const { data, error } = await supabase.storage.from('forum').download(path);
      if (error) throw error;
      urls.set(path, URL.createObjectURL(data));
    }
    const src = urls.get(path);
    box.innerHTML = kind === 'clip' ? `<video controls playsinline preload="metadata" src="${src}"></video>` : `<img alt="Photo from the post" src="${src}">`;
  } catch { box.innerHTML = `<span class="hint">This ${esc(kind)} did not load.</span>`; }
}

start().catch(e => { root.innerHTML = `<p class="msg err">${esc(e.message)}</p>`; });
