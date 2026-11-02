// Coach dashboard: make a team link from a meeting, keep a roster, and see who played and how
// they scored on each idea. Player results arrive as links (#r=...) and are stored on this device.
import { SPORTS, fill } from './sports.js';
import { CONCEPTS } from './concepts.js';
import { positionOf } from './positions.js';
import { parseTranscript } from './parse.js';
import { groupTranscript } from './extract.js';
import { loadLibrary } from './ideas.js';
import { db, loadCoach, saveCoach, loadProfile } from './db.js';
import { pack, readHash, shareOrCopy } from './share.js';
import { localDay } from './progress.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TAG = { start: 'NEW', stop: 'VAULTED', continue: 'STILL META' };
const ORDER = ['start', 'stop', 'continue'];
const SAMPLE = '/samples/lacrosse.txt';
const SOLO = 'solo';
const norm = n => String(n || '').trim().toLowerCase().replace(/\s+/g, ' ');
let coach;

function alertMsg(msg, kind = 'err') { const a = $('c-alert'); a.textContent = msg; a.className = 'alert ' + kind; a.hidden = !msg; if (msg) a.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
let toastT = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600); }

/* ---------- 1. make a team link ---------- */
$('c-sport').innerHTML = `<option value="lacrosse">Lacrosse</option>`;
function meetingStatus() {
  const raw = $('c-text').value, st = $('c-status');
  if (!raw.trim()) { st.className = 'dz-status'; st.textContent = 'Paste the meeting or open the transcript file.'; return null; }
  const parsed = parseTranscript(raw);
  if (!parsed.lines.length) { st.className = 'dz-status err'; st.textContent = 'No readable lines found. Paste the transcript text itself.'; return null; }
  const { groups, stats } = groupTranscript(parsed.lines, $('c-sport').value);
  st.className = 'dz-status ' + (groups.length ? 'ok' : 'warn');
  st.innerHTML = groups.length ? `${esc(parsed.format)} · ${stats.unique} sentences · <b>${stats.kept}</b> plays kept · ${groups.length} coaching points`
    : `${esc(parsed.format)} · ${stats.unique} sentences, but no coaching points found. Check the sport, or paste a longer meeting.`;
  return { parsed, groups, stats };
}
let mt = 0;
$('c-text').addEventListener('input', () => { clearTimeout(mt); mt = setTimeout(meetingStatus, 250); });
$('c-sport').addEventListener('change', meetingStatus);
$('c-file').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  if (f.size > 5e6) { alertMsg('That file is over 5 MB. Export only the transcript.'); return; }
  $('c-text').value = await f.text(); e.target.value = ''; meetingStatus();
});
$('c-sample').addEventListener('click', async () => {
  try { const r = await fetch(SAMPLE); if (!r.ok) throw 0; $('c-text').value = await r.text(); meetingStatus(); }
  catch { alertMsg('The sample meeting did not load. Check your connection.'); }
});
$('c-make').addEventListener('click', async () => {
  alertMsg('');
  const team = $('c-team').value.trim(), coachName = $('c-coach').value.trim(), sport = $('c-sport').value;
  const m = meetingStatus();
  if (!m) { alertMsg('Paste the meeting first, or use a sample meeting.'); return; }
  if (!m.groups.length) { alertMsg('No coaching points were found in this meeting, so there is nothing to send yet.'); return; }
  const session = { v: 1, id: Math.random().toString(36).slice(2, 10), team: team.slice(0, 40), coach: coachName.slice(0, 40), sport, date: localDay(),
    stats: m.stats, groups: m.groups.slice(0, 14).map(g => ({ b: g.bucket, c: g.concept, m: g.mentions, q: g.quote.slice(0, 160), ms: g.measures, iv: g.ideas })) };
  const url = new URL('/play', location.origin); url.hash = 't=' + await pack(session);
  coach.sessions[session.id] = { ...session, url: url.href, made: Date.now() }; coach.active = session.id;
  coach.lastTeam = team; coach.lastCoach = coachName; coach.lastSport = sport; await saveCoach(coach);
  const byB = b => session.groups.filter(g => g.b === b).length;
  $('c-linkbox').hidden = false;
  $('c-linkbox').innerHTML = `<b>Team link ready</b><span class="hint">${session.groups.length} coaching points: ${byB('start')} start, ${byB('stop')} stop, ${byB('continue')} continue. Each player gets the ones that matter for their position.</span>
    <input id="c-link" readonly value="${esc(url.href)}" aria-label="Team link">
    <div class="row"><button class="btn" id="c-share" type="button">SHARE LINK</button><a class="ghost" href="${esc(url.href)}" target="_blank" rel="noopener">Open as a player</a><span class="hint" id="c-share-note" role="status"></span></div>`;
  $('c-link').addEventListener('focus', e => e.target.select());
  $('c-share').addEventListener('click', async () => {
    const how = await shareOrCopy(url.href, `${team || 'Team'} update from ${coachName || 'your coach'}`);
    $('c-share-note').textContent = how === 'copied' ? 'Copied. Paste it in your team chat.' : how === 'shared' ? 'Shared.' : how === 'manual' ? 'Select the link above and copy it.' : '';
  });
  paint();
});

