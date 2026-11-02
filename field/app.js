import { C, readColors, View, VIEW, clamp, txt, wrapText, crown, rng } from './ink.js';
import { SPORTS, fill } from './sports.js';
import { CONCEPTS } from './concepts.js';
import { SCENES, drawScene, stepsFor } from './scenes.js';
import { parseTranscript } from './parse.js';
import { acquire } from './acquire.js';
import { extractOffline, itemsFromGroups, headlineFor, MAX_ITEMS } from './extract.js';
import { POSITIONS, readPlayer, positionOf } from './positions.js';
import { gameFor, banner } from './games.js';
import { db, loadProfile, saveProfile } from './db.js';
import { loadLibrary, ideasFor, sportIdeasWithPosition, ideaById, itemFromIdea, pickLibraryItems, libraryStats } from './ideas.js';
import { XP, tierOf, TIER_XP, UNLOCKS, unlockedIds, nextUnlock, liveStreak, weekProgress, WEEKLY_GOAL, applyResult, RARITY, rarity, localDay } from './progress.js';
import { pack, readHash, teamGroups, shareOrCopy } from './share.js';

const $ = id => document.getElementById(id);
const DPR = Math.min(window.devicePixelRatio || 1, 2);
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ASPECT = (VIEW.y1 - VIEW.y0) / (VIEW.x1 - VIEW.x0);
const TAG = { start: 'NEW', stop: 'VAULTED', continue: 'STILL META' };
const ORDER = ['start', 'stop', 'continue'];
const SAMPLE = '/samples/lacrosse.txt';
const SOURCE = { library: 'Library', meeting: 'Meeting', team: 'Team' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const keyOf = i => i.idea || i.concept;
const sourceOf = u => u.source || (u.fromLibrary ? 'library' : 'meeting');
const ringSvg = (cls, frac) => `<svg class="ring ${cls}" viewBox="0 0 44 44" aria-hidden="true"><circle class="bg" cx="22" cy="22" r="18"/><circle class="fg" cx="22" cy="22" r="18" style="stroke-dashoffset:${(113.1 * (1 - clamp(frac, 0, 1))).toFixed(1)}"/></svg>`;
const FLAME = '<svg class="flame" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.5 2c.8 3.6-2.9 5.4-2.9 9.1 0 1.2.5 2.1 1.3 2.6-.1-1.9.9-3.3 2.4-4.3-.3 2.4 2.7 3.4 2.7 6.3A4.8 4.8 0 0 1 11.2 20 5.6 5.6 0 0 1 6 14.3C6 8.7 11 6.5 12.5 2z"/></svg>';
const state = { profile: null, sport: null, position: null, update: null, frames: [], auto: null, team: null, meeting: null, hist: { sport: null, pos: null } };
readColors();

/* ---------- skins, HUD, week, locker ---------- */
function applySkin(id) {
  const ok = id && id !== 'default' && unlockedIds(state.profile?.xp || 0).includes(id);
  if (ok) document.documentElement.dataset.skin = id; else delete document.documentElement.dataset.skin;
  readColors(); state.frames.forEach(f => f.draw()); drawExample();
}
function paintHUD() {
  const p = state.profile, { tier, into } = tierOf(p.xp), streak = liveStreak(p);
  $('hud-tier').textContent = tier; $('hud-xp').textContent = `${p.xp} XP`; $('hud-xpbar').style.width = (into / TIER_XP * 100) + '%';
  $('hud-streak').hidden = !streak; $('hud-streak-n').textContent = streak;
  $('hud').classList.toggle('legend', p.skin === 'legend' && unlockedIds(p.xp).includes('legend'));
}
function paintWeek() {
  const p = state.profile, wk = weekProgress(p), nu = nextUnlock(p.xp);
  $('week').hidden = !p.played;
  $('wk-streak').textContent = liveStreak(p); $('wk-best').textContent = `day streak · best ${p.bestStreak || 0}`;
  $('wk-ring').innerHTML = ringSvg('', wk / WEEKLY_GOAL); $('wk-goal').textContent = `${Math.min(wk, WEEKLY_GOAL)}/${WEEKLY_GOAL}`;
  $('wk-next').textContent = nu ? nu.name : 'All unlocked';
  $('wk-next-xp').textContent = nu ? `${nu.xpToGo} XP to Tier ${nu.tier}` : 'Legend status';
}
async function paintLocker() {
  const p = state.profile, { tier, into } = tierOf(p.xp), owned = unlockedIds(p.xp);
  $('lk-tier').textContent = tier; $('lk-xp').textContent = `${into} / ${TIER_XP} XP`; $('lk-xpbar').style.width = (into / TIER_XP * 100) + '%';
  $('unlocks').innerHTML = [{ id: 'default', name: 'Standard field', tier: 1, kind: 'Field skin' }, ...UNLOCKS].map(u => {
    const have = u.id === 'default' || owned.includes(u.id), on = (p.skin || 'default') === u.id;
    return `<div class="unlock${have ? ' have' : ''}${on ? ' on' : ''}"><b>${esc(u.name)}</b><span>${have ? esc(u.kind) : `Tier ${u.tier}`}</span>${have ? `<button type="button" data-skin="${u.id}"${on ? ' disabled' : ''}>${on ? 'EQUIPPED' : 'EQUIP'}</button>` : '<i>LOCKED</i>'}</div>`;
  }).join('');
  $('unlocks').querySelectorAll('[data-skin]').forEach(b => b.addEventListener('click', async () => { p.skin = b.dataset.skin; await saveProfile(p); applySkin(p.skin); paintLocker(); paintHUD(); }));
  $('badges').innerHTML = Object.entries(CONCEPTS).map(([id, c]) => { const n = p.mastery[id] || 0, r = rarity(n); return `<div class="badge r${r}"><i></i>${esc(c.name)}<small>${RARITY[r]}${n ? ` · ${n}` : ''}</small></div>`; }).join('');
  await paintHistory();
}
async function paintHistory() {
  const list = (await db.listUpdates()).filter(u => SPORTS[u.sport] && Array.isArray(u.items)), f = state.hist;
  const sports = [...new Set(list.map(u => u.sport))];
  const positions = f.sport ? [...new Set(list.filter(u => u.sport === f.sport).map(u => u.position))] : [];
  const chip = (label, on, attr) => `<button class="chip small" type="button" aria-pressed="${on}" ${attr}>${esc(label)}</button>`;
  $('hist-filters').innerHTML = sports.length > 1 || positions.length > 1 ? [chip('ALL', !f.sport, 'data-hs=""'), ...sports.map(s => chip(SPORTS[s].name.toUpperCase(), f.sport === s, `data-hs="${s}"`)),
    ...(positions.length > 1 ? positions.map(pid => chip((positionOf(f.sport, pid)?.label || pid).toUpperCase(), f.pos === pid, `data-hp="${esc(pid)}"`)) : [])].join('') : '';
  $('hist-filters').querySelectorAll('[data-hs]').forEach(b => b.addEventListener('click', () => { f.sport = b.dataset.hs || null; f.pos = null; paintHistory(); }));
  $('hist-filters').querySelectorAll('[data-hp]').forEach(b => b.addEventListener('click', () => { f.pos = f.pos === b.dataset.hp ? null : b.dataset.hp; paintHistory(); }));
  const shown = list.filter(u => (!f.sport || u.sport === f.sport) && (!f.pos || u.position === f.pos)).slice(0, 20);
  $('history').innerHTML = shown.length ? shown.map(u => {
    const n = u.items.length, g = u.items.map(i => u.results?.[keyOf(i)]), passed = g.filter(x => x && x !== 'miss').length, left = n - passed;
    return `<li class="hrow"><div class="hmain"><b>${esc(SPORTS[u.sport].name)} · ${esc(positionOf(u.sport, u.position)?.label || '')}</b><span>${new Date(u.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${esc(SOURCE[sourceOf(u)])}${u.team?.team ? ` · ${esc(u.team.team)}` : ''} · ${passed}/${n} passed · +${u.xp || 0} XP</span></div>
      <div class="hacts"><button type="button" data-open="${u.id}">REPLAY</button>${left ? `<button type="button" class="hot" data-left="${u.id}">PLAY ${left} LEFT</button>` : '<em>CLEAN</em>'}</div></li>`;
  }).join('') : `<li class="empty">${list.length ? 'No updates match this filter.' : 'No updates yet. Drop in to earn XP and start a streak.'}</li>`;
  $('history').querySelectorAll('[data-open],[data-left]').forEach(b => b.addEventListener('click', async () => {
    const u = await db.getUpdate(+(b.dataset.open || b.dataset.left)); if (!u) return;
    openUpdate(u); if (b.dataset.left) setTimeout(playNext, 300);
  }));
}
const toastQ = [];
function toast(msg) { toastQ.push(msg); if (toastQ.length === 1) showToast(); }
function showToast() {
  const t = $('toast'); if (!toastQ.length) { t.hidden = true; return; }
  t.textContent = toastQ[0]; t.hidden = false;
  setTimeout(() => { toastQ.shift(); showToast(); }, 2300);
}

/* ---------- lobby: who you are ---------- */
function paintChips() {
  state.sport = 'lacrosse';
  $('sport-chips').innerHTML = `<button class="chip" type="button" data-sport="lacrosse" aria-pressed="true" disabled>LACROSSE</button>`;
  $('pos-chips').innerHTML = POSITIONS.lacrosse.map(p => `<button class="chip" type="button" data-pos="${p.id}" aria-pressed="${p.id === state.position}">${p.label.toUpperCase()}</button>`).join('');
  $('pos-chips').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { state.position = b.dataset.pos; syncInput(); paintChips(); updateGoHint(); }));
  updateGoHint();
}
function syncInput() { $('player-in').value = ['lacrosse', state.position && positionOf('lacrosse', state.position).label.toLowerCase()].filter(Boolean).join(' '); }
$('player-in').addEventListener('input', e => {
  const r = readPlayer(e.target.value);
  state.sport = 'lacrosse'; state.position = r.position; paintChips(); analyzeMeeting();
});
$('player-in').addEventListener('keydown', e => { if (e.key === 'Enter') dropIn(); });

