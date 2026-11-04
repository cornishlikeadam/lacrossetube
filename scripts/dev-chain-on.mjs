#!/usr/bin/env node
// One command to bring the lacrossetube-dev Supabase project up to this branch and switch the
// testnet chain on. Run it on the operator machine, from the repo:
//   node scripts/dev-chain-on.mjs
// It does, in order (each step is skipped when already done):
//   1. signs the Supabase CLI in (opens the browser) if it is not signed in;
//   2. links lacrossetube-dev (xeildwwpwfgficrqziph), using SUPABASE_DB_PASSWORD from the
//      environment or supabase/.env.hosted when present;
//   3. pushes the migrations (Phase 2) and deploys key-login, owner-verify and redeem;
//   4. makes the treasury key if the project has none (stored only as TREASURY_PRIVATE_KEY);
//   5. sets DOGEOS_CLIENT_ID if missing: your Sandbox client ID from https://console.dogeos.com/,
//      from --client-id=<id>, the DOGEOS_CLIENT_ID environment variable, or a prompt;
//   6. prints the treasury address, its testnet balance, and the faucet link.
// It never prints a private key. lacrossetube-dev only; production is never touched.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { CHAIN, addressUrl, formatDoge } from '../supabase/functions/_shared/chain.js';
import { secretNames, setSecrets, makeTreasury } from './treasury.mjs';

const REF = 'xeildwwpwfgficrqziph', URL_ = `https://${REF}.supabase.co`;
const root = new URL('..', import.meta.url).pathname;
const step = m => console.log(`\n▶ ${m}`);
const sb = (args, opts = {}) => spawnSync('npx', ['supabase', ...args], { cwd: root, stdio: 'inherit', ...opts });
const quiet = args => spawnSync('npx', ['supabase', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const must = (r, what) => { if (r.status !== 0) { console.error(`\n${what} did not finish. Fix the message above and run this again; finished steps are skipped.`); process.exit(1); } };

step('Supabase CLI sign-in');
if (quiet(['projects', 'list', '-o', 'json']).status !== 0) {
  console.log('Not signed in. Opening the Supabase sign-in…');
  must(sb(['login']), 'Sign-in');
}
const projects = quiet(['projects', 'list', '-o', 'json']);
if (!projects.stdout.includes(REF)) { console.error(`This Supabase account cannot see lacrossetube-dev (${REF}). Sign in with the account that owns it.`); process.exit(1); }
console.log('Signed in; lacrossetube-dev is visible.');

step('Link lacrossetube-dev');
// The CLI reads SUPABASE_DB_PASSWORD from the environment, so it never appears in a command line.
if (!process.env.SUPABASE_DB_PASSWORD && existsSync(`${root}supabase/.env.hosted`)) process.loadEnvFile(`${root}supabase/.env.hosted`);
must(sb(['link', '--project-ref', REF]), 'Linking');

step('Push the database migrations');
must(sb(['db', 'push', '--linked', '--yes']), 'The migration push');

step('Deploy the Edge Functions');
must(sb(['functions', 'deploy', 'key-login', 'owner-verify', 'redeem', '--project-ref', REF, '--use-api']), 'The function deploy');

step('Chain secrets');
const names = secretNames(REF);
let treasury = null;
if (!names.includes('TREASURY_PRIVATE_KEY')) {
  treasury = makeTreasury({ ref: REF });
  console.log('Made the treasury key and stored it only as TREASURY_PRIVATE_KEY.');
} else console.log('TREASURY_PRIVATE_KEY is already set (kept: team addresses come from it).');
if (!names.includes('DOGEOS_CLIENT_ID')) {
  let id = process.argv.find(a => a.startsWith('--client-id='))?.slice(12) || process.env.DOGEOS_CLIENT_ID;
  if (!id) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    id = (await rl.question('Paste your DogeOS Sandbox client ID (https://console.dogeos.com/): ')).trim();
    rl.close();
  }
  if (!/^[A-Za-z0-9._:-]{4,200}$/.test(id || '')) { console.error('That does not look like a client ID. Run this again with --client-id=<id>.'); process.exit(1); }
  setSecrets({ DOGEOS_CLIENT_ID: id }, REF);
  console.log('Set DOGEOS_CLIENT_ID.');
} else console.log('DOGEOS_CLIENT_ID is already set.');

step('Treasury');
if (!treasury) {
  // The key stays secret; ask the redeem function for the address it uses.
  try {
    const keys = JSON.parse(execFileSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', REF, '-o', 'json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    const anon = keys.find(k => k.name === 'anon')?.api_key;
    const r = await fetch(`${URL_}/functions/v1/redeem`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: anon, authorization: `Bearer ${anon}` }, body: JSON.stringify({ action: 'status' }) });
    const s = await r.json();
    treasury = s.treasury;
    console.log(`Redeem reports configured: ${s.configured}`);
  } catch { /* shown below */ }
}
if (!treasury) console.log('Could not read the treasury address. Open the preview wallet: it shows when redeem is configured.');
else {
  console.log(`Treasury address: ${treasury}\n  ${addressUrl(treasury)}`);
  try {
    const r = await fetch(CHAIN.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [treasury, 'latest'] }) });
    const wei = BigInt((await r.json()).result);
    console.log(`Balance: ${formatDoge(wei)}`);
    if (wei === 0n) console.log(`Fund it with testnet DOGE (the faucet asks a person to claim, once a day): ${CHAIN.faucet}`);
  } catch { console.log(`Could not read the balance. Fund it from ${CHAIN.faucet}`); }
}
console.log('\nDone. The preview uses lacrossetube-dev; production was not touched.');
