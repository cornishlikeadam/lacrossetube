// End-to-end check of Phase 1 against the LOCAL Supabase stack: coach applies, the owner verifies
// with an owner-signed request, the roster, invites, parent consent, profiles, placement and a
// re-issued key. Fake people only. Needs `npx supabase start` and
// `npx supabase functions serve --env-file supabase/.env.local` (with OWNER_PUBKEY set there),
// plus supabase/.env.owner-test holding the matching throwaway owner key.
import { execSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { loginMessage } from '../supabase/functions/_shared/key-login-core.js';
import { signOwnerRequest } from './owner-lib.mjs';

const env = Object.fromEntries(execSync('npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  .split('\n').map(l => l.match(/^(\w+)="?(.*?)"?$/)).filter(Boolean).map(m => [m[1], m[2]]));
process.loadEnvFile(new URL('../supabase/.env.owner-test', import.meta.url));
const url = env.API_URL, pubKey = env.PUBLISHABLE_KEY, ownerSk = hexToBytes(process.env.LT_TEST_OWNER_SK);
const admin = createClient(url, env.SECRET_KEY, { auth: { persistSession: false } });
const ok = msg => console.log('ok ', msg);

async function fn(name, body) {
  const r = await fetch(`${url}/functions/v1/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: pubKey }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}
const device = () => { const sk = schnorr.utils.randomSecretKey(); return { sk, pub: bytesToHex(schnorr.getPublicKey(sk)) }; };
async function signed(d, extra) {
  const { body: { challenge } } = await fn('key-login', { step: 'challenge', pubkey: d.pub });
  return { pubkey: d.pub, challenge, sig: bytesToHex(schnorr.sign(loginMessage(challenge, sha256), d.sk)), verifier: bytesToHex(crypto.getRandomValues(new Uint8Array(32))), ...extra };
}
async function session(res) {
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const c = createClient(url, pubKey, { auth: { persistSession: false, autoRefreshToken: false } });
  assert.ifError((await c.auth.setSession(res.body.session)).error);
  return c;
}
const rpc = async (c, name, args) => { const { data, error } = await c.rpc(name, args); if (error) throw new Error(`${name}: ${error.message}`); return data; };
const accept = async (code, d, extra = {}) => fn('key-login', { step: 'invite-accept', code, ...(await signed(d, extra)) });
const placement = grades => ['help', 'talk', 'slide', 'angle', 'hustle'].map((concept, i) => ({ concept, idea_id: `fake-${concept}`, grade: grades[i] }));

// 1. A coach applies; the application lands on the owner's board.
const coachDev = device();
const applied = await fn('key-login', { step: 'apply', ...(await signed(coachDev, { coach: { first_name: 'Casey', last_initial: 'R', email: 'coach@example.com' }, team: { name: 'Fake Riverside U14', city: 'Testville' } })) });
const coach = await session(applied);
const org = applied.body.orgId;
const { data: card } = await admin.from('board_cards').select('col, title').eq('ref_id', org).single();
assert.equal(card.col, 'inbox');
ok(`coach applied; owner board card in Inbox: "${card.title}"`);
await assert.rejects(rpc(coach, 'roster_add', { p_org: org, p_first_name: 'Too', p_last_initial: 'S', p_number: '1', p_position: 'attack', p_age_band: '18_plus' }), /verified team/);
ok('an unverified team cannot add players');

// 2. Only an owner-signed request verifies it.
const forged = signOwnerRequest(schnorr.utils.randomSecretKey(), 'verify_org', { org_id: org });
assert.equal((await fn('owner-verify', forged)).status, 401);
const stale = signOwnerRequest(ownerSk, 'verify_org', { org_id: org }, Date.now() - 10 * 60 * 1000);
assert.equal((await fn('owner-verify', stale)).status, 401);
const pending = await fn('owner-verify', signOwnerRequest(ownerSk, 'list', {}));
assert.ok(pending.body.applications.some(a => a.org_id === org));
const verified = await fn('owner-verify', signOwnerRequest(ownerSk, 'verify_org', { org_id: org }));
assert.equal(verified.status, 200, JSON.stringify(verified.body));
const { data: orgRow } = await admin.from('orgs').select('verified_at, verified_sig').eq('id', org).single();
assert.ok(orgRow.verified_at && orgRow.verified_sig);
assert.equal((await admin.from('board_cards').select('col').eq('ref_id', org).single()).data.col, 'done');
ok('a forged or stale signature is refused; the owner-signed verify flips the team to verified and closes the card');

// 3. The roster: one U13, one 13-17, one 18+.
await assert.rejects(rpc(coach, 'roster_add', { p_org: org, p_first_name: 'Noparent', p_last_initial: 'X', p_number: '9', p_position: 'attack', p_age_band: 'u13' }), /parent email/);
const add = (first, initial, number, position, band, parent) => rpc(coach, 'roster_add', { p_org: org, p_first_name: first, p_last_initial: initial, p_number: number, p_position: position, p_age_band: band, p_parent_email: parent ?? null });
await add('Jordan', 'K', '22', 'attack', 'u13', 'parent.jordan@example.com');
await add('Sam', 'T', '7', 'defense', '13_17', 'parent.sam@example.com');
await add('Alex', 'M', '31', 'goalie', '18_plus');
const roster = await rpc(coach, 'roster_for_coach', { p_org: org });
const row = name => roster.find(r => r.display_name === name);
assert.deepEqual(roster.filter(r => r.role === 'player').map(r => r.age_band).sort(), ['13_17', '18_plus', 'u13']);
assert.equal(roster.filter(r => r.role === 'parent').length, 2);
ok('U13 needs a parent email; the coach adds a U13, a 13-17 and an 18+ row (plus two parent rows)');

// 4. Invites: one per row, only a hash stored.
const codes = {};
for (const r of roster) if (r.role !== 'coach') codes[r.display_name] = (await rpc(coach, 'invite_create', { p_org: org, p_person: r.person_id }))[0].code;
const { data: stored } = await admin.from('invites').select('*').eq('org_id', org);
assert.ok(stored.every(i => !Object.values(codes).includes(i.code_hash) && /^[0-9a-f]{64}$/.test(i.code_hash) && !('code' in i)));
assert.ok(stored.every(i => new Date(i.expires_at) - Date.now() > 6.9 * 864e5));
ok('each roster row has a 7-day one-time invite; only its hash is stored');

// 5. Parent consent comes first for U13.
const jordanDev = device();
assert.equal((await accept(codes['Jordan K.'], jordanDev)).status, 403);
const parentJ = device();
assert.equal((await accept(codes['Parent of Jordan K.'], parentJ)).status, 403, 'a parent invite needs consent');
const parentJordan = await session(await accept(codes['Parent of Jordan K.'], parentJ, { consent: true }));
const { data: g } = await admin.from('guardians').select('consent_at, consent_method').eq('child_id', row('Jordan K.').person_id).single();
assert.ok(g.consent_at); assert.equal(g.consent_method, 'parent_invite');
ok('the U13 invite waits for a parent; the parent invite records consent');

// 6. Each player opens an invite and lands on a filled profile.
const players = {};
for (const [name, d] of [['Jordan K.', jordanDev], ['Sam T.', device()], ['Alex M.', device()]]) {
  const t0 = Date.now(), res = await accept(codes[name], d);
  const c = await session(res), home = await rpc(c, 'team_home');
  assert.equal(home.person.display_name, name);
  assert.equal(home.teams[0].name, 'Fake Riverside U14');
  assert.ok(home.teams[0].number && home.teams[0].position);
  players[name] = { c, d, id: res.body.personId, ms: Date.now() - t0 };
}
assert.equal((await accept(codes['Sam T.'], device())).status, 404, 'an invite works once');
ok(`three players joined with filled profiles (server time ${Object.values(players).map(p => p.ms + ' ms').join(', ')}); a used invite is refused`);

// 7. Profiles: presets only; socials 13+ only, team-only by default.
const J = players['Jordan K.'], S = players['Sam T.'], A = players['Alex M.'];
assert.ifError((await J.c.from('people').update({ avatar: 'crown', skin: 'default' }).eq('id', J.id)).error);
assert.ok((await J.c.from('people').update({ socials: { instagram: 'https://instagram.com/fake_kid' } }).eq('id', J.id)).error, 'U13 cannot add socials');
assert.ok((await J.c.from('people').update({ avatar: 'https://example.com/photo.jpg' }).eq('id', J.id)).error, 'no photos');
assert.ok((await S.c.from('people').update({ socials: { instagram: 'https://evil.example.com/x' } }).eq('id', S.id)).error, 'links only on the five sites');
assert.ifError((await S.c.from('people').update({ socials: { instagram: 'https://instagram.com/fake_sam', hudl: 'https://hudl.com/profile/123' }, socials_public_self: true }).eq('id', S.id)).error);
let sam = (await rpc(S.c, 'team_home')).person;
assert.equal(sam.socials_public_parent, false);
ok('U13: no socials, no photo URLs; 13-17 socials are links on the five sites and stay team-only by default');

// 8. The 13-17 parent is the second switch for public socials.
const parentSam = await session(await accept(codes['Parent of Sam T.'], device(), { consent: true }));
await rpc(parentSam, 'guardian_set', { p_child: S.id, p_public_socials: true });
assert.equal((await rpc(S.c, 'team_home')).person.socials_public_parent, true);
await assert.rejects(rpc(S.c, 'guardian_set', { p_child: S.id, p_public_socials: true }), /parent/);
ok('only a consenting parent can flip the second switch for 13-17 public socials');

// 9. Visibility: another team, and anonymous visitors, cannot see the U13 player.
const otherCoach = await session(await fn('key-login', { step: 'apply', ...(await signed(device(), { coach: { first_name: 'Other', last_initial: 'C' }, team: { name: 'Fake Other Team', city: 'Elsewhere' } })) }));
assert.equal((await otherCoach.from('people').select('id').eq('id', J.id)).data.length, 0);
const anon = createClient(url, pubKey, { auth: { persistSession: false } });
assert.ok((await anon.from('people').select('id').eq('id', J.id)).error);
assert.equal((await S.c.from('people').select('display_name').eq('id', J.id)).data[0].display_name, 'Jordan K.', 'teammates see each other');
assert.ok((await S.c.from('people').select('contact_email').limit(1)).error, 'emails are never readable from the browser');
assert.equal(J.c ? (await rpc(J.c, 'team_home')).person.global_board_consent : null, false);
ok('the U13 player is visible to teammates only, never to another team or the public; no email is readable');

// 10. Placement: five challenges, once, seeding ratings from 500.
const seedJ = await rpc(J.c, 'placement_submit', { p_results: placement(['perfect', 'good', 'perfect', 'miss', 'good']) });
const seedS = await rpc(S.c, 'placement_submit', { p_results: placement(['perfect', 'perfect', 'perfect', 'perfect', 'good']) });
await rpc(A.c, 'placement_submit', { p_results: placement(['miss', 'good', 'miss', 'good', 'miss']) });
await assert.rejects(rpc(J.c, 'placement_submit', { p_results: placement(['perfect', 'perfect', 'perfect', 'perfect', 'perfect']) }), /already done/);
assert.equal(Number(seedJ), 517, 'perfect +40, good +15, miss -25 from 500: (540+515+540+475+515)/5');
const homeS = await rpc(S.c, 'team_home');
assert.equal(homeS.teams[0].seed_rank, 1); assert.equal(homeS.teams[0].placed_count, 3);
assert.equal(homeS.teams[0].has_session, false);
ok(`placement seeds ratings once (Jordan ${seedJ}, Sam ${seedS}); the team page has a rank and an empty coach-session state`);

// 11. Lost key: revoke, re-invite, same person and seed.
const before = (await rpc(S.c, 'team_home')).person;
assert.equal(await rpc(coach, 'keys_revoke', { p_org: org, p_person: S.id }), 1);
const oldLogin = await fn('key-login', { step: 'verify', ...(await signed(S.d)) });
assert.equal(oldLogin.status, 403);
assert.equal(await rpc(S.c, 'team_home'), null, 'the lost device is signed out at once');
assert.equal((await S.c.from('people').select('id')).data?.length ?? 0, 0);
const newCode = (await rpc(coach, 'invite_create', { p_org: org, p_person: S.id }))[0].code;
const back = await accept(newCode, device());
assert.equal(back.body.personId, S.id);
const after = (await rpc(await session(back), 'team_home')).person;
assert.equal(after.seed_rating, before.seed_rating); assert.equal(after.xp, before.xp);
ok(`a revoked key is refused; a new invite brings back the same person with the same seed (${after.seed_rating}) and XP (${after.xp})`);

// 12. Money stays in the schema, not on screen.
for (const t of ['payments', 'fundraisers', 'events', 'listings', 'orders']) {
  const read = await coach.from(t).select('*').limit(1), write = await coach.from(t).insert({});
  assert.ok(read.error || read.data.length === 0); assert.ok(write.error);
}
ok('money tables exist with RLS and no browser access');
console.log('\nPhase 1 checks passed against', url);