/* ---------- lobby: the meeting ---------- */
let mtTimer = 0;
const sportHits = text => { const t = text.toLowerCase(); return Object.entries(SPORTS).map(([id, s]) => [id, s.detect.reduce((n, k) => n + (t.split(k).length - 1), 0)]).sort((a, b) => b[1] - a[1]); };
function dzStatus(kind, html) { const dz = $('dz-status'); dz.className = 'dz-status ' + kind; dz.innerHTML = html; }
function analyzeMeeting() {
  const raw = $('text-in').value;
  $('clear-btn').hidden = !raw.trim();
  if (!raw.trim()) { state.meeting = null; dzStatus('', 'No meeting yet. You will play ideas from your library.'); updateGoHint(); return; }
  if (/[\u0000-\u0008\u000e-\u001f]/.test(raw.slice(0, 4000))) { state.meeting = null; dzStatus('err', 'That file is not plain text. Export the transcript as .vtt, .srt or .txt and try again.'); updateGoHint(); return; }
  const parsed = parseTranscript(raw);
  if (!parsed.lines.length) { state.meeting = null; dzStatus('err', 'No readable lines found. Paste the transcript text itself.'); updateGoHint(); return; }
  state.sport = 'lacrosse';
  const { stats } = acquire(parsed.lines, 'lacrosse');
  state.meeting = { parsed, stats };
  if (stats.kept) dzStatus('ok', `${esc(parsed.format)} · ${stats.unique} sentences · <b>${stats.kept}</b> plays, numbers and calls kept`);
  else dzStatus('warn', `${esc(parsed.format)} · ${stats.unique} sentences, but no plays found. You will get library ideas instead.`);
  updateGoHint();
}
$('text-in').addEventListener('input', () => { clearTimeout(mtTimer); mtTimer = setTimeout(analyzeMeeting, 250); });
async function loadFile(f) {
  if (!f) return;
  if (f.size > 5e6) { dzStatus('err', 'That file is over 5 MB. Export only the transcript and try again.'); return; }
  $('text-in').value = await f.text(); analyzeMeeting();
}
$('file-in').addEventListener('change', async e => { await loadFile(e.target.files[0]); e.target.value = ''; });
const dzEl = $('dropzone');
['dragenter', 'dragover'].forEach(ev => dzEl.addEventListener(ev, e => { e.preventDefault(); dzEl.classList.add('drag'); }));
['dragleave', 'drop'].forEach(ev => dzEl.addEventListener(ev, () => dzEl.classList.remove('drag')));
dzEl.addEventListener('drop', e => { e.preventDefault(); loadFile(e.dataTransfer?.files?.[0]); });
$('sample-btn').addEventListener('click', async () => {
  try {
    const r = await fetch(SAMPLE); if (!r.ok) throw new Error(`HTTP ${r.status}`);
    $('text-in').value = await r.text();
    state.sport = 'lacrosse'; syncInput(); paintChips();
    analyzeMeeting();
  } catch { dzStatus('err', 'The sample meeting did not load. Check your connection and try again.'); }
});
$('clear-btn').addEventListener('click', () => { $('text-in').value = ''; analyzeMeeting(); });
function updateGoHint() {
  const pos = state.sport && positionOf(state.sport, state.position);
  $('go-sub').textContent = !state.sport ? 'Type your sport and position to start.'
    : state.team ? `Builds your frames from ${state.team.coach || 'your coach'}'s meeting.`
    : state.meeting?.stats?.kept ? `Builds up to ${MAX_ITEMS} frames from this meeting for a ${pos.you}.`
    : `Builds ${pickLibraryItems(state.sport, pos.id, state.profile?.ideaStats, 5).length} frames from your ${pos.you} library: new ideas first, then the ones you missed.`;
}

