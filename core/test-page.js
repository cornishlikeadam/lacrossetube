// /test?tier=N: one Warrior Test. Quiz tiers (2, 4, 5) ask five questions, multiple choice or
// written, one at a time; the database grades them, so the answers never reach this page.
// Tier 3 is five more field games on concepts the player has not played. Tier 1 is placement.
import { readColors } from '../field/ink.js';
import { loadLibrary, pickLibraryItems } from '../field/ideas.js';
import { POSITIONS } from '../field/positions.js';
import { applyResult } from '../field/progress.js';
import { loadProfile, saveProfile } from '../field/db.js';
import { Round } from './round.js';
import { rpc } from './auth.js';
import { supabase } from './supabase.js';
import { POINTS } from '../supabase/functions/_shared/chain.js';
import { $, esc, ensureSignedIn } from './ui.js';
import { mountPortal } from './portal.js';

mountPortal('player');

const root = $('test');
const level = Number(new URLSearchParams(location.search).get('tier'));
const doge = points => `${(points / POINTS.perDoge).toLocaleString()} DOGE`;

async function start() {
  if (!supabase) { root.innerHTML = '<p class="msg err">Team accounts are not switched on for this site.</p>'; return; }
  if (!(await ensureSignedIn(root))) { root.innerHTML = '<p class="msg err">Join your team from your invite first.</p>'; return; }
  if (level === 1) { location.replace('/placement'); return; }
  const [home, board] = await Promise.all([rpc('team_home'), rpc('warrior_board')]);
  const tier = board.find(t => t.level === level);
  if (!tier) { root.innerHTML = '<p class="msg err">There is no such tier.</p>'; return; }
  document.documentElement.dataset.skin = home.person.skin || 'default';
  const head = `<p class="kicker">WARRIOR TIER ${level} OF 5 · ${tier.kind === 'quiz' ? 'QUIZ' : 'FIELD GAMES'}</p><h1>${esc(tier.name)}</h1>`;
  if (!tier.unlocked) { root.innerHTML = `${head}<p>Pass tier ${level - 1} first.</p><div class="row"><a class="btn alt" href="/team">MY TEAM PAGE</a></div>`; return; }
  root.innerHTML = `${head}<p>${esc(tier.blurb)}</p>
    <p>Five questions. Get ${tier.pass_score} right to pass${tier.passed ? '. You already passed this tier, so a retry is practice only' : ` and earn <b>${tier.reward_points.toLocaleString()} points</b> (${doge(tier.reward_points)} on testnet)`}.</p>
    <div class="row"><button class="btn" type="button" id="ts-go">START ▶</button><a class="ghost" href="/team">Back</a></div>`;
  $('ts-go').addEventListener('click', () => (tier.kind === 'quiz' ? quiz(tier, head) : games(tier, head, home)));
}

/* ---------- quiz tiers ---------- */
async function quiz(tier, head) {
  const questions = await rpc('warrior_questions_for', { p_level: tier.level });
  const answers = {};
  const ask = i => {
    const q = questions[i];
    root.innerHTML = `${head}<p class="kicker">QUESTION ${i + 1} OF 5</p><p class="q-prompt">${esc(q.prompt)}</p>
      ${q.kind === 'choice'
        ? `<div class="choices" role="radiogroup">${q.options.map((o, k) => `<label class="choice"><input type="radio" name="q" value="${k}"${answers[q.ord] === String(k) ? ' checked' : ''}><span>${esc(o)}</span></label>`).join('')}</div>`
        : `<label class="field" for="q-written">Your answer<input id="q-written" maxlength="200" autocomplete="off" value="${esc(answers[q.ord] || '')}"></label>`}
      <div class="row">${i ? '<button class="ghost" type="button" id="q-back">Back</button>' : ''}<button class="btn" type="button" id="q-next">${i < 4 ? 'NEXT ▶' : 'SUBMIT ▶'}</button></div>
      <p class="msg" id="q-msg" role="status" hidden></p>`;
    const read = () => (q.kind === 'choice' ? root.querySelector('input[name="q"]:checked')?.value : $('q-written').value.trim());
    $('q-back')?.addEventListener('click', () => { answers[q.ord] = read() ?? answers[q.ord]; ask(i - 1); });
    $('q-next').addEventListener('click', async () => {
      const a = read();
      if (!a) { $('q-msg').textContent = q.kind === 'choice' ? 'Pick an answer.' : 'Type an answer.'; $('q-msg').className = 'msg err'; $('q-msg').hidden = false; return; }
      answers[q.ord] = a;
      if (i < 4) return ask(i + 1);
      root.innerHTML = `${head}<p class="hint">Checking your answers…</p>`;
      done(head, await rpc('warrior_submit_quiz', { p_level: tier.level, p_answers: answers }), questions);
    });
  };
  ask(0);
}

