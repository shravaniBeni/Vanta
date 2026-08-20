/**
 * server/src/middleware/auth.js
 *
 * Express JWT authentication middleware using Supabase.
 *
 * Flow:
 *   1. Read the Authorization header.
 *   2. Require format: Bearer <token>
 *   3. Call supabase.auth.getUser(token) — no custom JWT verification.
 *   4. If valid, attach { id, email } to req.user and call next().
 *   5. Otherwise return a 401 with a consistent JSON error body.
 *
 * Error responses never leak Supabase internals or token values.
 */

import supabase from '../supabase.js';

/**
 * requireAuth — middleware that enforces a valid Supabase JWT.
 * Attach to any route or router that requires authentication.
 */
export async function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];

  // 1. Presence check
  if (!authHeader) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // 2. Format check — must be "Bearer <token>"
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer' || !parts[1]) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = parts[1];

  // 3. Verify via Supabase — no local JWT parsing
  let user;
  try {
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      // Distinguish expired/invalid from unexpected service errors for
      // logging purposes, but return the same message to the caller.
      const isAuthError =
        error?.status === 401 ||
        error?.status === 403 ||
        error?.message?.toLowerCase().includes('invalid') ||
        error?.message?.toLowerCase().includes('expired') ||
        error?.message?.toLowerCase().includes('jwt');

      if (!isAuthError && error) {
        // Unexpected error from the auth service — log server-side only
        console.error('[auth] Supabase auth service error:', error.message);
        return res.status(401).json({ error: 'Authentication service error' });
      }

      return res.status(401).json({ error: 'Invalid or expired authentication token' });
    }

    user = data.user;
  } catch (err) {
    // Network or unexpected runtime error talking to Supabase
    console.error('[auth] Unexpected auth error:', err.message);
    return res.status(401).json({ error: 'Authentication service error' });
  }

  // 4. Attach minimal user info to request — do not attach the raw token
  req.user = {
    id: user.id,
    email: user.email,
  };

  next();
}