/* ---------- results in ---------- */
function importReport(r) {
  const key = `${r.s || SOLO}|${norm(r.n)}|${r.p}`, prev = coach.reports[key];
  if (prev) {
    const rank = { miss: 0, good: 1, perfect: 2 }, byKey = new Map(prev.items.map(i => [i[0], i]));
    for (const it of r.items) { const old = byKey.get(it[0]); if (!old || (rank[it[1]] ?? -1) > (rank[old[1]] ?? -1)) byKey.set(it[0], it); }
    coach.reports[key] = { ...prev, ...r, x: Math.max(prev.x, r.x), items: [...byKey.values()], d: r.d > prev.d ? r.d : prev.d, got: Date.now() };
  } else coach.reports[key] = { ...r, got: Date.now() };
  coach.active = r.s || SOLO;
  const team = r.s && coach.sessions[r.s]?.team;
  const roster = coach.rosters[rosterKey(coach.active)] ||= [];
  if (!roster.some(n => norm(n) === norm(r.n))) roster.push(r.n);
  return `Added ${r.n}'s results${team ? ` to ${team}` : ''}.`;
}
async function addFromText(text) {
  alertMsg('');
  try {
    const h = await readHash(text);
    if (!h) { alertMsg('That is not a results link. It should end with #r= followed by letters and numbers.'); return false; }
    if (h.kind !== 'r') { alertMsg('That is a team link, not a results link. Send it to your players instead.'); return false; }
    const msg = importReport(h.data); await saveCoach(coach); paint(); toast(msg); return true;
  } catch (e) { alertMsg(`That results link did not open. ${e.message}`); return false; }
}
$('c-add').addEventListener('click', async () => { if (await addFromText($('c-paste').value)) $('c-paste').value = ''; });
$('c-paste').addEventListener('keydown', e => { if (e.key === 'Enter') $('c-add').click(); });
$('c-device').addEventListener('click', async () => {
  const [u] = await db.listUpdates(), p = await loadProfile();
  if (!u) { alertMsg('This device has no played updates yet. Open the player app and drop in first.', 'warn'); return; }
  const r = { v: 1, s: u.team?.id || null, tn: u.team?.team || '', n: p.name || 'This device', sp: u.sport, p: u.position, d: localDay(new Date(u.date)), x: u.xp || 0,
    items: u.items.map(i => [i.idea || i.concept, u.results?.[i.idea || i.concept] || null, i.concept, String(i.title).slice(0, 60)]) };
  const msg = importReport(r); await saveCoach(coach); paint(); toast(msg);
});

/* ---------- 2. roster ---------- */
const rosterKey = id => id === SOLO ? SOLO : (coach.sessions[id]?.team ? 'team:' + norm(coach.sessions[id].team) : 'session:' + id);
$('c-roster-save').addEventListener('click', async () => {
  const names = [...new Set($('c-roster').value.split('\n').map(s => s.trim().slice(0, 24)).filter(Boolean))];
  coach.rosters[rosterKey(coach.active || SOLO)] = names; await saveCoach(coach);
  $('c-roster-note').textContent = `Saved ${names.length} player${names.length === 1 ? '' : 's'}.`; paint();
});

