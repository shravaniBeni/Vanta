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
 * @param {object} raw
 * @param {number} expectedBaseVersion
 * @returns {{ success: boolean, data?: object, error?: object }}
 */
export function validateAndNormalizeProposal(raw, expectedBaseVersion) {
  if (!raw || typeof raw !== 'object') {
    return { success: false, error: { message: 'Proposal is not an object' } };
  }

  // Force base version
  raw.base_architect_version = expectedBaseVersion;

  // Validate node types in recommended additions against registry
  if (Array.isArray(raw.recommended_changes?.add_nodes)) {
    for (const node of raw.recommended_changes.add_nodes) {
      const cap = getNodeCapability(node.type);
      if (!cap) {
        // Unknown type — remove from add_nodes to avoid invalid state
        node._invalid = true;
      }
    }
    raw.recommended_changes.add_nodes =
      raw.recommended_changes.add_nodes.filter(n => !n._invalid);
  }

  // Sync unsupported_capabilities from requested_capabilities if not explicitly set
  if (!Array.isArray(raw.unsupported_capabilities) || raw.unsupported_capabilities.length === 0) {
    raw.unsupported_capabilities = (raw.requested_capabilities || [])
      .filter(cap => cap.runtime_status !== 'supported')
      .map(cap => cap.type);
  }

  // Force executable=false if any unsupported capability present
  if (raw.unsupported_capabilities?.length > 0) {
    raw.executable = false;
  }

  const result = ArchitectProposalSchema.safeParse(raw);
  if (!result.success) {
    return { success: false, error: result.error.flatten() };
  }
  return { success: true, data: result.data };
}
