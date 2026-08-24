/**
 * server/src/architect/proposalActivator.js
 *
 * Phase 9C: Deterministic proposal → candidate workflow compiler,
 * impact analyzer, and safe activation sequencer.
 *
 * NO LLM calls. Every function here is deterministic.
 *
 * Exported functions:
 *   buildCandidateWorkflow(activeNodes, activeConnections, proposal)
 *   analyzeImpact(activeNodes, candidateNodes, proposal)
 *   activateProposal(ragAppId, userId, ragApp, proposal)
 *
 * INVARIANTS:
 *   - activateProposal() never modifies active workflow unless ALL validation
 *     passes AND (if required) re-indexing completes successfully.
 *   - On any failure the active workflow, active architect_plan, and
 *     document_chunks remain exactly as they were.
 *   - Re-indexing uses the EXISTING approved architect_plan chunking config
 *     (Phase 9C does not generate a new plan — it only activates workflow topology).
 */

import { v4 as uuidv4 } from 'uuid';
import supabase from '../supabase.js';
import { getNodeCapability, isNodeExecutable } from '../nodeCapabilityRegistry.js';
import { validateWorkflow } from '../workflowUtils.js';
import { indexAllDocumentsWithPlan } from './indexer.js';

// ─── buildCandidateWorkflow ───────────────────────────────────────────────────

/**
 * Apply a validated proposal's recommended_changes to the current active
 * workflow to produce a candidate {nodes, connections}.
 *
 * Source of truth: proposal.recommended_changes + current active workflow.
 * NOT the user's draft — the draft is discarded after proposal generation.
 *
 * Operations applied (in order):
 *   1. Remove nodes   — filter by node ID or type string
 *   2. Add nodes      — create with stable deterministic IDs
 *   3. Reconfigure    — merge params onto existing nodes
 *   4. Remove connections — filter by from+to pair
 *   5. Add connections    — append after dedup
 *
 * @param {object[]} activeNodes      — current active rag_app.nodes
 * @param {object[]} activeConnections — current active rag_app.connections
 * @param {object}   proposal         — validated ArchitectProposalSchema object
 * @returns {{ nodes: object[], connections: object[] }}
 */
export function buildCandidateWorkflow(activeNodes, activeConnections, proposal) {
  const changes = proposal.recommended_changes || {};

  // Deep-clone to avoid mutating the inputs
  let nodes       = activeNodes.map(n => ({ ...n, params: { ...(n.params || {}) } }));
  let connections = activeConnections.map(c => ({ ...c }));

  // ── Step 1: Remove nodes ───────────────────────────────────────────────────
  // remove_nodes contains node IDs or type strings
  const toRemove = new Set(changes.remove_nodes || []);
  if (toRemove.size > 0) {
    nodes = nodes.filter(n => !toRemove.has(n.id) && !toRemove.has(n.type));
    // Also remove any connections involving removed nodes
    const remainingIds = new Set(nodes.map(n => n.id));
    connections = connections.filter(
      c => remainingIds.has(c.from) && remainingIds.has(c.to)
    );
  }

  // ── Step 2: Add nodes ──────────────────────────────────────────────────────
  const existingIds = new Set(nodes.map(n => n.id));
  const addedTypePositions = { x: 80, y: 500 }; // new nodes placed below main pipeline

  for (const addSpec of (changes.add_nodes || [])) {
    const cap = getNodeCapability(addSpec.type);
    if (!cap) continue; // unknown type — skip (normalizer already stripped these)

    // Generate a deterministic stable ID: type + shortened uuid
    const newId = `${addSpec.type.toLowerCase()}-${uuidv4().slice(0, 8)}`;

    nodes.push({
      id:     newId,
      type:   addSpec.type,
      label:  addSpec.label || cap.label,
      x:      addedTypePositions.x,
      y:      addedTypePositions.y,
      params: { ...(addSpec.params || {}) },
    });
    addedTypePositions.x += 240; // space them out
    existingIds.add(newId);
  }

  // ── Step 3: Reconfigure nodes ──────────────────────────────────────────────
  const nodeById = Object.fromEntries(nodes.map(n => [n.id, n]));
  for (const reconf of (changes.reconfigure_nodes || [])) {
    const node = nodeById[reconf.node_id];
    if (!node) continue; // node not found — skip
    node.params = { ...node.params, ...reconf.params };
  }

  // ── Step 4: Remove connections ─────────────────────────────────────────────
  const removeConnSet = new Set(
    (changes.connections?.remove || []).map(c => `${c.from}→${c.to}`)
  );
  if (removeConnSet.size > 0) {
    connections = connections.filter(c => !removeConnSet.has(`${c.from}→${c.to}`));
  }

  // ── Step 5: Add connections ────────────────────────────────────────────────
  const existingConnSet = new Set(connections.map(c => `${c.from}→${c.to}`));
  for (const addConn of (changes.connections?.add || [])) {
    const key = `${addConn.from}→${addConn.to}`;
    if (!existingConnSet.has(key)) {
      // Only add if both endpoints exist in the candidate nodes
      const finalIds = new Set(nodes.map(n => n.id));
      if (finalIds.has(addConn.from) && finalIds.has(addConn.to)) {
        connections.push({ from: addConn.from, to: addConn.to });
        existingConnSet.add(key);
      }
    }
  }

  return { nodes, connections };
}

