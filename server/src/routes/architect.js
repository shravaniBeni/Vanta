/**
 * server/src/routes/architect.js
 *
 * Phase 7: AI RAG Architect routes.
 * All routes require authentication and verify ownership of the target RAG app.
 *
 * POST /api/architect/analyze   — profile documents + generate follow-up questions
 * POST /api/architect/plan      — generate + validate + persist architect plan
 * POST /api/architect/approve   — set architect_status = 'approved'
 */

import { Router } from 'express';
import supabase from '../supabase.js';
import { getOwnedRagApp } from '../helpers.js';
import { profileDocuments } from '../architect/profiler.js';
import { generateFollowUpQuestions, generateArchitectPlan } from '../architect/planner.js';
import { ArchitectPlanSchema, normalizeRawPlan } from '../architect/schema.js';
import { indexAllDocumentsWithPlan } from '../architect/indexer.js';
import { buildWorkflowFromArchitectPlan } from '../workflowBuilder.js';

const router = Router();

// ─── POST /api/architect/analyze ─────────────────────────────────────────────
// Step 1: Profile the knowledge base + determine if follow-up questions needed.
// Does NOT call the LLM if the requirement is clear enough.

router.post('/analyze', async (req, res) => {
  const { rag_app_id, requirement, previous_answers } = req.body;
  if (!rag_app_id) return res.status(400).json({ error: 'rag_app_id is required' });
  if (!requirement?.trim()) return res.status(400).json({ error: 'requirement is required' });

  try {
    // Verify ownership — strictly scoped to this user's app
    const ragApp = await getOwnedRagApp(rag_app_id, req.user.id);
    if (!ragApp) return res.status(404).json({ error: 'RAG app not found' });

    // Build deterministic knowledge profile (no LLM, scoped to rag_app_id)
    const knowledgeProfile = await profileDocuments(rag_app_id);

    // Generate follow-up questions if needed (1 LLM call, or skipped)
    const clarification = await generateFollowUpQuestions(
      requirement.trim(),
      knowledgeProfile,
      previous_answers || []
    );

    res.json({
      rag_app_id,
      knowledge_profile: knowledgeProfile,
      needs_clarification: clarification.needs_clarification,
      questions: clarification.questions,
    });
  } catch (err) {
    console.error('[architect/analyze]', err.message);
    res.status(500).json({ error: 'Analysis failed: ' + err.message });
  }
});

// ─── POST /api/architect/plan ─────────────────────────────────────────────────
// Step 2: Generate, validate, and persist the architect plan.
// Sets architect_status → 'generating' then 'ready' (or 'error').

router.post('/plan', async (req, res) => {
  const { rag_app_id, requirement, answers, knowledge_profile } = req.body;
  if (!rag_app_id) return res.status(400).json({ error: 'rag_app_id is required' });
  if (!requirement?.trim()) return res.status(400).json({ error: 'requirement is required' });

  try {
    const ragApp = await getOwnedRagApp(rag_app_id, req.user.id);
    if (!ragApp) return res.status(404).json({ error: 'RAG app not found' });

    // Mark as generating
    await supabase
      .from('rag_apps')
      .update({ architect_status: 'generating' })
      .eq('id', rag_app_id)
      .eq('user_id', req.user.id);

    // Use provided profile (from analyze step) or re-profile if not provided
    const profile = knowledge_profile || await profileDocuments(rag_app_id);

    // Generate plan via LLM
    let rawPlan;
    try {
      rawPlan = await generateArchitectPlan(requirement.trim(), profile, answers || []);
    } catch (llmErr) {
      console.error('[architect/plan] LLM error:', llmErr.message);
      await supabase
        .from('rag_apps')
        .update({ architect_status: 'error' })
        .eq('id', rag_app_id)
        .eq('user_id', req.user.id);
      return res.status(500).json({ error: 'Plan generation failed: ' + llmErr.message });
    }

    // Normalize: apply runtime constraints before validation
    const normalized = normalizeRawPlan(rawPlan);

    // Validate with Zod
    const validation = ArchitectPlanSchema.safeParse(normalized);
    if (!validation.success) {
      console.error('[architect/plan] Zod validation failed:', validation.error.flatten());
      await supabase
        .from('rag_apps')
        .update({ architect_status: 'error' })
        .eq('id', rag_app_id)
        .eq('user_id', req.user.id);
      return res.status(422).json({
        error: 'Generated plan failed validation',
        details: validation.error.flatten(),
      });
    }

    const validPlan = validation.data;

    // Persist: increment version, set status to ready
    // Do NOT overwrite previous valid plan on failure (already guarded above)
    const newVersion = (ragApp.architect_version || 0) + 1;

    await supabase
      .from('rag_apps')
      .update({
        architect_plan:    validPlan,
        architect_status:  'ready',
        architect_version: newVersion,
        updated_at:        new Date().toISOString(),
      })
      .eq('id', rag_app_id)
      .eq('user_id', req.user.id);

    res.json({
      plan:              validPlan,
      architect_status:  'ready',
      architect_version: newVersion,
    });
  } catch (err) {
    console.error('[architect/plan]', err.message);
    // Attempt to mark as error without destroying previous plan
    try {
      await supabase
        .from('rag_apps')
        .update({ architect_status: 'error' })
        .eq('id', rag_app_id)
        .eq('user_id', req.user.id);
    } catch { /* silent */ }
    res.status(500).json({ error: 'Plan generation failed: ' + err.message });
  }
});

