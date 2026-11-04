#!/usr/bin/env node
// Testnet treasury for redeeming points (DogeOS Chikyū Testnet). Run it yourself, once:
//   node scripts/treasury.mjs init [--project-ref <ref>] [--replace]
// It makes a new key, stores it ONLY as the TREASURY_PRIVATE_KEY secret on the Supabase project
// (never printed, never written to the repo), and prints the treasury address to fund from the
// faucet. Redeem also needs DOGEOS_CLIENT_ID (your Sandbox client ID from
// https://console.dogeos.com/):  npx supabase secrets set DOGEOS_CLIENT_ID=<id>
// Team addresses are derived from the treasury key (_shared/team-key.js), so replacing it moves
// every team to a new address and strands DOGE on the old ones. init refuses to replace an
// existing key unless you pass --replace.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/curves/utils.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { addressFromSecret } from '../supabase/functions/_shared/evm.js';
import { CHAIN, addressUrl } from '../supabase/functions/_shared/chain.js';

const refArgs = ref => (ref ? ['--project-ref', ref] : []);

// The names of the secrets set on the project (values are never shown by Supabase).
export function secretNames(ref) {
  const out = execFileSync('npx', ['supabase', 'secrets', 'list', ...refArgs(ref), '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  try { return JSON.parse(out).map(s => s.name ?? s.Name).filter(Boolean); } catch { return [...out.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)].map(m => m[1]); }
}

// Sets secrets from a private temp file, so values never appear in a command line or the terminal.
export function setSecrets(values, ref) {
  const dir = mkdtempSync(join(tmpdir(), 'lt-secret-')), file = join(dir, 'secret.env');
  try {
    writeFileSync(file, Object.entries(values).map(([k, v]) => `${k}=${v}\n`).join(''), { mode: 0o600 });
    execFileSync('npx', ['supabase', 'secrets', 'set', ...refArgs(ref), '--env-file', file], { stdio: ['ignore', 'ignore', 'inherit'] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// Makes the treasury key, stores it as the secret, returns only the address.
export function makeTreasury({ ref, replace = false } = {}) {
  if (!CHAIN.testnet) throw new Error('This script only makes testnet treasuries.');
  if (!replace && secretNames(ref).includes('TREASURY_PRIVATE_KEY')) {
    throw new Error('TREASURY_PRIVATE_KEY is already set. Team addresses come from it: replacing it moves every team to a new address and strands DOGE on the old ones. Pass --replace to replace it anyway.');
  }
  const sk = secp256k1.utils.randomSecretKey(), address = addressFromSecret(sk, { secp256k1, keccak: keccak_256 });
  try { setSecrets({ TREASURY_PRIVATE_KEY: `0x${bytesToHex(sk)}` }, ref); } finally { sk.fill(0); }
  return address;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args[0] !== 'init') { console.log('Usage: node scripts/treasury.mjs init [--project-ref <ref>] [--replace]'); process.exit(0); }
  const at = args.indexOf('--project-ref');
  try {
    const address = makeTreasury({ ref: at > 0 ? args[at + 1] : undefined, replace: args.includes('--replace') });
    console.log('Treasury key stored as the TREASURY_PRIVATE_KEY secret. It is not saved anywhere else.');
    console.log(`Treasury address: ${address}\n  ${addressUrl(address)}`);
    console.log(`Fund it with testnet DOGE: ${CHAIN.faucet}`);
  } catch (e) { console.error(e.message); process.exit(1); }
}
