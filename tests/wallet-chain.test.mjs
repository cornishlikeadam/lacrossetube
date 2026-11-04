// Phase 3: the redeem function's chain transfers (_shared/wallet-core.js) against the real
// migrated database (tests/db/pg.mjs) and a fake DogeOS chain that records every transfer.
// Covers redeem, sending to a teammate, giving to a team pool at the team address, session payouts
// that stay site balance until the team address holds testnet DOGE and then leave from it, failed
// transfers that give the points back, and "not configured" until both secrets are set.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { available, startDb } from './db/pg.mjs';
import { CHAIN, POINTS, pointsToWei, txUrl } from '../supabase/functions/_shared/chain.js';
import { addressFromSecret } from '../supabase/functions/_shared/evm.js';
import { teamSecret } from '../supabase/functions/_shared/team-key.js';
import { walletAction, WalletError } from '../supabase/functions/_shared/wallet-core.js';

const skip = available ? false : 'no local Postgres server binaries (initdb) on this machine';
const deps = { secp256k1, keccak: keccak_256 };
const addressOf = sk => addressFromSecret(sk, deps);
const hex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
let db;
before(async () => { if (!skip) db = await startDb(); });
after(async () => { await db?.stop(); });

// Supabase client stand-ins: the service client runs as the database owner; the user client as the person.
const wrap = async f => { try { return { data: await f(), error: null }; } catch (e) { return { data: null, error: { message: e.message, code: e.code } }; } };
const named = args => { const k = Object.keys(args); return [k.map((x, i) => `${x} => $${i + 1}`).join(', '), k.map(x => args[x])]; };
const service = () => ({
  rpc: (name, args = {}) => wrap(async () => { const [a, v] = named(args); return (await db.sql(`select public.${name}(${a}) as v`, v))[0].v; }),
  from: table => {
    const q = { cols: '*', where: [] };
    const b = { select(c) { q.cols = c; return b; }, eq(c, v) { q.where.push([c, v]); return b; },
      maybeSingle: () => wrap(async () => (await db.sql(`select ${q.cols} from public.${table}${q.where.length ? ` where ${q.where.map(([c], i) => `${c} = $${i + 1}`).join(' and ')}` : ''}`, q.where.map(w => w[1])))[0] ?? null) };
    return b;
  },
});
const userClient = p => ({ rpc: (name, args = {}) => wrap(() => db.call(p, name, args)) });

const treasurySk = secp256k1.utils.randomSecretKey();
const treasury = { address: addressOf(treasurySk), account: { address: addressOf(treasurySk) } };
const teamAccount = org => { const a = addressOf(teamSecret(treasurySk, org, { hmac, sha256, secp256k1 })); return { address: a, account: { address: a } }; };
function fakeChain() {
  const c = { sends: [], fail: null, balances: new Map(), gas: 21000n * 10n ** 9n * 2n };
  c.send = async (account, to, wei) => { if (c.fail) throw new Error(`${c.fail}\nDetails: from the RPC`); c.sends.push({ from: account.address, to, wei }); return '0x' + hex(32); };
  c.balance = async a => c.balances.get(a.toLowerCase()) ?? 0n;
  c.gasCost = async () => c.gas;
  return c;
}
const act = (p, body, chain, configured = true) => walletAction(body, { CHAIN, POINTS, pointsToWei, txUrl, configured, treasury: configured ? treasury : null, db: service(), user: userClient(p), chain, teamAccount });
const balance = async p => (await db.call(p, 'wallet_home')).points;
const give = (p, points) => db.sql(`insert into public.warrior_progress (person_id, level, best_score, attempts, passed_at, points) values ($1, 2, 5, 1, now(), $2)`, [p.id, points]);
const withAddress = async p => { const sk = secp256k1.utils.randomSecretKey(); p.address = addressOf(sk); await db.sql(`insert into public.keys (pubkey, person_id, evm_address) values ($1, $2, $3)`, [hex(32), p.id, p.address]); return p; };
const fails = (status, re) => e => { assert.ok(e instanceof WalletError, e.message); assert.equal(e.status, status, e.message); assert.match(e.message, re); return true; };

