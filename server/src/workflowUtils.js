/**
 * server/src/workflowUtils.js
 *
 * Phase 9A: Workflow diff and topology validation utilities.
 *
 * diffWorkflow(active, draft)
 *   Compares two workflow states and returns structured change descriptions.
 *   x/y position changes are NOT counted as semantic architecture changes.
 *
 * validateWorkflow(nodes, connections)
 *   Validates a workflow against the capability registry.
 *   Returns { valid: boolean, errors: string[], warnings: string[] }
 */

import { getNodeCapability, isNodeExecutable, REQUIRED_NODE_TYPES } from './nodeCapabilityRegistry.js';

// ─── DIFF ──────────────────────────────────────────────────────────────────────

/**
 * Compute a structured diff between an active and draft workflow.
 *
 * Ignores x/y position changes — those are purely visual and do not
 * affect architecture or runtime behavior.
 *
 * @param {{ nodes: object[], connections: object[] }} active
 * @param {{ nodes: object[], connections: object[] }} draft
 * @returns {{
 *   added_nodes: object[],
 *   removed_nodes: object[],
 *   changed_nodes: Array<{ id: string, type: string, changed_params: object }>,
 *   added_connections: object[],
 *   removed_connections: object[],
 *   has_changes: boolean,
 * }}
 */
export function diffWorkflow(active, draft) {
  const activeNodes  = active?.nodes       ?? [];
  const draftNodes   = draft?.nodes        ?? [];
  const activeConns  = active?.connections ?? [];
  const draftConns   = draft?.connections  ?? [];

  // Index by id for fast lookup
  const activeById = Object.fromEntries(activeNodes.map(n => [n.id, n]));
  const draftById  = Object.fromEntries(draftNodes.map(n => [n.id, n]));

  // Added nodes: in draft but not in active
  const added_nodes = draftNodes.filter(n => !activeById[n.id]);

  // Removed nodes: in active but not in draft
  const removed_nodes = activeNodes.filter(n => !draftById[n.id]);

  // Changed nodes: in both, but non-positional properties differ
  const changed_nodes = [];
  for (const draftNode of draftNodes) {
    const activeNode = activeById[draftNode.id];
    if (!activeNode) continue; // already counted as added

    const changes = _getParamChanges(activeNode, draftNode);
    if (changes !== null) {
      changed_nodes.push({
        id:             draftNode.id,
        type:           draftNode.type,
        changed_params: changes,
      });
    }
  }

  // Connections diff (identified by from+to pair)
  const activeConnSet = new Set(activeConns.map(c => `${c.from}→${c.to}`));
  const draftConnSet  = new Set(draftConns.map(c => `${c.from}→${c.to}`));

  const added_connections   = draftConns.filter(c => !activeConnSet.has(`${c.from}→${c.to}`));
  const removed_connections = activeConns.filter(c => !draftConnSet.has(`${c.from}→${c.to}`));

  const has_changes =
    added_nodes.length > 0    ||
    removed_nodes.length > 0  ||
    changed_nodes.length > 0  ||
    added_connections.length > 0 ||
    removed_connections.length > 0;

  return {
    added_nodes,
    removed_nodes,
    changed_nodes,
    added_connections,
    removed_connections,
    has_changes,
  };
}

/**
 * Compare two node objects and return their non-positional differences.
 * Returns null if no semantic change exists.
 * x and y are excluded — they are visual-only.
 */
function _getParamChanges(activeNode, draftNode) {
  const changes = {};

  // Check type change
  if (activeNode.type !== draftNode.type) {
    changes.type = { from: activeNode.type, to: draftNode.type };
  }

  // Check label change
  if (activeNode.label !== draftNode.label) {
    changes.label = { from: activeNode.label, to: draftNode.label };
  }

  // Check params — deep compare, ignore x/y (those live on the node root, not params)
  const activeParams = activeNode.params ?? {};
  const draftParams  = draftNode.params  ?? {};
  const allParamKeys = new Set([...Object.keys(activeParams), ...Object.keys(draftParams)]);

  const paramChanges = {};
  for (const key of allParamKeys) {
    const av = activeParams[key];
    const dv = draftParams[key];
    if (JSON.stringify(av) !== JSON.stringify(dv)) {
      paramChanges[key] = { from: av, to: dv };
    }
  }

  if (Object.keys(paramChanges).length > 0) {
    changes.params = paramChanges;
  }

  return Object.keys(changes).length > 0 ? changes : null;
}

// ─── VALIDATE ─────────────────────────────────────────────────────────────────

/**
 * Validate a workflow against the capability registry and topology rules.
 *
 * Returns two independent dimensions:
 *   structurally_valid — the graph is topologically understandable:
 *     all node types exist in the registry, all connections reference
 *     existing node IDs, and connected input/output types are compatible.
 *     Unsupported nodes do NOT make a workflow structurally invalid —
 *     they represent valid user intent that the current runtime cannot yet execute.
 *
 *   executable — every node in the workflow is supported by the current runtime.
 *     A structurally valid workflow containing VoiceRecognition is NOT executable
 *     because VoiceRecognition has runtime_status !== 'supported'.
 *
 * @param {object[]} nodes
 * @param {object[]} connections
 * @returns {{
 *   structurally_valid: boolean,
 *   executable: boolean,
 *   errors: string[],               — structural problems (blocking)
 *   warnings: string[],             — non-blocking observations
 *   unsupported_capabilities: string[], — node types present but not executable
 * }}
 */
