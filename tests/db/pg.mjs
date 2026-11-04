// A throwaway local Postgres for database tests: initdb into a temp folder, start it on a Unix
// socket only (no TCP), apply the Supabase stand-ins and every migration in order, and hand back
// helpers to act as a signed-in person (role authenticated with a JWT, like PostgREST does).
// Needs Postgres server binaries (initdb, pg_ctl). Without them, `available` is false and the
// tests that use this skip. Nothing here touches a real Supabase project.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, chownSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

const root = new URL('../../', import.meta.url).pathname;

function binDir() {
  try { const d = execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim(); if (existsSync(join(d, 'initdb'))) return d; } catch { /* no pg_config */ }
  for (const base of ['/usr/lib/postgresql', '/opt/homebrew/opt', '/usr/local/opt']) {
    if (!existsSync(base)) continue;
    for (const v of readdirSync(base).sort().reverse()) {
      for (const d of [join(base, v, 'bin')]) if (existsSync(join(d, 'initdb'))) return d;
    }
  }
  return null;
}
const BIN = binDir();
export const available = Boolean(BIN);

// Postgres refuses to run as root; in a root container run it as the postgres user.
const asRoot = process.getuid?.() === 0;
const run = (cmd, args) => (asRoot
  ? execFileSync('runuser', ['-u', 'postgres', '--', join(BIN, cmd), ...args], { stdio: 'pipe' })
  : execFileSync(join(BIN, cmd), args, { stdio: 'pipe' }));

export async function startDb() {
  if (!BIN) throw new Error('No Postgres server binaries found.');
  const dir = mkdtempSync(join(tmpdir(), 'lt-pg-')), data = join(dir, 'data');
  if (asRoot) { const uid = Number(execFileSync('id', ['-u', 'postgres']).toString()), gid = Number(execFileSync('id', ['-g', 'postgres']).toString()); chownSync(dir, uid, gid); }
  run('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8']);
  const port = 20000 + Math.floor(Math.random() * 20000);
  run('pg_ctl', ['-D', data, '-l', join(dir, 'log'), '-w', '-o', `-k ${dir} -p ${port} -c listen_addresses='' -c fsync=off`, 'start']);
  const pool = new pg.Pool({ host: dir, port, user: 'postgres', database: 'postgres', max: 4 });
  const stop = async () => {
    await pool.end().catch(() => {});
    try { run('pg_ctl', ['-D', data, '-m', 'immediate', 'stop']); } catch { /* already down */ }
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    await pool.query(readFileSync(join(root, 'tests/db/supabase-stubs.sql'), 'utf8'));
    const dirM = join(root, 'supabase/migrations');
    for (const f of readdirSync(dirM).filter(f => f.endsWith('.sql')).sort()) {
      try { await pool.query(readFileSync(join(dirM, f), 'utf8')); }
      catch (e) { throw new Error(`${f}: ${e.message}${e.position ? ` (at ${e.position})` : ''}`); }
    }
  } catch (e) { await stop(); throw e; }
  return { pool, stop, ...helpers(pool) };
}

function helpers(pool) {
  const sql = async (text, params = []) => (await pool.query(text, params)).rows;
  // Runs fn(query) in one transaction as this person: role authenticated, with their JWT.
  async function as(person, fn) {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role authenticated');
      await c.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`,
        [JSON.stringify({ sub: person.user, session_id: person.session, role: 'authenticated' }), person.user]);
      const out = await fn(async (text, params = []) => (await c.query(text, params)).rows);
      await c.query('commit');
      return out;
    } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
  }
  // Calls one database function as this person and returns its value.
  const call = (person, name, args = {}) => as(person, async q => {
    const keys = Object.keys(args);
    const rows = await q(`select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as v`, keys.map(k => args[k]));
    return rows[0].v;
  });
  // A signed-in auth user with a live session, linked to this person.
  async function signIn(personId) {
    const [{ id: user }] = await sql(`insert into auth.users (email) values ($1) returning id`, [`${personId}@people.lacrossetube.invalid`]);
    const [{ id: session }] = await sql(`insert into auth.sessions (user_id) values ($1) returning id`, [user]);
    await sql(`update public.people set auth_user_id = $1 where id = $2`, [user, personId]);
    return { id: personId, user, session };
  }
  const hex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
  // A coach applies (apply_team, as the key-login function does), the owner verifies the team.
  async function team({ name = `Team ${hex(3)}`, state = 'Maryland', website = null, verify = true } = {}) {
    const [r] = await sql(`select * from public.apply_team(p_pubkey => $1, p_login_at => now(), p_verifier_hash => null, p_pepper => null,
      p_first_name => 'Casey', p_last_initial => 'R', p_email => 'coach@example.com', p_team => $2, p_city => 'College Park', p_state => $3, p_website => $4)`,
    [hex(32), name, state, website]);
    if (verify) await sql(`update public.orgs set verified_at = now(), verified_sig = 'test' where id = $1`, [r.org_id]);
    return { org: r.org_id, coach: await signIn(r.person_id) };
  }
  async function player(t, first = 'Pat') {
    const m = await call(t.coach, 'roster_add', { p_org: t.org, p_first_name: first, p_last_initial: 'Q', p_number: String(Math.floor(Math.random() * 90) + 1), p_position: 'attack', p_age_band: '18_plus' });
    const [{ person_id }] = await sql(`select person_id from public.memberships where id = $1`, [m]);
    return signIn(person_id);
  }
  return { sql, as, call, signIn, team, player };
}
