// Every chain transfer, for the redeem Edge Function (index.ts wires in Supabase and the chain).
// DogeOS Chikyū Testnet only (chain.js). Actions, each by a signed-in person:
//   status                      -> { configured, chain, treasury, perDoge, minRedeem }
//   redeem                      -> points to testnet DOGE at the person's current address
//   send   { to, points, note } -> points to a teammate as testnet DOGE at the teammate's address
//   donate { org, points, note }-> points into a team's pool as testnet DOGE at the team address
//   claim  { payout }           -> a session payout: from the team address when it holds enough
//                                  testnet DOGE, otherwise from the team's points pool
//   team   { org }              -> the team address (recorded on the team) and its balance
// Each transfer is reserved in the database first (the points are held, or the payout is checked
// and claimed), then sent, then finished with the tx hash. A failed transfer finishes as failed,
// and failed rows never count: the points come back, and a payout can be confirmed again.
// Until DOGEOS_CLIENT_ID and TREASURY_PRIVATE_KEY are both set, every action but status answers
// "not configured" and the browser keeps using site balance.
export class WalletError extends Error { constructor(message, status = 400, extra = {}) { super(message); this.status = status; this.extra = extra; } }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const firstLine = e => String(e?.shortMessage || e?.message || 'transfer failed').split('\n')[0];
const fundsHint = msg => (/insufficient funds|exceeds the balance|gas required exceeds/i.test(msg) ? ' The treasury needs testnet DOGE from the faucet.' : '');

