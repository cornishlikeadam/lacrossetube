// Phase 2 against the LOCAL Supabase stack, through the real API (PostgREST, Storage, key-login):
// the coach application stores the state and school website; a film minute and a finished game
// pay, a 31st minute and an 8th game do not; a forum post takes a tip (a YouTube link is refused);
// a service is paid with a receipt; points go to a teammate and into the team pool; and the coach
// runs session payouts A, B, C and D from the pool. Fake people only.
// Needs `npx supabase start` and `npx supabase functions serve --env-file supabase/.env.local`
// (with OWNER_PUBKEY set there), plus supabase/.env.owner-test holding the matching throwaway owner key.
import { execSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { loginMessage } from '../supabase/functions/_shared/key-login-core.js';
import { addressFromSecret } from '../supabase/functions/_shared/evm.js';
import { POINTS } from '../supabase/functions/_shared/chain.js';
import { signOwnerRequest } from './owner-lib.mjs';

const env = Object.fromEntries(execSync('npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  .split('\n').map(l => l.match(/^(\w+)="?(.*?)"?$/)).filter(Boolean).map(m => [m[1], m[2]]));
process.loadEnvFile(new URL('../supabase/.env.owner-test', import.meta.url));
const url = env.API_URL, key = env.PUBLISHABLE_KEY, ownerSk = hexToBytes(process.env.LT_TEST_OWNER_SK);
const admin = createClient(url, env.SECRET_KEY, { auth: { persistSession: false } });
const ok = m => console.log('ok ', m);
const E = POINTS.earn;
const fn = async (name, body) => {
  const r = await fetch(`${url}/functions/v1/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: key }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const device = () => { const sk = schnorr.utils.randomSecretKey(); return { sk, pub: bytesToHex(schnorr.getPublicKey(sk)), address: addressFromSecret(sk, { secp256k1, keccak: keccak_256 }) }; };
async function signed(d, extra) {
  const { body: { challenge } } = await fn('key-login', { step: 'challenge', pubkey: d.pub });
  return { pubkey: d.pub, challenge, sig: bytesToHex(schnorr.sign(loginMessage(challenge, sha256), d.sk)), verifier: bytesToHex(crypto.getRandomValues(new Uint8Array(32))), address: d.address, ...extra };
}
const client = async session => { const c = createClient(url, key, { auth: { persistSession: false } }); await c.auth.setSession(session); return c; };
const call = async (c, name, args = {}) => { const { data, error } = await c.rpc(name, args); if (error) throw new Error(`${name}: ${error.message}`); return data; };
const points = async c => (await call(c, 'wallet_home')).points;
const tag = Date.now().toString(36);

// The coach application: state required, school website optional.
const noState = await fn('key-login', { step: 'apply', ...(await signed(device(), { coach: { first_name: 'No', last_initial: 'S' }, team: { name: `No State ${tag}`, city: 'Lab' } })) });
assert.equal(noState.status, 400); assert.match(noState.body.error, /state/);
const applied = await fn('key-login', { step: 'apply', ...(await signed(device(), { coach: { first_name: 'Pool', last_initial: 'C' }, team: { name: `Phase Two ${tag}`, city: 'Baltimore', state: 'Maryland', website: 'https://www.example.edu/lacrosse' } })) });
assert.equal(applied.status, 200, JSON.stringify(applied.body));
const coach = await client(applied.body.session), org = applied.body.orgId;
const { data: orgRow } = await admin.from('orgs').select('state, website').eq('id', org).single();
assert.deepEqual(orgRow, { state: 'Maryland', website: 'https://www.example.edu/lacrosse' });
ok('the coach application stored the state (Maryland) and the optional school website');
assert.equal((await fn('owner-verify', signOwnerRequest(ownerSk, 'verify_org', { org_id: org }))).status, 200);

const join = async (first, number) => {
  await call(coach, 'roster_add', { p_org: org, p_first_name: first, p_last_initial: 'T', p_number: number, p_position: 'attack', p_age_band: '18_plus' });
  const row = (await call(coach, 'roster_for_coach', { p_org: org })).find(r => r.display_name === `${first} T.`);
  const [inv] = await call(coach, 'invite_create', { p_org: org, p_person: row.person_id });
  const res = await fn('key-login', { step: 'invite-accept', code: inv.code, ...(await signed(device())) });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const c = await client(res.body.session);
  await call(c, 'placement_submit', { p_results: ['help', 'talk', 'slide', 'angle', 'hustle'].map(concept => ({ concept, idea_id: `fake-${concept}`, grade: 'good' })) });
  return { c, id: row.person_id };
};
const riley = await join('Riley', '4'), morgan = await join('Morgan', '12');
assert.equal(await points(riley.c), 1000);

// Film minutes: the server never credits more than the time since the last beat, so the check
// winds that clock back with the service key instead of waiting.
const rewind = id => admin.from('watch_clock').update({ last_at: new Date(Date.now() - 61000).toISOString() }).eq('person_id', id);
const beat = async (p, film) => { await rewind(p.id); return call(p.c, 'watch_beat', { p_film: film, p_seconds: 60 }); };
assert.equal((await beat(riley, 'yt-bw8KCj1uzNA')).points_added, E.perMinute);
for (let m = 2; m <= E.maxMinutes; m++) await beat(riley, 'yt-bw8KCj1uzNA');
const minute31 = await beat(riley, 'yt-bw8KCj1uzNA');
assert.equal(minute31.points_added, 0); assert.equal(minute31.minutes_paid, E.maxMinutes);
ok(`a film minute paid ${E.perMinute} points; the 31st minute paid nothing (${minute31.minutes_paid} minutes = ${E.perMinute * E.maxMinutes} points today)`);

const game = (p, k) => call(p.c, 'game_complete', { p_key: `check-${tag}-${k}`, p_concept: 'slide', p_grade: 'good' });
assert.equal((await game(riley, 1)).points_added, E.perGame);
for (let k = 2; k <= E.maxGames; k++) await game(riley, k);
const eighth = await game(riley, 8);
assert.equal(eighth.points_added, 0); assert.equal(eighth.reason, 'cap');
assert.equal(await points(riley.c), 1000 + 15000 + 7000);
ok(`a finished game paid ${E.perGame} points; the 8th game of the day paid nothing; Riley has ${(await points(riley.c)).toLocaleString()} points`);

// Forum: a YouTube link is refused; a text post and a photo post; a tip; a paid service.
const { error: yt } = await riley.c.rpc('forum_post', { p_body: 'https://www.youtube.com/watch?v=bw8KCj1uzNA' });
assert.match(yt.message, /film library/);
const post = await call(riley.c, 'forum_post', { p_body: `Wall ball week 3 (${tag})` });
const me = (await call(riley.c, 'team_home')).person.id, photo = `${me}/${crypto.randomUUID()}.png`;
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
const up = await riley.c.storage.from('forum').upload(photo, new Blob([png], { type: 'image/png' }), { contentType: 'image/png' });
assert.ifError(up.error);
const { error: wrongFolder } = await riley.c.storage.from('forum').upload(`${morgan.id}/${crypto.randomUUID()}.png`, new Blob([png], { type: 'image/png' }), { contentType: 'image/png' });
assert.ok(wrongFolder, 'nobody uploads into another member\'s folder');
await call(riley.c, 'forum_post', { p_body: '', p_media_path: photo, p_media_kind: 'photo' });
assert.ok((await morgan.c.storage.from('forum').download(photo)).data, 'another member can see the photo');
await call(morgan.c, 'post_tip', { p_post: post, p_points: 50 });
assert.equal(await points(morgan.c), 950);
const svc = await call(riley.c, 'forum_post', { p_body: 'I string your head', p_title: 'Mesh foundations stringing', p_price: 300, p_pattern: 'mesh-basics' });
const receipt = await call(morgan.c, 'service_pay', { p_post: svc });
assert.equal(receipt.kind, 'service'); assert.equal(await points(morgan.c), 650);
ok('forum: a YouTube link was refused; a text post and a photo; Morgan tipped 50 and paid 300 for a stick-doctor service (receipt kept)');

// Wallet: send to a teammate; give to the team pool.
await call(riley.c, 'points_send', { p_to: morgan.id, p_points: 350, p_note: 'check' });
assert.equal(await points(morgan.c), 1000);
await call(riley.c, 'team_donate', { p_org: org, p_points: 5000, p_note: 'pool' });
assert.equal((await call(coach, 'payouts_for_coach', { p_org: org })).pool, 5000);
ok('wallet: Riley sent 350 points to Morgan and gave 5,000 to the team pool');

// Session payouts A-D.
const link = `http://127.0.0.1:5173/play#t=z${tag}`, wcs = `s${tag}`.slice(0, 16);
const make = (condition, extra = {}) => call(coach, 'payout_create', { p_org: org, p_link: link, p_wcs_id: wcs, p_label: 'Check session', p_condition: condition, ...extra });
const A = await make('open'), B = await make('finish'), C = await make('watch', { p_film: 'yt-W4ka4tBYWoI', p_film_title: 'Check film', p_minutes: 2 }), D = await make('present');
const claim = id => morgan.c.rpc('payout_claim', { p_payout: id });
assert.match((await claim(A)).error.message, /Open the session/);
await call(morgan.c, 'wcs_event', { p_session: wcs, p_kind: 'open' });
await call(morgan.c, 'wcs_event', { p_session: wcs, p_kind: 'finish' });
await beat(morgan, 'yt-W4ka4tBYWoI'); await beat(morgan, 'yt-W4ka4tBYWoI');
await call(coach, 'payout_mark', { p_payout: D, p_person: morgan.id, p_present: true });
const before = await points(morgan.c);
for (const id of [A, B, C, D]) { const { data, error } = await claim(id); assert.ifError(error); assert.equal(data.kind, 'payout'); }
const paid = POINTS.payout.open + POINTS.payout.finish + 2 * POINTS.payout.watchPerMinute + POINTS.payout.present;
assert.equal(await points(morgan.c), before + paid);
assert.equal((await call(coach, 'payouts_for_coach', { p_org: org })).pool, 5000 - paid);
assert.match((await claim(A)).error.message, /already confirmed/);
ok(`payouts: A, B, C and D each paid only after the condition was true and Morgan confirmed (${paid} points out of the pool)`);
console.log('\nPhase 2 checks passed against', url);
