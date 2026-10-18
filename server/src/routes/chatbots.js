/**
 * server/src/routes/chatbots.js
 *
 * Phase 3: Chatbot (rag_apps) routes — fully migrated to Supabase PostgreSQL.
 * SQLite is no longer used by this file.
 *
 * Temporary persistence split (resolved in later phases):
 *   rag_apps        → Supabase  ✅ (this file)
 *   projects        → Supabase  ✅ (projects.js)
 *   document_chunks → SQLite    (migrated in Phase 4)
 *   chat_messages   → SQLite    (migrated in Phase 5)
 *
 * Public API contract (unchanged from Phase 1):
 *   GET    /api/chatbots              — list user's apps (auth required)
 *   GET    /api/chatbots?embed_id=X   — public embed lookup (no auth, deployed only)
 *   GET    /api/chatbots?id=X         — get by id (auth required)
 *   GET    /api/chatbots/:id          — get by id (auth required)
 *   POST   /api/chatbots/generate     — AI-generate workflow (auth required)
 *   POST   /api/chatbots              — manual create (auth required)
 *   PATCH  /api/chatbots/:id          — update fields (auth required, owner only)
 *   DELETE /api/chatbots/:id          — delete (auth required, owner only)
 */

import { Router } from 'express';
import supabase from '../supabase.js';
import { invokeLLMJson } from '../openai.js';
import { getOwnedRagApp, getOwnedProject, getOrCreateDefaultProject } from '../helpers.js';

const router = Router();

// ─── Response shape ───────────────────────────────────────────────────────────
//
// The frontend currently uses these fields from the chatbot response:
//   id, title, description, status, embed_id, nodes, connections,
//   created_at, updated_at
//
// Phase 3 adds (additive — frontend ignores unknown fields):
//   project_id, architect_plan, architect_status, architect_version
//
// Fields removed (were SQLite-only, never used by the active frontend):
//   amd_enabled, sample_documents

/**
 * Format a rag_apps row into the API response shape.
 * JSONB columns (nodes, connections, architect_plan) are already parsed
 * by Supabase JS client — no manual JSON.parse needed.
 */
function formatApp(row) {
  return {
    id:                row.id,
    title:             row.title,
    description:       row.description,
    status:            row.status,
    embed_id:          row.embed_id,
    nodes:             row.nodes             ?? [],
    connections:       row.connections       ?? [],
    project_id:        row.project_id,
    architect_plan:    row.architect_plan    ?? null,
    architect_status:  row.architect_status,
    architect_version: row.architect_version,
    // Phase 9A: draft workflow fields
    draft_nodes:       row.draft_nodes       ?? null,
    draft_connections: row.draft_connections ?? null,
    draft_updated_at:  row.draft_updated_at  ?? null,
    // Phase 10B: UI configuration (separate from RAG workflow)
    ui_config:         row.ui_config         ?? null,
    created_at:        row.created_at,
    updated_at:        row.updated_at,
  };
}

// ─── GET /api/chatbots ────────────────────────────────────────────────────────
//
// Handles three patterns:
//   1. ?embed_id=X  — public embed lookup (no auth guard in index.js chatbotAuth)
//   2. ?id=X        — single app by id (auth required, returns array for compat)
//   3. (none)       — list all apps owned by authenticated user

