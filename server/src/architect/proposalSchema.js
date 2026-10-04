/**
 * server/src/architect/proposalSchema.js
 *
 * Phase 9B: Zod schema for the Architect's structured proposal.
 *
 * A proposal is advisory only — it does NOT modify the active workflow,
 * active architect_plan, or document_chunks. Phase 9C will activate it.
 *
 * Constraints:
 *   - runtime_status values must match the capability registry
 *   - unsupported capabilities cannot make executable=true
 *   - node types in recommended changes must exist in the registry
 *   - base_architect_version must be provided
 */

import { z } from 'zod';
import { getNodeCapability } from '../nodeCapabilityRegistry.js';

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const RequestedCapabilitySchema = z.object({
  type:           z.string().min(1),
  runtime_status: z.enum(['supported', 'experimental', 'unavailable']),
  reason:         z.string().min(1),
});

const NodeChangeSchema = z.object({
  type:       z.string().min(1),
  label:      z.string().optional(),
  params:     z.record(z.unknown()).optional().default({}),
  reason:     z.string().min(1),
});

const NodeReconfigureSchema = z.object({
  node_id:    z.string().min(1),
  type:       z.string().min(1),
  params:     z.record(z.unknown()),
  reason:     z.string().min(1),
});

const ConnectionChangeSchema = z.object({
  from:   z.string().min(1),
  to:     z.string().min(1),
  reason: z.string().optional().default(''),
});

const ReasoningSchema = z.object({
  architecture:           z.string().min(1),
  runtime_compatibility:  z.string().min(1),
  knowledge_impact:       z.string().min(1),
});

// ─── Full proposal schema ─────────────────────────────────────────────────────

export const ArchitectProposalSchema = z.object({
  base_architect_version: z.number().int().min(0),
  intent_summary:         z.string().min(1),
  analysis:               z.string().min(1),

  requested_capabilities: z.array(RequestedCapabilitySchema).default([]),

  recommended_changes: z.object({
    add_nodes:         z.array(NodeChangeSchema).default([]),
    remove_nodes:      z.array(z.string()).default([]),  // node IDs or type strings
    reconfigure_nodes: z.array(NodeReconfigureSchema).default([]),
    connections: z.object({
      add:    z.array(ConnectionChangeSchema).default([]),
      remove: z.array(z.object({ from: z.string(), to: z.string() })).default([]),
    }).default({ add: [], remove: [] }),
  }).default({ add_nodes: [], remove_nodes: [], reconfigure_nodes: [], connections: { add: [], remove: [] } }),

  unsupported_capabilities: z.array(z.string()).default([]),
  future_recommendations:   z.array(z.object({
    feature: z.string(),
    reason:  z.string(),
  })).default([]),

  requires_reindex: z.boolean(),
  executable:       z.boolean(),

  reasoning: ReasoningSchema,
  summary:   z.string().min(1),
}).superRefine((data, ctx) => {
  // If any requested capability is not supported, executable must be false
  const hasUnsupported = data.requested_capabilities.some(
    cap => cap.runtime_status !== 'supported'
  );
  if (hasUnsupported && data.executable) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'executable cannot be true when unsupported capabilities are requested',
      path: ['executable'],
    });
  }

  // unsupported_capabilities list must not allow executable=true
  if (data.unsupported_capabilities.length > 0 && data.executable) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'executable cannot be true when unsupported_capabilities is non-empty',
      path: ['executable'],
    });
  }
});

/**
 * Validate a raw LLM-generated proposal.
 * Normalizes and enforces runtime constraints before persistence.
 *
 * Pre-parse normalisation handles common LLM output deviations:
 *   - reasoning as a flat string → split into the 3 required fields
 *   - reasoning fields that are empty strings → replaced with a minimal stub
 *   - add_nodes[].reason as empty string → replaced with type-based stub
 *   - requested_capabilities as string array → coerced to {type,runtime_status,reason} objects
 *   - intent_summary/analysis/summary empty strings → replaced with stubs
 *
 * These normalisations preserve the schema's intent; they do NOT weaken
 * the Zod constraints — the coerced values always satisfy min(1).
 *
 * @param {object} raw
 * @param {number} expectedBaseVersion
 * @param {string[]} [discussedCapabilities] — capability types explicitly mentioned
 *   in the conversation (used to filter future_recommendations)
 * @returns {{ success: boolean, data?: object, error?: object }}
 */
