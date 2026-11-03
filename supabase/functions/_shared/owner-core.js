// Owner-signed requests. The owner's private key lives only in the owner CLI on the owner's own
// machine (scripts/owner.mjs). The server knows only OWNER_PUBKEY. A request signs
// `lacrossetube-owner:<action>:<payload JSON>:<ts>`, so a signature cannot be replayed for another
// action or team, and it expires after five minutes.
export const OWNER_TTL_MS = 5 * 60 * 1000;
const te = new TextEncoder();
const HEX64 = /^[0-9a-f]{64}$/, HEX128 = /^[0-9a-f]{128}$/;
const unhex = s => Uint8Array.from(s.match(/../g), h => parseInt(h, 16));

export const ownerMessage = (action, payload, ts, sha256) =>
  sha256(te.encode(`lacrossetube-owner:${action}:${JSON.stringify(payload)}:${ts}`));

// Returns null when the request is good, or the reason it is not.
export function checkOwnerRequest({ action, payload, ts, sig }, { ownerPubkey, schnorr, sha256, now = Date.now() }) {
  if (!HEX64.test(String(ownerPubkey))) return 'The server has no owner key set.';
  if (!Number.isSafeInteger(ts) || Math.abs(now - ts) > OWNER_TTL_MS) return 'This request is too old or from the future. Check the clock and sign again.';
  if (!HEX128.test(String(sig))) return 'Bad signature.';
  try {
    return schnorr.verify(unhex(sig), ownerMessage(action, payload, ts, sha256), unhex(ownerPubkey)) ? null : 'This was not signed by the owner key.';
  } catch { return 'Bad signature.'; }
}
