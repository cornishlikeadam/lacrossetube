// Phase 2 on the page side: what counts as a watched film second, and where tips can and cannot
// appear. YouTube films are the library: no tip or pay control on a film card, and the only tip
// call in the site is on forum posts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { filmCounter } from '../core/film-count.js';

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

// Plays a film: one report per `step` seconds of wall time, the film's time moving by `rate`.
function play(c, { id = 'yt-a', from = 0, seconds, step = 0.5, rate = 1, visible = true, t0 = 0, start = 0 }) {
  let got = 0;
  for (let w = 0; w <= seconds + 1e-9; w += step) got += c.sample(id, from + (rate ? w * rate : 0), t0 + (start + w) * 1000, visible);
  return got;
}

test('a playing film counts its seconds; paused, hidden, skipped or rewound counts nothing', () => {
  let c = filmCounter();
  assert.ok(Math.abs(play(c, { seconds: 60 }) - 60) < 1e-6, 'a minute of play is a minute');
  c = filmCounter();
  assert.equal(play(c, { seconds: 60, rate: 0 }), 0, 'paused: the clock does not move');
  c = filmCounter();
  assert.equal(play(c, { seconds: 60, visible: false }), 0, 'an idle tab in the background pays nothing');
  c = filmCounter();
  assert.ok(Math.abs(play(c, { seconds: 30, rate: 2 }) - 30) < 1e-6, 'double speed counts wall time, not film time');
  c = filmCounter();
  c.sample('yt-a', 10, 0, true);
  assert.equal(c.sample('yt-a', 400, 1000, true), 0, 'skipping ahead counts nothing');
  assert.equal(c.sample('yt-a', 100, 2000, true), 0, 'rewinding counts nothing');
  assert.equal(c.sample('yt-a', 101, 3000, true), 1, 'and counting picks up again');
  assert.equal(c.sample('yt-a', 131, 33000, true), 0, 'nothing counts across a 30-second gap in reports');
  assert.equal(c.sample('yt-b', 5, 34000, true), 0, 'a new film starts fresh');
  assert.equal(c.sample('yt-b', 6, 35000, true), 1);
});

test('YouTube film cards carry no tip or pay control; only forum posts take tips', () => {
  for (const f of ['index.html', 'js/tube.js', 'core/film-earn.js']) {
    const text = read(f);
    const labels = [...text.matchAll(/<(button|a)\b[^>]*>([^<]*)</g)].map(m => m[2]);
    // An action label (TIP, PAY, DONATE…). The film site's "Tips & Tricks" category is not one.
    const action = l => /^\W*(tip|pay|donate|checkout|buy)(\s|$)/i.test(l.trim());
    assert.ok(!labels.some(action), `${f}: ${labels.filter(action).join(' | ')}`);
    assert.ok(!/post_tip|service_pay|data-tip/.test(text), `${f} must not tip`);
  }
  const callers = ['core', 'field', 'js'].flatMap(d => readdirSync(new URL(`../${d}`, import.meta.url)).filter(f => f.endsWith('.js')).map(f => `${d}/${f}`))
    .filter(f => /['"]post_tip['"]/.test(read(f)));
  assert.deepEqual(callers, ['core/forum-page.js']);
  const sql = read('supabase/migrations/20261105090000_phase2_earn_ledger_forum_payouts.sql');
  assert.match(sql, /Tips go to forum posts only/);
});

test('the wallet, forum and payout pages exist and the forum is built', () => {
  assert.match(read('vite.config.js'), /'forum'/);
  for (const f of ['core/wallet.js', 'core/forum-page.js', 'core/payouts.js']) assert.ok(read(f).length > 1000, f);
  assert.match(read('core/team-page.js'), /mountWallet/);
  assert.match(read('core/coach-team.js'), /mountWallet/);
  assert.match(read('core/coach-team.js'), /ap-state/);
});

test('no owner or treasury key code reaches the browser bundle', () => {
  const browser = ['core', 'field', 'js'].flatMap(d => readdirSync(new URL(`../${d}`, import.meta.url)).filter(f => f.endsWith('.js')).map(f => `${d}/${f}`));
  for (const f of browser) {
    const text = read(f);
    // Names may appear in help text; what matters is that no browser module loads server key code.
    assert.ok(!/from\s+['"][^'"]*(wallet-core|team-key|owner-lib|scripts\/)[^'"]*['"]|import\(\s*['"][^'"]*(wallet-core|team-key|owner-lib)/.test(text), `${f} must not import server key code`);
    assert.ok(!/Deno\.env|process\.env\.(TREASURY|OWNER)/.test(text), `${f} must not read server secrets`);
  }
  assert.match(read('supabase/functions/redeem/index.ts'), /Deno\.env\.get\('TREASURY_PRIVATE_KEY'\)/);
});