export function validateWorkflow(nodes, connections) {
  const errors   = [];
  const warnings = [];
  const unsupported_capabilities = [];

  if (!Array.isArray(nodes) || nodes.length === 0) {
    errors.push('Workflow has no nodes.');
    return {
      structurally_valid: false,
      executable:         false,
      errors,
      warnings,
      unsupported_capabilities,
    };
  }

  const nodeIds    = new Set(nodes.map(n => n.id));
  const nodeTypeMap = Object.fromEntries(nodes.map(n => [n.id, n.type]));

  // ── 1. Every node type must exist in the registry ─────────────────────────
  for (const node of nodes) {
    const cap = getNodeCapability(node.type);
    if (!cap) {
      errors.push(`Unknown node type: '${node.type}' (id=${node.id}).`);
      continue;
    }

    // ── 2. Collect unsupported capabilities (structural intent preserved) ────
    // These do NOT generate errors — the user may be planning ahead.
    // They generate warnings and are collected in unsupported_capabilities.
    if (cap.runtime_status !== 'supported') {
      if (!unsupported_capabilities.includes(node.type)) {
        unsupported_capabilities.push(node.type);
      }
      warnings.push(
        `'${node.label || node.type}' (${cap.runtime_status}) is not currently available ` +
        `in the Vanta runtime and cannot be part of an active production workflow.`
      );
    }
  }

  // ── 3. Every connection must reference existing node IDs ──────────────────
  for (const conn of connections) {
    if (!nodeIds.has(conn.from)) {
      errors.push(`Connection references non-existent source node id='${conn.from}'.`);
    }
    if (!nodeIds.has(conn.to)) {
      errors.push(`Connection references non-existent target node id='${conn.to}'.`);
    }
  }

  // ── 4. Input/output type compatibility ────────────────────────────────────
  for (const conn of connections) {
    const fromType = nodeTypeMap[conn.from];
    const toType   = nodeTypeMap[conn.to];
    if (!fromType || !toType) continue;

    const fromCap = getNodeCapability(fromType);
    const toCap   = getNodeCapability(toType);
    if (!fromCap || !toCap) continue;

    const outputSet = new Set(fromCap.output_types);
    const inputSet  = new Set(toCap.input_types);
    const overlap   = [...outputSet].filter(t => inputSet.has(t));

    if (outputSet.size > 0 && inputSet.size > 0 && overlap.length === 0) {
      errors.push(
        `Incompatible connection: '${fromType}' outputs [${fromCap.output_types.join(', ')}] ` +
        `but '${toType}' accepts [${toCap.input_types.join(', ')}].`
      );
    }
  }

  // ── 5. Required stages for a minimal RAG pipeline ─────────────────────────
  const presentTypes = new Set(nodes.map(n => n.type));
  for (const required of REQUIRED_NODE_TYPES) {
    if (!presentTypes.has(required)) {
      warnings.push(`Required node type '${required}' is missing from the workflow.`);
    }
  }

  // ── 6. Dangling executable connections from unavailable nodes ─────────────
  for (const conn of connections) {
    const fromType = nodeTypeMap[conn.from];
    const toType   = nodeTypeMap[conn.to];
    if (!fromType || !toType) continue;
    if (!isNodeExecutable(fromType) && isNodeExecutable(toType)) {
      warnings.push(
        `Connection from unavailable node '${fromType}' to supported node '${toType}' ` +
        `will produce no data in production.`
      );
    }
  }

  // ── 7. Dangling nodes — ingestion-input nodes with no outgoing connections ─
  // A node that produces output but has no downstream connection will silently
  // contribute no data to the pipeline. Warn so the user can diagnose.
  for (const node of nodes) {
    const cap = getNodeCapability(node.type);
    if (!cap) continue;
    if (!cap.output_types || cap.output_types.length === 0) continue; // terminal node — OK

    const hasOutgoing = connections.some(c => c.from === node.id);
    if (!hasOutgoing && cap.runtime_status === 'supported') {
      warnings.push(
        `Node '${node.label || node.type}' (id=${node.id}) produces output ` +
        `[${cap.output_types.join(', ')}] but has no downstream connection. ` +
        `It will not contribute to the pipeline.`
      );
    }
  }

  // structurally_valid: only structural/topological errors count (not unsupported capabilities)
  const structurally_valid = errors.length === 0;

  // executable: structurally valid AND every node is supported
  const executable = structurally_valid && unsupported_capabilities.length === 0;

  return { structurally_valid, executable, errors, warnings, unsupported_capabilities };
}
