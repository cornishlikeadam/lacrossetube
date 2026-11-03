// The one Supabase client for the browser. Vite fills in the URL and the public (anon or
// publishable) key at build time from SUPABASE_URL and SUPABASE_ANON_KEY. With neither set, the
// site stays fully static and `supabase` is null.
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = __LT_SUPABASE_URL__;
const SUPABASE_ANON_KEY = __LT_SUPABASE_ANON_KEY__;

export const supabase = SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
