/**
 * client/src/lib/supabaseClient.js
 *
 * Browser-safe Supabase client using the anon key.
 * Do NOT use the service-role key here — ever.
 * RLS policies control what authenticated users can access.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  const missing = [
    !SUPABASE_URL      && 'VITE_SUPABASE_URL',
    !SUPABASE_ANON_KEY && 'VITE_SUPABASE_ANON_KEY',
  ].filter(Boolean).join(', ');
  // Throw at module load so misconfiguration is caught immediately in dev
  throw new Error(
    `[supabaseClient] Missing env variable(s): ${missing}. ` +
    'Add them to client/.env — they are browser-safe (anon key only).'
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default supabase;