// ─── analyzeImpact ────────────────────────────────────────────────────────────

/**
 * Determine the runtime impact of activating the candidate workflow.
 *
 * Fully deterministic — uses the capability registry's
 * requires_reindex_on_change and affects_ingestion flags.
 *
 * Impact categories (non-exclusive):
 *   visual_only        — only x/y positions changed (no semantic effect)
 *   query_runtime_only — only query-side config changed (top_k, response_style, etc.)
 *   ingestion_affecting — ingestion pipeline nodes changed
 *   requires_reindex   — chunk-invalidating param change detected
 *   unsupported        — unsupported/experimental nodes present
 *
 * @param {object[]} activeNodes    — current production nodes
 * @param {object[]} candidateNodes — post-change nodes
 * @param {object}   proposal       — validated proposal (for requires_reindex hint)
 * @returns {{
 *   categories: string[],
 *   requires_reindex: boolean,
 *   reindex_reasons: string[],
 *   query_only_changes: string[],
 *   ingestion_changes: string[],
 *   unsupported_nodes: string[],
 * }}
 */
export function analyzeImpact(activeNodes, candidateNodes, proposal) {
  const categories      = new Set();
  const reindex_reasons = [];
  const query_only_changes = [];
  const ingestion_changes  = [];
  const unsupported_nodes  = [];

  const activeById    = Object.fromEntries(activeNodes.map(n => [n.id, n]));
  const candidateById = Object.fromEntries(candidateNodes.map(n => [n.id, n]));

  // ── Added nodes ────────────────────────────────────────────────────────────
  for (const cn of candidateNodes) {
    if (!activeById[cn.id]) {
      // New node added
      const cap = getNodeCapability(cn.type);
      if (!cap) continue;

      if (!isNodeExecutable(cn.type)) {
        unsupported_nodes.push(cn.type);
        categories.add('unsupported');
        continue;
      }
      if (cap.affects_ingestion) {
        ingestion_changes.push(`Added ${cn.type}`);
        categories.add('ingestion_affecting');
        if (cap.requires_reindex_on_change) {
          reindex_reasons.push(`New node ${cn.type} requires re-index`);
          categories.add('requires_reindex');
        }
      }
      if (cap.affects_query_runtime) {
        query_only_changes.push(`Added ${cn.type}`);
        categories.add('query_runtime_only');
      }
    }
  }

  // ── Removed nodes ──────────────────────────────────────────────────────────
  for (const an of activeNodes) {
    if (!candidateById[an.id]) {
      const cap = getNodeCapability(an.type);
      if (!cap) continue;

      if (cap.affects_ingestion) {
        ingestion_changes.push(`Removed ${an.type}`);
        categories.add('ingestion_affecting');
        if (cap.requires_reindex_on_change) {
          reindex_reasons.push(`Removed node ${an.type} requires re-index`);
          categories.add('requires_reindex');
        }
      }
      if (cap.affects_query_runtime) {
        query_only_changes.push(`Removed ${an.type}`);
        categories.add('query_runtime_only');
      }
    }
  }

  // ── Reconfigured nodes — param changes ────────────────────────────────────
  for (const cn of candidateNodes) {
    const an = activeById[cn.id];
    if (!an) continue; // added node, handled above

    const cap = getNodeCapability(cn.type);
    if (!cap) continue;

    // Compare params
    const oldParams = an.params || {};
    const newParams = cn.params || {};
    const allKeys = new Set([...Object.keys(oldParams), ...Object.keys(newParams)]);
    let hasParamChange = false;

    for (const key of allKeys) {
      if (JSON.stringify(oldParams[key]) !== JSON.stringify(newParams[key])) {
        hasParamChange = true;
        break;
      }
    }

    if (!hasParamChange) continue;

    if (cap.requires_reindex_on_change) {
      reindex_reasons.push(`${cn.type} param change requires re-index`);
      categories.add('requires_reindex');
      categories.add('ingestion_affecting');
      ingestion_changes.push(`Reconfigured ${cn.type}`);
    } else if (cap.affects_ingestion) {
      ingestion_changes.push(`Reconfigured ${cn.type}`);
      categories.add('ingestion_affecting');
      // Node can affect both ingestion AND query runtime (e.g. VectorStore top_k change)
      if (cap.affects_query_runtime) {
        query_only_changes.push(`Reconfigured ${cn.type}`);
        categories.add('query_runtime_only');
      }
    } else if (cap.affects_query_runtime) {
      query_only_changes.push(`Reconfigured ${cn.type}`);
      categories.add('query_runtime_only');
    } else {
      categories.add('visual_only');
    }
  }

  // ── If no semantic changes detected ───────────────────────────────────────
  if (categories.size === 0) {
    categories.add('visual_only');
  }

  // ── Always trust deterministic analysis over proposal's LLM hint ──────────
  // If proposal says requires_reindex but we detect no such change, defer to us.
  // If we detect requires_reindex, always re-index regardless of proposal hint.
  const requires_reindex = categories.has('requires_reindex') || categories.has('unsupported');

  // Unsupported nodes block activation — don't require re-index for those
  const blockingUnsupported = unsupported_nodes.length > 0;

  return {
    categories:          [...categories],
    requires_reindex:    requires_reindex && !blockingUnsupported,
    reindex_reasons,
    query_only_changes,
    ingestion_changes,
    unsupported_nodes,
    blocked:             blockingUnsupported,
  };
}

