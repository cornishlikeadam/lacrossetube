// The DogeOS (EVM) address of a LacrosseTube key. The login key is secp256k1; its 0x address is the
// last 20 bytes of keccak-256 over the uncompressed public key, written with the EIP-55 checksum.
// The server only knows the key's x-only (BIP-340) public key, so it checks a claimed address
// against the two points with that x. Callers pass in @noble's secp256k1 and keccak_256.
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const te = new TextEncoder();

export function checksum(address, keccak) {
  const lower = address.toLowerCase().replace(/^0x/, ''), h = hex(keccak(te.encode(lower)));
  return '0x' + [...lower].map((c, i) => (parseInt(h[i], 16) >= 8 ? c.toUpperCase() : c)).join('');
}
const fromUncompressed = (pub65, keccak) => checksum('0x' + hex(keccak(pub65.slice(1))).slice(-40), keccak);

export const addressFromSecret = (sk, { secp256k1, keccak }) => fromUncompressed(secp256k1.getPublicKey(sk, false), keccak);

export function addressesForXOnly(xOnlyHex, { secp256k1, keccak }) {
  const even = secp256k1.Point.fromHex('02' + xOnlyHex);
  return [even, even.negate()].map(p => fromUncompressed(p.toBytes(false), keccak));
}

export const isAddress = a => /^0x[0-9a-fA-F]{40}$/.test(String(a));
export const sameAddress = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
