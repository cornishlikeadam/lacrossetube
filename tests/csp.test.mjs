// The CSP in vercel.json must keep blocking third-party scripts. Phase 0 may add one Supabase
// project to connect-src (https + wss for the same host) and nothing else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const csp = config.headers.flatMap(h => h.headers).find(h => h.key === 'Content-Security-Policy').value;
const dir = Object.fromEntries(csp.split(';').map(d => d.trim().split(/\s+/)).filter(p => p[0]).map(([k, ...v]) => [k, v]));

test('scripts load only from this site', () => {
  assert.deepEqual(dir['script-src'], ["'self'"]);
  assert.deepEqual(dir['default-src'], ["'self'"]);
  assert.deepEqual(dir['object-src'], ["'none'"]);
  assert.ok(!csp.includes("'unsafe-eval'"));
  assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp));
});

test('connect-src allows this site, fonts, and at most one Supabase project', () => {
  const extra = dir['connect-src'].filter(s => !["'self'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'].includes(s));
  assert.ok(extra.length === 0 || extra.length === 2, `unexpected connect-src entries: ${extra}`);
  if (extra.length) {
    const [https, wss] = extra;
    assert.match(https, /^https:\/\/[a-z0-9]{20}\.supabase\.co$/);
    assert.equal(wss, https.replace('https://', 'wss://'));
  }
  assert.ok(!dir['connect-src'].some(s => s.includes('*')), 'no wildcards');
});

test('the rest of the policy is unchanged from production', () => {
  assert.deepEqual(dir['frame-src'], ['https://www.youtube-nocookie.com']);
  // blob: shows forum photos, which are read with the member's session from a private bucket.
  assert.deepEqual(dir['img-src'], ["'self'", 'https://i.ytimg.com', 'https://archive.org', 'data:', 'blob:']);
  assert.deepEqual(dir['media-src'], ["'self'", 'blob:']);
  assert.deepEqual(dir['frame-ancestors'], ["'none'"]);
  assert.deepEqual(dir['base-uri'], ["'self'"]);
  assert.deepEqual(dir['form-action'], ["'self'"]);
});

test('Vercel builds with Vite into dist', () => {
  assert.equal(config.buildCommand, 'npm run build');
  assert.equal(config.outputDirectory, 'dist');
});
