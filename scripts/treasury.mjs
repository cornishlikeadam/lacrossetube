#!/usr/bin/env node
// Testnet treasury for redeeming points (DogeOS Chikyū Testnet). Run it yourself, once:
//   node scripts/treasury.mjs init
// It makes a new key, stores it ONLY as the TREASURY_PRIVATE_KEY secret on the linked Supabase
// project (never printed, never written to the repo), and prints the treasury address to fund
// from the faucet. Redeem also needs DOGEOS_CLIENT_ID (your Sandbox client ID from
// https://console.dogeos.com/):  npx supabase secrets set DOGEOS_CLIENT_ID=<id>
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/curves/utils.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { addressFromSecret } from '../supabase/functions/_shared/evm.js';
import { CHAIN, addressUrl } from '../supabase/functions/_shared/chain.js';

if (process.argv[2] !== 'init') { console.log('Usage: node scripts/treasury.mjs init'); process.exit(0); }
if (!CHAIN.testnet) { console.error('This script only makes testnet treasuries.'); process.exit(1); }
const sk = secp256k1.utils.randomSecretKey(), address = addressFromSecret(sk, { secp256k1, keccak: keccak_256 });
const dir = mkdtempSync(join(tmpdir(), 'lt-treasury-')), file = join(dir, 'secret.env');
try {
  writeFileSync(file, `TREASURY_PRIVATE_KEY=0x${bytesToHex(sk)}\n`, { mode: 0o600 });
  execFileSync('npx', ['supabase', 'secrets', 'set', '--env-file', file], { stdio: ['ignore', 'ignore', 'inherit'] });
} finally { sk.fill(0); rmSync(dir, { recursive: true, force: true }); }
console.log(`Treasury key stored as the TREASURY_PRIVATE_KEY secret. It is not saved anywhere else; running init again replaces it.`);
console.log(`Treasury address: ${address}\n  ${addressUrl(address)}`);
console.log(`Fund it with testnet DOGE: ${CHAIN.faucet}`);
