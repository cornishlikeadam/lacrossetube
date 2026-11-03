// Puts the hosted Supabase project into vercel.json's CSP connect-src, and nothing else:
// https://<ref>.supabase.co for the API and wss://<ref>.supabase.co for Realtime.
// Every other directive is left exactly as it is.
//   node scripts/set-supabase-csp.mjs https://abcdefghijklmnopqrst.supabase.co
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../vercel.json', import.meta.url);
const arg = process.argv[2] || process.env.SUPABASE_URL || '';
const m = arg.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/);
if (!m) { console.error('Pass the project URL, like https://abcdefghijklmnopqrst.supabase.co'); process.exit(1); }
const host = `${m[1]}.supabase.co`;

// Edit only the connect-src text so the rest of the file keeps its formatting.
const text = readFileSync(FILE, 'utf8');
const next = text.replace(/connect-src ([^;"]*)/, (_, sources) => {
  const kept = sources.trim().split(/\s+/).filter(s => !/\.supabase\.co$/.test(s));
  return ['connect-src', ...kept, `https://${host}`, `wss://${host}`].join(' ');
});
JSON.parse(next);
writeFileSync(FILE, next);
console.log(`connect-src now allows https://${host} and wss://${host}`);
