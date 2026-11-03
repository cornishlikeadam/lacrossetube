// Owner MCP tests. Offline: the block explorer is stubbed with block 358391's real merkle root,
// Supabase with a small fake, and drafts go to a temp copy of the repo's data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { catalogSearch, vouchAdd, blogDraft, otsVerify, curatorRun, REPO } from './tools.js';
import { parseProof } from './ots.js';

// Block 358391 as Blockstream's Esplora API reports it (merkle root in display byte order).
const BLOCK_358391 = { hash: '000000000000000003e892881a8cdcdc117c06d444057c98b6f04a9ee75a2319', merkle_root: '8a1b66ecb7cbd07d8139a7e7d7f2c41aab1f5009b8364aaf61d03ad245e47e00', timestamp: 1432827678 };
const explorer = async url => url.includes('/block-height/')
  ? { text: async () => BLOCK_358391.hash }
  : { json: async () => BLOCK_358391 };

async function tempRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'lt-owner-'));
  await mkdir(join(dir, 'data'));
  for (const f of ['catalog.json', 'dispatch.json']) await cp(resolve(REPO, 'data', f), join(dir, 'data', f));
  await cp(resolve(REPO, 'tests/fixtures'), join(dir, 'fixtures'), { recursive: true });
  return dir;
}

function fakeDb() {
  const rows = { vouches: [], catalog_items: [] };
  return {
    rows,
    from(table) {
      return {
        upsert: async r => { rows[table].push(...[].concat(r)); return { error: null }; },
        insert: r => ({ select: () => ({ single: async () => { rows[table].push(r); return { data: { id: 'fake-id' }, error: null }; } }) }),
      };
    },
  };
}

test('catalog_search: every word must match, title hits first', async () => {
  const r = await catalogSearch({ query: 'adjacent slide' });
  assert.ok(r.total >= 1);
  assert.match(r.items[0].title.toLowerCase(), /adjacent/);
  assert.equal((await catalogSearch({ query: 'zzzz-no-such-film' })).total, 0);
  assert.ok((await catalogSearch({ query: '', limit: 3 })).items.length === 3);
});

test('vouch_add: refuses unknown items, needs Supabase, writes an additive vouch', async () => {
  await assert.rejects(vouchAdd({ item_id: 'yt-TsTgsq2vcPE', voucher_name: 'Fake Coach', quote: 'Good' }, {}), /not configured/);
  const db = fakeDb();
  await assert.rejects(vouchAdd({ item_id: 'nope', voucher_name: 'Fake Coach', quote: 'Good' }, { db }), /No shelf item/);
  const r = await vouchAdd({ item_id: 'yt-TsTgsq2vcPE', voucher_name: 'Fake Coach', quote: 'Clean slide teaching.' }, { db });
  assert.match(r.content_hash, /^[0-9a-f]{64}$/);
  assert.equal(db.rows.vouches[0].item_id, 'yt-TsTgsq2vcPE');
  assert.equal(db.rows.catalog_items[0].id, 'yt-TsTgsq2vcPE');
});

test('curator_run: sync-only mirrors the catalog without running the curator', async () => {
  const db = fakeDb(), repo = await tempRepo();
  const r = await curatorRun({ run_curator: false, sync: true }, { repo, db });
  const count = JSON.parse(await readFile(join(repo, 'data/catalog.json'), 'utf8')).length;
  assert.equal(db.rows.catalog_items.length, count);
  assert.match(r.sync, new RegExp(`^${count} catalog items`));
  assert.match((await curatorRun({ run_curator: false }, { repo })).sync, /not configured/);
  await rm(repo, { recursive: true });
});

test('blog_draft: writes under drafts/blog from the Dispatch, never overwrites, stays in the repo', async () => {
  const repo = await tempRepo();
  const { path } = await blogDraft({ title: 'Tuesday drop', date: '2026-11-03' }, { repo });
  assert.equal(path, 'drafts/blog/2026-11-03-tuesday-drop.md');
  const text = await readFile(join(repo, path), 'utf8');
  assert.match(text, /^# Tuesday drop\n\n_Draft, not published._/);
  assert.match(text, /^- \*\*.+\*\* \(.+\): .+/m);
  await assert.rejects(blogDraft({ title: 'Tuesday drop', date: '2026-11-03' }, { repo }), /already exists/);
  await assert.rejects(blogDraft({ title: 'x', date: 'nope' }, { repo }), /Use a date/);
  await rm(repo, { recursive: true });
});

test('ots_verify: a real Bitcoin proof verifies, a changed file does not, a calendar-only proof is pending', async () => {
  const repo = await tempRepo(), fetchImpl = explorer;
  const ok = await otsVerify({ file: 'fixtures/hello-world.txt' }, { repo, fetchImpl });
  assert.equal(ok.status, 'verified');
  assert.equal(ok.height, 358391);
  assert.equal(ok.time, '2015-05-28T15:41:18.000Z');
  const pending = await otsVerify({ file: 'fixtures/incomplete.txt' }, { repo, fetchImpl });
  assert.equal(pending.status, 'pending');
  assert.deepEqual(pending.calendars, ['https://alice.btc.calendar.opentimestamps.org']);
  const wrong = await otsVerify({ file: 'fixtures/incomplete.txt', proof: 'fixtures/hello-world.txt.ots' }, { repo, fetchImpl });
  assert.equal(wrong.status, 'mismatch');
  await assert.rejects(otsVerify({ file: '../etc/passwd' }, { repo }), /outside the repo/);
  assert.throws(() => parseProof(new Uint8Array([1, 2, 3])), /not an OpenTimestamps proof|ends early/);
  await rm(repo, { recursive: true });
});

test('the MCP server lists exactly the five Phase 0 site tools and answers a search', async () => {
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve(import.meta.dirname, 'server.js')], env: { PATH: process.env.PATH } }));
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(t => t.name).sort(), ['blog_draft', 'catalog_search', 'curator_run', 'ots_verify', 'vouch_add']);
    const res = await client.callTool({ name: 'catalog_search', arguments: { query: 'wall ball', limit: 2 } });
    assert.ok(!res.isError);
    assert.ok(JSON.parse(res.content[0].text).total >= 1);
    const noDb = await client.callTool({ name: 'vouch_add', arguments: { item_id: 'yt-TsTgsq2vcPE', voucher_name: 'x', quote: 'y' } });
    assert.ok(noDb.isError);
  } finally { await client.close(); }
});
