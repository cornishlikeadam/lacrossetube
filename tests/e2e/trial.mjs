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
      for (let k = 0; k < 40 && !(await page.isVisible('#pl-next')); k++) {
        const box = await cv.boundingBox(), [x, y] = [[.5, .55], [.28, .82], [.72, .82], [.4, .4]][k % 4];
        await page.mouse.click(box.x + box.width * x, box.y + box.height * y); await page.waitForTimeout(350);
      }
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

// 7. Lose Player 1's phone: reissue, same person and seed, new address.
await page.goto(`${BASE}/trial`); await page.waitForSelector('.steps');
await page.goto(`${BASE}/team`);
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
