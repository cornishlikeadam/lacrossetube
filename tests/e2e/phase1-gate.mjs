// Phase 1 gate, end to end in a real browser on LOCALHOST: a fake coach applies, the owner verifies
// with an owner-signed request (a throwaway local owner key standing in for scripts/owner.mjs),
// the coach builds a roster and prints the QR sheet, a parent consents, three players join on
// their own "devices" (browser contexts), place, and land on their team page; then a lost key
// is re-issued. Fake people only. Screenshots and the printed sheet go to output/phase1/.
//
// Needs: local Supabase + functions (see scripts/check-phase1.mjs), and the Vite dev server:
//   SUPABASE_URL=<local API_URL> SUPABASE_ANON_KEY=<local publishable key> npx vite --port 5173
//   LT_CHROME=<path to Chrome for Testing> node tests/e2e/phase1-gate.mjs
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { hexToBytes } from '@noble/curves/utils.js';
import { signOwnerRequest } from '../../scripts/owner-lib.mjs';

const BASE = process.env.LT_BASE || 'http://localhost:5173';
const OUT = new URL('../../output/phase1/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const env = Object.fromEntries(execSync('npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  .split('\n').map(l => l.match(/^(\w+)="?(.*?)"?$/)).filter(Boolean).map(m => [m[1], m[2]]));
process.loadEnvFile(new URL('../../supabase/.env.owner-test', import.meta.url));
const admin = createClient(env.API_URL, env.SECRET_KEY, { auth: { persistSession: false } });
const ownerSk = hexToBytes(process.env.LT_TEST_OWNER_SK);
const owner = async (action, payload) => {
  const r = await fetch(`${env.API_URL}/functions/v1/owner-verify`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: env.PUBLISHABLE_KEY }, body: JSON.stringify(signOwnerRequest(ownerSk, action, payload)) });
  return r.json();
};
const ok = msg => console.log('ok ', msg);
const TEAM = `Fake Gate Team ${Date.now().toString(36)}`;
const PIN = { coach: '418203', parent: '660192', jordan: '275531', sam: '903847', alex: '512468', sam2: '734106' };

const browser = await chromium.launch({ executablePath: process.env.LT_CHROME });
const device = async () => { const c = await browser.newContext({ viewport: { width: 390, height: 844 } }); const p = await c.newPage(); p.on('dialog', d => d.accept()); p.on('pageerror', e => console.log('  page error:', e.message)); return p; };
const noPayControls = async (page, who) => {
  const words = await page.$$eval('button, a, [role="button"], input[type="submit"]', els => els.map(e => (e.textContent || e.value || '').trim()));
  assert.ok(!words.some(w => /\b(pay|tip|invoice|donate|sats|wallet|checkout|buy)\b/i.test(w)), `${who} saw a pay control: ${words.join(' | ')}`);
};

// 1. Coach applies.
const coach = await device();
await coach.goto(`${BASE}/coach`);
await coach.fill('#ap-first', 'Casey'); await coach.fill('#ap-last', 'R'); await coach.fill('#ap-email', 'coach.gate@example.com');
await coach.fill('#ap-team', TEAM); await coach.fill('#ap-city', 'Testville');
await coach.fill('#km-pin', PIN.coach); await coach.click('text=APPLY WITH THIS PIN');
await coach.waitForSelector('text=Your application is in');
const { data: org } = await admin.from('orgs').select('id, verified_at').eq('name', TEAM).single();
const { data: card } = await admin.from('board_cards').select('col, title').eq('ref_id', org.id).single();
assert.equal(card.col, 'inbox'); assert.equal(org.verified_at, null);
ok(`coach applied in the browser; card in Inbox: "${card.title}"`);

// 2. Owner verifies with an owner-signed request.
assert.ok((await owner('list', {})).applications.some(a => a.org_id === org.id));
assert.equal((await owner('verify_org', { org_id: org.id })).verified, TEAM);
await coach.click('text=CHECK AGAIN');
await coach.waitForSelector('text=VERIFIED');
ok('owner-signed verify flipped the team to verified; the coach desk shows the roster');

// 3. Roster: U13, 13-17, 18+.
const addRow = async (first, last, num, pos, band, parent) => {
  await coach.fill('#ad-first', first); await coach.fill('#ad-last', last); await coach.fill('#ad-num', num);
  await coach.selectOption('#ad-pos', pos); await coach.selectOption('#ad-band', band);
  if (band !== '18_plus') await coach.fill('#ad-parent', parent || '');
  await coach.click('#ad-go');
};
await addRow('Jordan', 'K', '22', 'attack', 'u13', '');
await coach.waitForSelector('#ad-msg.err');
assert.match(await coach.textContent('#ad-msg'), /parent email/);
await addRow('Jordan', 'K', '22', 'attack', 'u13', 'parent.jordan@example.com');
await coach.waitForSelector('td:text-is("Jordan K.")');
await addRow('Sam', 'T', '7', 'defense', '13_17', '');
await coach.waitForSelector('td:text-is("Sam T.")');
await addRow('Alex', 'M', '31', 'goalie', '18_plus');
await coach.waitForSelector('td:text-is("Alex M.")');
ok('coach added U13 (parent email required), 13-17 and 18+ rows');

