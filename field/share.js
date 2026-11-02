// Links between coach and players, with no server. A team link (#t=) carries the coach's meeting
// summary to every player. A results link (#r=) carries one player's scores back to the coach.
// Payloads are JSON, deflated where the browser can, then base64url. Everything read from a link
// is treated as untrusted: checked, trimmed to size, and escaped when shown.
import { CONCEPTS } from './concepts.js';
import { SPORTS } from './sports.js';
import { POSITIONS } from './positions.js';

const enc = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const dec = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
async function through(bytes, Stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new Stream('deflate-raw'))).arrayBuffer()); }

export async function pack(obj) {
  const json = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream === 'function') { try { return 'z' + enc(await through(json, CompressionStream)); } catch { /* fall through */ } }
  return 'j' + enc(json);
}
export async function unpack(s) {
  if (typeof s !== 'string' || s.length < 2 || s.length > 20000) throw new Error('The link is empty or too long.');
  let bytes;
  try { bytes = dec(s.slice(1)); } catch { throw new Error('The link is damaged. Ask for it again.'); }
  if (s[0] === 'z') {
    if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot open compressed links. Update it and try again.');
    try { bytes = await through(bytes, DecompressionStream); } catch { throw new Error('The link is damaged. Ask for it again.'); }
  } else if (s[0] !== 'j') throw new Error('This is not a What Coach Said link.');
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('The link is damaged. Ask for it again.'); }
}

const str = (v, n) => typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n) : '';
const day = v => /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
const num = (v, lo, hi) => Number.isFinite(+v) ? Math.min(hi, Math.max(lo, Math.round(+v))) : 0;
const GRADES = ['perfect', 'good', 'miss'];

export function cleanSession(o) {
  if (!o || o.v !== 1 || !SPORTS[o.sport]) throw new Error('This team link is not valid.');
  const groups = (Array.isArray(o.groups) ? o.groups : []).slice(0, 16).filter(g => CONCEPTS[g?.c] && ['start', 'stop', 'continue'].includes(g?.b)).map(g => ({
    b: g.b, c: g.c, m: num(g.m, 1, 99), q: str(g.q, 200), ms: (Array.isArray(g.ms) ? g.ms : []).slice(0, 3).map(x => str(x, 24)).filter(Boolean),
    iv: (Array.isArray(g.iv) ? g.iv : []).slice(0, 6).map(x => str(x, 40)).filter(Boolean),
  }));
  if (!groups.length) throw new Error('This team link has no coaching points.');
  const st = o.stats || {};
  return { v: 1, id: str(o.id, 16) || 'team', team: str(o.team, 40), coach: str(o.coach, 40), sport: o.sport, date: day(o.date),
    stats: { unique: num(st.unique, 0, 9999), kept: num(st.kept, 0, 9999), play: num(st.play, 0, 9999), measure: num(st.measure, 0, 9999), call: num(st.call, 0, 9999), noise: num(st.noise, 0, 9999) }, groups };
}
export function cleanReport(o) {
  if (!o || o.v !== 1 || !SPORTS[o.sp]) throw new Error('This results link is not valid.');
  if (!POSITIONS[o.sp].some(p => p.id === o.p)) throw new Error('This results link has an unknown position.');
  const items = (Array.isArray(o.items) ? o.items : []).slice(0, 12).filter(i => Array.isArray(i) && CONCEPTS[i[2]]).map(i => [str(i[0], 40), GRADES.includes(i[1]) ? i[1] : null, i[2], str(i[3], 60)]);
  return { v: 1, s: str(o.s, 16) || null, tn: str(o.tn, 40), n: str(o.n, 24) || 'Player', sp: o.sp, p: o.p, d: day(o.d), x: num(o.x, 0, 99999), items };
}

export const teamGroups = session => session.groups.map(g => ({ bucket: g.b, concept: g.c, mentions: g.m, quote: g.q, measures: g.ms, ideas: g.iv }));

// #t=... or #r=... (a full URL or a bare hash works too)
export async function readHash(input) {
  const m = String(input || '').match(/#?([tr])=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  const data = await unpack(m[2]);
  return m[1] === 't' ? { kind: 't', data: cleanSession(data) } : { kind: 'r', data: cleanReport(data) };
}

// Share sheet on phones; clipboard elsewhere. Returns how it went so the page can say it.
export async function shareOrCopy(url, title) {
  if (navigator.share) { try { await navigator.share({ title, url }); return 'shared'; } catch (e) { if (e?.name === 'AbortError') return 'cancelled'; } }
  try { await navigator.clipboard.writeText(url); return 'copied'; } catch { return 'manual'; }
}
