// Automatic earnings for the signed-in person: film beats from the film site, and finished What
// Coach Said games and sessions from /play. Quiet when the site has no team accounts or nobody is
// signed in on this device: the film room and the game work the same without an account.
// The server does the counting and the caps (public.watch_beat, game_complete, wcs_event).
import { supabase } from './supabase.js';

let signedIn = null;
export async function isSignedIn() {
  if (!supabase) return false;
  if (signedIn === null) {
    try { const { data } = await supabase.auth.getSession(); signedIn = Boolean(data.session); } catch { signedIn = false; }
  }
  return signedIn;
}
async function call(name, args) {
  if (!(await isSignedIn())) return null;
  const { data, error } = await supabase.rpc(name, args);
  if (!error) return data;
  if (/jwt|session|sign in/i.test(error.message)) signedIn = false;
  return { error: error.message };
}

// seconds (1-60) during which the film clock was advancing in a visible tab
export const filmBeat = (film, seconds) => call('watch_beat', { p_film: film, p_seconds: seconds });
// key: the idea id (or concept) of one What Coach Said game; grade: perfect, good or miss
export const gameDone = (key, concept, grade) => call('game_complete', { p_key: key, p_concept: concept, p_grade: grade });
// id: the session id inside a coach's team link (/play#t=...); kind: 'open' or 'finish'
export const sessionEvent = (id, kind) => (/^[A-Za-z0-9_-]{1,16}$/.test(String(id)) ? call('wcs_event', { p_session: id, p_kind: kind }) : Promise.resolve(null));