/* ---------- 3. who played ---------- */
function columnsFor(id, reports) {
  const s = coach.sessions[id];
  if (s) return s.groups.slice().sort((a, b) => ORDER.indexOf(a.b) - ORDER.indexOf(b.b) || b.m - a.m)
    .map(g => ({ c: g.c, tag: TAG[g.b], title: fill(CONCEPTS[g.c].title[g.b], SPORTS[s.sport]) }));
  const seen = new Map();
  for (const r of reports) for (const it of r.items) if (!seen.has(it[2])) seen.set(it[2], { c: it[2], tag: '', title: CONCEPTS[it[2]]?.name || it[2] });
  return [...seen.values()];
}
function paint() {
  const ids = [...new Set([...Object.keys(coach.sessions), ...Object.values(coach.reports).map(r => r.s || SOLO)])];
  const active = coach.active && ids.includes(coach.active) ? coach.active : ids[0] || null;
  coach.active = active;
  const label = id => id === SOLO ? 'Solo results' : coach.sessions[id] ? `${coach.sessions[id].team || 'Team'} · ${coach.sessions[id].date}` : `Team link ${id}`;
  $('c-sessions').innerHTML = ids.length ? ids.map(id => `<button class="chip small" type="button" data-s="${esc(id)}" aria-pressed="${id === active}">${esc(label(id))}</button>`).join('')
    : '<p class="hint">No team links or results yet. Make a team link above, or add a results link from a player.</p>';
  $('c-sessions').querySelectorAll('[data-s]').forEach(b => b.addEventListener('click', async () => { coach.active = b.dataset.s; await saveCoach(coach); paint(); }));
  const rk = rosterKey(active || SOLO), roster = coach.rosters[rk] || [];
  $('c-roster').value = roster.join('\n');
  $('c-roster-for').textContent = `Roster for ${active ? label(active) : 'your team'}. One name or jersey number per line. Players type the same name or number when they send results.`;
  if (!active) { $('c-summary').innerHTML = ''; $('c-table').innerHTML = ''; return; }

  const reports = Object.values(coach.reports).filter(r => (r.s || SOLO) === active);
  const cols = columnsFor(active, reports);
  const rows = [];
  for (const r of reports) rows.push({ name: r.n, r });
  for (const n of roster) if (!reports.some(r => norm(r.n) === norm(n))) rows.push({ name: n, r: null });
  rows.sort((a, b) => (a.r ? 0 : 1) - (b.r ? 0 : 1) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const gradeOf = (r, c) => r?.items.find(it => it[2] === c)?.[1] || null;
  const passedIn = (r) => r.items.filter(it => it[1] && it[1] !== 'miss').length;
  const playedN = rows.filter(x => x.r && x.r.items.some(it => it[1])).length;
  const per = cols.map(col => { const gs = reports.map(r => gradeOf(r, col.c)).filter(Boolean); return { col, n: gs.length, pass: gs.filter(g => g !== 'miss').length, miss: gs.filter(g => g === 'miss').length }; });
  const weak = per.filter(p => p.miss).sort((a, b) => b.miss - a.miss || a.pass - b.pass)[0];
  const avgXp = reports.length ? Math.round(reports.reduce((s, r) => s + r.x, 0) / reports.length) : 0;
  $('c-summary').innerHTML = [
    ['WHO PLAYED', `${playedN} of ${Math.max(rows.length, playedN)}`, rows.length > playedN ? `${rows.length - playedN} not yet` : 'Everyone'],
    ['AVERAGE XP', String(avgXp), `${reports.length} result${reports.length === 1 ? '' : 's'} in`],
    ['RE-TEACH', weak ? weak.col.title : '—', weak ? `${weak.miss} miss${weak.miss === 1 ? '' : 'es'} of ${weak.n}` : 'No misses yet'],
  ].map(([k, v, s]) => `<div class="stat"><span>${k}</span><b>${esc(v)}</b><span>${esc(s)}</span></div>`).join('');
  const cell = g => `<span class="g ${g || 'none'}">${g === 'perfect' ? 'P' : g === 'good' ? 'G' : g === 'miss' ? 'M' : '—'}</span>`;
  $('c-table').innerHTML = `<caption class="fine" style="caption-side:bottom;text-align:left;padding:8px">P perfect · G good · M miss · — not in their update or not played</caption>
    <thead><tr><th>Player</th><th>Position</th><th>Played</th><th>XP</th>${cols.map(c => `<th><span class="t">${esc(c.tag)}</span>${esc(c.title)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(({ name, r }) => r
      ? `<tr><td><b>${esc(name)}</b><br><span class="fine">${esc(r.d)}</span></td><td>${esc(positionOf(r.sp, r.p)?.label || r.p)}</td><td class="num">${passedIn(r)}/${r.items.length}</td><td class="num">${r.x}</td>${cols.map(c => `<td title="${esc(r.items.find(it => it[2] === c.c)?.[3] || '')}">${cell(gradeOf(r, c.c))}</td>`).join('')}</tr>`
      : `<tr class="notyet"><td><b>${esc(name)}</b></td><td colspan="${3 + cols.length}">Not yet</td></tr>`).join('') || `<tr><td colspan="${4 + cols.length}">No players yet. Add a roster or a results link.</td></tr>`}</tbody>
    <tfoot><tr><td colspan="4">Passed per idea</td>${per.map(p => `<td>${p.n ? `${p.pass}/${p.n}` : '—'}</td>`).join('')}</tr></tfoot>`;
}
$('c-csv').addEventListener('click', async () => {
  const t = $('c-table'); if (!t.rows.length) return;
  // Names come from links anyone can make: a leading = + - @ would run as a spreadsheet formula.
  const cell = v => `"${v.replace(/^[=+\-@]/, "'$&").replace(/"/g, '""')}"`;
  const csv = [...t.querySelectorAll('thead tr, tbody tr')].map(tr => [...tr.cells].map(td => cell(td.innerText.replace(/\s+/g, ' ').trim())).join(',')).join('\n');
  try { await navigator.clipboard.writeText(csv); $('c-csv-note').textContent = 'Copied. Paste it into a spreadsheet.'; }
  catch { $('c-csv-note').textContent = 'Copy was blocked by the browser.'; }
});

/* ---------- boot ---------- */
(async () => {
  coach = await loadCoach();
  if (coach.lastTeam) $('c-team').value = coach.lastTeam;
  if (coach.lastCoach) $('c-coach').value = coach.lastCoach;
  if (SPORTS[coach.lastSport]) $('c-sport').value = coach.lastSport;
  await loadLibrary();
  if (/#r=/.test(location.hash)) { await addFromText(location.hash); history.replaceState(null, '', location.pathname); }
  paint();
})();