router.get('/', async (req, res) => {
  const { id, embed_id } = req.query;

  try {
    // ── Public embed lookup ───────────────────────────────────────────────────
    if (embed_id) {
      // Must be deployed. Return only minimal public-safe fields.
      const { data, error } = await supabase
        .from('rag_apps')
        .select('id, title, description, embed_id, nodes, connections, status, ui_config')
        .eq('embed_id', embed_id)
        .eq('status', 'deployed')
        .single();

      if (error || !data) {
        // Return empty array — consistent with old SQLite behavior, Chat.jsx
        // checks array.length > 0 to decide whether to load the chatbot.
        return res.json([]);
      }

      // Return only public-safe fields — no user_id, project_id, architect_plan
      return res.json([{
        id:          data.id,
        title:       data.title,
        description: data.description,
        embed_id:    data.embed_id,
        nodes:       data.nodes       ?? [],
        connections: data.connections ?? [],
        status:      data.status,
        ui_config:   data.ui_config   ?? null,
      }]);
    }

    // ── Filter by id ──────────────────────────────────────────────────────────
    if (id) {
      const app = await getOwnedRagApp(id, req.user.id);
      if (!app) return res.json([]);
      return res.json([formatApp(app)]);
    }

    // ── List all user's apps ──────────────────────────────────────────────────
    const { data, error } = await supabase
      .from('rag_apps')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[chatbots GET /]', error.message);
      return res.status(500).json({ error: 'Failed to fetch chatbots' });
    }

    res.json((data ?? []).map(formatApp));
  } catch (err) {
    console.error('[chatbots GET /]', err.message);
    res.status(500).json({ error: 'Failed to fetch chatbots' });
  }
});

// ─── GET /api/chatbots/:id ────────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const app = await getOwnedRagApp(req.params.id, req.user.id);
    // Return 404 regardless of whether the app exists for a different user.
    if (!app) return res.status(404).json({ error: 'Chatbot not found' });
    res.json(formatApp(app));
  } catch (err) {
    console.error('[chatbots GET /:id]', err.message);
    res.status(500).json({ error: 'Failed to fetch chatbot' });
  }
});

// ─── POST /api/chatbots/create-draft ─────────────────────────────────────────
//
// Creates a minimal draft rag_app with no workflow nodes.
// Used by the new "Create New RAG" flow that routes directly to the Architect.
// No LLM call. No node generation.

