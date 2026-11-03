#!/usr/bin/env node
// LacrosseTube owner CLI. Run it yourself, on your own machine. It is the only place the owner
// key exists: encrypted with your passphrase in ~/.lacrossetube/owner-key.json (outside the repo).
// Nothing here prints, logs or sends the private key or the passphrase.
//
//   node scripts/owner.mjs init               make the owner key (once) and print its public key
//   node scripts/owner.mjs pubkey             print the public key
//   node scripts/owner.mjs pending            list team applications waiting for you
//   node scripts/owner.mjs verify <team-id>   verify one team, after you confirm its name
//
// pending and verify need SUPABASE_URL and SUPABASE_ANON_KEY (the public key) in the environment.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { newOwnerKey, openOwnerKey, signOwnerRequest } from './owner-lib.mjs';

const FILE = process.env.LT_OWNER_KEY_FILE || join(homedir(), '.lacrossetube', 'owner-key.json');
const [cmd, arg] = process.argv.slice(2);

function ask(question, { hidden = false } = {}) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = s => { if (s.startsWith(question)) rl.output.write(question); };
    rl.question(question, answer => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer); });
  });
}
const loadFile = () => {
  if (!existsSync(FILE)) throw new Error(`No owner key yet. Run: node scripts/owner.mjs init`);
  return JSON.parse(readFileSync(FILE, 'utf8'));
};
// Unlocks the owner key once for one command, then wipes it.
async function withOwnerKey(fn) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) throw new Error('Set SUPABASE_URL and SUPABASE_ANON_KEY (the public key) first.');
  const sk = openOwnerKey(loadFile(), await ask('Owner passphrase: ', { hidden: true }));
  try { return await fn(sk); } finally { sk.fill(0); }
}
async function call(sk, action, payload) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY;
  const body = signOwnerRequest(sk, action, payload);
  const r = await fetch(`${url}/functions/v1/owner-verify`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: key }, body: JSON.stringify(body) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error || `HTTP ${r.status}`);
  return out;
}

try {
  if (cmd === 'init') {
    if (existsSync(FILE)) throw new Error(`An owner key already exists at ${FILE}. It is never overwritten.`);
    const p1 = await ask('Choose an owner passphrase (12+ characters): ', { hidden: true });
    const p2 = await ask('Type it again: ', { hidden: true });
    if (p1 !== p2) throw new Error('The passphrases did not match.');
    const file = newOwnerKey(p1);
    mkdirSync(dirname(FILE), { recursive: true, mode: 0o700 });
    writeFileSync(FILE, JSON.stringify(file, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    console.log(`Owner key saved, encrypted, at ${FILE}. Back up that file and your passphrase; neither can be recovered.`);
    console.log(`Public key: ${file.pubkey}`);
    console.log(`Give the server the public key: npx supabase secrets set OWNER_PUBKEY=${file.pubkey}`);
  } else if (cmd === 'pubkey') {
    console.log(loadFile().pubkey);
  } else if (cmd === 'pending') {
    const { applications } = await withOwnerKey(sk => call(sk, 'list', {}));
    if (!applications.length) console.log('No team applications waiting.');
    for (const a of applications) console.log(`${a.org_id}  ${a.team}${a.city ? ` (${a.city})` : ''}  coach ${a.coach}${a.email ? ` <${a.email}>` : ''}  applied ${a.applied.slice(0, 10)}`);
  } else if (cmd === 'verify') {
    if (!/^[0-9a-f-]{36}$/.test(String(arg))) throw new Error('Give the team id from `pending`.');
    await withOwnerKey(async sk => {
      const { applications } = await call(sk, 'list', {});
      const app = applications.find(a => a.org_id === arg);
      if (!app) throw new Error('That team is not waiting for verification.');
      const yes = await ask(`Verify "${app.team}"${app.city ? ` (${app.city})` : ''}, coach ${app.coach}? Type yes: `);
      if (yes.trim().toLowerCase() !== 'yes') throw new Error('Not verified.');
      const { verified } = await call(sk, 'verify_org', { org_id: arg });
      console.log(`Verified: ${verified}. The coach can add players now.`);
    });
  } else {
    console.log('Usage: node scripts/owner.mjs init | pubkey | pending | verify <team-id>');
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
