// The player loop, as pure rules (no storage, no DOM), so it can be tested:
// XP per challenge, daily and clean-sheet bonuses, tiers, cosmetic unlocks, local-day streaks,
// and a weekly goal of finished updates.
export const XP = { perfect: 150, good: 80, miss: 0 };
export const BONUS = { clean: 50, firstToday: 25 };
export const TIER_XP = 500;
export const WEEKLY_GOAL = 3;
export const UNLOCKS = [
  { tier: 2, id: 'night', name: 'Night Game field', kind: 'Field skin' },
  { tier: 3, id: 'neon', name: 'Neon lines', kind: 'Field skin' },
  { tier: 4, id: 'gold', name: 'Gold chalk', kind: 'Field skin' },
  { tier: 5, id: 'legend', name: 'Legend crown', kind: 'HUD crown' },
];
export const RARITY = ['LOCKED', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'];
export const rarity = n => n >= 8 ? 4 : n >= 5 ? 3 : n >= 3 ? 2 : n >= 1 ? 1 : 0;
const ORDER = { miss: 0, good: 1, perfect: 2 };

export const tierOf = xp => ({ tier: Math.floor(xp / TIER_XP) + 1, into: xp % TIER_XP });
export const unlockedIds = xp => UNLOCKS.filter(u => tierOf(xp).tier >= u.tier).map(u => u.id);
export function nextUnlock(xp) {
  const tier = tierOf(xp).tier, u = UNLOCKS.find(x => x.tier > tier);
  return u ? { ...u, xpToGo: (u.tier - 1) * TIER_XP - xp } : null;
}

// Days are the player's own calendar days, not UTC: an 11 pm session counts for today.
const pad = n => String(n).padStart(2, '0');
export const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayNum = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
export function weekId(d = new Date()) {
  const back = (d.getDay() + 6) % 7; // weeks start on Monday
  return localDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() - back));
}

export function defaultProfile() {
  return { name: '', sport: null, position: null, xp: 0, played: 0, mastery: {}, ideaStats: {}, streak: 0, bestStreak: 0,
    lastPlayed: null, lastBonusDay: null, week: { id: null, done: 0 }, skin: 'default' };
}
export function normalizeProfile(p) {
  const out = { ...defaultProfile(), ...(p || {}) };
  for (const k of ['mastery', 'ideaStats']) if (!out[k] || typeof out[k] !== 'object') out[k] = {};
  if (!out.week || typeof out.week !== 'object') out.week = { id: null, done: 0 };
  if (!Number.isFinite(out.xp)) out.xp = 0;
  return out;
}

// A challenge was played: extend the streak if the last play was yesterday, restart it otherwise.
export function notePlay(profile, now = new Date()) {
  const today = localDay(now), ev = { firstToday: false, streakUp: false };
  if (profile.lastPlayed !== today) {
    const gap = profile.lastPlayed ? dayNum(today) - dayNum(profile.lastPlayed) : null;
    profile.streak = gap === 1 ? (profile.streak || 0) + 1 : 1;
    profile.bestStreak = Math.max(profile.bestStreak || 0, profile.streak);
    profile.lastPlayed = today; ev.streakUp = true;
  }
  if (profile.lastBonusDay !== today) { profile.lastBonusDay = today; ev.firstToday = true; }
  return ev;
}
// The streak still counts today if the last play was today or yesterday.
export function liveStreak(profile, now = new Date()) {
  if (!profile.lastPlayed) return 0;
  return dayNum(localDay(now)) - dayNum(profile.lastPlayed) <= 1 ? profile.streak || 0 : 0;
}
export const weekProgress = (profile, now = new Date()) => profile.week?.id === weekId(now) ? profile.week.done : 0;

const keyOf = item => item.idea || item.concept;
// Record one challenge result. Returns what changed, for the toasts and the done screen.
export function applyResult(profile, update, item, grade, now = new Date()) {
  const key = keyOf(item), prev = update.results[key];
  const gain = Math.max(0, XP[grade] - (prev ? XP[prev] : 0));
  if (!prev || ORDER[grade] > ORDER[prev]) update.results[key] = grade;
  const ev = notePlay(profile, now), notes = [];
  let bonus = 0, badge = null, finished = false, clean = false;
  if (ev.firstToday) { bonus += BONUS.firstToday; notes.push(`+${BONUS.firstToday} XP first play today`); }
  // a badge levels up the first time an idea passes in an update
  if (grade !== 'miss' && (!prev || prev === 'miss')) {
    const before = profile.mastery[item.concept] || 0;
    profile.mastery[item.concept] = before + 1;
    if (rarity(before + 1) > rarity(before)) badge = { concept: item.concept, from: rarity(before), to: rarity(before + 1) };
  }
  const st = profile.ideaStats[key] || { plays: 0, best: null, last: null };
  st.plays++; if (!st.best || ORDER[grade] > ORDER[st.best]) st.best = grade; st.last = localDay(now);
  profile.ideaStats[key] = st;
  const graded = update.items.map(i => update.results[keyOf(i)]);
  if (!update.finished && graded.every(Boolean)) {
    update.finished = true; finished = true;
    const id = weekId(now); if (profile.week?.id !== id) profile.week = { id, done: 0 }; profile.week.done++;
  }
  if (!update.clean && graded.every(g => g && g !== 'miss')) { update.clean = true; clean = true; bonus += BONUS.clean; notes.push(`+${BONUS.clean} XP clean sheet: every frame passed`); }
  const beforeTier = tierOf(profile.xp).tier;
  profile.xp += gain + bonus; update.xp = (update.xp || 0) + gain + bonus;
  const afterTier = tierOf(profile.xp).tier;
  const unlocked = UNLOCKS.filter(u => u.tier > beforeTier && u.tier <= afterTier);
  if (badge) update.badges = [...(update.badges || []), badge];
  if (unlocked.length) update.unlocked = [...(update.unlocked || []), ...unlocked.map(u => u.id)];
  if (notes.length) update.notes = [...(update.notes || []), ...notes];
  return { gain, bonus, notes, badge, finished, clean, tierUp: afterTier > beforeTier ? afterTier : null, unlocked, streak: profile.streak, streakUp: ev.streakUp };
}