// ─── POST /api/architect/approve ─────────────────────────────────────────────
// Step 3: User approves the plan.
// Sets architect_status = 'approved'. Does NOT increment version.
// Does NOT generate React Flow nodes. Does NOT re-index documents.

router.post('/approve', async (req, res) => {
  const { rag_app_id } = req.body;
  if (!rag_app_id) return res.status(400).json({ error: 'rag_app_id is required' });

  try {
    const ragApp = await getOwnedRagApp(rag_app_id, req.user.id);
    if (!ragApp) return res.status(404).json({ error: 'RAG app not found' });

    if (!ragApp.architect_plan) {
      return res.status(400).json({ error: 'No architect plan to approve. Generate a plan first.' });
    }
    if (ragApp.architect_status !== 'ready') {
      return res.status(400).json({
        error: `Cannot approve a plan with status "${ragApp.architect_status}". Plan must be in "ready" state.`,
      });
    }

    const { error: updateErr } = await supabase
      .from('rag_apps')
      .update({
        architect_status: 'approved',
        updated_at: new Date().toISOString(),
      })
      .eq('id', rag_app_id)
      .eq('user_id', req.user.id);

    if (updateErr) {
      console.error('[architect/approve] DB update failed:', updateErr.message);
      return res.status(500).json({ error: 'Approval failed: ' + updateErr.message });
    }

    res.json({
      rag_app_id,
      architect_status:  'approved',
      architect_version: ragApp.architect_version,
      plan:              ragApp.architect_plan,
    });
  } catch (err) {
    console.error('[architect/approve]', err.message);
    res.status(500).json({ error: 'Approval failed: ' + err.message });
  }
});

// ─── POST /api/architect/index-all ───────────────────────────────────────────
// Execute final indexing for all profiled documents using the approved plan.
// Must be called AFTER architect_status = 'approved'.
// Each document: profiled → indexing → indexed (or error)

router.post('/index-all', async (req, res) => {
  const { rag_app_id } = req.body;
  if (!rag_app_id) return res.status(400).json({ error: 'rag_app_id is required' });

  try {
    const ragApp = await getOwnedRagApp(rag_app_id, req.user.id);
    if (!ragApp) return res.status(404).json({ error: 'RAG app not found' });

    if (ragApp.architect_status !== 'approved') {
      return res.status(400).json({
        error: `Cannot index: architect_status is '${ragApp.architect_status}'. Plan must be approved first.`,
      });
    }

    const result = await indexAllDocumentsWithPlan(rag_app_id, req.user.id);

    res.json({
      rag_app_id,
      indexed: result.indexed,
      skipped: result.skipped,
      errors:  result.errors,
    });
  } catch (err) {
    console.error('[architect/index-all]', err.message);
    res.status(500).json({ error: 'Indexing failed: ' + err.message });
  }
});