test('team keys: one per team, derived on the server from the treasury key, never the coach\'s wallet', () => {
  const org = crypto.randomUUID(), other = crypto.randomUUID();
  const a = teamSecret(treasurySk, org, { hmac, sha256, secp256k1 });
  assert.deepEqual(a, teamSecret(treasurySk, org, { hmac, sha256, secp256k1 }), 'the same team always gets the same address');
  assert.notDeepEqual(a, teamSecret(treasurySk, other, { hmac, sha256, secp256k1 }));
  assert.notDeepEqual(a, teamSecret(secp256k1.utils.randomSecretKey(), org, { hmac, sha256, secp256k1 }));
  assert.ok(secp256k1.utils.isValidSecretKey(a));
  assert.notEqual(addressOf(a), treasury.address);
  assert.throws(() => teamSecret(treasurySk, 'not-a-team', { hmac, sha256, secp256k1 }), /Bad team id/);
});

test('until both secrets are set, every chain action says "not configured" and nothing changes', { skip }, async () => {
  const t = await db.team(), p = await withAddress(await db.player(t));
  await give(p, 1000);
  const chain = fakeChain();
  const st = await act(p, { action: 'status' }, chain, false);
  assert.equal(st.configured, false); assert.equal(st.treasury, null); assert.equal(st.chain.id, 6281971);
  for (const body of [{ action: 'redeem' }, { action: 'send', to: crypto.randomUUID(), points: 1 }, { action: 'donate', org: t.org, points: 1 }]) {
    await assert.rejects(act(p, body, chain, false), fails(503, /not configured/));
  }
  assert.equal(chain.sends.length, 0); assert.equal(await balance(p), 1000);
});

test('redeem sends testnet DOGE to the person\'s address with a receipt; a failed transfer gives the points back', { skip }, async () => {
  const t = await db.team(), p = await withAddress(await db.player(t));
  await give(p, 1250);
  const chain = fakeChain();
  chain.fail = 'insufficient funds for gas * price + value';
  await assert.rejects(act(p, { action: 'redeem' }, chain), fails(502, /points are back.*faucet/));
  assert.equal(await balance(p), 1250);
  assert.equal((await db.call(p, 'team_home')).wallet.receipts[0].status, 'failed');
  chain.fail = null;
  const { receipt } = await act(p, { action: 'redeem' }, chain);
  assert.equal(receipt.points, 1200); assert.equal(receipt.to_address, p.address);
  assert.equal(receipt.explorer, `https://dogeos-testnet.l2scan.co/tx/${receipt.tx_hash}`);
  assert.deepEqual(chain.sends, [{ from: treasury.address, to: p.address, wei: 12n * 10n ** 17n }]);
  assert.equal(await balance(p), 50);
  const [row] = await db.sql(`select status, tx_hash from public.point_redemptions where id = $1`, [receipt.id]);
  assert.deepEqual(row, { status: 'sent', tx_hash: receipt.tx_hash });
});

test('sending to a teammate is a testnet DOGE transfer to their address, with the tx hash on the receipt', { skip }, async () => {
  const t = await db.team(), a = await withAddress(await db.player(t, 'Riley')), b = await withAddress(await db.player(t, 'Morgan'));
  const stranger = await withAddress(await db.player(await db.team(), 'Sky')), noKey = await db.player(t, 'Jamie');
  await give(a, 1000);
  const chain = fakeChain();
  const { transfer } = await act(a, { action: 'send', to: b.id, points: 400, note: 'gas' }, chain);
  assert.equal(transfer.status, 'sent'); assert.equal(transfer.settle, 'chain'); assert.equal(transfer.to_address, b.address);
  assert.match(transfer.explorer, /^https:\/\/dogeos-testnet\.l2scan\.co\/tx\/0x[0-9a-f]{64}$/);
  assert.deepEqual(chain.sends.at(-1), { from: treasury.address, to: b.address, wei: pointsToWei(400) });
  assert.equal(await balance(a), 600);
  assert.equal(await balance(b), 0, 'the teammate got DOGE at their address, not site points');
  const row = (await db.call(a, 'wallet_home')).activity.find(x => x.id === transfer.id);
  assert.equal(row.tx_hash, transfer.tx_hash); assert.equal(row.status, 'sent');
  chain.fail = 'nonce too low';
  await assert.rejects(act(a, { action: 'send', to: b.id, points: 100 }, chain), fails(502, /points are back/));
  assert.equal(await balance(a), 600, 'a failed transfer does not burn the points');
  chain.fail = null;
  await assert.rejects(act(a, { action: 'send', to: stranger.id, points: 1 }, chain), fails(403, /only to a teammate/));
  await assert.rejects(act(a, { action: 'send', to: noKey.id, points: 1 }, chain), fails(400, /no wallet address yet/));
  await assert.rejects(act(a, { action: 'send', to: b.id, points: 10000 }, chain), fails(400, /You have 600 points/));
});

