// OpenTimestamps verification with no OpenTimestamps library: parse the .ots proof, replay its
// hash operations from the file's digest, and compare each Bitcoin attestation's result with that
// block's merkle root from a public Esplora block explorer (Blockstream, then mempool.space).
// A proof whose only attestations are calendar promises is reported as pending.
import { sha256 } from '@noble/hashes/sha2.js';
import { sha1, ripemd160 } from '@noble/hashes/legacy.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const MAGIC = Uint8Array.from([0x00, ...new TextEncoder().encode('OpenTimestamps'), 0x00, 0x00, ...new TextEncoder().encode('Proof'), 0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94]);
const BITCOIN = '0588960d73d71901', PENDING = '83dfe30d2ef90c8e';
const HASHES = { 0x08: ['sha256', sha256, 32], 0x02: ['sha1', sha1, 20], 0x03: ['ripemd160', ripemd160, 20], 0x67: ['keccak256', keccak_256, 32] };
const MAX_DEPTH = 256, MAX_BYTES = 4096;
const td = new TextDecoder();
const concat = (a, b) => { const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out; };

function reader(bytes) {
  let i = 0;
  const need = n => { if (i + n > bytes.length) throw new Error('The proof ends early.'); };
  const r = {
    byte() { need(1); return bytes[i++]; },
    bytes(n) { need(n); return bytes.slice(i, (i += n)); },
    varuint() { let v = 0, shift = 0, b; do { b = r.byte(); v += (b & 0x7f) * 2 ** shift; shift += 7; if (shift > 63) throw new Error('Bad number in the proof.'); } while (b & 0x80); return v; },
    varbytes(max = MAX_BYTES) { const n = r.varuint(); if (n > max) throw new Error('A field in the proof is too long.'); return r.bytes(n); },
    done: () => i === bytes.length,
  };
  return r;
}

function attestation(r) {
  const tag = bytesToHex(r.bytes(8)), payload = reader(r.varbytes());
  if (tag === BITCOIN) return { kind: 'bitcoin', height: payload.varuint() };
  if (tag === PENDING) return { kind: 'pending', uri: td.decode(payload.varbytes(1000)) };
  return { kind: 'unknown', tag };
}

function apply(tag, r, msg) {
  if (HASHES[tag]) return HASHES[tag][1](msg);
  if (tag === 0xf0) return concat(msg, r.varbytes());
  if (tag === 0xf1) return concat(r.varbytes(), msg);
  if (tag === 0xf2) return msg.slice().reverse();
  if (tag === 0xf3) return new TextEncoder().encode(bytesToHex(msg));
  throw new Error(`Unknown operation 0x${tag.toString(16)} in the proof.`);
}

// Walks the timestamp tree from `msg`, collecting every attestation with the message it commits.
function walk(r, msg, found, depth = 0) {
  if (depth > MAX_DEPTH) throw new Error('The proof is nested too deeply.');
  const step = tag => {
    if (tag === 0x00) found.push({ ...attestation(r), digest: bytesToHex(msg) });
    else walk(r, apply(tag, r, msg), found, depth + 1);
  };
  let tag = r.byte();
  while (tag === 0xff) { step(r.byte()); tag = r.byte(); }
  step(tag);
}

// Parses an .ots file. Returns { hashOp, fileDigest, attestations: [{ kind, height|uri, digest }] }.
export function parseProof(bytes) {
  const r = reader(bytes);
  if (bytesToHex(r.bytes(MAGIC.length)) !== bytesToHex(MAGIC)) throw new Error('This is not an OpenTimestamps proof.');
  if (r.varuint() !== 1) throw new Error('Unsupported proof version.');
  const op = HASHES[r.byte()];
  if (!op) throw new Error('Unsupported file hash in the proof.');
  const fileDigest = r.bytes(op[2]), attestations = [];
  walk(r, fileDigest, attestations);
  if (!r.done()) throw new Error('The proof has trailing bytes.');
  return { hashOp: op[0], fileDigest: bytesToHex(fileDigest), attestations };
}

export const EXPLORERS = ['https://blockstream.info/api', 'https://mempool.space/api'];

async function blockAt(height, apis, fetchImpl) {
  let last;
  for (const api of apis) {
    try {
      const get = path => fetchImpl(`${api}${path}`, { signal: AbortSignal.timeout(10000) });
      const hash = (await (await get(`/block-height/${height}`)).text()).trim();
      if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`No block at height ${height}.`);
      const block = await (await get(`/block/${hash}`)).json();
      return { hash, merkleRoot: block.merkle_root, time: block.timestamp, api };
    } catch (e) { last = e; }
  }
  throw new Error(`Could not read block ${height} from ${apis.join(' or ')}: ${last?.message}`);
}
const reverseHex = h => h.match(/../g).reverse().join('');

// Verifies a proof against the stamped file's bytes.
// Returns { status: 'verified' | 'pending' | 'mismatch' | 'failed', ... }.
export async function verifyProof(fileBytes, proofBytes, { apis = EXPLORERS, fetchImpl = fetch } = {}) {
  const proof = parseProof(proofBytes);
  const digest = bytesToHex(HASHES[Object.keys(HASHES).find(k => HASHES[k][0] === proof.hashOp)][1](fileBytes));
  if (digest !== proof.fileDigest) return { status: 'mismatch', detail: 'This proof is for a different file.', fileDigest: digest, proofDigest: proof.fileDigest };
  const checked = [];
  for (const a of proof.attestations.filter(x => x.kind === 'bitcoin')) {
    const block = await blockAt(a.height, apis, fetchImpl);
    const ok = reverseHex(block.merkleRoot) === a.digest;
    checked.push({ height: a.height, block: block.hash, ok, time: new Date(block.time * 1000).toISOString() });
    if (ok) return { status: 'verified', height: a.height, block: block.hash, time: new Date(block.time * 1000).toISOString(), checked };
  }
  if (checked.length) return { status: 'failed', detail: 'No Bitcoin attestation matched its block.', checked };
  const pending = proof.attestations.filter(x => x.kind === 'pending').map(x => x.uri);
  return { status: 'pending', detail: 'Not in a Bitcoin block yet. Run `ots upgrade` on the proof later.', calendars: pending };
}