/* ---------- lobby: team links ---------- */
function paintTeam() {
  const t = state.team, b = $('team-banner');
  b.hidden = !t; $('meeting-step').hidden = !!t;
  if (!t) return;
  b.innerHTML = `<p class="kicker">TEAM UPDATE</p><h2>${esc(t.coach || 'Your coach')} sent an update</h2>
    <p>${esc(t.team || 'Your team')} · ${esc(SPORTS[t.sport].name)}${t.date ? ' · ' + esc(t.date) : ''} · ${t.groups.length} coaching points. Pick your position and drop in. When you finish, send your results back.</p>
    <button type="button" class="linkish" id="leave-team">Not on this team? Play solo instead.</button>`;
  $('leave-team').addEventListener('click', () => { state.team = null; history.replaceState(null, '', location.pathname); paintTeam(); paintChips(); });
}
async function readTeamLink() {
  if (!/#t=/.test(location.hash)) return;
  try {
    const h = await readHash(location.hash);
    if (h?.kind !== 't') return;
    state.team = h.data;
    if (state.sport !== h.data.sport) { state.sport = h.data.sport; state.position = state.profile.sport === h.data.sport ? state.profile.position : null; }
    syncInput(); paintChips(); paintTeam();
    // A player who opens the coach's link lands on the team card, not the pitch for new players.
    requestAnimationFrame(() => $('team-banner').scrollIntoView({ block: 'start', behavior: REDUCE ? 'auto' : 'smooth' }));
  } catch (e) { showAlert(`This team link did not open. ${e.message}`); }
}
window.addEventListener('hashchange', readTeamLink);

/* ---------- drop in ---------- */
function showAlert(msg, kind = 'err') { const a = $('go-note'); a.textContent = msg; a.className = 'alert ' + kind; a.hidden = false; }
const hideAlert = () => { $('go-note').hidden = true; };
function setBusy(on) { $('go-btn').disabled = on; $('go-btn').setAttribute('aria-busy', String(on)); $('progress').hidden = !on; }
async function step(text, pct) {
  $('progress-text').textContent = text; $('progress').style.setProperty('--p', pct + '%');
  // A timer, not requestAnimationFrame: that pauses in a background tab and would stall the build.
  await new Promise(r => setTimeout(r, REDUCE ? 0 : 110));
}
$('go-btn').addEventListener('click', dropIn);
async function dropIn() {
  if ($('go-btn').disabled) return;
  hideAlert();
  state.sport = 'lacrosse';
  if (!state.position) { showAlert('Pick your position. Try: defense, LSM, midfield, attack, or goalie.'); $('player-in').focus(); return; }
  const pos = positionOf(state.sport, state.position), p = state.profile;
  setBusy(true);
  try {
    await step('Loading your idea library', 10);
    await loadLibrary();
    let res, source, engine = 'offline', note = null, format = null;
    if (state.team) {
      source = 'team'; format = 'Team link';
      await step(`Reading ${state.team.coach || 'your coach'}'s points`, 40);
      await step(`Ranking for a ${pos.you}`, 60);
      let items = itemsFromGroups(teamGroups(state.team), state.sport, pos.id);
      const fromMeeting = items.length;
      if (items.length < 3) items = [...items, ...pickLibraryItems(state.sport, pos.id, p.ideaStats, 3 - items.length, new Set(items.map(i => i.concept)))];
      res = { items, stats: state.team.stats, headline: headlineFor(state.team.stats, fromMeeting, items.length, pos) };
    } else if (state.meeting?.parsed?.lines.length) {
      source = 'meeting'; format = state.meeting.parsed.format;
      await step('Reading the meeting', 25);
      await step('Keeping plays, numbers and calls', 40);
      await step(`Ranking for a ${pos.you}`, 55);
      res = extractOffline(state.meeting.parsed.lines, state.sport, pos.id, { ideaStats: p.ideaStats });
      // The public film room stays on the offline engine. No Claude key is called from this page.
    } else {
      source = 'library';
      await step(`Picking ideas for a ${pos.you}`, 50);
      const items = pickLibraryItems(state.sport, pos.id, p.ideaStats, 5);
      const fresh = items.filter(i => i.fresh).length, retry = items.filter(i => i.retry).length, review = items.length - fresh - retry;
      res = { items, stats: { library: ideasFor(state.sport, pos.id).length, fresh, retry, review }, headline: `${items.length} ideas for a ${pos.you}: ${fresh} new, ${retry} to retry, ${review} to review.` };
    }
    if (!res.items.length) throw new Error('No ideas were found for this sport and position.');
    await step(`Building ${res.items.length} frames`, 90);
    const update = { date: Date.now(), sport: state.sport, position: pos.id, engine, source, format, headline: res.headline, items: res.items, stats: res.stats, results: {}, xp: 0, note,
      team: state.team ? { id: state.team.id, team: state.team.team, coach: state.team.coach } : null };
    update.id = await db.addUpdate(update);
    p.sport = state.sport; p.position = pos.id; p.name = $('name-in').value.trim().slice(0, 24); p.played++;
    await saveProfile(p);
    await step('Ready', 100);
    openUpdate(update);
  } catch (e) { showAlert(`Could not build the update. ${e.message}`); }
  finally { setBusy(false); }
}

// Claude is optional: no key, a timeout or an error all fall back to the offline board, and say why.
async function askClaude(parsed, sport, position) {
  const text = parsed.lines.map(l => (l.speaker ? l.speaker + ': ' : '') + l.text).join('\n');
  if (text.length > 150000) return { note: 'The meeting is over 150,000 characters, so the offline engine was used.' };
  const ideas = sportIdeasWithPosition(sport).map(i => ({ id: i.id, title: i.title, directive: i.directive, template: i.template, position: i.position }));
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 75000);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      let r;
      try { r = await fetch('api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, sport, position, ideas }), signal: ctrl.signal }); }
      catch (e) {
        if (e.name === 'AbortError') return { note: 'Claude took longer than 75 seconds, so the offline engine was used.' };
        if (attempt === 0) { await step('Network hiccup. Trying Claude once more', 70); continue; }
        return { note: 'Could not reach Claude, so the offline engine was used.' };
      }
      // No endpoint or no key on this site: stay offline for the rest of this visit.
      if ([404, 405, 501, 503].includes(r.status)) { state.noClaude = true; return {}; }
      if ((r.status === 429 || r.status >= 500) && attempt === 0) { await step('Claude is busy. Trying once more', 70); await new Promise(x => setTimeout(x, 1500)); continue; }
      const data = await r.json().catch(() => null);
      if (!r.ok || !data) return { note: `Claude did not answer (${data?.error || 'HTTP ' + r.status}), so the offline engine was used.` };
      return { data };
    }
    return { note: 'Claude did not answer, so the offline engine was used.' };
  } finally { clearTimeout(timer); }
}
function mergeClaude(off, data) {
  const sp = SPORTS[state.sport], used = new Set(), items = [], s = (v, n) => typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : '';
  for (const i of Array.isArray(data.items) ? data.items : []) {
    if (!CONCEPTS[i?.concept] || !ORDER.includes(i.bucket)) continue;
    const idea = i.idea ? ideaById(i.idea) : null, concept = idea ? idea.template : i.concept;
    if (used.has(concept)) continue;
    const Cn = CONCEPTS[concept];
    const base = idea ? itemFromIdea(idea, i.bucket, state.sport)
      : { bucket: i.bucket, concept, idea: null, title: fill(Cn.title[i.bucket], sp), line: fill(Cn.line[i.bucket], sp), kid: fill(Cn.kid, sp), why: fill(Cn.why, sp), viz: '', change: Cn.change, game: null, tags: [concept] };
    items.push({ ...base, title: s(i.title, 70) || base.title, line: s(i.line, 80) || base.line, kid: s(i.kid, 260) || base.kid, why: s(i.why, 260) || base.why,
      quote: s(i.quote, 220), mentions: Number.isFinite(i.mentions) ? i.mentions : 1, measurements: (Array.isArray(i.measurements) ? i.measurements : []).slice(0, 3).map(m => s(m, 24)).filter(Boolean), source: 'claude' });
    used.add(concept);
  }
  for (const o of off.items) { if (items.length >= 3) break; if (!used.has(o.concept)) { used.add(o.concept); items.push(o); } }
  items.sort((a, b) => ORDER.indexOf(a.bucket) - ORDER.indexOf(b.bucket));
  return { ...off, headline: s(data.headline, 240) || off.headline, items: items.slice(0, MAX_ITEMS) };
}