// ─── POST /api/architect/materialize ─────────────────────────────────────────
// Phase 8: Convert approved architect_plan into workflow nodes + connections.
// Deterministic — no LLM call. Same plan always produces same workflow.
//
// Behavior:
//   1. Authenticate + verify ownership
//   2. Verify architect_status = 'approved'
//   3. Re-validate architect_plan with Zod
//   4. Fetch current document metadata for this app
//   5. Check for legacy indexed chunks (metadata.architect_version absent)
//   6. Build nodes + connections deterministically
//   7. Persist nodes + connections into rag_apps
//
// Legacy indexed documents (old eager-indexing pipeline without architect_version
// in chunk metadata) are re-indexed using force=true to ensure they match the
// approved plan. This prevents mixing old default chunks with new plan chunks.

router.post('/materialize', async (req, res) => {
  const { rag_app_id } = req.body;
  if (!rag_app_id) return res.status(400).json({ error: 'rag_app_id is required' });

  try {
    const ragApp = await getOwnedRagApp(rag_app_id, req.user.id);
    if (!ragApp) return res.status(404).json({ error: 'RAG app not found' });

    // Only approved plans can be materialized
    if (ragApp.architect_status !== 'approved') {
      return res.status(400).json({
        error: `Cannot materialize: architect_status is '${ragApp.architect_status}'. ` +
               `Only 'approved' plans can be materialized.`,
      });
    }

    if (!ragApp.architect_plan) {
      return res.status(400).json({ error: 'No architect_plan found. Generate and approve a plan first.' });
    }

    // Re-validate the plan (defence in depth — the plan was validated on generation)
    const normalized = normalizeRawPlan(JSON.parse(JSON.stringify(ragApp.architect_plan)));
    const validation = ArchitectPlanSchema.safeParse(normalized);
    if (!validation.success) {
      console.error('[architect/materialize] plan re-validation failed:', validation.error.flatten());
      return res.status(422).json({
        error: 'Architect plan failed re-validation before materialization',
        details: validation.error.flatten(),
      });
    }
    const validPlan = validation.data;

    // Fetch current documents for this app (all statuses with Storage objects)
    const { data: documents, error: docsErr } = await supabase
      .from('documents')
      .select('id, file_name, status, chunk_count')
      .eq('rag_app_id', rag_app_id)
      .in('status', ['profiled', 'indexed', 'indexing', 'error']);

    if (docsErr) {
      console.error('[architect/materialize] docs fetch error:', docsErr.message);
      return res.status(500).json({ error: 'Failed to fetch document metadata' });
    }

    // Build workflow deterministically (no LLM, pure translation)
    let nodes, connections;
    try {
      const result = buildWorkflowFromArchitectPlan({
        ragAppId:         rag_app_id,
        architectPlan:    validPlan,
        architectVersion: ragApp.architect_version,
        documents:        documents || [],
      });
      nodes       = result.nodes;
      connections = result.connections;
    } catch (buildErr) {
      console.error('[architect/materialize] workflow build error:', buildErr.message);
      return res.status(422).json({ error: 'Workflow generation failed: ' + buildErr.message });
    }

    // Persist nodes + connections — do not modify architect_plan or status
    const { error: updateErr } = await supabase
      .from('rag_apps')
      .update({
        nodes,
        connections,
        updated_at: new Date().toISOString(),
      })
      .eq('id', rag_app_id)
      .eq('user_id', req.user.id);

    if (updateErr) {
      console.error('[architect/materialize] persist error:', updateErr.message);
      return res.status(500).json({ error: 'Failed to persist workflow: ' + updateErr.message });
    }

    console.log(
      `[architect/materialize] RAG app ${rag_app_id.slice(0,8)} — ` +
      `${nodes.length} nodes, ${connections.length} connections ` +
      `(architect_version=${ragApp.architect_version})`
    );

    res.json({
      rag_app_id,
      architect_version: ragApp.architect_version,
      nodes,
      connections,
      node_count:       nodes.length,
      connection_count: connections.length,
    });
  } catch (err) {
    console.error('[architect/materialize]', err.message);
    res.status(500).json({ error: 'Materialization failed: ' + err.message });
  }
});

// ─── POST /api/architect/build-pipeline ──────────────────────────────────────
// Phase 8: Combined build: materialize workflow + index all documents.
// This is the single action the frontend calls from the "Build RAG Pipeline" button.
//
// Sequence (failure-safe):
//   1. Validate approved plan (Zod)
//   2. Fetch document metadata
//   3. Build workflow deterministically (no LLM)
//   4. Persist nodes + connections
//   5. Index all docs (force=true to replace legacy chunks)
//   6. Return result
//
// If step 1-4 fails: stop, do NOT index, return error
// If step 5 fails: report indexing errors, materialized workflow is kept