/* ---------- games tier ---------- */
async function games(tier, head, home) {
  const position = home.teams.find(t => t.role === 'player')?.position || 'midfield';
  readColors();
  await loadLibrary();
  const { data: played } = await supabase.from('results').select('concept').eq('ranked', true);
  const skip = new Set((played || []).map(r => r.concept)), items = [];
  for (const pos of [position, ...POSITIONS.lacrosse.map(p => p.id).filter(p => p !== position)]) {
    for (const it of pickLibraryItems('lacrosse', pos, {}, 5 - items.length, skip)) { items.push(it); skip.add(it.concept); }
    if (items.length >= 5) break;
  }
  if (items.length < 5) throw new Error('Not enough new field challenges loaded. Refresh to try again.');
  const profile = await loadProfile(), update = { items, results: {}, xp: 0, source: 'warrior', date: Date.now() };
  const grades = [];
  let round = null;
  const play = i => {
    const item = items[i];
    round?.stop();
    root.innerHTML = `${head}<p class="kicker">CHALLENGE ${i + 1} OF 5</p><p class="q-prompt">${esc(item.title)}</p><p class="fline">${esc(item.line)}</p>
      <canvas class="placement-canvas" aria-label="Challenge: ${esc(item.title)}. Tap the field to answer."></canvas>
      <div class="row"><button class="btn" type="button" id="pl-next" hidden>${i < 4 ? 'NEXT ▶' : 'SUBMIT ▶'}</button></div>`;
    round = new Round(root.querySelector('canvas'), item, async g => {
      grades[i] = { concept: item.concept, idea_id: item.idea, grade: g };
      applyResult(profile, update, item, g);
      await saveProfile(profile);
      $('pl-next').hidden = false; $('pl-next').focus();
    });
    $('pl-next').addEventListener('click', async () => {
      if (i < 4) return play(i + 1);
      round.stop();
      root.innerHTML = `${head}<p class="hint">Saving…</p>`;
      done(head, await rpc('warrior_submit_games', { p_level: tier.level, p_results: grades }));
    });
  };
  play(0);
}

/* ---------- result ---------- */
function done(head, r, questions = null) {
  const next = r.next_unlocked ? `<a class="btn" href="/test?tier=${r.level + 1}">TIER ${r.level + 1} ▶</a>` : '';
  root.innerHTML = `${head}<p class="kicker">${r.passed ? 'PASSED' : 'NOT YET'}</p><h1>${r.score} of 5</h1>
    <p>${r.passed
      ? (r.newly_passed ? `Tier passed. <b>+${r.points_awarded.toLocaleString()} points</b> (${doge(r.points_awarded)} on testnet).` : 'Passed again. Points are paid once per tier.')
      : `You need ${r.pass_score} to pass. Try again whenever you like.`}</p>
    ${r.results ? `<ol class="q-results">${r.results.map(x => `<li class="${x.correct ? 'right' : 'wrong'}"><b>${x.correct ? 'Right' : 'Missed'}</b> · ${esc(questions.find(q => q.ord === x.ord)?.prompt)}<br><small>${esc(x.explain)}</small></li>`).join('')}</ol>` : ''}
    <div class="row">${r.passed && r.level < 5 ? next : `<a class="btn" href="/test?tier=${r.level}">${r.passed ? 'PLAY AGAIN' : 'TRY AGAIN'}</a>`}<a class="btn alt" href="/team">MY TEAM PAGE</a></div>`;
}

start().catch(e => { root.innerHTML = `<p class="msg err">${esc(e.message)}</p>`; });