/* ---------- a frame canvas: scene loop or mini-game ---------- */
class FrameCanvas {
  constructor(cv, item, sp, onResult) {
    const dur = SCENES[item.concept]?.dur || 4;
    Object.assign(this, { cv, ctx: cv.getContext('2d'), item, id: item.concept, sp, onResult, w: 0, t: dur, dur, mode: 'scene', visible: false });
    new ResizeObserver(() => this.resize()).observe(cv);
    cv.addEventListener('pointerdown', e => this.down(e)); cv.addEventListener('pointerup', e => this.up(e)); cv.addEventListener('pointercancel', e => this.up(e));
    cv.addEventListener('contextmenu', e => { if (this.mode === 'game') e.preventDefault(); });
  }
  resize() { const w = this.cv.clientWidth; if (!w || w === this.w) return; this.w = w; this.h = Math.round(w * ASPECT); this.cv.style.height = this.h + 'px'; this.cv.width = Math.round(w * DPR); this.cv.height = Math.round(this.h * DPR); this.draw(); }
  field(e) { const r = this.cv.getBoundingClientRect(), s = r.width / (VIEW.x1 - VIEW.x0); return { p: { x: (e.clientX - r.left) / s + VIEW.x0, y: (e.clientY - r.top) / s + VIEW.y0 }, sx: e.clientX - r.left, sy: e.clientY - r.top }; }
  draw() {
    if (!this.w) return;
    const ctx = this.ctx; ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (this.mode === 'scene') {
      if (SCENES[this.id]) drawScene(this.id, ctx, this.w, this.h, Math.min(this.t, this.dur), this.sp, new View(ctx, this.w));
      else { ctx.fillStyle = C.field; ctx.fillRect(0, 0, this.w, this.h); this.sp.draw(new View(ctx, this.w)); }
      return;
    }
    ctx.fillStyle = C.field; ctx.fillRect(0, 0, this.w, this.h);
    const v = new View(ctx, this.w); this.sp.draw(v); this.game.draw(ctx, v, this.w, this.h, this.gt);
    if (this.game.result) {
      if (this.doneAt == null) { this.doneAt = this.gt; this.onResult(this.game.result); }
      if (this.gt - this.doneAt > .5) banner(ctx, this.w, this.h, this.game.result.g, this.game.result.msg, XP[this.game.result.g]);
    }
  }
  tick(now) {
    const dt = clamp((now - this.last) / 1000, 0, .1); this.last = now;
    if (this.mode === 'game') this.gt += dt; else if (!REDUCE) this.t = (this.t + dt) % (this.dur + 1.2);
    this.draw();
    if (this.mode === 'game' || (this.visible && !REDUCE)) this.raf = requestAnimationFrame(n => this.tick(n)); else this.raf = 0;
  }
  run() { if (this.raf) return; this.last = performance.now(); this.raf = requestAnimationFrame(n => this.tick(n)); }
  show(v) { this.visible = v; if (v) this.run(); }
  play() { this.mode = 'game'; this.game = gameFor(this.item, this.sp); this.gt = 0; this.doneAt = null; this.run(); }
  down(e) {
    if (this.mode !== 'game') return;
    if (this.game.result) { if (this.gt - this.doneAt > .9) { this.mode = 'scene'; this.t = 0; this.run(); } return; }
    const f = this.field(e); try { this.cv.setPointerCapture(e.pointerId); } catch { /* not all pointers capture */ }
    this.game.down(f.p, f.sx, f.sy, this.gt);
  }
  up() { if (this.mode === 'game' && this.game.up) this.game.up(this.gt); }
}
const io = new IntersectionObserver(es => es.forEach(e => e.target._fc?.show(e.isIntersecting)), { threshold: .2 });

