// /placement: five What Coach Said challenges from the player's position, played with the
// existing games and graded with the existing local rules. The five grades go to the server once
// (placement_submit) and seed the player's concept ratings from 500. Practice stays on the device:
// the plays also count toward this device's XP and streak, as in the player app.
import { C, readColors, View, VIEW, clamp } from '../field/ink.js';
import { SPORTS } from '../field/sports.js';
import { gameFor, banner, XP } from '../field/games.js';
import { loadLibrary, pickLibraryItems } from '../field/ideas.js';
import { applyResult } from '../field/progress.js';
import { loadProfile, saveProfile } from '../field/db.js';
import { rpc } from './auth.js';
import { supabase } from './supabase.js';
import { $, esc, ensureSignedIn, positionLabel } from './ui.js';

const root = $('placement');
const DPR = Math.min(window.devicePixelRatio || 1, 2);
const ASPECT = (VIEW.y1 - VIEW.y0) / (VIEW.x1 - VIEW.x0);
const sp = SPORTS.lacrosse;

// One game at a time on one canvas, like the player app's frames in game mode.
class Round {
  constructor(cv, item, onResult) {
    Object.assign(this, { cv, ctx: cv.getContext('2d'), item, onResult, w: 0, gt: 0, last: 0, raf: 0, game: gameFor(item, sp), doneAt: null });
    new ResizeObserver(() => this.resize()).observe(cv);
    cv.addEventListener('pointerdown', e => this.down(e));
    cv.addEventListener('pointerup', () => this.game.up?.(this.gt));
    cv.addEventListener('pointercancel', () => this.game.up?.(this.gt));
    this.last = performance.now(); this.raf = requestAnimationFrame(n => this.tick(n));
  }
  resize() { const w = this.cv.clientWidth; if (!w || w === this.w) return; this.w = w; this.h = Math.round(w * ASPECT); this.cv.style.height = this.h + 'px'; this.cv.width = Math.round(w * DPR); this.cv.height = Math.round(this.h * DPR); }
  field(e) { const r = this.cv.getBoundingClientRect(), s = r.width / (VIEW.x1 - VIEW.x0); return { p: { x: (e.clientX - r.left) / s + VIEW.x0, y: (e.clientY - r.top) / s + VIEW.y0 }, sx: e.clientX - r.left, sy: e.clientY - r.top }; }
  tick(now) {
    this.gt += clamp((now - this.last) / 1000, 0, .1); this.last = now;
    if (this.w) {
      const ctx = this.ctx; ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.fillStyle = C.field; ctx.fillRect(0, 0, this.w, this.h);
      const v = new View(ctx, this.w); sp.draw(v); this.game.draw(ctx, v, this.w, this.h, this.gt);
      if (this.game.result) {
        if (this.doneAt == null) { this.doneAt = this.gt; this.onResult(this.game.result.g); }
        if (this.gt - this.doneAt > .5) banner(ctx, this.w, this.h, this.game.result.g, this.game.result.msg, XP[this.game.result.g]);
      }
    }
    if (this.doneAt == null || this.gt - this.doneAt < 1.5) this.raf = requestAnimationFrame(n => this.tick(n));
  }
  down(e) {
    if (this.game.result) return;
    try { this.cv.setPointerCapture(e.pointerId); } catch { /* not all pointers capture */ }
    const f = this.field(e); this.game.down(f.p, f.sx, f.sy, this.gt);
  }
  stop() { cancelAnimationFrame(this.raf); }
}

async function start() {
  if (!supabase) { root.innerHTML = '<p class="msg err">Team accounts are not switched on for this site.</p>'; return; }
  if (!(await ensureSignedIn(root))) { root.innerHTML = '<p class="msg err">Join your team from your invite first.</p>'; return; }
  const home = await rpc('team_home'), team = home.teams.find(t => t.role === 'player');
  if (!team) { location.replace('/team'); return; }
  if (home.person.placed) { location.replace('/team'); return; }
  readColors();
  await loadLibrary();
  const items = pickLibraryItems('lacrosse', team.position, {}, 5);
  if (items.length < 5) throw new Error('The idea library did not load. Refresh to try again.');
  const profile = await loadProfile(), update = { items, results: {}, xp: 0, source: 'placement', date: Date.now() };
  profile.position ||= team.position; profile.name ||= home.person.first_name;
  const grades = [];
  let round = null;

  const play = i => {
    const item = items[i];
    round?.stop();
    root.innerHTML = `<p class="kicker">PLACEMENT · ${i + 1} OF 5 · ${esc(positionLabel(team.position)).toUpperCase()}</p>
      <h1>${esc(item.title)}</h1>
      <p class="fline">${esc(item.line)}</p>
      <canvas class="placement-canvas" aria-label="Challenge: ${esc(item.title)}. Tap the field to answer."></canvas>
      <div class="row"><button class="btn" type="button" id="pl-next" hidden>${i < 4 ? 'NEXT ▶' : 'SEE MY SEED ▶'}</button></div>`;
    round = new Round(root.querySelector('canvas'), item, async g => {
      grades[i] = { concept: item.concept, idea_id: item.idea, grade: g };
      applyResult(profile, update, item, g);
      await saveProfile(profile);
      $('pl-next').hidden = false; $('pl-next').focus();
    });
    $('pl-next').addEventListener('click', () => (i < 4 ? play(i + 1) : finish()));
  };

  const finish = async () => {
    round?.stop();
    root.innerHTML = '<p class="hint">Saving your placement…</p>';
    const seed = await rpc('placement_submit', { p_results: grades });
    const passed = grades.filter(g => g.grade !== 'miss').length;
    root.innerHTML = `<p class="kicker">PLACEMENT DONE</p><h1>Seed rating ${Math.round(seed)}</h1>
      <p>${passed} of 5 passed. Every concept starts at 500; this round moved the five you played. It seeds your team rank.</p>
      <div class="row"><a class="btn" href="/team">MY TEAM PAGE ▶</a></div>`;
  };

  root.innerHTML = `<p class="kicker">PLACEMENT ROUND</p><h1>Five quick challenges</h1>
    <p>Each one is a lacrosse read for a ${esc(positionLabel(team.position)).toLowerCase()}. Tap the field to answer. Your result seeds your rating once; after this, practice stays on your phone.</p>
    <div class="row"><button class="btn" type="button" id="pl-go">START ▶</button></div>`;
  $('pl-go').addEventListener('click', () => play(0));
}

start().catch(e => { root.innerHTML = `<p class="msg err">${esc(e.message)}</p>`; });