test('a donation lands at the team address, which is separate from the coach\'s wallet', { skip }, async () => {
  const t = await db.team(), coach = await withAddress(t.coach), fan = await withAddress(await db.player(await db.team(), 'Fan'));
  await give(fan, 2000);
  const chain = fakeChain();
  const { transfer } = await act(fan, { action: 'donate', org: t.org, points: 1500, note: 'go' }, chain);
  const team = teamAccount(t.org);
  assert.equal(transfer.to_address, team.address); assert.notEqual(team.address, coach.address);
  assert.deepEqual(chain.sends.at(-1), { from: treasury.address, to: team.address, wei: pointsToWei(1500) });
  const [{ evm_address }] = await db.sql(`select evm_address from public.orgs where id = $1`, [t.org]);
  assert.equal(evm_address, team.address, 'the team address is recorded on the team');
  assert.equal(await balance(fan), 500);
  const view = await db.call(t.coach, 'payouts_for_coach', { p_org: t.org });
  assert.equal(view.pool, 0, 'chain donations are on the team address, not in the points pool');
  assert.equal(view.address, team.address); assert.equal(view.donations[0].tx_hash, transfer.tx_hash);
  const info = await act(fan, { action: 'team', org: t.org }, chain);
  assert.equal(info.address, team.address);
});

test('session payouts stay site balance until the team address holds testnet DOGE, then leave from it', { skip }, async () => {
  const t = await db.team(), p = await withAddress(await db.player(t, 'Riley')), donor = await db.player(t, 'Morgan');
  await give(donor, 5000);
  await db.call(donor, 'team_donate', { p_org: t.org, p_points: 1000 });
  const chain = fakeChain();
  const make = () => db.call(t.coach, 'payout_create', { p_org: t.org, p_link: 'https://x.vercel.app/play#t=zz', p_wcs_id: 'abc12345', p_label: '', p_condition: 'present' });
  const D1 = await make(), D2 = await make();
  await assert.rejects(act(p, { action: 'claim', payout: D1 }, chain), fails(400, /not marked you present/));
  await db.call(t.coach, 'payout_mark', { p_payout: D1, p_person: p.id, p_present: true });
  const site = (await act(p, { action: 'claim', payout: D1 }, chain)).transfer;
  assert.equal(site.settle, 'site'); assert.equal(site.points, POINTS.payout.present);
  assert.equal(chain.sends.length, 0, 'an empty team address pays from the points pool');
  assert.equal((await db.call(t.coach, 'payouts_for_coach', { p_org: t.org })).pool, 1000 - POINTS.payout.present);

  const team = teamAccount(t.org);
  chain.balances.set(team.address.toLowerCase(), pointsToWei(POINTS.payout.present) + chain.gas);
  await db.call(t.coach, 'payout_mark', { p_payout: D2, p_person: p.id, p_present: true });
  chain.fail = 'execution reverted';
  await assert.rejects(act(p, { action: 'claim', payout: D2 }, chain), fails(502, /Nothing was taken; confirm again/));
  chain.fail = null;
  const before = await balance(p);
  const onChain = (await act(p, { action: 'claim', payout: D2 }, chain)).transfer;
  assert.equal(onChain.settle, 'chain'); assert.equal(onChain.status, 'sent'); assert.equal(onChain.to_address, p.address);
  assert.deepEqual(chain.sends.at(-1), { from: team.address, to: p.address, wei: pointsToWei(POINTS.payout.present) });
  assert.equal(await balance(p), before, 'a chain payout lands as DOGE at the player\'s address');
  assert.equal((await db.call(t.coach, 'payouts_for_coach', { p_org: t.org })).pool, 1000 - POINTS.payout.present, 'and the points pool is untouched');
  await assert.rejects(act(p, { action: 'claim', payout: D2 }, chain), fails(400, /already confirmed/));
  const mine = (await db.call(p, 'payouts_for_me')).find(x => x.id === D2);
  assert.equal(mine.claim.tx_hash, onChain.tx_hash);
});
