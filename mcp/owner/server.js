// LacrosseTube owner MCP, Phase 0: site tools only. Runs over stdio on the operator's machine.
// The service key comes from mcp/owner/.env (git-ignored) or the environment. This server never
// holds or asks for the owner's private key. Trust and money tools arrive in later phases.
// Tool names use underscores (catalog_search for catalog.search) because MCP clients and the
// Claude API accept only letters, digits, _ and - in tool names.
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { catalogSearch, vouchAdd, curatorRun, blogDraft, otsVerify, supabaseFromEnv } from './tools.js';

try { process.loadEnvFile(fileURLToPath(new URL('./.env', import.meta.url))); } catch { /* no .env: Supabase tools report it */ }
const db = supabaseFromEnv();
const server = new McpServer({ name: 'lacrossetube-owner', version: '0.1.0' });

const tool = (name, description, inputSchema, fn) => server.registerTool(name, { description, inputSchema }, async args => {
  try { return { content: [{ type: 'text', text: JSON.stringify(await fn(args), null, 2) }] }; }
  catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
});

tool('catalog_search', 'Search the LacrosseTube shelf (data/catalog.json). Every word in the query must match the title, author, note or category.', {
  query: z.string().max(200).describe('Words to match, e.g. "adjacent slide"'),
  category: z.string().max(60).optional().describe('Category id or label, e.g. "games" or "College & Pro Film"'),
  limit: z.number().int().min(1).max(50).optional(),
}, args => catalogSearch(args));

tool('vouch_add', 'Record a human vouch for a shelf item in Supabase. Additive: the static catalog is not changed.', {
  item_id: z.string().max(80).describe('Shelf item id, e.g. "yt-TsTgsq2vcPE"'),
  voucher_name: z.string().min(1).max(60).describe('Who vouches (a coach, player or stick doctor)'),
  quote: z.string().min(1).max(280).describe('Why it is worth watching, in their words'),
}, args => vouchAdd(args, { db }));

tool('curator_run', 'Run daily_6pm_curator.py, which rewrites the static catalog in this working tree, then mirror the catalog into Supabase. Does not commit or deploy.', {
  run_curator: z.boolean().optional().describe('Run the curator first (default true). False only mirrors the current catalog.'),
  sync: z.boolean().optional().describe('Mirror data/catalog.json into Supabase catalog_items (default true).'),
}, args => curatorRun(args, { db }));

tool('blog_draft', 'Write an unpublished Markdown draft to drafts/blog/. With no body, it lists today\'s Dispatch films. Never overwrites.', {
  title: z.string().min(1).max(100),
  body: z.string().max(20000).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}, args => blogDraft(args));

tool('ots_verify', 'Verify an OpenTimestamps proof for a file in this repo against Bitcoin block headers.', {
  file: z.string().max(300).describe('Path in the repo, e.g. "data/catalog.json"'),
  proof: z.string().max(300).optional().describe('Path to the .ots proof (default: file + ".ots")'),
}, args => otsVerify(args));

await server.connect(new StdioServerTransport());