/* ---------- the film strip ---------- */
function openUpdate(u) {
  state.update = u; u.results ||= {};
  const sp = SPORTS[u.sport], pos = positionOf(u.sport, u.position), src = sourceOf(u);
  state.frames.forEach(f => { f.visible = false; }); state.frames = [];
  const strip = $('strip'); strip.innerHTML = '';
  const n = u.items.length + 2, no = i => `${String(i + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}`;
  const s = u.stats || {};
  const intro = document.createElement('section'); intro.className = 'frame intro';
  const chg = src === 'library' ? [`${s.library ?? u.items.length} ${pos.you} ideas`, `${u.items.length} for you`] : [`${s.unique ?? '?'} sentences`, `${s.kept ?? '?'} plays`];
  intro.innerHTML = `<div class="frame-head"><span class="tag">${src === 'team' ? 'TEAM UPDATE' : src === 'library' ? 'DAILY DROP' : 'SEASON UPDATE'}</span><span class="fno">${no(0)}</span></div>
    <canvas aria-label="${src === 'library' ? 'Ideas picked from your library' : 'Every sentence from the meeting falls through the acquisition rules. Noise drops out. Plays, numbers and calls stay.'}"></canvas>
    <div class="change"><span class="b">${esc(chg[0])}</span><i>→</i><span class="a">${esc(chg[1])}</span>${src !== 'library' ? `<i>→</i><span class="a">${u.items.length} for you</span>` : ''}</div>
    <p class="fline">${esc(sp.name)} · ${esc(pos.label)}</p>
    <p class="headline">${esc(u.headline || '')}</p>
    <div class="meas"><span>${u.engine === 'claude' ? 'CLAUDE OPUS 5.5' : src === 'library' ? 'IDEA LIBRARY' : 'OFFLINE ENGINE'}</span>${u.format ? `<span>${esc(u.format)}</span>` : ''}${u.team?.team ? `<span>${esc(u.team.team)}</span>` : ''}${u.note ? `<span class="warn">${esc(u.note)}</span>` : ''}</div>
    <div class="acts"><button class="act" type="button" data-go="1">START ▼</button></div>`;
  strip.append(intro);
  funnel(intro.querySelector('canvas'), src === 'library'
    ? { total: s.library || u.items.length, left: `${s.library || u.items.length} IDEAS`, right: `${u.items.length} FOR YOU`, rule: `PICKED FOR A ${pos.you.toUpperCase()}`, bins: [['NEW', s.fresh || 0, 'start'], ['RETRY', s.retry || 0, 'stop'], ['REVIEW', s.review || 0, 'cont']] }
    : { total: s.unique || u.items.length, left: `${s.unique || '?'} HEARD`, right: `${u.items.length} FOR YOU`, rule: 'RULES: PLAYS · NUMBERS · CALLS', bins: [['PLAYS', Math.max(0, (s.kept || 0) - (s.measure || 0) - (s.call || 0)), 'start'], ['NUMBERS', s.measure || 0, 'cont'], ['CALLS', s.call || 0, 'green']] });
  intro.querySelector('[data-go]').addEventListener('click', () => strip.querySelector('.frame:not(.intro)')?.scrollIntoView({ behavior: REDUCE ? 'auto' : 'smooth', block: 'start' }));
  u.items.forEach((item, i) => {
    const ch = item.change || CONCEPTS[item.concept]?.change || [item.line, item.line];
    strip.append(linkEl(ch[1]));
    const f = document.createElement('section'); f.className = 'frame ' + (ORDER.includes(item.bucket) ? item.bucket : 'start');
    const steps = SCENES[item.concept] ? stepsFor(item.concept, sp) : [], best = u.results[keyOf(item)];
    const srcTag = item.source === 'library' ? `<span class="src">${item.retry ? 'RETRY' : item.fresh ? 'NEW IDEA' : 'REVIEW'}</span>` : '';
    f.innerHTML = `<div class="frame-head"><span class="tag">${TAG[item.bucket] || 'NEW'}</span>${srcTag}<span class="fno">${no(i + 1)}</span></div>
      <canvas role="img" aria-label="Animated diagram: ${esc(item.title)}"></canvas>
      <div class="change"><span class="b">${esc(ch[0])}</span><i>→</i><span class="a">${esc(ch[1])}</span></div>
      <p class="fline">${esc(item.line)}</p>${item.fix ? `<p class="ffix"><b>INSTEAD</b>${esc(item.fix)}</p>` : ''}
      ${item.measurements?.length ? `<div class="meas">${item.measurements.map(m => `<span>${esc(m)}</span>`).join('')}</div>` : ''}
      <div class="acts"><button class="act play" type="button">PLAY ▶</button><button class="act alt why-btn" type="button" aria-expanded="false">WHY</button><button class="act alt clip" type="button">CLIP</button></div>
      <p class="result${best === 'miss' ? ' miss' : ''}"${best ? '' : ' hidden'}>${best ? `BEST: ${best.toUpperCase()}` : ''}</p>
      <div class="why" hidden><h4>${esc(item.title)}</h4><p class="kid">${esc(item.kid)}</p>${item.quote ? `<p class="q">"${esc(item.quote)}"</p>` : ''}
        ${item.viz ? `<p class="viz"><b>WHAT YOU SEE</b>${esc(item.viz)}</p>` : ''}${steps.length ? `<ol>${steps.map(x => `<li>${esc(x[1])}</li>`).join('')}</ol>` : ''}
        ${item.why && item.why !== item.kid ? `<p class="reason"><b>WHY IT WORKS</b>${esc(item.why)}</p>` : ''}</div>`;
    const cv = f.querySelector('canvas'), res = f.querySelector('.result');
    const fc = new FrameCanvas(cv, item, sp, r => award(item, r, res));
    cv._fc = fc; io.observe(cv); state.frames.push(fc);
    f.querySelector('.play').addEventListener('click', () => { fc.play(); cv.scrollIntoView({ behavior: REDUCE ? 'auto' : 'smooth', block: 'center' }); });
    const wb = f.querySelector('.why-btn'); wb.addEventListener('click', () => { const w = f.querySelector('.why'); w.hidden = !w.hidden; wb.setAttribute('aria-expanded', String(!w.hidden)); });
    f.querySelector('.clip').addEventListener('click', e => openFilm(item, e.currentTarget));
    strip.append(f);
  });
  strip.append(linkEl('Update complete'));
  const outro = document.createElement('section'); outro.className = 'frame outro'; outro.id = 'outro';
  strip.append(outro); paintOutro();
  $('lobby').hidden = true; $('update').hidden = false; window.scrollTo(0, 0); setAuto(false);
}
const linkEl = s => { const d = document.createElement('div'); d.className = 'link'; d.textContent = String(s || '').toUpperCase(); return d; };
function playNext() {
  const u = state.update, i = u.items.findIndex(it => { const g = u.results[keyOf(it)]; return !g || g === 'miss'; });
  if (i < 0) return;
  const fc = state.frames[i]; fc.cv.scrollIntoView({ behavior: REDUCE ? 'auto' : 'smooth', block: 'center' });
  setTimeout(() => fc.play(), REDUCE ? 0 : 450);
}

