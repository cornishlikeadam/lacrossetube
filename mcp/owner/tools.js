// The owner MCP's site tools. Each takes plain arguments plus injected context ({ repo, db }) so
// tests can run them against a temp folder and a fake database.
// Supabase access uses the service (secret) key from this machine's environment only. The tools
// never touch the owner's private key, wallets or money.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, relative, isAbsolute } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { verifyProof } from './ots.js';

export const REPO = resolve(import.meta.dirname, '../..');
const te = new TextEncoder();

export function supabaseFromEnv(env = process.env) {
  const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}
const needDb = db => { if (!db) throw new Error('Supabase is not configured on this machine. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in mcp/owner/.env.'); return db; };
const loadCatalog = async repo => JSON.parse(await readFile(resolve(repo, 'data/catalog.json'), 'utf8'));
const brief = it => ({ id: it.id, title: it.title, author: it.author, category: it.categoryLabel || it.category, duration: it.duration || null, url: it.url });
const catalogRow = it => ({ id: it.id, type: it.type ?? null, category: it.category ?? null, title: it.title ?? null, author: it.author ?? null, url: it.url ?? null, youtube_id: it.youtubeId ?? null, data: it, synced_at: new Date().toISOString() });

function inRepo(repo, path) {
  const full = resolve(repo, path), rel = relative(repo, full);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`${path} is outside the repo.`);
  return full;
}

function run(cmd, args, { cwd, timeoutMs }) {
  return new Promise(resolvePromise => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const keep = d => { out = (out + d).slice(-8000); };
    child.stdout.on('data', keep); child.stderr.on('data', keep);
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.on('close', code => { clearTimeout(timer); resolvePromise({ code, tail: out.trim().split('\n').slice(-20).join('\n') }); });
  });
}

/* catalog.search: find films and PDFs on the shelf. Every word must match. */
export async function catalogSearch({ query = '', category, limit = 10 }, { repo = REPO } = {}) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = (await loadCatalog(repo))
    .filter(it => !category || it.category === category || it.categoryLabel === category)
    .map(it => {
      const title = String(it.title || '').toLowerCase();
      const hay = [title, it.author, it.curatorNote, it.subTag, it.categoryLabel, it.category].join(' ').toLowerCase();
      return { it, ok: words.every(w => hay.includes(w)), score: words.filter(w => title.includes(w)).length };
    })
    .filter(x => x.ok)
    .sort((a, b) => b.score - a.score);
  return { total: hits.length, items: hits.slice(0, Math.min(limit, 50)).map(x => brief(x.it)) };
}

/* vouch.add: record a human vouch for a shelf item in Supabase (additive; the static catalog is unchanged). */
export async function vouchAdd({ item_id, voucher_name, quote }, { repo = REPO, db } = {}) {
  needDb(db);
  const item = (await loadCatalog(repo)).find(it => it.id === item_id);
  if (!item) throw new Error(`No shelf item with id ${item_id}.`);
  const created_at = new Date().toISOString();
  const content_hash = bytesToHex(sha256(te.encode(JSON.stringify({ item_id, voucher_name, quote, created_at }))));
  const { error: upErr } = await db.from('catalog_items').upsert(catalogRow(item));
  if (upErr) throw new Error(`Could not mirror the catalog item: ${upErr.message}`);
  const { data, error } = await db.from('vouches').insert({ item_id, voucher_name, quote, content_hash, created_at }).select('id').single();
  if (error) throw new Error(`Could not save the vouch: ${error.message}`);
  return { id: data.id, item: brief(item), content_hash, note: 'Saved to Supabase. The static catalog is unchanged.' };
}

/* curator.run: run daily_6pm_curator.py (it still writes the static catalog), then mirror the catalog to Supabase. */
export async function curatorRun({ run_curator = true, sync = true }, { repo = REPO, db } = {}) {
  const result = {};
  if (run_curator) {
    const r = await run('python3', ['daily_6pm_curator.py'], { cwd: repo, timeoutMs: 10 * 60 * 1000 });
    result.curator = { exit: r.code, tail: r.tail };
    if (r.code !== 0) return { ...result, sync: 'skipped because the curator failed' };
    result.changed = (await run('git', ['status', '--short', '--', 'data', 'blog'], { cwd: repo, timeoutMs: 15000 })).tail || 'no changes';
  }
  if (sync) {
    if (!db) result.sync = 'skipped: Supabase is not configured on this machine';
    else {
      const rows = (await loadCatalog(repo)).map(catalogRow);
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await db.from('catalog_items').upsert(rows.slice(i, i + 200));
        if (error) throw new Error(`Catalog sync stopped at row ${i}: ${error.message}`);
      }
      result.sync = `${rows.length} catalog items mirrored to Supabase`;
    }
  }
  return result;
}

/* blog.draft: write an unpublished Markdown draft under drafts/blog/. Never overwrites. */
export async function blogDraft({ title, body, date }, { repo = REPO } = {}) {
  const day = date || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Use a date like 2026-11-03.');
  const slug = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'draft';
  let text = body;
  if (!text) {
    const [dispatch, catalog] = await Promise.all([readFile(resolve(repo, 'data/dispatch.json'), 'utf8').then(JSON.parse), loadCatalog(repo)]);
    const byId = new Map(catalog.map(it => [it.id, it]));
    text = (dispatch.items || []).map(d => { const it = byId.get(d.id); return it ? `- **${it.title}** (${it.author}): ${d.why}` : null; }).filter(Boolean).join('\n');
  }
  const file = inRepo(repo, `drafts/blog/${day}-${slug}.md`);
  await mkdir(resolve(repo, 'drafts/blog'), { recursive: true });
  await writeFile(file, `# ${title}\n\n_Draft, not published._\n\n${text}\n`, { flag: 'wx' }).catch(e => {
    throw e.code === 'EEXIST' ? new Error(`${relative(repo, file)} already exists.`) : e;
  });
  return { path: relative(repo, file) };
}

/* ots.verify: check an OpenTimestamps proof for a file in the repo against Bitcoin. */
export async function otsVerify({ file, proof }, { repo = REPO, fetchImpl } = {}) {
  const filePath = inRepo(repo, file), proofPath = inRepo(repo, proof || `${file}.ots`);
  const [fileBytes, proofBytes] = await Promise.all([readFile(filePath), readFile(proofPath)]);
  return { file: relative(repo, filePath), proof: relative(repo, proofPath), ...(await verifyProof(fileBytes, proofBytes, fetchImpl ? { fetchImpl } : {})) };
}
