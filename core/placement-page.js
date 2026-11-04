// /placement: five What Coach Said challenges from the player's position, played with the
// existing games and graded with the existing local rules. The five grades go to the server once
// (placement_submit) and seed the player's concept ratings from 500. Practice stays on the device:
// the plays also count toward this device's XP and streak, as in the player app.
import { readColors } from '../field/ink.js';
import { Round } from './round.js';
import { loadLibrary, pickLibraryItems } from '../field/ideas.js';
import { applyResult } from '../field/progress.js';
import { loadProfile, saveProfile } from '../field/db.js';
import { rpc } from './auth.js';
import { supabase } from './supabase.js';
import { $, esc, ensureSignedIn, positionLabel } from './ui.js';
import { mountPortal } from './portal.js';

mountPortal('player');

const root = $('placement');

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
    root.innerHTML = `<p class="kicker">PLACEMENT DONE · WARRIOR TIER 1 PASSED</p><h1>Seed rating ${Math.round(seed)}</h1>
      <p>${passed} of 5 passed. Every concept starts at 500; this round moved the five you played. It seeds your team rank.</p>
      <p><b>+1,000 points</b> (1 DOGE on testnet). Tier 2, Rules &amp; Field IQ, is open on your team page.</p>
      <div class="row"><a class="btn" href="/team">MY TEAM PAGE ▶</a><a class="btn alt" href="/test?tier=2">TIER 2 ▶</a></div>`;
  };

  root.innerHTML = `<p class="kicker">PLACEMENT ROUND</p><h1>Five quick challenges</h1>
    <p>Each one is a lacrosse read for a ${esc(positionLabel(team.position)).toLowerCase()}. Tap the field to answer. Your result seeds your rating once; after this, practice stays on your phone.</p>
    <div class="row"><button class="btn" type="button" id="pl-go">START ▶</button></div>`;
  $('pl-go').addEventListener('click', () => play(0));
}

start().catch(e => { root.innerHTML = `<p class="msg err">${esc(e.message)}</p>`; });