router.post('/build-pipeline', async (req, res) => {
  const { rag_app_id } = req.body;
  if (!rag_app_id) return res.status(400).json({ error: 'rag_app_id is required' });

  try {
    const ragApp = await getOwnedRagApp(rag_app_id, req.user.id);
    if (!ragApp) return res.status(404).json({ error: 'RAG app not found' });

    if (ragApp.architect_status !== 'approved') {
      return res.status(400).json({
        error: `Cannot build pipeline: architect_status is '${ragApp.architect_status}'. Approve the plan first.`,
      });
    }

    if (!ragApp.architect_plan) {
      return res.status(400).json({ error: 'No architect_plan found. Generate and approve a plan first.' });
    }

    // Re-validate the plan
    const normalized = normalizeRawPlan(JSON.parse(JSON.stringify(ragApp.architect_plan)));
    const validation = ArchitectPlanSchema.safeParse(normalized);
    if (!validation.success) {
      return res.status(422).json({
        error: 'Architect plan failed re-validation',
        details: validation.error.flatten(),
      });
    }
    const validPlan = validation.data;

    // Fetch document metadata
    const { data: documents, error: docsErr } = await supabase
      .from('documents')
      .select('id, file_name, status, chunk_count')
      .eq('rag_app_id', rag_app_id)
      .in('status', ['profiled', 'indexed', 'indexing', 'error', 'uploaded', 'profiling']);

    if (docsErr) {
      return res.status(500).json({ error: 'Failed to fetch document metadata: ' + docsErr.message });
    }

    // Build workflow deterministically (no LLM)
    let nodes, connections;
    try {
      ({ nodes, connections } = buildWorkflowFromArchitectPlan({
        ragAppId:         rag_app_id,
        architectPlan:    validPlan,
        architectVersion: ragApp.architect_version,
        documents:        documents || [],
      }));
    } catch (buildErr) {
      console.error('[architect/build-pipeline] build error:', buildErr.message);
      return res.status(422).json({ error: 'Workflow generation failed: ' + buildErr.message });
    }

    // Persist nodes + connections
    const { error: updateErr } = await supabase
      .from('rag_apps')
      .update({ nodes, connections, updated_at: new Date().toISOString() })
      .eq('id', rag_app_id)
      .eq('user_id', req.user.id);

    if (updateErr) {
      return res.status(500).json({ error: 'Failed to persist workflow: ' + updateErr.message });
    }

    console.log(`[architect/build-pipeline] workflow persisted for ${rag_app_id.slice(0,8)} — starting indexing`);

    // Index all docs with the approved plan
    // force=true replaces legacy chunks (no architect_version) with plan-consistent chunks
    const indexResult = await indexAllDocumentsWithPlan(rag_app_id, req.user.id, { force: true });

    res.json({
      rag_app_id,
      architect_version:  ragApp.architect_version,
      workflow: {
        nodes,
        connections,
        node_count:       nodes.length,
        connection_count: connections.length,
      },
      indexing: {
        indexed: indexResult.indexed,
        skipped: indexResult.skipped,
        errors:  indexResult.errors,
      },
    });
  } catch (err) {
    console.error('[architect/build-pipeline]', err.message);
    res.status(500).json({ error: 'Pipeline build failed: ' + err.message });
  }
});

// ─── GET /api/architect/:ragAppId ─────────────────────────────────────────────
// Fetch current architect state for a RAG app (for page reload restoration).

router.get('/:ragAppId', async (req, res) => {
  try {
    const ragApp = await getOwnedRagApp(req.params.ragAppId, req.user.id);
    if (!ragApp) return res.status(404).json({ error: 'RAG app not found' });

    res.json({
      rag_app_id:        ragApp.id,
      architect_plan:    ragApp.architect_plan || null,
      architect_status:  ragApp.architect_status,
      architect_version: ragApp.architect_version,
    });
  } catch (err) {
    console.error('[architect/get]', err.message);
    res.status(500).json({ error: 'Failed to fetch architect state' });
  }
});

export default router;
