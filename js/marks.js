// Locker notes and practice cards. Packed links are deflated JSON in the hash.
// Anything read from a link is untrusted: checked, trimmed, then escaped at render.
(function () {
  const SKILLS = ['help', 'slide', 'talk', 'angle', 'pick', 'danger', 'double', 'loose', 'hold', 'disguise', 'hustle', 'sidewall', 'mesh', 'leather', 'goalie'];
  const MARKS_KEY = 'lacrossetube_marks';
  const PRACTICE_KEY = 'lacrossetube_practice';
  const MAX_MARKS = 40;
  const MAX_STEPS = 5;
  const MAX_TEXT = 160;
  const MAX_TITLE = 60;
  const MAX_PACK = 18000;

  function cleanMark(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const t = Number(raw.t);
    if (!Number.isFinite(t) || t < 0 || t > 8 * 3600) return null;
    const text = String(raw.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
    if (!text) return null;
    const skill = SKILLS.includes(raw.skill) ? raw.skill : '';
    const at = Number(raw.at);
    return { v: 1, t: Math.round(t * 10) / 10, text, skill, at: Number.isFinite(at) ? at : Date.now() };
  }

  function cleanId(id) {
    const value = String(id || '');
    return /^[\w-]{1,80}$/.test(value) ? value : '';
  }

  function cleanPractice(raw) {
    if (!raw || raw.v !== 1) return null;
    const title = String(raw.title || 'Practice').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE) || 'Practice';
    const steps = (Array.isArray(raw.steps) ? raw.steps : []).slice(0, MAX_STEPS).map(step => {
      const itemId = cleanId(step?.itemId);
      const t = Number(step?.t);
      if (!itemId || !Number.isFinite(t) || t < 0 || t > 8 * 3600) return null;
      const why = String(step?.why || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
      return { itemId, t: Math.round(t * 10) / 10, why };
    }).filter(Boolean);
    return { v: 1, title, steps };
  }

  function cleanSharedMarks(raw) {
    const itemId = cleanId(raw?.itemId);
    if (!raw || raw.v !== 1 || !itemId) return null;
    const marks = (Array.isArray(raw.marks) ? raw.marks : []).map(cleanMark).filter(Boolean).slice(0, MAX_MARKS);
    return { v: 1, itemId, marks };
  }

  function store() {
    try { return window.localStorage; } catch { return null; }
  }

  function loadMarkMap() {
    try {
      const raw = JSON.parse(store()?.getItem(MARKS_KEY) || '{}');
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
      const out = {};
      for (const [id, list] of Object.entries(raw)) {
        const itemId = cleanId(id);
        if (!itemId || !Array.isArray(list)) continue;
        const marks = list.map(cleanMark).filter(Boolean).slice(0, MAX_MARKS);
        if (marks.length) out[itemId] = marks;
      }
      return out;
    } catch {
      return {};
    }
  }

  function writeMarkMap(map) {
    store()?.setItem(MARKS_KEY, JSON.stringify(map));
  }

  function marksFor(itemId) {
    return (loadMarkMap()[cleanId(itemId)] || []).slice();
  }

  function setMarks(itemId, marks) {
    const id = cleanId(itemId);
    if (!id) return [];
    const map = loadMarkMap();
    const clean = (marks || []).map(cleanMark).filter(Boolean).slice(0, MAX_MARKS);
    if (clean.length) map[id] = clean;
    else delete map[id];
    writeMarkMap(map);
    return clean;
  }

  function loadPractice() {
    try {
      return cleanPractice(JSON.parse(store()?.getItem(PRACTICE_KEY) || 'null')) || { v: 1, title: 'Practice', steps: [] };
    } catch {
      return { v: 1, title: 'Practice', steps: [] };
    }
  }

  function savePractice(practice) {
    const clean = cleanPractice(practice) || { v: 1, title: 'Practice', steps: [] };
    store()?.setItem(PRACTICE_KEY, JSON.stringify(clean));
    return clean;
  }

  const enc = bytes => {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const dec = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));

  async function through(bytes, Stream) {
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new Stream('deflate-raw'))).arrayBuffer());
  }

  async function pack(obj) {
    const json = new TextEncoder().encode(JSON.stringify(obj));
    let token;
    if (typeof CompressionStream === 'function') {
      try { token = 'z' + enc(await through(json, CompressionStream)); }
      catch { token = ''; }
    }
    if (!token) token = 'j' + enc(json);
    if (token.length > MAX_PACK) throw new Error('This link is too long. Shorten the notes and try again.');
    return token;
  }

  async function unpack(token) {
    if (typeof token !== 'string' || token.length < 2 || token.length > MAX_PACK) throw new Error('The link is empty or too long.');
    const bytes = dec(token.slice(1));
    const raw = token[0] === 'z' && typeof DecompressionStream === 'function'
      ? await through(bytes, DecompressionStream)
      : bytes;
    const text = new TextDecoder().decode(raw);
    if (text.length > 100000) throw new Error('The link is too large.');
    return JSON.parse(text);
  }

  async function readHash(input) {
    const match = String(input || '').match(/#([mp])=([A-Za-z0-9_-]+)/);
    if (!match) return null;
    try {
      const data = await unpack(match[2]);
      if (match[1] === 'm') {
        const marks = cleanSharedMarks(data);
        return marks ? { kind: 'm', data: marks } : null;
      }
      const practice = cleanPractice(data);
      return practice ? { kind: 'p', data: practice } : null;
    } catch {
      return null;
    }
  }

  function fmt(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const m = Math.floor(s / 60);
    return m + ':' + String(s % 60).padStart(2, '0');
  }

  globalThis.LT = {
    SKILLS, MAX_STEPS, MAX_TEXT, cleanMark, cleanPractice, cleanSharedMarks,
    marksFor, setMarks, loadPractice, savePractice, pack, unpack, readHash, fmt
  };
})();
