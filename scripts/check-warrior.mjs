// Warrior Tests against the LOCAL stack: tiers unlock in order, answers never reach the browser,
// written answers are graded fairly, points pay once per tier, and all five total 100 DOGE.
// Needs `npx supabase start` and `npx supabase functions serve --env-file supabase/.env.local`.
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
const ok = m => console.log('ok ', m);
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
const call = async (c, name, args) => { const { data, error } = await c.rpc(name, args); if (error) throw new Error(`${name}: ${error.message}`); return data; };

const applied = await fn('key-login', { step: 'apply', ...(await signed(device(), { coach: { first_name: 'Tier', last_initial: 'T' }, team: { name: `Warrior Test ${Date.now().toString(36)}`, city: 'Lab', state: 'New York' } })) });
const coach = await client(applied.body.session), org = applied.body.orgId;
assert.equal((await fn('owner-verify', signOwnerRequest(ownerSk, 'verify_org', { org_id: org }))).status, 200);
await call(coach, 'roster_add', { p_org: org, p_first_name: 'Ari', p_last_initial: 'W', p_number: '3', p_position: 'attack', p_age_band: '18_plus' });
const pid = (await call(coach, 'roster_for_coach', { p_org: org })).find(r => r.role === 'player').person_id;
const [inv] = await call(coach, 'invite_create', { p_org: org, p_person: pid });
const p = await client((await fn('key-login', { step: 'invite-accept', code: inv.code, ...(await signed(device())) })).body.session);
const points = async () => (await call(p, 'team_home')).wallet.points;

await assert.rejects(call(p, 'warrior_questions_for', { p_level: 2 }), /Pass the tier before/);
const direct = await p.from('warrior_questions').select('answer');
assert.ok(direct.error || direct.data.length === 0, 'answers must not be readable');
ok('tier 2 is locked before placement; the question bank (with answers) is not readable from the browser');

await call(p, 'placement_submit', { p_results: ['help', 'talk', 'slide', 'angle', 'hustle'].map((concept, i) => ({ concept, idea_id: `fake-${concept}`, grade: i < 2 ? 'miss' : 'good' })) });
assert.equal(await points(), 1000);
ok('placement passes tier 1 and pays 1,000 points (1 DOGE)');

const qs = await call(p, 'warrior_questions_for', { p_level: 2 });
assert.equal(qs.length, 5); assert.ok(qs.every(q => !('answer' in q) && !('explain' in q)));
const miss = await call(p, 'warrior_submit_quiz', { p_level: 2, p_answers: { 1: '0', 2: '0', 3: '1', 4: '0', 5: 'seven' } });
assert.equal(miss.passed, false); assert.equal(miss.points_awarded, 0); assert.equal(await points(), 1000);
await assert.rejects(call(p, 'warrior_questions_for', { p_level: 3 }), /Pass the tier before/);
const pass2 = await call(p, 'warrior_submit_quiz', { p_level: 2, p_answers: { 1: '1', 2: '1', 3: '0', 4: '1', 5: 'You can have 4 long poles.' } });
assert.equal(pass2.score, 5); assert.equal(pass2.points_awarded, 4000);
const again = await call(p, 'warrior_submit_quiz', { p_level: 2, p_answers: { 1: '1', 2: '1', 3: '0', 4: '1', 5: 'four' } });
assert.equal(again.points_awarded, 0); assert.equal(await points(), 5000);
ok('tier 2 quiz: questions come without answers, a fail pays nothing, a pass pays 4,000 once, written "4 long poles" counts');

const g3 = await call(p, 'warrior_submit_games', { p_level: 3, p_results: ['loose', 'danger', 'pick', 'double', 'hold'].map((concept, i) => ({ concept, idea_id: `fake-${concept}`, grade: i < 3 ? 'perfect' : 'miss' })) });
assert.equal(g3.passed, true); assert.equal(g3.points_awarded, 15000);
await assert.rejects(call(p, 'warrior_submit_quiz', { p_level: 5, p_answers: {} }), /Pass the tier before/);
ok('tier 3 field games pass with 3 of 5 and pay 15,000; tier 5 stays locked until tier 4');

const t4 = await call(p, 'warrior_submit_quiz', { p_level: 4, p_answers: { 1: '1', 2: '0', 3: '2', 4: '2', 5: "The Creator's Game" } });
assert.equal(t4.score, 5);
const t5 = await call(p, 'warrior_submit_quiz', { p_level: 5, p_answers: { 1: '1', 2: '1', 3: '1', 4: 'Name, Image & Likeness', 5: 'box lacrosse' } });
assert.equal(t5.score, 5);
const half = await call(p, 'warrior_submit_quiz', { p_level: 5, p_answers: { 1: '1', 2: '1', 3: '1', 4: 'name and image', 5: 'field' } });
assert.equal(half.score, 3, '"name and image" misses likeness; "field" is not box');
const total = await points();
assert.equal(total, 100 * POINTS.perDoge);
const board = await call(p, 'warrior_board');
assert.ok(board.every(t => t.passed));
ok(`history and business quizzes pass; written answers need the right words; all five tiers total ${total.toLocaleString()} points = ${total / POINTS.perDoge} DOGE`);
console.log('\nWarrior Tests checks passed against', url);