// ─── activateProposal ─────────────────────────────────────────────────────────

/**
 * Full safe activation sequence for an approved proposal.
 *
 * Called only after:
 *   1. Ownership verified by caller
 *   2. proposed_architect_status === 'ready_for_review'
 *   3. proposal !== null
 *   4. base version matches
 *   5. Zod re-validation passed
 *   6. Capability re-check passed (executable === true from re-check)
 *
 * Activation order:
 *   1. Build candidate workflow (deterministic, no LLM)
 *   2. Validate candidate (structurally_valid + executable)
 *   3. Analyze impact
 *   4. If impact.blocked → return blocked error (no writes)
 *   5. Mark proposed_architect_status = 'activating' (signals in-progress)
 *   6. If requires_reindex → index all docs (force=true)
 *      - On indexing failure → mark activation_error, keep old workflow, throw
 *   7. Persist new nodes + connections (atomic update)
 *   8. Clear draft (reset to new active)
 *   9. Mark proposed_architect_status = 'activated', set activated_at
 *  10. Increment architect_version by 1 (traceability)
 *
 * @param {string} ragAppId
 * @param {string} userId
 * @param {object} ragApp  — current rag_app row from DB
 * @param {object} proposal — already Zod-validated proposal
 * @returns {Promise<{
 *   activated: boolean,
 *   nodes: object[],
 *   connections: object[],
 *   architect_version: number,
 *   impact: object,
 *   reindexed: boolean,
 *   indexing_result: object|null,
 * }>}
 */
