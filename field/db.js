// Onboard database. Everything lives in this browser (IndexedDB): the player's profile, XP,
// mastery, streaks, every update they played, and the coach's sessions and roster.
// Nothing is sent to a server. If IndexedDB is blocked, the app keeps working from memory.
import { normalizeProfile } from './progress.js';

const NAME = 'lacrossetube-field', VERSION = 1;
let dbp = null; const mem = { kv: new Map(), updates: [] };

function open() {
  if (dbp) return dbp;
  dbp = new Promise(resolve => {
    try {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('updates')) db.createObjectStore('updates', { keyPath: 'id', autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbp;
}
async function run(store, mode, fn) {
  const db = await open(); if (!db) return null;
  return new Promise(resolve => {
    try { const tx = db.transaction(store, mode), r = fn(tx.objectStore(store)); tx.oncomplete = () => resolve(r?.result ?? null); tx.onerror = () => resolve(null); }
    catch { resolve(null); }
  });
}

export const db = {
  async get(key) { const v = await run('kv', 'readonly', s => s.get(key)); return v ?? mem.kv.get(key) ?? null; },
  async set(key, val) { mem.kv.set(key, val); await run('kv', 'readwrite', s => s.put(val, key)); },
  async addUpdate(u) { const id = await run('updates', 'readwrite', s => s.add(u)); const rec = { ...u, id: id ?? Date.now() }; if (id == null) mem.updates.push(rec); return rec.id; },
  async putUpdate(u) { const ok = await run('updates', 'readwrite', s => s.put(u)); if (ok == null) { const i = mem.updates.findIndex(x => x.id === u.id); if (i >= 0) mem.updates[i] = u; } },
  async listUpdates() { const all = await run('updates', 'readonly', s => s.getAll()); return (all ?? mem.updates).slice().sort((a, b) => b.id - a.id); },
  async getUpdate(id) { return (await run('updates', 'readonly', s => s.get(id))) ?? mem.updates.find(u => u.id === id) ?? null; },
};

export const loadProfile = async () => normalizeProfile(await db.get('profile'));
export const saveProfile = p => db.set('profile', p);

// Coach side: team sessions this device made, results players sent back, and rosters per team.
export async function loadCoach() {
  const c = (await db.get('coach')) || {};
  return { sessions: {}, reports: {}, rosters: {}, active: null, ...c };
}
export const saveCoach = c => db.set('coach', c);
