/**
 * server/src/routes/workflow.js
 *
 * Phase 9A: Draft workflow management and capability registry.
 *
 * All routes require authentication. Ownership is verified against rag_apps.user_id.
 *
 * GET  /api/workflow/registry          — capability registry
 * GET  /api/workflow/:ragAppId         — get active + draft workflow
 * PATCH /api/workflow/:ragAppId/draft  — save draft (does NOT touch active)
 * DELETE /api/workflow/:ragAppId/draft — discard draft (restore visual to active)
 * POST /api/workflow/:ragAppId/diff    — compute diff between active and draft
 * POST /api/workflow/:ragAppId/validate — validate a workflow topology
 */

import { Router } from 'express';
import supabase from '../supabase.js';
import { getOwnedRagApp } from '../helpers.js';
import { getAllCapabilities } from '../nodeCapabilityRegistry.js';
import { diffWorkflow, validateWorkflow } from '../workflowUtils.js';

const router = Router();

// ─── GET /api/workflow/registry ───────────────────────────────────────────────
// Returns the full capability registry for all node types.
// Used by the Editor to render status badges and filter palette.

router.get('/registry', (req, res) => {
  res.json(getAllCapabilities());
});

// ─── GET /api/workflow/:ragAppId ──────────────────────────────────────────────
// Returns active workflow and current draft (if any).

router.get('/:ragAppId', async (req, res) => {
  try {
    const ragApp = await getOwnedRagApp(req.params.ragAppId, req.user.id);
    if (!ragApp) return res.status(404).json({ error: 'RAG app not found' });

    const hasDraft = ragApp.draft_nodes !== null && ragApp.draft_nodes !== undefined;

    res.json({
      rag_app_id:        ragApp.id,
      // Active workflow — what the runtime uses
      active: {
        nodes:       ragApp.nodes       ?? [],
        connections: ragApp.connections ?? [],
      },
      // Draft workflow — canvas edits not yet activated
      draft: hasDraft ? {
        nodes:       ragApp.draft_nodes       ?? [],
        connections: ragApp.draft_connections ?? [],
        updated_at:  ragApp.draft_updated_at,
      } : null,
      has_draft:         hasDraft,
      architect_version: ragApp.architect_version,
    });
  } catch (err) {
    console.error('[workflow GET /:ragAppId]', err.message);
    res.status(500).json({ error: 'Failed to fetch workflow' });
  }
});

// ─── PATCH /api/workflow/:ragAppId/draft ──────────────────────────────────────
// Save canvas changes as draft. Does NOT modify nodes/connections (active).
// This is the new "Save Draft" action that replaces direct-to-active saves.

router.patch('/:ragAppId/draft', async (req, res) => {
  const { nodes, connections } = req.body;

  if (!Array.isArray(nodes)) {
    return res.status(400).json({ error: 'nodes must be an array' });
  }
  if (!Array.isArray(connections)) {
    return res.status(400).json({ error: 'connections must be an array' });
  }

  try {
    const ragApp = await getOwnedRagApp(req.params.ragAppId, req.user.id);
    if (!ragApp) return res.status(404).json({ error: 'RAG app not found' });

    const { error: updateErr } = await supabase
      .from('rag_apps')
      .update({
        draft_nodes:       nodes,
        draft_connections: connections,
        draft_updated_at:  new Date().toISOString(),
      })
      .eq('id', req.params.ragAppId)
      .eq('user_id', req.user.id);

    if (updateErr) {
      console.error('[workflow PATCH draft]', updateErr.message);
      return res.status(500).json({ error: 'Failed to save draft' });
    }

    res.json({
      rag_app_id:       req.params.ragAppId,
      draft_saved:      true,
      draft_updated_at: new Date().toISOString(),
      node_count:       nodes.length,
      connection_count: connections.length,
    });
  } catch (err) {
    console.error('[workflow PATCH draft]', err.message);
    res.status(500).json({ error: 'Failed to save draft' });
  }
});

// ─── DELETE /api/workflow/:ragAppId/draft ─────────────────────────────────────
// Discard the current draft. Sets draft_nodes/connections back to NULL.
// After this, the Editor canvas should reset to the active workflow.

router.delete('/:ragAppId/draft', async (req, res) => {
  try {
    const ragApp = await getOwnedRagApp(req.params.ragAppId, req.user.id);
    if (!ragApp) return res.status(404).json({ error: 'RAG app not found' });

    const { error: updateErr } = await supabase
      .from('rag_apps')
      .update({
        draft_nodes:       null,
        draft_connections: null,
        draft_updated_at:  null,
      })
      .eq('id', req.params.ragAppId)
      .eq('user_id', req.user.id);

    if (updateErr) {
      console.error('[workflow DELETE draft]', updateErr.message);
      return res.status(500).json({ error: 'Failed to discard draft' });
    }

    res.json({
      rag_app_id:   req.params.ragAppId,
      draft_cleared: true,
    });
  } catch (err) {
    console.error('[workflow DELETE draft]', err.message);
    res.status(500).json({ error: 'Failed to discard draft' });
  }
});

// ─── POST /api/workflow/:ragAppId/diff ────────────────────────────────────────
// Compute a structured diff between active and draft (or a provided workflow).
// Body: { nodes?, connections? } — if provided, diffs active vs body;
//                                  otherwise diffs active vs stored draft.

router.post('/:ragAppId/diff', async (req, res) => {
  try {
    const ragApp = await getOwnedRagApp(req.params.ragAppId, req.user.id);
    if (!ragApp) return res.status(404).json({ error: 'RAG app not found' });

    const active = {
      nodes:       ragApp.nodes       ?? [],
      connections: ragApp.connections ?? [],
    };

    // Use body if provided, otherwise use stored draft
    const draft = (req.body.nodes !== undefined)
      ? { nodes: req.body.nodes ?? [], connections: req.body.connections ?? [] }
      : { nodes: ragApp.draft_nodes ?? [], connections: ragApp.draft_connections ?? [] };

    const diff = diffWorkflow(active, draft);

    res.json({ rag_app_id: req.params.ragAppId, diff });
  } catch (err) {
    console.error('[workflow POST diff]', err.message);
    res.status(500).json({ error: 'Failed to compute diff' });
  }
});

// ─── POST /api/workflow/:ragAppId/validate ────────────────────────────────────
// Validate a workflow topology against the capability registry.
// Body: { nodes, connections } — validates the provided workflow.
// If no body provided, validates the current draft (or active if no draft).

router.post('/:ragAppId/validate', async (req, res) => {
  try {
    const ragApp = await getOwnedRagApp(req.params.ragAppId, req.user.id);
    if (!ragApp) return res.status(404).json({ error: 'RAG app not found' });

    let nodes, connections;

    if (req.body.nodes !== undefined) {
      nodes       = req.body.nodes       ?? [];
      connections = req.body.connections ?? [];
    } else if (ragApp.draft_nodes !== null && ragApp.draft_nodes !== undefined) {
      nodes       = ragApp.draft_nodes       ?? [];
      connections = ragApp.draft_connections ?? [];
    } else {
      nodes       = ragApp.nodes       ?? [];
      connections = ragApp.connections ?? [];
    }

    const result = validateWorkflow(nodes, connections);

    res.json({
      rag_app_id: req.params.ragAppId,
      ...result,
    });
  } catch (err) {
    console.error('[workflow POST validate]', err.message);
    res.status(500).json({ error: 'Failed to validate workflow' });
  }
});

export default router;
