// Idea library: sport -> position -> ideas (title, directive, why, tags, viz notes, template, game).
// Loaded with fetch, which works in every browser (a JSON import assertion crashed the app),
// checked against the schema, grown by optional daily files, and backed by a built-in
// fallback so a drop-in never fails.
import { CONCEPTS } from './concepts.js';
import { POSITIONS } from './positions.js';
import { SPORTS, fill } from './sports.js';

export const TEMPLATES = Object.keys(CONCEPTS);
const BUCKETS = ['start', 'stop', 'continue'];
let LIB = null, LOADING = null;

export function validateIdea(i) {
  const errs = [];
  for (const k of ['id', 'title', 'directive', 'why', 'template']) if (typeof i?.[k] !== 'string' || !i[k].trim()) errs.push(`missing ${k}`);
  if (i?.template && !TEMPLATES.includes(i.template)) errs.push(`unknown template "${i.template}"`);
  if (i?.bucket && !BUCKETS.includes(i.bucket)) errs.push(`bad bucket "${i.bucket}"`);
  if (i?.change && !(Array.isArray(i.change) && i.change.length === 2)) errs.push('change needs [before, after]');
  const g = i?.game;
  if (g) {
    if (!['concept', 'choose', 'time'].includes(g.type)) errs.push(`bad game type "${g.type}"`);
    if (g.type === 'choose' && !(g.ask && Array.isArray(g.options) && g.options.length === 2 && g.options.includes(g.correct) && g.right && g.wrong)) errs.push('choose game needs ask, 2 options, correct, right, wrong');
    if (g.type === 'time' && !(g.ask && g.cue && g.right && g.wrong)) errs.push('time game needs ask, cue, right, wrong');
  }
  return errs;
}

export function validateLibrary(lib) {
  const problems = [], clean = { ...lib, sports: {} }, seen = new Set();
  for (const [sport, positions] of Object.entries(lib?.sports || {})) {
    clean.sports[sport] = {};
    for (const [pos, list] of Object.entries(positions || {})) {
      clean.sports[sport][pos] = (Array.isArray(list) ? list : []).filter(i => {
        const errs = validateIdea(i);
        if (i?.id && seen.has(i.id)) errs.push('duplicate id');
        if (errs.length) { problems.push(`${sport}/${pos}/${i?.id || '?'}: ${errs.join(', ')}`); return false; }
        seen.add(i.id); return true;
      });
    }
  }
  return { lib: clean, problems };
}

// Same shape built from the 11 concepts, used only if the library file cannot load.
export function builtInLibrary() {
  const sports = {};
  for (const [sid, positions] of Object.entries(POSITIONS)) {
    sports[sid] = {};
    for (const p of positions) {
      sports[sid][p.id] = Object.entries(p.w).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => ({
        id: `${sid}-${p.id}-${t}`, title: CONCEPTS[t].name, directive: fill(CONCEPTS[t].line.start, SPORTS[sid]), why: fill(CONCEPTS[t].why, SPORTS[sid]),
        tags: [t], viz: CONCEPTS[t].name, template: t, bucket: 'start',
      }));
    }
  }
  return { version: 0, builtIn: true, sports };
}

// Daily files may be an array of {sport, position, ...idea}, {ideas: [...]}, or the library shape.
export function normalizeBatch(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.ideas)) return data.ideas;
  const out = [];
  for (const [sport, ps] of Object.entries(data?.sports || {})) for (const [position, list] of Object.entries(ps || {})) for (const i of list || []) out.push({ sport, position, ...i });
  return out;
}
export function mergeIdeas(current, batch) {
  const next = structuredClone(current); next.sports ||= {};
  let added = 0, updated = 0, rejected = 0;
  for (const item of batch || []) {
    const { sport, position, ...idea } = item || {};
    if (!sport || !position || validateIdea(idea).length) { rejected++; continue; }
    const list = ((next.sports[sport] ||= {})[position] ||= []);
    const at = list.findIndex(i => i.id === idea.id);
    if (at >= 0) { list[at] = { ...list[at], ...idea }; updated++; } else { list.push(idea); added++; }
  }
  next.mergeLog = [...(current.mergeLog || []), { added, updated, rejected }];
  return next;
}