// The done screen: what you earned, what it moved (streak, weekly goal, tier, badges, unlocks), what is left.
function paintOutro() {
  const u = state.update, o = $('outro'); if (!o) return;
  const p = state.profile, n = u.items.length, g = u.items.map(i => u.results[keyOf(i)]);
  const played = g.filter(Boolean).length, passed = g.filter(x => x && x !== 'miss').length, left = n - passed, done = played === n;
  const { tier, into } = tierOf(p.xp), nu = nextUnlock(p.xp), wk = weekProgress(p), total = String(n + 2).padStart(2, '0');
  const list = [
    ...(u.unlocked || []).map(id => UNLOCKS.find(x => x.id === id)).filter(Boolean).map(x => `<li class="u">UNLOCKED · ${esc(x.name)} <button type="button" class="linkish" data-equip="${x.id}">Equip</button></li>`),
    ...(u.badges || []).map(b => `<li class="b">${esc(CONCEPTS[b.concept]?.name || b.concept)} · ${RARITY[b.from]} → ${RARITY[b.to]}</li>`),
    ...(u.notes || []).map(t => `<li>${esc(t)}</li>`),
  ];
  o.innerHTML = `<div class="frame-head"><span class="tag">${done ? (u.clean ? 'CLEAN SHEET' : 'UPDATE COMPLETE') : `${n - played} TO PLAY`}</span><span class="fno">${total} / ${total}</span></div>
    <div class="outro-body">
      <div class="done-top"><div class="bigxp">+${u.xp || 0} XP</div><div class="score"><b>${passed}/${n}</b>passed</div></div>
      <div class="done-grid">
        <div class="done-card">${FLAME}<b>${liveStreak(p)}</b><small>day streak · best ${p.bestStreak || 0}</small></div>
        <div class="done-card">${ringSvg('', wk / WEEKLY_GOAL)}<b>${Math.min(wk, WEEKLY_GOAL)}/${WEEKLY_GOAL}</b><small>updates this week</small></div>
        <div class="done-card"><b>TIER ${tier}</b><div class="xpbar big"><i style="width:${(into / TIER_XP * 100).toFixed(1)}%"></i></div><small>${nu ? `${nu.xpToGo} XP to ${esc(nu.name)}` : 'Everything unlocked'}</small></div>
      </div>
      ${list.length ? `<ul class="done-list">${list.join('')}</ul>` : ''}
      <p class="done-next">${done ? (u.clean ? 'Every frame passed. That is what coach said.' : `${left} frame${left === 1 ? '' : 's'} missed. Pass them all for a +50 XP clean sheet.`) : `Play the ${n - played} frame${n - played === 1 ? '' : 's'} left to finish this update.`}</p>
      <div class="send" id="send" role="status"></div>
      <div class="outro-acts">
        ${left ? `<button class="act" type="button" id="o-next">${done ? 'RETRY MISSES' : 'NEXT FRAME'} ▶</button>` : ''}
        <button class="act${left ? ' alt' : ''}" type="button" id="o-send">SEND TO COACH</button>
        <button class="act alt" type="button" id="o-md">COPY FOR OBSIDIAN</button>
        <button class="act alt" type="button" id="o-dl">DOWNLOAD .MD</button>
        <button class="act alt" type="button" id="o-lobby">LOBBY</button>
      </div>
    </div>`;
  o.querySelector('#o-next')?.addEventListener('click', playNext);
  o.querySelector('#o-send').addEventListener('click', sendToCoach);
  o.querySelector('#o-md').addEventListener('click', copyMD);
  o.querySelector('#o-dl').addEventListener('click', downloadMD);
  o.querySelector('#o-lobby').addEventListener('click', goLobby);
  o.querySelectorAll('[data-equip]').forEach(b => b.addEventListener('click', async () => { p.skin = b.dataset.equip; await saveProfile(p); applySkin(p.skin); paintHUD(); }));
}
async function award(item, r, resEl) {
  const u = state.update, ev = applyResult(state.profile, u, item, r.g);
  await db.putUpdate(u); await saveProfile(state.profile);
  paintHUD(); paintOutro();
  const g = u.results[keyOf(item)];
  resEl.hidden = false; resEl.className = 'result' + (g === 'miss' ? ' miss' : ''); resEl.textContent = `BEST: ${g.toUpperCase()} · tap the field to watch again`;
  for (const x of ev.unlocked) toast(`TIER ${x.tier} · ${x.name.toUpperCase()} UNLOCKED`);
  if (ev.tierUp && !ev.unlocked.length) toast(`TIER ${ev.tierUp}`);
  if (ev.badge) toast(`${CONCEPTS[ev.badge.concept].name.toUpperCase()} → ${RARITY[ev.badge.to]}`);
  if (ev.streakUp && ev.streak > 1) toast(`${ev.streak}-DAY STREAK`);
  if (ev.clean) toast('CLEAN SHEET · +50 XP');
}

/* ---------- send results to the coach ---------- */
async function sendToCoach() {
  const p = state.profile, u = state.update, box = $('send');
  const typed = $('send-name')?.value.trim();
  if (typed) { p.name = typed.slice(0, 24); await saveProfile(p); $('name-in').value = p.name; }
  if (!p.name) {
    box.innerHTML = `<label class="namefield" for="send-name">Your name or number, so your coach knows who played<input id="send-name" maxlength="24" placeholder="#22"></label>`;
    $('send-name').focus(); $('send-name').addEventListener('keydown', e => { if (e.key === 'Enter') sendToCoach(); }); return;
  }
  const report = { v: 1, s: u.team?.id || null, tn: u.team?.team || '', n: p.name, sp: u.sport, p: u.position, d: localDay(new Date(u.date)), x: u.xp || 0,
    items: u.items.map(i => [keyOf(i), u.results[keyOf(i)] || null, i.concept, String(i.title).slice(0, 60)]) };
  const url = new URL('/coach', location.origin); url.hash = 'r=' + await pack(report);
  const how = await shareOrCopy(url.href, `${p.name}: What Coach Said results`);
  box.innerHTML = how === 'shared' ? 'Sent. Your coach opens the link to add your results.'
    : how === 'copied' ? 'Link copied. Paste it to your coach in your team chat.'
    : how === 'cancelled' ? '' : `<label class="namefield" for="send-link">Copy this link for your coach<input id="send-link" readonly value="${esc(url.href)}"></label>`;
  $('send-link')?.addEventListener('focus', e => e.target.select());
}

