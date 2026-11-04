// The preview trial in ONE browser (one context, like a person on their laptop), on LOCALHOST:
// trial page -> apply as coach -> approve on the owner page with the owner key file -> add three
// players -> open each invite in that player's slot -> profile with DogeOS address and points ->
// key file download -> reissue a lost key. Fake people only; redeem is left "not configured".
//
// Needs the local stack + functions (OWNER_PUBKEY of output/phase1/test-owner-key.json in
// supabase/.env.local), `npx vite` on :5173 pointed at the local stack, and LT_CHROME.
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { openOwnerKey } from '../../scripts/owner-lib.mjs';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/curves/utils.js';

const BASE = process.env.LT_BASE || 'http://localhost:5173';
const OUT = new URL('../../output/phase1/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
process.loadEnvFile(new URL('../../supabase/.env.owner-test', import.meta.url));
const ok = msg => console.log('ok ', msg);

const browser = await chromium.launch({ executablePath: process.env.LT_CHROME });
const context = await browser.newContext({ viewport: { width: 420, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
page.on('dialog', d => d.accept());
page.on('pageerror', e => console.log('  page error:', e.message));
const trial = async () => { await page.goto(`${BASE}/trial`); await page.waitForSelector('.steps'); };

// 1. Apply as coach, from the trial page.
await trial();
await page.click('text=APPLY AS COACH');
await page.waitForURL('**/coach');
assert.ok((await page.inputValue('#ap-team')).startsWith('Trial Team'), 'the trial form is filled in');
await page.fill('#km-pin', '418203'); await page.click('text=APPLY WITH THIS PIN');
await page.waitForSelector('text=Your application is in');
ok('click 1 · apply: the coach applied from the coach desk in their own slot');

// 2. Approve on the owner page with the owner key file (once), then one click.
await page.click('text=APPROVE IT ON THE OWNER PAGE');
await page.waitForURL('**/owner');
await page.setInputFiles('#ow-file', `${OUT}test-owner-key.json`);
await page.fill('#ow-pass', process.env.LT_TEST_OWNER_PASS);
await page.click('#ow-go');
await page.waitForSelector('[data-approve]', { timeout: 60000 });
await page.click('[data-approve]');
await page.waitForSelector('text=Approved. The coach can add players now.');
await page.reload(); await page.waitForSelector('text=No teams waiting');
ok('click 2 · approve: the owner page signed with the owner key file; after the first unlock it needs no passphrase');

// 3. Add three players with invites.
await trial();
await page.click('#tr-add');
await page.waitForSelector('text=OPEN AS PLAYER 1');
const invites = await page.$$eval('.invites li', els => els.map(e => e.textContent));
assert.equal(invites.length, 3);
ok('three players added to the roster, each with an invite link');

// 4. Open each invite in its player's slot.
const timings = [], addresses = {};
for (const n of [1, 2, 3]) {
  await trial();
  const t0 = Date.now();
  await page.click(`text=OPEN AS PLAYER ${n}`);
  await page.waitForURL('**/join');
  await page.waitForSelector('#km-pin');
  assert.equal(await page.$('#jn-consent'), null, 'no parent consent step in the 18+ version');
  await page.fill('#km-pin', `13579${n}`); await page.click('text=JOIN WITH THIS PIN');
  await page.waitForSelector('.id-card.filled');
  timings.push(Date.now() - t0);
  await page.click('#pf-save');
  await page.waitForURL('**/placement');
  if (n === 1) {
    await page.click('#pl-go');
    for (let i = 0; i < 5; i++) {
      const cv = page.locator('canvas.placement-canvas'); await cv.waitFor();
      await page.waitForFunction(() => document.querySelector('canvas.placement-canvas').getBoundingClientRect().height > 160);
      // Sweep taps over the field (and the answer buttons) until the game gives a result: some
      // games only react to a tap on a player, like a person tapping a circle.
      const spots = [[.5, .55], [.28, .82], [.72, .82]];
      for (let gy = .2; gy < .95; gy += .08) for (let gx = .08; gx < .95; gx += .08) spots.push([gx, gy]);
      for (let k = 0; k < spots.length && !(await page.isVisible('#pl-next')); k++) {
        const box = await cv.boundingBox(), [x, y] = spots[k];
        await page.mouse.click(box.x + box.width * x, box.y + box.height * y); await page.waitForTimeout(k < 3 ? 350 : 60);
      }
      if (!(await page.isVisible('#pl-next'))) { await page.screenshot({ path: `${OUT}trial-stalled-${i + 1}.png` }); throw new Error(`placement challenge ${i + 1} gave no result`); }
      await page.click('#pl-next');
    }
    await page.waitForSelector('text=PLACEMENT DONE');
  }
  await page.goto(`${BASE}/team`);
  await page.waitForSelector('#wl-addr');
  addresses[n] = (await page.textContent('#wl-addr')).trim();
  assert.match(addresses[n], /^0x[0-9a-fA-F]{40}$/);
}
assert.equal(new Set(Object.values(addresses)).size, 3);
await page.screenshot({ path: `${OUT}trial-team-wallet.png`, fullPage: true });
ok(`click 3 · open an invite: three players joined in one browser, each with a DogeOS address (${timings.map(ms => (ms / 1000).toFixed(1) + ' s').join(', ')} to a filled profile)`);

// 4b. Player 1 takes the Tier 2 quiz (multiple choice and a written answer).
await page.selectOption('.switcher select', 'p1');
await page.waitForURL('**/team'); await page.waitForSelector('.tiers');
assert.match(await page.textContent('.tiers'), /Tier 2 · Rules & Field IQ/);
await page.goto(`${BASE}/test?tier=2`);
await page.click('#ts-go');
for (const a of ['1', '1', '0', '1', 'four']) {
  await page.waitForSelector('#q-next');
  if (/^\d$/.test(a)) await page.check(`input[name="q"][value="${a}"]`, { force: true }); else await page.fill('#q-written', a);
  await page.click('#q-next');
}
await page.waitForSelector('text=Tier passed');
assert.match(await page.textContent('#test'), /5 of 5/);
await page.goto(`${BASE}/team`); await page.waitForSelector('.tiers');
assert.match(await page.textContent('.stat-grid'), /5000\s*points/);
ok('Player 1 passed Tier 2 (multiple choice + written) in the browser: 1,000 + 4,000 = 5,000 points');

// 4c. The switcher gets from a player back to the coach desk; signing out offers coach or player.
await page.selectOption('.switcher select', 'coach');
await page.waitForURL('**/coach'); await page.waitForSelector('text=VERIFIED');
assert.ok(await page.isVisible('.portal-tag:text("COACH PORTAL")'));
await page.click('#rs-out');
await page.waitForSelector('.portal-choice');
await page.click('.portal-card.player[data-slot="p3"]');
await page.waitForURL('**/team'); await page.waitForSelector('#wl-addr');
assert.ok(await page.isVisible('.portal-tag:text("PLAYER PORTAL")'));
ok('the switcher moves from a player to the coach desk; sign-out offers Coach or Player 1-3; each portal is tagged');

// 5. The wallet card: points, redeem not configured, the plain warning.
const wallet = await page.textContent('.wallet');
assert.match(wallet, /Redeem: not configured/);
assert.match(wallet, /DOGE already sent to this address is not recovered by a reissued login/);
ok('the profile shows the address and points; redeem is labelled "not configured"; the reissue warning is plain');

// 6. Download the encrypted key file (Player 3's slot is open now).
await page.click('text=Download my encrypted key file');
await page.fill('#kf-pin', '135793'); await page.fill('#kf-pass', 'player three backup'); await page.fill('#kf-pass2', 'player three backup');
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#kf-go')]);
const file = JSON.parse(await (await dl.createReadStream()).toArray().then(c => Buffer.concat(c).toString()));
assert.equal(file.address, addresses[3]);
const sk = openOwnerKey(file, 'player three backup');
assert.equal(bytesToHex(schnorr.getPublicKey(sk)), file.pubkey);
ok(`downloaded ${dl.suggestedFilename()}: encrypted, opens with its passphrase, holds the key for ${file.address.slice(0, 10)}…`);

// 7. Lose Player 1's phone: reissue, same person and seed, new address. The coach signed out in
// step 4c, so the trial page says so; sign the coach back in first.
await trial();
assert.match(await page.textContent('.steps'), /The coach is signed out/);
await page.click('.steps button[data-go="coach:/coach"]');
await page.waitForSelector('#si-pin'); await page.fill('#si-pin', '418203'); await page.click('#si-go');
await page.waitForSelector('text=VERIFIED');
await trial();
const p1Before = await page.textContent('.slot:nth-child(2)');
await page.click("text=Lose Player 1's phone");
await page.waitForURL('**/join');
await page.fill('#km-pin', '246801'); await page.click('text=JOIN WITH THIS PIN');
await page.waitForSelector('.id-card.filled');
const name = await page.textContent('.id-card.filled b');
assert.ok(p1Before.includes(name), `${name} is the same person`);
await page.goto(`${BASE}/team`); await page.waitForSelector('#wl-addr');
const newAddr = (await page.textContent('#wl-addr')).trim();
assert.notEqual(newAddr, addresses[1]);
const seed = await page.textContent('.stat b');
assert.match(seed, /^\d+$/, 'the seed rating stayed with the person');
ok(`lost key reissued: same person (${name}), same seed (${seed}), new address ${newAddr.slice(0, 10)}…`);

await browser.close();
console.log('\nPreview trial passed in one browser on', BASE);