router.post('/create-draft', async (req, res) => {
  const { description, project_id: requestedProjectId } = req.body;
  if (!description || typeof description !== 'string' || description.trim().length === 0) {
    return res.status(400).json({ error: 'description is required' });
  }

  try {
    // Resolve project
    let project;
    if (requestedProjectId) {
      project = await getOwnedProject(requestedProjectId, req.user.id);
      if (!project) return res.status(404).json({ error: 'Project not found' });
    } else {
      project = await getOrCreateDefaultProject(req.user.id);
    }

    // Derive a working title from the description (first sentence or first 60 chars)
    const rawTitle = description.trim().split(/[.!?\n]/)[0].trim();
    const title    = rawTitle.length > 60 ? rawTitle.slice(0, 57) + '...' : rawTitle || 'New RAG App';

    const { data, error } = await supabase
      .from('rag_apps')
      .insert({
        user_id:           req.user.id,
        project_id:        project.id,
        title,
        description:       description.trim(),
        status:            'draft',
        nodes:             [],
        connections:       [],
        architect_status:  'pending',
        architect_plan:    null,
        architect_version: 0,
      })
      .select()
      .single();

    if (error || !data) {
      console.error('[chatbots POST /create-draft]', error?.message);
      return res.status(500).json({ error: 'Failed to create RAG app' });
    }

    res.status(201).json(formatApp(data));
  } catch (err) {
    console.error('[chatbots POST /create-draft]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/chatbots/generate ─────────────────────────────────────────────
//
// Note: Express matches routes in registration order. Because this file is
// used as a sub-router mounted at /api/chatbots, '/generate' is registered
// before '/:id' so there is no route conflict.

router.post('/generate', async (req, res) => {
  const { description, project_id: requestedProjectId } = req.body;
  if (!description || typeof description !== 'string' || description.trim().length === 0) {
    return res.status(400).json({ error: 'description is required' });
  }

  try {
    // ── Resolve project ───────────────────────────────────────────────────────
    let project;
    if (requestedProjectId) {
      project = await getOwnedProject(requestedProjectId, req.user.id);
      if (!project) return res.status(404).json({ error: 'Project not found' });
    } else {
      project = await getOrCreateDefaultProject(req.user.id);
    }

    // ── Generate workflow via LLM ─────────────────────────────────────────────
    const generated = await invokeLLMJson(`
You are a RAG workflow generator. Given a user's plain English description of a chatbot, generate a complete RAG workflow.

User description: "${description.trim()}"

Generate a workflow with appropriate nodes from: DocumentUpload, WebCrawler, OCR, TextSplitter, DocumentProcessor, Embeddings, VectorStore, LLM, APIIntegration, ChatOutput

Rules:
- Always include at minimum: DocumentUpload, TextSplitter, Embeddings, VectorStore, LLM, ChatOutput
- Add APIIntegration if the use case needs real-time external data (orders, inventory, live prices)
- Position nodes left-to-right. x from 100 to 900, y between 150 and 350
- chunk_size: FAQ=500, Legal=1500, General=1000
- LLM temperature: factual/support=0.3, conversational=0.7

Return ONLY valid JSON:
{
  "title": "descriptive title",
  "nodes": [
    {"id":"1","type":"DocumentUpload","label":"Upload Documents","x":100,"y":200,"params":{}},
    {"id":"2","type":"TextSplitter","label":"Split Text","x":300,"y":200,"params":{"chunk_size":1000,"overlap":200}},
    {"id":"3","type":"Embeddings","label":"Embeddings","x":500,"y":200,"params":{"model":"text-embedding-3-small"}},
    {"id":"4","type":"VectorStore","label":"Vector Store","x":700,"y":200,"params":{"type":"FAISS"}},
    {"id":"5","type":"LLM","label":"Language Model","x":500,"y":350,"params":{"model":"gpt-3.5-turbo","temperature":0.7}},
    {"id":"6","type":"ChatOutput","label":"Chat Output","x":700,"y":350,"params":{}}
  ],
  "connections":[
    {"from":"1","to":"2"},{"from":"2","to":"3"},{"from":"3","to":"4"},
    {"from":"4","to":"5"},{"from":"5","to":"6"}
  ]
}
`);

    // ── Insert into Supabase ──────────────────────────────────────────────────
    const { data, error } = await supabase
      .from('rag_apps')
      .insert({
        user_id:           req.user.id,
        project_id:        project.id,
        title:             generated.title || 'Untitled Chatbot',
        description:       description.trim(),
        status:            'draft',
        nodes:             generated.nodes        ?? [],
        connections:       generated.connections  ?? [],
        architect_status:  'pending',
        architect_version: 0,
      })
      .select()
      .single();

    if (error || !data) {
      console.error('[chatbots POST /generate]', error?.message);
      return res.status(500).json({ error: 'Failed to create chatbot' });
    }

    res.status(201).json(formatApp(data));
  } catch (err) {
    console.error('[chatbots POST /generate]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/chatbots ───────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  const { title, description, status, nodes, connections, project_id: requestedProjectId } = req.body;

  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return res.status(400).json({ error: 'title is required' });
  }

  try {
    let project;
    if (requestedProjectId) {
      project = await getOwnedProject(requestedProjectId, req.user.id);
      if (!project) return res.status(404).json({ error: 'Project not found' });
    } else {
      project = await getOrCreateDefaultProject(req.user.id);
    }

    const { data, error } = await supabase
      .from('rag_apps')
      .insert({
        user_id:           req.user.id,
        project_id:        project.id,
        title:             title.trim(),
        description:       description?.trim() ?? '',
        status:            status ?? 'draft',
        nodes:             Array.isArray(nodes)       ? nodes       : [],
        connections:       Array.isArray(connections) ? connections : [],
        architect_status:  'pending',
        architect_version: 0,
      })
      .select()
      .single();

    if (error || !data) {
      console.error('[chatbots POST /]', error?.message);
      return res.status(500).json({ error: 'Failed to create chatbot' });
    }

    res.status(201).json(formatApp(data));
  } catch (err) {
    console.error('[chatbots POST /]', err.message);
    res.status(500).json({ error: 'Failed to create chatbot' });
  }
});

// ─── PATCH /api/chatbots/:id ──────────────────────────────────────────────────

router.patch('/:id', async (req, res) => {
  try {
    const existing = await getOwnedRagApp(req.params.id, req.user.id);
    if (!existing) return res.status(404).json({ error: 'Chatbot not found' });

    // Fields the frontend/API can update. user_id and created_at are never
    // updatable. project_id is only updated if the caller supplies a valid
    // project they own.
    const allowed = ['title', 'description', 'status', 'embed_id', 'nodes', 'connections'];
    const updates = {};

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }

    // Allow architect fields (additive, no logic attached)
    if (req.body.architect_plan    !== undefined) updates.architect_plan    = req.body.architect_plan;
    if (req.body.architect_status  !== undefined) updates.architect_status  = req.body.architect_status;
    if (req.body.architect_version !== undefined) updates.architect_version = req.body.architect_version;

    // Optional project reassignment — validate ownership
    if (req.body.project_id !== undefined) {
      const newProject = await getOwnedProject(req.body.project_id, req.user.id);
      if (!newProject) return res.status(404).json({ error: 'Project not found' });
      updates.project_id = req.body.project_id;
    }

    if (Object.keys(updates).length === 0) {
      return res.json(formatApp(existing));
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('rag_apps')
      .update(updates)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single();

    if (error || !data) {
      console.error('[chatbots PATCH /:id]', error?.message);
      return res.status(500).json({ error: 'Failed to update chatbot' });
    }

    res.json(formatApp(data));
  } catch (err) {
    console.error('[chatbots PATCH /:id]', err.message);
    res.status(500).json({ error: 'Failed to update chatbot' });
  }
});

// ─── DELETE /api/chatbots/:id ─────────────────────────────────────────────────
//
// Deletes a rag_app and all its associated data.
// Storage objects must be explicitly deleted — ON DELETE CASCADE only handles DB rows.
//
// Deletion order:
//   1. Verify ownership
//   2. Collect all document storage_path values
//   3. Delete Storage objects from knowledge-docs bucket
//   4. Delete rag_app row → DB cascades: documents, document_chunks, messages, deployments

const STORAGE_BUCKET_NAME = 'knowledge-docs';

router.delete('/:id', async (req, res) => {
  try {
    const existing = await getOwnedRagApp(req.params.id, req.user.id);
    if (!existing) return res.status(404).json({ error: 'Chatbot not found' });

    // Collect storage paths for all documents belonging to this app
    const { data: docs } = await supabase
      .from('documents')
      .select('id, storage_path')
      .eq('rag_app_id', req.params.id);

    // Delete Storage objects first (best-effort — log warnings, don't fail the deletion)
    if (docs?.length) {
      const paths = docs.map(d => d.storage_path).filter(Boolean);
      if (paths.length > 0) {
        const { error: storageErr } = await supabase.storage
          .from(STORAGE_BUCKET_NAME)
          .remove(paths);
        if (storageErr) {
          console.warn(`[chatbots DELETE /:id] Storage cleanup warning for app ${req.params.id}: ${storageErr.message}`);
        } else {
          console.log(`[chatbots DELETE /:id] Deleted ${paths.length} Storage object(s) for app ${req.params.id.slice(0,8)}`);
        }
      }
    }

    // Delete rag_app row — DB cascades handle documents, document_chunks, messages, deployments
    const { error } = await supabase
      .from('rag_apps')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (error) {
      console.error('[chatbots DELETE /:id]', error.message);
      return res.status(500).json({ error: 'Failed to delete chatbot' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[chatbots DELETE /:id]', err.message);
    res.status(500).json({ error: 'Failed to delete chatbot' });
  }
});

export default router;