export async function activateProposal(ragAppId, userId, ragApp, proposal) {
  const activeNodes       = ragApp.nodes       || [];
  const activeConnections = ragApp.connections || [];

  // ── 1. Build candidate workflow ────────────────────────────────────────────
  const { nodes: candidateNodes, connections: candidateConns } =
    buildCandidateWorkflow(activeNodes, activeConnections, proposal);

  // ── 2. Validate candidate ──────────────────────────────────────────────────
  const validation = validateWorkflow(candidateNodes, candidateConns);

  if (!validation.structurally_valid) {
    throw Object.assign(
      new Error(`Candidate workflow is not structurally valid: ${validation.errors.join('; ')}`),
      { code: 'INVALID_CANDIDATE', validation }
    );
  }

  if (!validation.executable) {
    throw Object.assign(
      new Error(`Candidate workflow is not executable — unsupported capabilities: ${validation.unsupported_capabilities.join(', ')}`),
      { code: 'NOT_EXECUTABLE', validation }
    );
  }

  // ── 3. Impact analysis ─────────────────────────────────────────────────────
  const impact = analyzeImpact(activeNodes, candidateNodes, proposal);

  if (impact.blocked) {
    throw Object.assign(
      new Error(`Activation blocked: unsupported capabilities in candidate — ${impact.unsupported_nodes.join(', ')}`),
      { code: 'BLOCKED_UNSUPPORTED', impact }
    );
  }

  // ── 4. Mark 'activating' ──────────────────────────────────────────────────
  await _updateProposalStatus(ragAppId, userId, 'activating', null);

  const newVersion = (ragApp.architect_version || 0) + 1;
  let indexingResult = null;
  let reindexed = false;

  try {
    // ── 5. Re-index if required ────────────────────────────────────────────
    if (impact.requires_reindex) {
      console.log(
        `[proposalActivator] Reindexing required for ${ragAppId.slice(0, 8)} — reasons: ${impact.reindex_reasons.join(', ')}`
      );
      indexingResult = await indexAllDocumentsWithPlan(ragAppId, userId, { force: true });
      reindexed = true;

      if (indexingResult.errors?.length > 0) {
        // Partial indexing failure — do not promote workflow
        throw new Error(
          `Indexing failed for ${indexingResult.errors.length} document(s): ${indexingResult.errors.slice(0, 3).join('; ')}`
        );
      }
    }

    // ── 6. Persist candidate as active + clear draft + mark activated ───────
    const { error: updateErr } = await supabase
      .from('rag_apps')
      .update({
        // Promote candidate to active
        nodes:       candidateNodes,
        connections: candidateConns,

        // Clear draft (reset to match new active)
        draft_nodes:       null,
        draft_connections: null,
        draft_updated_at:  null,

        // Proposal lifecycle
        proposed_architect_status:       'activated',
        proposed_architect_activated_at: new Date().toISOString(),
        proposed_architect_error:        null,

        // Bump architect version for traceability
        architect_version: newVersion,

        updated_at: new Date().toISOString(),
      })
      .eq('id', ragAppId)
      .eq('user_id', userId);

    if (updateErr) {
      throw new Error(`Failed to persist activated workflow: ${updateErr.message}`);
    }

    console.log(
      `[proposalActivator] Activated ${ragAppId.slice(0, 8)} — ` +
      `v${ragApp.architect_version} → v${newVersion} ` +
      `nodes=${candidateNodes.length} reindexed=${reindexed}`
    );

    return {
      activated:        true,
      nodes:            candidateNodes,
      connections:      candidateConns,
      architect_version: newVersion,
      impact,
      reindexed,
      indexing_result:  indexingResult,
    };
  } catch (err) {
    // ── Rollback: mark activation_error, keep old workflow intact ────────────
    console.error(`[proposalActivator] Activation failed for ${ragAppId.slice(0, 8)}:`, err.message);

    await _updateProposalStatus(ragAppId, userId, 'activation_error', err.message.slice(0, 500));

    // Re-throw so the route can return the appropriate error response
    throw err;
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function _updateProposalStatus(ragAppId, userId, status, errorMessage) {
  const update = { proposed_architect_status: status };
  if (errorMessage !== null) {
    update.proposed_architect_error = errorMessage;
  } else {
    update.proposed_architect_error = null;
  }

  const { error } = await supabase
    .from('rag_apps')
    .update(update)
    .eq('id', ragAppId)
    .eq('user_id', userId);

  if (error) {
    console.error('[proposalActivator] Status update failed:', error.message);
  }
}