export function useLibrary(lib) { LIB = lib; LOADING = Promise.resolve(lib); return lib; }
export function loadLibrary(base = '') {
  if (LOADING) return LOADING;
  LOADING = (async () => {
    let lib, source = 'file', problems = [];
    try {
      const r = await fetch('/data/ideas.lacrosse.json');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      ({ lib, problems } = validateLibrary(await r.json()));
    } catch (e) { lib = builtInLibrary(); source = 'built-in'; problems.push(`library file did not load (${e.message})`); }
    const daily = [];
    try {
      const r = await fetch('/data/daily/index.json');
      if (r.ok) for (const f of ((await r.json()).files || []).slice(-7)) {
        if (!/^[\w.-]+\.json$/.test(f)) continue;
        const d = await fetch('/data/daily/' + f);
        if (d.ok) { lib = mergeIdeas(lib, normalizeBatch(await d.json())); daily.push({ file: f, ...lib.mergeLog.at(-1) }); }
      }
    } catch { /* daily growth files are optional */ }
    if (problems.length) console.warn('Idea library problems:', problems);
    return (LIB = { ...lib, source, problems, daily });
  })();
  return LOADING;
}
const current = () => LIB || builtInLibrary();

export function ideasFor(sport, position) {
  const sp = current().sports[sport] || {};
  return sp[position] || sp[POSITIONS[sport]?.[0]?.id] || Object.values(sp)[0] || [];
}
export const sportIdeas = sport => Object.values(current().sports[sport] || {}).flat();
export const sportIdeasWithPosition = sport => Object.entries(current().sports[sport] || {}).flatMap(([position, list]) => list.map(i => ({ ...i, position })));
export function ideaById(id) {
  for (const positions of Object.values(current().sports)) for (const list of Object.values(positions)) { const hit = list.find(i => i.id === id); if (hit) return hit; }
  return null;
}
export function libraryStats() {
  const lib = current(), bySport = {}; let total = 0;
  for (const [sport, positions] of Object.entries(lib.sports)) { bySport[sport] = Object.values(positions).reduce((n, l) => n + l.length, 0); total += bySport[sport]; }
  return { total, bySport, version: lib.version, source: lib.source || 'file', problems: lib.problems || [], daily: lib.daily || [] };
}

// One frame's item, from a library idea. A bucket other than the idea's own uses the concept's line
// for that bucket ("Do not chase the pass."), so the caption always matches the tag.
export function itemFromIdea(idea, bucket, sport, extra = {}) {
  const C = CONCEPTS[idea.template], sp = SPORTS[sport];
  const own = idea.bucket || 'start';
  // Ideas are written as instructions. "Keep doing it" reuses the instruction. "Stop" says the
  // concept's Do-not line and keeps the instruction as what to do instead.
  return {
    bucket, concept: idea.template, idea: idea.id, title: idea.title,
    line: bucket === own || bucket === 'continue' ? idea.directive : fill(C.line[bucket], sp),
    fix: bucket === 'stop' && own !== 'stop' ? idea.directive : '',
    kid: idea.kid || idea.why, why: idea.why, viz: idea.viz || '', change: idea.change || C.change,
    game: idea.game || null, tags: idea.tags || [], measurements: [], source: 'library', ...extra,
  };
}

// Library drop-in: ideas this player has never played first, then the ones they missed, then the rest.
// One frame per animation template, Start frames before Stop frames.
export function pickLibraryItems(sport, position, stats = {}, limit = 5, skipTemplates = new Set()) {
  const rank = i => { const s = stats[i.id]; return !s ? 0 : s.best === 'miss' ? 1 : s.best === 'good' ? 2 : 3 + s.plays; };
  const used = new Set(skipTemplates), out = [];
  for (const i of ideasFor(sport, position).map((idea, k) => ({ idea, k })).sort((a, b) => rank(a.idea) - rank(b.idea) || a.k - b.k).map(x => x.idea)) {
    if (out.length >= limit || used.has(i.template)) continue;
    used.add(i.template); out.push(i);
  }
  return out.sort((a, b) => BUCKETS.indexOf(a.bucket || 'start') - BUCKETS.indexOf(b.bucket || 'start'))
    .map(i => itemFromIdea(i, i.bucket || 'start', sport, { fresh: !stats[i.id], retry: stats[i.id]?.best === 'miss' }));
}
