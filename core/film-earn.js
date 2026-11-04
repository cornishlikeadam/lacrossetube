// The film site's earning clock. js/tube.js reports every time the YouTube player tells it the
// film's time ('lt-film-clock'). Only seconds in which that clock actually moved forward, about as
// fast as the wall clock, in a visible tab, count. Paused, buffering, skipped ahead, rewound or a
// hidden tab counts nothing: an idle tab pays nothing. Every 30 counted seconds go to the server,
// which pays 500 points per full minute, up to 30 minutes a day (public.watch_beat).
import { filmBeat, isSignedIn } from './earn.js';
import { filmCounter } from './film-count.js';
import { POINTS } from '../supabase/functions/_shared/chain.js';

const E = POINTS.earn, BEAT = 30, counter = filmCounter();
let film = null, pending = 0, sending = false;

document.addEventListener('lt-film-clock', e => {
  const { id, t } = e.detail || {};
  if (typeof id !== 'string' || !Number.isFinite(t)) return;
  if (id !== film) { flush(); film = id; pending = 0; paint(null); }
  pending += counter.sample(id, t, performance.now(), document.visibilityState === 'visible');
  if (pending >= BEAT) flush();
});
document.addEventListener('lt-film-stop', () => { flush(); film = null; counter.reset(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') { flush(); counter.reset(); } });
addEventListener('pagehide', () => flush());

async function flush() {
  const s = Math.min(Math.floor(pending), 60), id = film;
  if (s < 1 || !id || sending) return;
  pending -= s; sending = true;
  try { const r = await filmBeat(id, s); if (r && !r.error) paint(r); } catch { /* offline: the seconds are dropped, never invented */ } finally { sending = false; }
}

// A line under the film for signed-in people: today's paid minutes.
async function paint(r) {
  if (!(await isSignedIn())) return;
  const wrap = document.getElementById('modalVideoWrap');
  if (!wrap) return;
  let el = document.getElementById('lt-earn');
  if (!el) { el = document.createElement('p'); el.id = 'lt-earn'; el.className = 'lt-earn'; el.setAttribute('role', 'status'); wrap.after(el); }
  el.textContent = r
    ? (r.minutes_paid >= E.maxMinutes ? `Film minutes today: ${E.maxMinutes} of ${E.maxMinutes}. That is today's film pay; watching still counts for your coach.`
      : `Film minutes today: ${r.minutes_paid} of ${E.maxMinutes}${r.points_added ? ` · +${r.points_added.toLocaleString()} points` : ''}`)
    : `Watching pays ${E.perMinute} points a minute while the film plays, up to ${E.maxMinutes} minutes a day.`;
}
