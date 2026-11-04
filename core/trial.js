// The preview trial. It exists only in builds that point at the lacrossetube-dev project (or a
// local stack): Vite sets __LT_TRIAL__ then, and leaves the trial and owner pages out otherwise.
// In a trial build one browser can hold several people at once, each in their own slot (their
// own key store and session), so the whole flow can be tried without private windows.
export const TRIAL = typeof __LT_TRIAL__ !== 'undefined' && __LT_TRIAL__;
export const PEOPLE = [
  { id: 'coach', label: 'Coach' },
  { id: 'p1', label: 'Player 1' },
  { id: 'p2', label: 'Player 2' },
  { id: 'p3', label: 'Player 3' },
];
const KEY = 'lt-trial-person';
const read = () => { try { return globalThis.localStorage?.getItem(KEY) || ''; } catch { return ''; } };

// The slot this page uses. Fixed for the life of the page; switching reloads into another slot.
export const slot = TRIAL ? read() : '';
export const slotLabel = id => PEOPLE.find(p => p.id === id)?.label || 'You';
export function useSlot(id) { if (TRIAL) localStorage.setItem(KEY, id); }
export const suffix = id => (id ? `:${id}` : '');

// Invite links the coach desk made during the trial, newest per person. Trial builds only.
const INVITES = 'lt-trial-invites';
export function trialInvites() {
  if (!TRIAL) return [];
  try { return JSON.parse(localStorage.getItem(INVITES) || '[]'); } catch { return []; }
}
export function rememberInvite(inv) {
  if (!TRIAL) return;
  const rest = trialInvites().filter(i => i.person !== inv.person);
  localStorage.setItem(INVITES, JSON.stringify([...rest, { ...inv, used: false }]));
}
export function markInviteUsed(link, by) {
  if (!TRIAL) return;
  localStorage.setItem(INVITES, JSON.stringify(trialInvites().map(i => (i.link === link ? { ...i, used: true, by } : i))));
}
