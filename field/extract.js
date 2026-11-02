// Offline engine. Step 1: acquisition rules keep only plays, measurements and calls.
// Step 2: each kept sentence goes to Start / Stop / Continue by the coach's phrasing.
// Step 3: it is filed under a concept, and under every library idea whose words it uses.
// Step 4: for one player, points are ranked by how often the coach said them, weighted for the
// player's position. A point uses a library idea only when the coach's words matched it, the
// player's own position first; otherwise it keeps the concept's plain wording.
import { CONCEPTS } from './concepts.js';
import { SPORTS, fill } from './sports.js';
import { positionOf } from './positions.js';
import { acquire } from './acquire.js';
import { ideasFor, sportIdeas, ideaById, itemFromIdea, pickLibraryItems } from './ideas.js';

const STRONG = /\b(great|love|loved|well done|way to|awesome|nice job|good job|excellent|perfect|beautiful|a lot better|that's it|that’s it|keep (doing|that))\b/i;
const PRAISE = /\b(good|nice|not bad|looks good)\b/i;
const NEG = /\b(stop|don't|don’t|do not|never|can't|can’t|cannot|shouldn't|shouldn’t|no contact|too far|entirely too|bad|unfortunate|give up|gave up|piss|staring|no clue|lose|losing|just standing|throw it away|fading|giving up)\b/i;
const NEEDS = /\b(gotta|got to|gonna have to|need to|needs to|have to|has to|should|must|let's|let’s|make sure|start|we want|want to|quicker|sooner|better job|more)\b/i;
const FORCED = /^\s*(start|stop|continue|keep)\s*[:\-–]\s*/i;
export const MAX_ITEMS = 7;
export const MAX_VOTED = 6;
const ORDER = ['start', 'stop', 'continue'];

function bucketOf(s) {
  const f = s.match(FORCED); if (f) { const k = f[1].toLowerCase(); return k === 'keep' ? 'continue' : k; }
  const strong = STRONG.test(s), neg = NEG.test(s), needs = NEEDS.test(s);
  if (strong && !neg) return 'continue';
  if (neg) return 'stop';
  if (needs) return 'start';
  if (PRAISE.test(s)) return 'continue';
  return null;
}
const RE = new Map();
export function keyRe(k) {
  if (!RE.has(k)) { const stem = k.endsWith('~'), body = (stem ? k.slice(0, -1) : k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); RE.set(k, new RegExp(`(^|[^a-z])${body}${stem ? '' : "(s|es|ing|ed)?([^a-z']|$)"}`, 'i')); }
  return RE.get(k);
}
function conceptOf(s) {
  const t = s.toLowerCase(); let best = null, bs = 0;
  for (const [id, c] of Object.entries(CONCEPTS)) { let sc = 0; for (const k of c.keys) if (keyRe(k).test(t)) sc += k.length > 6 ? 2 : 1; if (sc > bs) { bs = sc; best = id; } }
  return best;
}
const ideaScore = (t, i) => (i.keys || []).reduce((s, k) => s + (keyRe(k).test(t) ? (k.includes(' ') ? 2 : 1) : 0), 0);
function bestIdea(text, pool, template) {
  const t = text.toLowerCase(); let best = null, bs = 0;
  for (const i of pool) {
    if (template && i.template !== template) continue;
    const s = ideaScore(t, i);
    if (s > bs) { bs = s; best = i; }
  }
  return bs >= (template ? 1 : 2) ? best : null;
}
const scoreQuote = (q, c) => CONCEPTS[c].keys.filter(k => keyRe(k).test(q.toLowerCase())).length * 10 - Math.abs(q.split(/\s+/).length - 14) - (/—/.test(q) ? 6 : 0);

// Position-free summary of a meeting: one group per (bucket, concept). Team links carry these.
export function groupTranscript(lines, sportId, pool = sportIdeas(sportId)) {
  const { kept, stats } = acquire(lines, sportId);
  const groups = new Map(), measures = {};
  for (const s of kept) {
    const b = bucketOf(s.text); let c = conceptOf(s.text);
    const hit = bestIdea(s.text, pool, c);
    if (!c && hit) c = hit.template;
    if (!c) continue;
    if (s.measures.length) { measures[c] ||= new Set(); s.measures.forEach(m => measures[c].add(m)); }
    if (!b) continue;
    const key = b + ':' + c, g = groups.get(key) || { bucket: b, concept: c, mentions: 0, quotes: [], votes: {} };
    g.mentions++; g.quotes.push(s.text.replace(FORCED, ''));
    const t = s.text.toLowerCase();
    for (const i of pool) if (i.template === c) { const v = ideaScore(t, i); if (v) g.votes[i.id] = (g.votes[i.id] || 0) + v; }
    groups.set(key, g);
  }
  const list = [...groups.values()].map(g => ({
    bucket: g.bucket, concept: g.concept, mentions: g.mentions,
    quote: (g.quotes.filter(q => q.length < 170).sort((a, b) => scoreQuote(b, g.concept) - scoreQuote(a, g.concept))[0] || g.quotes[0]).slice(0, 170),
    measures: [...(measures[g.concept] || [])].slice(0, 3),
    ideas: Object.entries(g.votes).sort((a, b) => b[1] - a[1]).map(([id]) => id).slice(0, MAX_VOTED),
  })).sort((a, b) => b.mentions - a.mentions);
  return { groups: list, stats };
}

// One player's frames from the groups: each concept once, at most 3 per bucket.
export function itemsFromGroups(groups, sportId, positionId, max = MAX_ITEMS) {
  const sp = SPORTS[sportId], pos = positionOf(sportId, positionId), mine = new Set(ideasFor(sportId, pos?.id).map(i => i.id));
  const rank = g => g.mentions * (1 + (pos?.w[g.concept] ?? 1) / 3);
  const used = new Set(), per = { start: 0, stop: 0, continue: 0 }, picked = [];
  for (const g of [...groups].sort((a, b) => rank(b) - rank(a))) {
    if (!CONCEPTS[g.concept] || !ORDER.includes(g.bucket) || used.has(g.concept) || per[g.bucket] >= 3 || picked.length >= max) continue;
    used.add(g.concept); per[g.bucket]++; picked.push(g);
  }
  return picked.sort((a, b) => ORDER.indexOf(a.bucket) - ORDER.indexOf(b.bucket) || rank(b) - rank(a)).map(g => {
    const voted = (g.ideas || []).map(ideaById).filter(i => i && i.template === g.concept);
    const idea = voted.find(i => mine.has(i.id)) || voted[0] || null;
    const extra = { quote: g.quote, mentions: g.mentions, measurements: g.measures || [], source: 'meeting' };
    if (idea) return itemFromIdea(idea, g.bucket, sportId, extra);
    const C = CONCEPTS[g.concept];
    return { bucket: g.bucket, concept: g.concept, idea: null, title: fill(C.title[g.bucket], sp), line: fill(C.line[g.bucket], sp), kid: fill(C.kid, sp), why: fill(C.why, sp),
      viz: '', change: C.change, game: null, tags: [g.concept], ...extra };
  });
}

// A meeting always yields a playable update: fewer than `min` matched points are topped up from
// the player's own library, and the headline says so.
export function extractOffline(lines, sportId, positionId, { ideaStats = {}, min = 3 } = {}) {
  const pos = positionOf(sportId, positionId);
  const { groups, stats } = groupTranscript(lines, sportId);
  let items = itemsFromGroups(groups, sportId, pos?.id);
  const fromMeeting = items.length;
  if (items.length < min) items = [...items, ...pickLibraryItems(sportId, pos?.id, ideaStats, min - items.length, new Set(items.map(i => i.concept)))];
  return { sport: sportId, position: pos?.id, items, stats, groups, fromMeeting, headline: headlineFor(stats, fromMeeting, items.length, pos) };
}
export function headlineFor(stats, fromMeeting, total, pos) {
  const who = pos ? pos.you : 'player';
  if (!fromMeeting) return `${stats.unique} sentences heard, but none matched a play. Here are ${total} ideas from your ${who} library instead.`;
  const top = total > fromMeeting ? ` ${total - fromMeeting} more come from your library.` : '';
  return `${stats.unique} sentences heard. ${stats.kept} were real plays. Here are the ${fromMeeting} that matter for a ${who}.${top}`;
}
