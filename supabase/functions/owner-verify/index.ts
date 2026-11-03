// Owner actions, each signed by the owner key (see _shared/owner-core.js):
//   POST { action: 'list', payload: {}, ts, sig }                     -> { applications }
//   POST { action: 'verify_org', payload: { org_id }, ts, sig }       -> { verified: <team name> }
// Only the owner CLI (scripts/owner.mjs, on the owner's machine) can make these signatures.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { schnorr } from 'npm:@noble/curves@2.4.0/secp256k1.js';
import { sha256 } from 'npm:@noble/hashes@2.4.0/sha2.js';
import { checkOwnerRequest } from '../_shared/owner-core.js';

const URL = Deno.env.get('SUPABASE_URL');
const firstSecret = (json?: string) => { try { return Object.values(JSON.parse(json || '{}'))[0] as string | undefined; } catch { return undefined; } };
const SECRET = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY') || firstSecret(Deno.env.get('SUPABASE_SECRET_KEYS'));
const OWNER_PUBKEY = Deno.env.get('OWNER_PUBKEY');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405);
  if (!URL || !SECRET || !OWNER_PUBKEY) return reply({ error: 'Owner actions are not configured on this server.' }, 503);
  let body: { action?: string; payload?: Record<string, unknown>; ts?: number; sig?: string };
  try { body = await req.json(); } catch { return reply({ error: 'Send JSON.' }, 400); }
  const db = createClient(URL, SECRET, { auth: { autoRefreshToken: false, persistSession: false } });
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  const { data: allowed } = await db.rpc('rate_limit_hit', { p_bucket: `ip:${ip}:owner`, p_max: 20, p_window_seconds: 60 });
  if (allowed === false) return reply({ error: 'Too many tries. Wait a minute.' }, 429);

  const action = String(body.action), payload = body.payload ?? {};
  if (action === 'verify_org' && !UUID.test(String(payload.org_id))) return reply({ error: 'Give the team id.' }, 400);
  if (action !== 'list' && action !== 'verify_org') return reply({ error: 'Unknown action.' }, 400);
  const problem = checkOwnerRequest({ action, payload, ts: body.ts, sig: body.sig }, { ownerPubkey: OWNER_PUBKEY, schnorr, sha256 });
  if (problem) return reply({ error: problem }, 401);

  if (action === 'list') {
    const { data: cards, error } = await db.from('board_cards').select('ref_id, title, col, created_at').eq('kind', 'org_application').neq('col', 'done').order('created_at');
    if (error) return reply({ error: error.message }, 500);
    const ids = cards.map(c => c.ref_id);
    const { data: orgs } = ids.length ? await db.from('orgs').select('id, name, city, created_by, people!orgs_created_by_fkey(display_name, contact_email)').in('id', ids) : { data: [] };
    const byId = new Map((orgs ?? []).map(o => [o.id, o]));
    return reply({ applications: cards.map(c => { const o = byId.get(c.ref_id); return { org_id: c.ref_id, team: o?.name, city: o?.city, coach: o?.people?.display_name, email: o?.people?.contact_email, applied: c.created_at }; }) });
  }
  const { data: name, error } = await db.rpc('verify_org', { p_org: payload.org_id, p_sig: body.sig });
  if (error) return reply({ error: error.code === 'P0002' ? error.message : 'Could not verify the team.' }, error.code === 'P0002' ? 404 : 500);
  return reply({ verified: name });
});
