/**
 * server/src/helpers.js
 *
 * Reusable ownership-validation and convenience helpers for Supabase queries.
 * All helpers use the service-role client and enforce user_id scoping in the
 * query itself — they do not rely on RLS to filter results.
 *
 * Phase 3 usage:
 *   getOwnedRagApp(ragAppId, userId)      — fetch a rag_app owned by userId
 *   getOwnedProject(projectId, userId)    — fetch a project owned by userId
 *   getOrCreateDefaultProject(userId)     — return (or create) a default project
 */

import supabase from './supabase.js';

// ─── RAG Apps ─────────────────────────────────────────────────────────────────

/**
 * Fetch a rag_app row only if it is owned by userId.
 * Returns null if not found or not owned — callers should return 404.
 * Never returns a row owned by a different user.
 *
 * @param {string} ragAppId
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
export async function getOwnedRagApp(ragAppId, userId) {
  const { data, error } = await supabase
    .from('rag_apps')
    .select('*')
    .eq('id', ragAppId)
    .eq('user_id', userId)
    .single();

  if (error || !data) return null;
  return data;
}

// ─── Projects ─────────────────────────────────────────────────────────────────

/**
 * Fetch a project only if it is owned by userId.
 * Returns null if not found or not owned.
 *
 * @param {string} projectId
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
export async function getOwnedProject(projectId, userId) {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .eq('user_id', userId)
    .single();

  if (error || !data) return null;
  return data;
}

/**
 * Return the user's default project, or create one if none exists.
 *
 * Preference order:
 *   1. A project whose metadata contains { "is_default": true } owned by userId
 *   2. The most recently created project owned by userId
 *   3. A newly created project named "My Project" with { "is_default": true }
 *
 * Creating multiple default projects on concurrent requests is avoided by
 * checking for any existing project first. The is_default flag is a metadata
 * hint, not a unique constraint — if a user later creates projects manually,
 * the first project returned by step 2 is used.
 *
 * @param {string} userId
 * @returns {Promise<object>} — the project row (never null; throws on DB error)
 */
export async function getOrCreateDefaultProject(userId) {
  // 1. Look for a project explicitly marked as default
  const { data: defaultProjects } = await supabase
    .from('projects')
    .select('*')
    .eq('user_id', userId)
    .contains('metadata', { is_default: true })
    .limit(1);

  if (defaultProjects?.length) return defaultProjects[0];

  // 2. Fall back to the most recent project for this user
  const { data: anyProjects } = await supabase
    .from('projects')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (anyProjects?.length) return anyProjects[0];

  // 3. No projects exist — create the default project
  const { data: created, error } = await supabase
    .from('projects')
    .insert({
      user_id: userId,
      name: 'My Project',
      description: 'Default Vanta project',
      metadata: { is_default: true },
    })
    .select()
    .single();

  if (error || !created) {
    throw new Error(`[helpers] Failed to create default project for user: ${error?.message}`);
  }

  return created;
}