/* ---------- frame 1: the funnel (meeting) or the pick (library) ---------- */
function funnel(cv, cfg) {
  const ctx = cv.getContext('2d'); let w = 0, h = 0, t0 = performance.now(), raf = 0, vis = false;
  const N = Math.min(150, Math.max(cfg.total, 1)), r = rng(7), kinds = [];
  cfg.bins.forEach(([, count], b) => { for (let i = 0; i < Math.round(N * count / Math.max(cfg.total, 1)); i++) kinds.push(b); });
  while (kinds.length < N) kinds.push(-1);
  const dots = kinds.map(b => ({ b, x: r(), y: r() * .25, d: r() * 1.2 }));
  new ResizeObserver(() => { w = cv.clientWidth; h = Math.round(w * .62); cv.style.height = h + 'px'; cv.width = w * DPR; cv.height = h * DPR; draw(performance.now()); }).observe(cv);
  const col = b => b < 0 ? C.soft : C[cfg.bins[b][2]];
  const draw = now => {
    if (!w) return;
    const T = REDUCE ? 4 : ((now - t0) / 1000) % 5.5, fy = h * .45, by = h * .8;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.fillStyle = C.field; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.setLineDash([6, 6]); ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, fy); ctx.lineTo(w, fy); ctx.stroke(); ctx.restore();
    txt(ctx, cfg.rule, w - 10, fy - 12, { size: clamp(w / 34, 10, 15), font: 'hand', col: C.gold, align: 'right' });
    cfg.bins.forEach(([label, count, k], i) => {
      const bx = w * (i + .5) / 3;
      ctx.fillStyle = C[k]; ctx.globalAlpha = .18; ctx.fillRect(bx - w / 8, by, w / 4, h - by); ctx.globalAlpha = 1;
      txt(ctx, String(count), bx, by + (h - by) * .42, { size: clamp(w / 14, 16, 34), font: 'pop', col: C[k], align: 'center' });
      txt(ctx, label, bx, by + (h - by) * .8, { size: clamp(w / 40, 9, 13), font: 'hand', col: C.ink, align: 'center' });
    });
    for (const d of dots) {
      const u = clamp((T - d.d) / 2.2, 0, 1); let x = d.x * w, y = d.y * h + u * u * (by - d.y * h), a = 1;
      if (d.b < 0) { if (y > fy) { y = fy - 4; a = Math.max(0, 1 - (T - d.d - 1.2) * 1.5); } }
      else { const bx = w * (d.b + .5) / 3; x += (bx + (d.x - .5) * w / 5 - x) * clamp((y - fy) / (by - fy), 0, 1); }
      if (a <= 0) continue;
      ctx.globalAlpha = a; ctx.fillStyle = col(d.b); ctx.beginPath(); ctx.arc(x, Math.min(y, by - 3), 3.2, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    txt(ctx, cfg.left, 12, 22, { size: clamp(w / 22, 14, 24), font: 'pop', col: C.ink });
    txt(ctx, cfg.right, w - 12, 22, { size: clamp(w / 22, 14, 24), font: 'pop', col: C.gold, align: 'right', alpha: REDUCE ? 1 : clamp((T - 3.2) * 2, 0, 1) });
  };
  const loop = now => { draw(now); raf = vis && !REDUCE ? requestAnimationFrame(loop) : 0; };
  new IntersectionObserver(es => { vis = es[0].isIntersecting; if (vis && !raf) raf = requestAnimationFrame(loop); }, { threshold: .2 }).observe(cv);
}

/* ---------- auto-play: the strip as one continuous sequence ---------- */
function setAuto(on) {
  clearInterval(state.auto); state.auto = null; $('auto-btn').setAttribute('aria-pressed', String(on)); $('auto-btn').textContent = on ? '❚❚ AUTO-PLAY' : '▶ AUTO-PLAY';
  if (!on) return;
  const frames = [...document.querySelectorAll('#strip .frame')];
  let i = Math.max(0, frames.findIndex(f => f.getBoundingClientRect().bottom > 140));
  const next = () => { frames[i]?.scrollIntoView({ behavior: REDUCE ? 'auto' : 'smooth', block: 'start' }); i++; if (i > frames.length) setAuto(false); };
  next(); state.auto = setInterval(next, 7500);
}
$('auto-btn').addEventListener('click', () => setAuto(!state.auto));
['wheel', 'touchstart', 'keydown'].forEach(ev => window.addEventListener(ev, () => { if (state.auto) setAuto(false); }, { passive: true }));
function goLobby() {
  setAuto(false); state.frames.forEach(f => { f.visible = false; });
  $('update').hidden = true; $('lobby').hidden = false;
  paintHUD(); paintWeek(); paintLocker(); window.scrollTo(0, 0);
}
$('back-btn').addEventListener('click', goLobby);
$('hud-home').addEventListener('click', e => { e.preventDefault(); goLobby(); });

/* ---------- Obsidian ---------- */
function toMarkdown() {
  const u = state.update, sp = SPORTS[u.sport], pos = positionOf(u.sport, u.position), d = localDay(new Date(u.date));
  const out = ['---', `title: "What Coach Said: ${sp.name} ${pos.label} ${d}"`, `date: ${d}`, `sport: ${u.sport}`, `position: ${u.position}`, `source: ${sourceOf(u)}`,
    `engine: ${u.engine === 'claude' ? 'claude-opus-5-5' : 'offline'}`, `xp: ${u.xp || 0}`, `tags: [coaching, start-stop-continue, ${u.sport}]`, '---', '', `# ${sp.name} · ${pos.label} update`, '', `> ${u.headline || ''}`, ''];
  const s = u.stats || {};
  if (s.unique != null) out.push(`Heard ${s.unique} sentences. Kept ${s.kept}: ${s.play ?? '?'} plays, ${s.measure ?? '?'} numbers, ${s.call ?? '?'} calls. Dropped ${s.noise ?? '?'} as noise.`, '');
  for (const b of ORDER) {
    const items = u.items.filter(i => i.bucket === b); if (!items.length) continue;
    out.push(`## ${TAG[b]} (${b})`, '');
    for (const i of items) {
      out.push(`### ${i.title}`, '', `**${i.line}**`, '', ...(i.fix ? [`- **Instead:** ${i.fix}`] : []), `- **For a 10-year-old:** ${i.kid}`);
      if (i.quote) out.push(`- **Coach said:** "${i.quote}"`);
      if (i.measurements?.length) out.push(`- **Numbers:** ${i.measurements.join(', ')}`);
      if (i.why && i.why !== i.kid) out.push(`- **Why it works:** ${i.why}`);
      if (i.change) out.push(`- **Change:** ${i.change.join(' → ')}`);
      if (u.results[keyOf(i)]) out.push(`- **Challenge:** ${u.results[keyOf(i)]}`);
      out.push('');
    }
  }
  return out.join('\n');
}
async function copyMD(e) {
  const b = e.currentTarget, md = toMarkdown();
  try { await navigator.clipboard.writeText(md); b.textContent = 'COPIED'; }
  catch { const ta = document.createElement('textarea'); ta.value = md; document.body.append(ta); ta.select(); b.textContent = document.execCommand('copy') ? 'COPIED' : 'USE DOWNLOAD'; ta.remove(); }
  setTimeout(() => { b.textContent = 'COPY FOR OBSIDIAN'; }, 2000);
}
function downloadMD() {
  const u = state.update, a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([toMarkdown()], { type: 'text/markdown' }));
  a.download = `What Coach Said - ${SPORTS[u.sport].name} ${positionOf(u.sport, u.position).label} ${localDay(new Date(u.date))}.md`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- CLIP opens the matching film on the LacrosseTube shelf ---------- */
const filmLinks = {};
async function loadFilmLinks() {
  try {
    const r = await fetch('/data/links.json');
    if (r.ok) Object.assign(filmLinks, await r.json());
  } catch { /* the button says NO FILM if this file is missing */ }
}
function openFilm(item, btn) {
  const id = filmLinks[item.concept];
  if (!id) { btn.textContent = 'NO FILM'; setTimeout(() => { btn.textContent = 'CLIP'; }, 1400); return; }
  window.open('/?watch=' + encodeURIComponent(id), '_blank', 'noopener');
}

/* ---------- clip export (video) ---------- */
function titleCard(ctx, W, H, item, u) {
  const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#1d3a8a'); g.addColorStop(1, '#3b1f7a'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const band = { start: ['#ff8a1f', '#ffcf4a'], stop: ['#ff3d5a', '#b5123a'], continue: ['#1f8fff', '#5ad1ff'] }[item.bucket] || ['#ff8a1f', '#ffcf4a'];
  const bg = ctx.createLinearGradient(0, 0, W, 0); bg.addColorStop(0, band[0]); bg.addColorStop(1, band[1]);
  ctx.save(); ctx.fillStyle = bg; ctx.beginPath(); ctx.moveTo(W * .04, H * .36); ctx.lineTo(W, H * .32); ctx.lineTo(W * .96, H * .66); ctx.lineTo(0, H * .7); ctx.closePath(); ctx.fill(); ctx.restore();
  txt(ctx, 'WHAT COACH SAID?', W / 2, H * .18, { size: 60, font: 'pop', col: '#fff', align: 'center' });
  txt(ctx, TAG[item.bucket] || 'NEW', W / 2, H * .42, { size: 64, font: 'pop', col: '#05070f', align: 'center' });
  ctx.font = '92px "Anton", Impact, sans-serif';
  wrapText(ctx, item.line.toUpperCase(), W * .84).slice(0, 2).forEach((l, i) => txt(ctx, l, W / 2, H * .55 + i * 96, { size: 88, font: 'pop', col: '#fff', align: 'center', stroke: '#05070f', alpha: clamp(u * 3, 0, 1) }));
  crown(ctx, W * .86, H * .16, 44, '#ffd84a');
}
async function recordVideo(item, sp, btn) {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream || !SCENES[item.concept]) { btn.textContent = 'NOT HERE'; setTimeout(() => { btn.textContent = 'CLIP'; }, 1800); return; }
  const W = 1280, H = 960, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const ctx = cv.getContext('2d');
  const mime = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m)) || '';
  const rec = new MediaRecorder(cv.captureStream(30), mime ? { mimeType: mime, videoBitsPerSecond: 6e6 } : {}), chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); }; const done = new Promise(r => { rec.onstop = r; });
  const steps = stepsFor(item.concept, sp), dur = SCENES[item.concept].dur, INTRO = 1.8, OUTRO = 2.6, total = INTRO + dur + OUTRO, label = btn.textContent;
  btn.disabled = true; rec.start(250); const t0 = performance.now();
  await new Promise(res => {
    const tick = now => {
      const t = (now - t0) / 1000; ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (t < INTRO) titleCard(ctx, W, H, item, t / INTRO);
      else {
        const st = Math.min(dur, t - INTRO); drawScene(item.concept, ctx, W, H, st, sp, new View(ctx, W));
        const k = steps.reduce((a, [s], i) => st + .001 >= s ? i : a, 0), cap = t < INTRO + dur ? steps[k][1] : item.kid;
        ctx.font = '700 36px "Atkinson Hyperlegible", sans-serif'; const lines = wrapText(ctx, cap, W - 120), bh = lines.length * 45 + 40;
        ctx.save(); ctx.globalAlpha = .9; ctx.fillStyle = '#05070f'; ctx.fillRect(0, H - bh, W, bh); ctx.restore();
        lines.forEach((l, i) => txt(ctx, l, 60, H - bh + 42 + i * 45, { size: 36, font: 'body', col: '#fff' }));
      }
      btn.textContent = `REC ${Math.max(0, Math.ceil(total - t))}`;
      if (t < total) requestAnimationFrame(tick); else res();
    };
    requestAnimationFrame(tick);
  });
  rec.stop(); await done;
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(chunks, { type: mime || 'video/webm' }));
  a.download = `what-coach-said-${item.bucket}-${keyOf(item)}.${(mime || 'webm').includes('mp4') ? 'mp4' : 'webm'}`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  btn.disabled = false; btn.textContent = label;
}