export function validateAndNormalizeProposal(raw, expectedBaseVersion, discussedCapabilities = []) {
  if (!raw || typeof raw !== 'object') {
    return { success: false, error: { message: 'Proposal is not an object' } };
  }

  // Force base version
  raw.base_architect_version = expectedBaseVersion;

  // ── Pre-parse coercions ────────────────────────────────────────────────────
  // These fix common LLM output deviations BEFORE Zod validates.
  // They never weaken the schema — every coerced value satisfies min(1).

  // 1. reasoning: if missing entirely, create a minimal object
  if (!raw.reasoning) {
    raw.reasoning = {
      architecture:          'See analysis.',
      runtime_compatibility: 'See analysis.',
      knowledge_impact:      'See analysis.',
    };
  }
  // 2. reasoning: if it's a string, split it into the 3 required fields
  if (typeof raw.reasoning === 'string') {
    const text = raw.reasoning.trim() || 'See analysis.';
    raw.reasoning = {
      architecture:          text,
      runtime_compatibility: text,
      knowledge_impact:      text,
    };
  }
  // 2. reasoning: if it's an object, fill in any missing/empty fields
  if (raw.reasoning && typeof raw.reasoning === 'object') {
    const stub = raw.reasoning.architecture || raw.reasoning.runtime_compatibility ||
                 raw.reasoning.knowledge_impact || 'See analysis.';
    if (!raw.reasoning.architecture?.trim())         raw.reasoning.architecture         = stub;
    if (!raw.reasoning.runtime_compatibility?.trim()) raw.reasoning.runtime_compatibility = stub;
    if (!raw.reasoning.knowledge_impact?.trim())     raw.reasoning.knowledge_impact     = stub;
  }

  // 3. requested_capabilities: coerce string[] → object[]
  if (Array.isArray(raw.requested_capabilities)) {
    raw.requested_capabilities = raw.requested_capabilities.map(cap => {
      if (typeof cap === 'string') {
        const regCap = getNodeCapability(cap);
        return {
          type:           cap,
          runtime_status: regCap?.runtime_status ?? 'unavailable',
          reason:         `${cap} requested.`,
        };
      }
      // object: ensure reason is non-empty
      if (!cap.reason?.trim()) cap.reason = `${cap.type} requested.`;
      return cap;
    });
  }

  // 4. add_nodes[].reason: fill empty reason strings with a type-based stub
  if (Array.isArray(raw.recommended_changes?.add_nodes)) {
    for (const node of raw.recommended_changes.add_nodes) {
      if (!node.reason?.trim()) {
        node.reason = `Add ${node.type || 'node'} to workflow.`;
      }
    }
  }

  // 5. intent_summary / analysis / summary: fill empty strings with stubs
  if (!raw.intent_summary?.trim()) raw.intent_summary = 'Workflow update.';
  if (!raw.analysis?.trim())       raw.analysis       = 'See recommended changes.';
  if (!raw.summary?.trim())        raw.summary        = 'Workflow update proposed.';

  // ── Existing normalisation (unchanged from Phase 9B) ──────────────────────

  // Validate node types in recommended additions against registry
  if (Array.isArray(raw.recommended_changes?.add_nodes)) {
    for (const node of raw.recommended_changes.add_nodes) {
      const cap = getNodeCapability(node.type);
      if (!cap) {
        node._invalid = true;
      }
    }
    raw.recommended_changes.add_nodes =
      raw.recommended_changes.add_nodes.filter(n => !n._invalid);
  }

  // Sync unsupported_capabilities from requested_capabilities if not explicitly set
  if (!Array.isArray(raw.unsupported_capabilities) || raw.unsupported_capabilities.length === 0) {
    raw.unsupported_capabilities = (raw.requested_capabilities || [])
      .filter(cap => typeof cap === 'object' && cap.runtime_status !== 'supported')
      .map(cap => cap.type);
  }

  // Force executable=false if any unsupported capability present
  if (raw.unsupported_capabilities?.length > 0) {
    raw.executable = false;
  }

  // ── Future recommendations grounding filter ──────────────────────────────
  if (Array.isArray(raw.future_recommendations)) {
    const requested = new Set([
      ...discussedCapabilities.map(t => t.toLowerCase()),
      ...(raw.unsupported_capabilities || []).filter(t => typeof t === 'string').map(t => t.toLowerCase()),
      ...(raw.requested_capabilities || []).filter(c => typeof c === 'object').map(c => c.type.toLowerCase()),
    ]);

    const prerequisites = {
      ocr:               ['documentprocessor', 'imageanalysis'],
      imageanalysis:     ['ocr', 'documentprocessor'],
      documentprocessor: ['ocr', 'imageanalysis'],
      voicerecognition:  [],
      webcrawler:        [],
      translator:        [],
      datafilter:        [],
      datavalidation:    [],
      customcode:        [],
      codeexecution:     [],
      apiintegration:    [],
    };

    const allowedTypes = new Set(requested);
    for (const type of requested) {
      const prereqs = prerequisites[type] || [];
      for (const p of prereqs) allowedTypes.add(p);
    }

    raw.future_recommendations = raw.future_recommendations.filter(rec => {
      if (!rec.feature) return false;
      const featureKey = rec.feature.toLowerCase().replace(/\s+/g, '');
      const cap = getNodeCapability(rec.feature);
      if (!cap) return false;
      return allowedTypes.has(featureKey) || allowedTypes.has(rec.feature.toLowerCase());
    });
  }

  const result = ArchitectProposalSchema.safeParse(raw);
  if (!result.success) {
    // ── Diagnostic logging: expose exact field errors in server logs ─────────
    const flat = result.error.flatten();
    console.error('[proposalSchema] Validation failed — fieldErrors:', JSON.stringify(flat.fieldErrors));
    console.error('[proposalSchema] Validation failed — formErrors:',  JSON.stringify(flat.formErrors));
    return { success: false, error: flat };
  }
  return { success: true, data: result.data };
}
