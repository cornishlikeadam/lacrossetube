// The team address (Phase 3). Each approved team has its own DogeOS address, separate from the
// coach's personal wallet. Its key is never stored and never leaves the server: the redeem Edge
// Function derives it from the treasury key and the team id, HMAC-SHA256(treasury key,
// "lacrossetube team wallet v1:<team id>:<n>") for the first n that gives a valid secp256k1 key.
// Replacing TREASURY_PRIVATE_KEY therefore also moves every team to a new address, and DOGE on
// the old ones stays there: scripts/treasury.mjs refuses to replace it without --replace.
// Callers pass in @noble's hmac, sha256 and secp256k1.
const te = new TextEncoder();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function teamSecret(treasurySk, orgId, { hmac, sha256, secp256k1 }) {
  if (!(treasurySk instanceof Uint8Array) || treasurySk.length !== 32) throw new Error('The treasury key must be 32 bytes.');
  if (!UUID.test(String(orgId))) throw new Error('Bad team id.');
  for (let n = 0; n < 16; n++) {
    const sk = hmac(sha256, treasurySk, te.encode(`lacrossetube team wallet v1:${orgId}:${n}`));
    if (secp256k1.utils.isValidSecretKey(sk)) return sk;
  }
  throw new Error('Could not derive a team key.');
}
