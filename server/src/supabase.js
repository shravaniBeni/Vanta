/**
 * server/src/supabase.js
 *
 * Supabase service-role client singleton.
 * Uses the SERVICE ROLE KEY — bypasses all RLS policies.
 * This module is server-side only. Never import it in frontend code.
 *
 * Fails clearly at module load time if required env vars are missing,
 * so misconfiguration surfaces immediately on startup rather than at
 * the first request.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  // Log which variable is missing without printing any key values.
  const missing = [
    !SUPABASE_URL && 'SUPABASE_URL',
    !SUPABASE_SERVICE_ROLE_KEY && 'SUPABASE_SERVICE_ROLE_KEY',
  ].filter(Boolean).join(', ');

  throw new Error(
    `[supabase] Missing required environment variable(s): ${missing}. ` +
    'Set them in server/.env before starting the server.'
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    // Disable automatic session persistence — the server is stateless.
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

export default supabase;
