/**
 * server/src/routes/projects.js
 *
 * Project CRUD routes — all require authentication.
 * Mounted at /api/projects in index.js.
 *
 * GET    /api/projects         — list user's projects
 * POST   /api/projects         — create a project
 * PATCH  /api/projects/:id     — update name/description/metadata
 * DELETE /api/projects/:id     — delete (blocked if RAG apps exist)
 */

import { Router } from 'express';
import supabase from '../supabase.js';
import { getOwnedProject } from '../helpers.js';

const router = Router();

// ─── List user's projects ────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('user_id', req.user.id)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('[projects GET /]', error.message);
      return res.status(500).json({ error: 'Failed to fetch projects' });
    }

    res.json(data ?? []);
  } catch (err) {
    console.error('[projects GET /]', err.message);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// ─── Create a project ────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  const { name, description, metadata } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'name is required' });
  }

  try {
    const { data, error } = await supabase
      .from('projects')
      .insert({
        user_id: req.user.id,
        name: name.trim(),
        description: description?.trim() ?? '',
        metadata: metadata && typeof metadata === 'object' ? metadata : {},
      })
      .select()
      .single();

    if (error) {
      console.error('[projects POST /]', error.message);
      return res.status(500).json({ error: 'Failed to create project' });
    }

    res.status(201).json(data);
  } catch (err) {
    console.error('[projects POST /]', err.message);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// ─── Update a project ────────────────────────────────────────────────────────

router.patch('/:id', async (req, res) => {
  try {
    const existing = await getOwnedProject(req.params.id, req.user.id);
    if (!existing) return res.status(404).json({ error: 'Project not found' });

    // Only allow updating these fields — never user_id or created_at
    const allowed = ['name', 'description', 'metadata'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.json(existing);
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('projects')
      .update(updates)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single();

    if (error) {
      console.error('[projects PATCH /:id]', error.message);
      return res.status(500).json({ error: 'Failed to update project' });
    }

    res.json(data);
  } catch (err) {
    console.error('[projects PATCH /:id]', err.message);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// ─── Delete a project ────────────────────────────────────────────────────────

router.delete('/:id', async (req, res) => {
  try {
    const existing = await getOwnedProject(req.params.id, req.user.id);
    if (!existing) return res.status(404).json({ error: 'Project not found' });

    // Check for RAG apps — rag_apps.project_id has ON DELETE RESTRICT so
    // Postgres would reject the delete anyway, but we return a clear 409
    // rather than a raw Postgres error.
    const { count, error: countErr } = await supabase
      .from('rag_apps')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', req.params.id);

    if (countErr) {
      console.error('[projects DELETE /:id] count error:', countErr.message);
      return res.status(500).json({ error: 'Failed to check project contents' });
    }

    if (count > 0) {
      return res.status(409).json({
        error: 'Project contains RAG applications and cannot be deleted',
      });
    }

    const { error: deleteErr } = await supabase
      .from('projects')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (deleteErr) {
      console.error('[projects DELETE /:id]', deleteErr.message);
      return res.status(500).json({ error: 'Failed to delete project' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[projects DELETE /:id]', err.message);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

export default router;