// deps: { CHAIN, POINTS, pointsToWei, txUrl, configured, treasury: { address, account },
//   db (service client: rpc, from), user (this caller's client: rpc), chain: { send(account, to, wei) -> hash,
//   balance(address) -> bigint, gasCost() -> bigint }, teamAccount(orgId) -> { address, account } }
export async function walletAction(body, deps) {
  const { CHAIN, POINTS, pointsToWei, txUrl, configured, treasury, db, user, chain, teamAccount } = deps;
  const status = { configured, chain: { id: CHAIN.id, name: CHAIN.name }, treasury: treasury?.address ?? null, perDoge: POINTS.perDoge, minRedeem: POINTS.minRedeem };
  const action = String(body?.action ?? '');
  if (action === 'status') return status;
  if (!['redeem', 'send', 'donate', 'claim', 'team'].includes(action)) throw new WalletError('Unknown action.');
  if (!configured) throw new WalletError('Redeem is not configured.', 503, status);

  const rpc = async (client, name, args) => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new WalletError(error.message, error.code === '42501' ? 403 : 400);
    return data;
  };
  const { data: home, error: homeErr } = await user.rpc('team_home');
  if (homeErr || !home) throw new WalletError('Sign in again first.', 401);
  const me = home.person.id;
  const allowed = await rpc(db, 'rate_limit_hit', { p_bucket: `person:${me}:chain`, p_max: 30, p_window_seconds: 3600 });
  if (allowed === false) throw new WalletError('Too many transfers this hour. Try again later.', 429);
  const points = n => { const v = Number(n); if (!Number.isInteger(v) || v < 1 || v > 1000000) throw new WalletError('Give a whole number of points from 1 to 1,000,000.'); return v; };
  const teamOf = async org => {
    if (!UUID.test(String(org))) throw new WalletError('Give the team.');
    const { data: o } = await db.from('orgs').select('id, name, verified_at, evm_address').eq('id', org).maybeSingle();
    if (!o?.verified_at) throw new WalletError('That team is not approved.');
    const t = teamAccount(o.id);
    if (!o.evm_address) await rpc(db, 'org_set_address', { p_org: o.id, p_address: t.address });
    else if (o.evm_address.toLowerCase() !== t.address.toLowerCase()) throw new WalletError('This team\'s address does not match the server key. Ask the owner.', 409);
    return { ...t, name: o.name };
  };
  // Reserve, send, finish. A failed send finishes as failed, so nothing is taken.
  const settle = async (id, account, to, wei, failMsg) => {
    try {
      const hash = await chain.send(account, to, wei);
      await rpc(db, 'transfer_finish', { p_id: id, p_tx_hash: hash, p_error: null });
      return { id, amount_wei: wei.toString(), to_address: to, tx_hash: hash, explorer: txUrl(hash), status: 'sent', settle: 'chain' };
    } catch (e) {
      if (e instanceof WalletError) throw e;
      const msg = firstLine(e);
      await rpc(db, 'transfer_finish', { p_id: id, p_tx_hash: null, p_error: msg });
      throw new WalletError(`${failMsg}${fundsHint(msg)}`, 502);
    }
  };

  if (action === 'team') {
    const t = await teamOf(body.org);
    let balance = null;
    try { balance = (await chain.balance(t.address)).toString(); } catch { /* the RPC is down: show the address anyway */ }
    return { address: t.address, balance_wei: balance };
  }

  if (action === 'redeem') {
    const address = home.wallet?.address;
    const p = Math.floor((home.wallet?.points ?? 0) / POINTS.minRedeem) * POINTS.minRedeem;
    if (!address) throw new WalletError('Your key has no wallet address yet. Sign in again on the device that holds your key.');
    if (p < POINTS.minRedeem) throw new WalletError(`You need at least ${POINTS.minRedeem} points to redeem.`);
    const limited = await rpc(db, 'rate_limit_hit', { p_bucket: `person:${me}:redeem`, p_max: 3, p_window_seconds: 3600 });
    if (limited === false) throw new WalletError('Too many redeems this hour. Try again later.', 429);
    const wei = pointsToWei(p);
    const id = await rpc(db, 'redeem_reserve', { p_person: me, p_points: p, p_amount_wei: wei.toString(), p_to: address, p_chain: CHAIN.id });
    try {
      const hash = await chain.send(treasury.account, address, wei);
      await rpc(db, 'redeem_finish', { p_id: id, p_tx_hash: hash, p_error: null });
      return { receipt: { id, points: p, amount_wei: wei.toString(), to_address: address, tx_hash: hash, explorer: txUrl(hash), status: 'sent' } };
    } catch (e) {
      const msg = firstLine(e);
      await rpc(db, 'redeem_finish', { p_id: id, p_tx_hash: null, p_error: msg });
      throw new WalletError(`The transfer did not go through, so your points are back.${fundsHint(msg)}`, 502);
    }
  }

  if (action === 'send') {
    const p = points(body.points);
    if (!UUID.test(String(body.to))) throw new WalletError('Pick a teammate.');
    const to = await rpc(db, 'wallet_address', { p_person: body.to });
    if (!to) throw new WalletError('That teammate has no wallet address yet. They sign in once on their own device first.');
    const wei = pointsToWei(p);
    const id = await rpc(db, 'transfer_reserve_chain', { p_kind: 'send', p_from_person: me, p_to_person: body.to, p_to_org: null, p_payout: null,
      p_points: p, p_note: body.note ?? null, p_amount_wei: wei.toString(), p_from_address: treasury.address, p_to_address: to, p_chain: CHAIN.id });
    return { transfer: { ...(await settle(id, treasury.account, to, wei, 'The transfer did not go through, so your points are back.')), points: p, kind: 'send' } };
  }

  if (action === 'donate') {
    const p = points(body.points), team = await teamOf(body.org), wei = pointsToWei(p);
    const id = await rpc(db, 'transfer_reserve_chain', { p_kind: 'donation', p_from_person: me, p_to_person: null, p_to_org: body.org, p_payout: null,
      p_points: p, p_note: body.note ?? null, p_amount_wei: wei.toString(), p_from_address: treasury.address, p_to_address: team.address, p_chain: CHAIN.id });
    return { transfer: { ...(await settle(id, treasury.account, team.address, wei, 'The transfer did not go through, so your points are back.')), points: p, kind: 'donation' } };
  }

  // claim: from the team address once it holds the amount plus gas; until then, from the pool.
  if (!UUID.test(String(body.payout))) throw new WalletError('Pick the payout.');
  const { data: payout } = await db.from('team_payouts').select('id, org_id, points').eq('id', body.payout).maybeSingle();
  if (!payout) throw new WalletError('No such payout.', 404);
  const team = await teamOf(payout.org_id), wei = pointsToWei(payout.points);
  let onChain = false;
  try { onChain = (await chain.balance(team.address)) >= wei + (await chain.gasCost()); } catch { onChain = false; }
  if (!onChain) return { transfer: await rpc(user, 'payout_claim', { p_payout: payout.id }) };
  const to = home.wallet?.address;
  if (!to) throw new WalletError('Your key has no wallet address yet. Sign in again on the device that holds your key.');
  const id = await rpc(db, 'transfer_reserve_chain', { p_kind: 'payout', p_from_person: null, p_to_person: me, p_to_org: null, p_payout: payout.id,
    p_points: payout.points, p_note: null, p_amount_wei: wei.toString(), p_from_address: team.address, p_to_address: to, p_chain: CHAIN.id });
  return { transfer: { ...(await settle(id, team.account, to, wei, 'The transfer from the team address did not go through. Nothing was taken; confirm again.')), points: payout.points, kind: 'payout' } };
}