/* ---------- first screen: one frame next to the raw meeting ---------- */
function drawExample() {
  const cv = $('vs-cv'); if (!cv) return;
  const w = cv.clientWidth; if (!w) return;
  const h = Math.round(w * ASPECT); cv.width = Math.round(w * DPR); cv.height = Math.round(h * DPR); cv.style.height = h + 'px';
  const ctx = cv.getContext('2d'); ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawScene('help', ctx, w, h, 1.8, SPORTS.lacrosse, new View(ctx, w)); // the moment the caption describes: stepped into the help spot
}
new ResizeObserver(drawExample).observe($('vs-cv'));

/* ---------- boot ---------- */
$('name-in').addEventListener('change', async e => { state.profile.name = e.target.value.trim().slice(0, 24); await saveProfile(state.profile); });
(async () => {
  state.profile = await loadProfile();
  applySkin(state.profile.skin);
  state.sport = 'lacrosse';
  state.position = POSITIONS.lacrosse.some(p => p.id === state.profile.position) ? state.profile.position : null;
  await loadFilmLinks();
  $('name-in').value = state.profile.name || '';
  if (state.sport) syncInput();
  paintChips(); paintHUD(); paintWeek(); paintLocker(); analyzeMeeting();
  await readTeamLink();
  loadLibrary().then(() => { updateGoHint(); const st = libraryStats(); if (st.source !== 'file') showAlert('The idea library did not load, so built-in ideas are used. Refresh to try again.', 'warn'); });
  document.fonts?.ready.then(() => { state.frames.forEach(f => f.draw()); drawExample(); });
})();