// 4. Invite sheet with QR codes, printed.
await coach.click('#rs-sheet');
await coach.waitForSelector('.invite-card');
const cards = await coach.$$eval('.invite-card', els => els.map(e => ({ name: e.querySelector('b').textContent, link: e.querySelector('code.link').textContent, qr: !!e.querySelector('.qr svg') })));
assert.equal(cards.length, 4); assert.ok(cards.every(c => c.qr && /\/join#i=[A-Za-z0-9_-]{20,}$/.test(c.link)));
assert.equal(cards[0].name, 'Parent of Jordan K.', 'parents print first');
await coach.evaluate(() => document.body.classList.add('print-sheet'));
await coach.emulateMedia({ media: 'print' });
await coach.pdf({ path: `${OUT}qr-sheet.pdf`, format: 'Letter', printBackground: true });
await coach.screenshot({ path: `${OUT}qr-sheet-print.png`, fullPage: true });
assert.equal(await coach.isVisible('.hud'), false, 'only the sheet prints');
await coach.emulateMedia({ media: 'screen' });
await coach.evaluate(() => document.body.classList.remove('print-sheet'));
const link = name => cards.find(c => c.name === name).link;
ok(`invite sheet: ${cards.length} QR cards; printed to output/phase1/qr-sheet.pdf`);

// 5. The U13 invite waits for a parent; the parent consents.
const jordan = await device();
await jordan.goto(link('Jordan K.'));
await jordan.waitForSelector('text=Almost there');
const parent = await device();
await parent.goto(link('Parent of Jordan K.'));
await parent.waitForSelector('#jn-consent');
await parent.fill('#km-pin', PIN.parent); await parent.click('text=JOIN WITH THIS PIN');
await parent.waitForSelector('text=Tick the box to give consent first.');
await parent.check('#jn-consent'); await parent.click('text=JOIN WITH THIS PIN');
await parent.waitForSelector('.id-card.filled');
await parent.click('#pf-save'); await parent.waitForURL('**/team');
await parent.waitForSelector('text=consent given');
const { data: g } = await admin.from('guardians').select('consent_at, consent_method, child:people!guardians_child_id_fkey(display_name)').not('consent_at', 'is', null);
assert.ok(g.some(x => x.child.display_name === 'Jordan K.' && x.consent_method === 'parent_invite'));
await noPayControls(parent, 'parent');
ok('the U13 invite waited for a parent; the parent invite recorded consent in the browser');

// 6. Three players join and land on a filled profile.
const timings = {};
async function join(page, name, pin) {
  const t0 = Date.now();
  await page.goto(link(name));
  await page.waitForSelector('#km-pin');
  await page.fill('#km-pin', pin); await page.click('text=JOIN WITH THIS PIN');
  await page.waitForSelector('.id-card.filled');
  timings[name] = Date.now() - t0;
  assert.equal(await page.textContent('.id-card.filled b'), name);
}
await jordan.reload();
await join(jordan, 'Jordan K.', PIN.jordan);
assert.equal(await jordan.$('#so-instagram'), null, 'U13 has no socials field');
assert.equal(await jordan.$('input[type="file"]'), null, 'no photo upload');
await jordan.screenshot({ path: `${OUT}u13-profile.png`, fullPage: true });
const sam = await device(); await join(sam, 'Sam T.', PIN.sam);
assert.ok(await sam.$('#so-instagram')); assert.equal(await sam.isChecked('#so-public'), false, '13-17 socials start team-only');
const alex = await device(); await join(alex, 'Alex M.', PIN.alex);
for (const [n, ms] of Object.entries(timings)) assert.ok(ms < 120000, `${n} took ${ms} ms`);
ok(`three players reached a filled profile: ${Object.entries(timings).map(([n, ms]) => `${n} ${(ms / 1000).toFixed(1)} s`).join(', ')}`);

// 7. Profiles, placement, team page.
async function placeAndLand(page, name, avatar) {
  await page.check(`input[name="avatar"][value="${avatar}"]`, { force: true });
  await page.click('#pf-save');
  await page.waitForURL('**/placement');
  await page.click('#pl-go');
  for (let i = 0; i < 5; i++) {
    const cv = page.locator('canvas.placement-canvas');
    await cv.waitFor();
    await page.waitForFunction(() => document.querySelector('canvas.placement-canvas').getBoundingClientRect().height > 160);
    for (let tries = 0; tries < 40 && !(await page.isVisible('#pl-next')); tries++) {
      const box = await cv.boundingBox();
      const spots = [[.5, .55], [.28, .82], [.72, .82], [.4, .4]];
      const [x, y] = spots[tries % spots.length];
      await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
      await page.waitForTimeout(350);
    }
    if (!(await page.isVisible('#pl-next'))) {
      await page.screenshot({ path: `${OUT}stalled-${name.replace(/\W/g, '')}-${i + 1}.png` });
      throw new Error(`${name}: challenge ${i + 1} gave no result (${await page.textContent('#placement h1')})`);
    }
    await page.click('#pl-next');
  }
  await page.waitForSelector('text=PLACEMENT DONE');
  await page.click('text=MY TEAM PAGE');
  await page.waitForURL('**/team');
  await page.waitForSelector('.stat-grid');
  const stats = await page.$$eval('.stat', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  assert.ok(/^\d+\s*seed rating$/.test(stats[0]), stats[0]);
  assert.ok(await page.isVisible('text=No session from your coach yet'));
  await noPayControls(page, name);
  return stats;
}
const jStats = await placeAndLand(jordan, 'Jordan K.', 'crown');
await jordan.screenshot({ path: `${OUT}u13-team.png`, fullPage: true });
const sStats = await placeAndLand(sam, 'Sam T.', 'bolt');
await placeAndLand(alex, 'Alex M.', 'shield');
const { data: jp } = await admin.from('people').select('socials, avatar, global_board_consent').eq('display_name', 'Jordan K.').order('created_at', { ascending: false }).limit(1).single();
assert.deepEqual(jp.socials, {}); assert.equal(jp.avatar, 'crown'); assert.equal(jp.global_board_consent, false);
const { data: sp } = await admin.from('people').select('id, socials_public_self, socials_public_parent, seed_rating').eq('display_name', 'Sam T.').order('created_at', { ascending: false }).limit(1).single();
assert.equal(sp.socials_public_parent, false);
ok(`placement done for all three; team pages show seed, rank and the empty coach-session state (Jordan: ${jStats[0]}; Sam: ${sStats[0]})`);
ok('U13: no socials, preset avatar only, off global boards; 13-17 socials team-only by default; no pay controls anywhere');

// 8. Lost key: turn off Sam's key, new invite, same person and seed.
await coach.reload(); await coach.waitForSelector('td:text-is("Sam T.")');
const samRow = coach.locator('tr', { has: coach.locator('td:text-is("Sam T.")') });
await samRow.locator('[data-revoke]').click();
await coach.waitForFunction(() => ![...document.querySelectorAll('tr')].find(r => r.textContent.includes('Sam T.'))?.querySelector('[data-revoke]'));
await coach.locator('tr', { has: coach.locator('td:text-is("Sam T.")') }).locator('[data-invite]').click();
await coach.waitForSelector('.invite-card');
const newLink = await coach.textContent('.invite-card code.link');
const sam2 = await device();
const t0 = Date.now();
await sam2.goto(newLink);
await sam2.fill('#km-pin', PIN.sam2); await sam2.click('text=JOIN WITH THIS PIN');
await sam2.waitForSelector('.id-card.filled');
const reissueMs = Date.now() - t0;
assert.equal(await sam2.textContent('.id-card.filled b'), 'Sam T.');
await sam2.click('#pf-save'); await sam2.waitForURL('**/team'); await sam2.waitForSelector('.stat-grid');
const s2Stats = await sam2.$$eval('.stat', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
assert.equal(s2Stats[0], sStats[0], 'same seed rating after re-issue');
const { data: sp2 } = await admin.from('people').select('id, seed_rating').eq('id', sp.id).single();
assert.equal(sp2.seed_rating, sp.seed_rating);
await sam.reload(); await sam.waitForSelector('text=SIGN IN');
ok(`lost key: the old device is signed out, the re-issued key lands on the same person with the same seed in ${(reissueMs / 1000).toFixed(1)} s`);

// 9. The shelf still works, offline fallback included.
const shelf = await device();
await shelf.goto(BASE);
await shelf.waitForSelector('text=Shelf Dispatch');
const shelfText = await shelf.textContent('body');
assert.ok(/Why it's here/.test(shelfText) && /Locker/.test(shelfText) && /Practice/.test(shelfText));
assert.ok(!/karpathy|50% still frame|halfway frame/i.test(shelfText));
const offline = await device();
await offline.route('**/data/live_bundle.js', r => r.abort());
await offline.goto(BASE);
await offline.waitForSelector('text=No matching films');
ok('Shelf Dispatch, Locker and practice cards load; with the live bundle blocked the shelf falls back without crashing');

await browser.close();
console.log('\nPhase 1 browser gate passed on', BASE);
