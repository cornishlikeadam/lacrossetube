// The one Supabase client for the browser. Vite fills in the URL and the public (anon or
// publishable) key at build time from SUPABASE_URL and SUPABASE_ANON_KEY. With neither set, the
// site stays fully static and `supabase` is null.
import { createClient } from '@supabase/supabase-js';
import { slot, suffix } from './trial.js';

export const SUPABASE_URL = __LT_SUPABASE_URL__;
const SUPABASE_ANON_KEY = __LT_SUPABASE_ANON_KEY__;

// Each trial slot keeps its own session; outside a trial build there is one.
export const sessionKey = id => `lt-auth${suffix(id)}`;
export const clientFor = id => (SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { storageKey: sessionKey(id) } }) : null);
export const supabase = clientFor(slot);
