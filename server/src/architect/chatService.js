/**
 * server/src/architect/chatService.js
 *
 * Phase 9B: Architect Chat service.
 *
 * Manages:
 *   - Architect context construction (active workflow, draft, diff, validation,
 *     capability registry, knowledge profile, document metadata)
 *   - Conversational LLM calls (multi-turn, bounded clarification)
 *   - Proposal generation + Zod validation
 *   - Conversation persistence (architect_chat_messages table)
 *
 * INVARIANTS:
 *   - NEVER modifies active nodes/connections
 *   - NEVER modifies approved architect_plan
 *   - NEVER modifies document_chunks
 *   - NEVER activates proposed architecture
 *   - Produces advisory text + structured proposal ONLY
 */

import supabase from '../supabase.js';
import { invokeLLMJson, invokeLLMChat, invokeLLMJsonChat, DEFAULT_CHAT_MODEL } from '../openai.js';
import { diffWorkflow, validateWorkflow } from '../workflowUtils.js';
import { getAllCapabilities } from '../nodeCapabilityRegistry.js';
import { validateAndNormalizeProposal } from './proposalSchema.js';

// ─── Constants ────────────────────────────────────────────────────────────────

// Max Architect clarification turns before it must produce a proposal
const MAX_CLARIFICATION_TURNS = 5;

// System prompt for the Architect
const ARCHITECT_SYSTEM_PROMPT = `You are the Vanta AI RAG Architect, an expert workflow advisor.

Your role is to help users design optimal RAG (Retrieval-Augmented Generation) pipelines.
You review workflow changes, understand user intent, and produce structured architecture proposals.

CRITICAL RULES:
1. NEVER claim an unsupported capability is executable. If a node has runtime_status 'unavailable' or 'experimental', say so clearly.
2. NEVER directly modify nodes, connections, active workflows, or active architect plans.
3. NEVER fabricate capability implementations that don't exist.
4. Ask clarifying questions only when genuinely needed — max ${MAX_CLARIFICATION_TURNS} clarification turns total.
5. Do NOT ask questions already answered by the context or previous conversation.
6. When you have enough information, transition to a structured proposal.
7. Be honest about limitations. Preserve user intent even when capabilities are unavailable.
8. Keep responses concise and conversational. No markdown headers in chat messages.

When producing a proposal, always use the JSON format specified in the system context.
When asking clarifying questions, be specific and architecture-relevant.`;

// ─── Context builder ──────────────────────────────────────────────────────────

/**
 * Build structured context for the Architect LLM.
 * This is injected as the system/initial message in the conversation.
 * x/y positions are stripped — they are visual-only.
 */
export async function buildArchitectContext(ragApp) {
  const activeNodes = (ragApp.nodes || []).map(stripPosition);
  const activeConns = ragApp.connections || [];
  const draftNodes  = ragApp.draft_nodes ? (ragApp.draft_nodes).map(stripPosition) : null;
  const draftConns  = ragApp.draft_connections || null;

  // Diff
  const diff = (draftNodes !== null)
    ? diffWorkflow(
        { nodes: activeNodes, connections: activeConns },
        { nodes: draftNodes,  connections: draftConns || [] }
      )
    : null;

  // Validation of draft (or active if no draft)
  const nodesToValidate   = draftNodes  ?? activeNodes;
  const connsToValidate   = draftConns  ?? activeConns;
  const validation        = validateWorkflow(nodesToValidate, connsToValidate);

  // Capability registry — compact form (strip redundant fields for token efficiency)
  const registry = getAllCapabilities().map(cap => ({
    type:                     cap.type,
    label:                    cap.label,
    runtime_status:           cap.runtime_status,
    input_types:              cap.input_types,
    output_types:             cap.output_types,
    affects_ingestion:        cap.affects_ingestion,
    affects_query_runtime:    cap.affects_query_runtime,
    requires_reindex_on_change: cap.requires_reindex_on_change,
    description:              cap.description,
  }));

  // Document metadata
  let documents = [];
  try {
    const { data: docs } = await supabase
      .from('documents')
      .select('id, file_name, mime_type, status, chunk_count')
      .eq('rag_app_id', ragApp.id)
      .in('status', ['profiled', 'indexed']);
    documents = docs || [];
  } catch { /* non-fatal */ }

  // Knowledge profile from last approved architect_plan
  const knowledgeProfile = ragApp.architect_plan?.knowledge_profile ?? null;

  const ctx = {
    rag_app_id:        ragApp.id,
    rag_app_title:     ragApp.title,
    rag_app_description: ragApp.description,
    base_architect_version: ragApp.architect_version || 0,
    architect_status:  ragApp.architect_status,
    approved_plan_summary: ragApp.architect_plan?.summary ?? null,
    approved_plan_chunking: ragApp.architect_plan?.chunking ?? null,
    approved_plan_retrieval: ragApp.architect_plan?.retrieval ?? null,
    approved_plan_generation: ragApp.architect_plan?.generation ?? null,
    active_workflow: {
      node_count:       activeNodes.length,
      nodes:            activeNodes,
      connections:      activeConns,
    },
    draft_workflow: draftNodes !== null ? {
      node_count:    draftNodes.length,
      nodes:         draftNodes,
      connections:   draftConns || [],
    } : null,
    // Always include has_changes so callers can reliably check ctx.diff.has_changes
    diff: diff?.has_changes ? {
      has_changes:          true,
      added_nodes:          diff.added_nodes.map(n => ({ id: n.id, type: n.type, label: n.label })),
      removed_nodes:        diff.removed_nodes.map(n => ({ id: n.id, type: n.type, label: n.label })),
      changed_nodes:        diff.changed_nodes,
      added_connections:    diff.added_connections,
      removed_connections:  diff.removed_connections,
    } : { has_changes: false },
    validation: {
      structurally_valid:       validation.structurally_valid,
      executable:               validation.executable,
      errors:                   validation.errors,
      warnings:                 validation.warnings,
      unsupported_capabilities: validation.unsupported_capabilities,
    },
    capability_registry: registry,
    documents: documents.map(d => ({
      file_name:   d.file_name,
      mime_type:   d.mime_type,
      status:      d.status,
      chunk_count: d.chunk_count,
    })),
    knowledge_profile: knowledgeProfile,
  };

  return ctx;
}

function stripPosition(node) {
  const { x, y, ...rest } = node;
  return rest;
}

// ─── System message builder ───────────────────────────────────────────────────

function buildSystemMessage(ctx) {
  return `${ARCHITECT_SYSTEM_PROMPT}

=== CURRENT CONTEXT ===
RAG App: "${ctx.rag_app_title}"
Description: ${ctx.rag_app_description || 'Not provided'}
Base architect version: v${ctx.base_architect_version}
Architect status: ${ctx.architect_status}

Active workflow: ${ctx.active_workflow.node_count} nodes
${JSON.stringify(ctx.active_workflow.nodes.map(n => `${n.type}(${n.id})`), null, 0)}

${ctx.draft_workflow ? `Draft workflow: ${ctx.draft_workflow.node_count} nodes
Diff from active: ${JSON.stringify(ctx.diff, null, 2)}` : 'No draft workflow.'}

Validation of draft/active:
- structurally_valid: ${ctx.validation.structurally_valid}
- executable: ${ctx.validation.executable}
- unsupported_capabilities: [${ctx.validation.unsupported_capabilities.join(', ')}]
- warnings: ${JSON.stringify(ctx.validation.warnings)}

Capability Registry (relevant statuses):
${ctx.capability_registry
  .filter(c => c.runtime_status !== 'supported' || ctx.validation.unsupported_capabilities.includes(c.type))
  .map(c => `  ${c.type}: ${c.runtime_status} — ${c.description}`)
  .join('\n')}

Supported capabilities: ${ctx.capability_registry.filter(c => c.runtime_status === 'supported').map(c => c.type).join(', ')}

Documents: ${ctx.documents.length} indexed
${ctx.documents.map(d => `  ${d.file_name} (${d.status}, ${d.chunk_count} chunks)`).join('\n')}

Knowledge profile: ${ctx.knowledge_profile ? JSON.stringify(ctx.knowledge_profile) : 'Not available'}

Approved plan summary: ${ctx.approved_plan_summary || 'Not available'}

=== YOUR TASK ===
Analyze the context, understand the user's intent, ask clarifying questions if needed (max ${MAX_CLARIFICATION_TURNS} turns total), then produce a structured JSON proposal.

When producing the final proposal, respond with ONLY valid JSON matching this schema:
{
  "base_architect_version": ${ctx.base_architect_version},
  "intent_summary": "one sentence",
  "analysis": "detailed analysis",
  "requested_capabilities": [{"type":"...", "runtime_status":"...", "reason":"..."}],
  "recommended_changes": {
    "add_nodes": [{"type":"...", "label":"...", "params":{}, "reason":"..."}],
    "remove_nodes": ["node_id_or_type"],
    "reconfigure_nodes": [{"node_id":"...", "type":"...", "params":{}, "reason":"..."}],
    "connections": {"add": [{"from":"...", "to":"...", "reason":"..."}], "remove": [{"from":"...", "to":"..."}]}
  },
  "unsupported_capabilities": ["..."],
  "future_recommendations": [{"feature":"...", "reason":"..."}],
  "requires_reindex": false,
  "executable": false,
  "reasoning": {"architecture":"...", "runtime_compatibility":"...", "knowledge_impact":"..."},
  "summary": "2-3 sentences"
}

For conversational turns (not the final proposal), respond with plain text.
Signal you are done clarifying by including the phrase: "I have enough information to propose an updated architecture."`;
}

// ─── Conversation persistence ─────────────────────────────────────────────────

export async function saveMessage(userId, ragAppId, baseVersion, role, content, metadata = {}) {
  const { error } = await supabase.from('architect_chat_messages').insert({
    user_id:                userId,
    rag_app_id:             ragAppId,
    base_architect_version: baseVersion,
    role,
    content,
    metadata,
  });
  if (error) {
    console.error('[chatService] saveMessage error:', error.message);
  }
}

export async function loadConversation(userId, ragAppId, baseVersion) {
  const { data, error } = await supabase
    .from('architect_chat_messages')
    .select('id, role, content, metadata, created_at')
    .eq('user_id', userId)
    .eq('rag_app_id', ragAppId)
    .eq('base_architect_version', baseVersion)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[chatService] loadConversation error:', error.message);
    return [];
  }
  return data || [];
}

export async function clearConversation(userId, ragAppId, baseVersion) {
  await supabase
    .from('architect_chat_messages')
    .delete()
    .eq('user_id', userId)
    .eq('rag_app_id', ragAppId)
    .eq('base_architect_version', baseVersion);
}

// ─── Clarification turn counter ───────────────────────────────────────────────

function countArchitectTurns(messages) {
  return messages.filter(m => m.role === 'architect').length;
}

// ─── Main chat function ───────────────────────────────────────────────────────

/**
 * Process a user message and return the Architect's response.
 * Handles both conversational turns and proposal generation.
 *
 * @param {string} userId
 * @param {object} ragApp — full rag_app row
 * @param {string} userMessage
 * @param {object[]} history — previous messages from loadConversation()
 * @param {object} ctx — pre-built context from buildArchitectContext()
 * @returns {Promise<{
 *   message: string,           — Architect's response text
 *   proposal: object | null,   — validated proposal if produced
 *   turn_count: number,
 *   status: 'clarifying' | 'ready_for_review',
 * }>}
 */
export async function processArchitectMessage(userId, ragApp, userMessage, history, ctx) {
  const baseVersion = ragApp.architect_version || 0;
  const architectTurns = countArchitectTurns(history);

  // Build the messages array for the LLM
  // System context is always first; then conversation history; then new user message
  const systemContent = buildSystemMessage(ctx);

  const llmMessages = [
    { role: 'system', content: systemContent },
    // Previous turns (skip system messages from DB — they were for context only)
    ...history
      .filter(m => m.role !== 'system')
      .map(m => ({
        role:    m.role === 'architect' ? 'assistant' : 'user',
        content: m.content,
      })),
    { role: 'user', content: userMessage },
  ];

  // Force proposal generation if we've hit the clarification limit
  const forceProposal = architectTurns >= MAX_CLARIFICATION_TURNS;
  if (forceProposal && !llmMessages.find(m => m.content.includes('I have enough information'))) {
    llmMessages[llmMessages.length - 1].content +=
      '\n\n[System: You have reached the maximum clarification turns. You must now produce the structured JSON proposal.]';
  }

  // Decide: should the response be JSON (proposal) or text (clarification)?
  // Detect proposal trigger in conversation or force flag
  const lastUserMsg = userMessage.toLowerCase();
  const proposalTriggers = [
    'ready for proposal', 'generate proposal', 'generate the proposal',
    'make a proposal', 'create the proposal', 'proposal now',
    'produce the proposal', 'propose', "that's all", "that is all",
    'proceed', 'go ahead', 'yes, both', 'yes to both',
  ];
  const userRequestsProposal = proposalTriggers.some(t => lastUserMsg.includes(t));
  const historyIndicatesReady = history.some(
    m => m.role === 'architect' && m.content.includes('I have enough information to propose')
  );
  const shouldGenerateProposal = forceProposal || userRequestsProposal || historyIndicatesReady;

  let architectResponse;
  let proposal = null;
  let status = 'clarifying';

  if (shouldGenerateProposal) {
    // Generate structured JSON proposal using the full conversation history for context.
    // We use invokeLLMJsonChat so the LLM has the complete conversation and outputs JSON.
    const proposalSystemMsg = `${systemContent}

IMPORTANT: Your ENTIRE response must be ONLY the JSON proposal object matching the schema above.
Do NOT include any conversational text, markdown, or explanation outside the JSON.`;

    const proposalMessages = [
      { role: 'system', content: proposalSystemMsg },
      // Include full conversation history (excluding system context saves)
      ...history
        .filter(m => m.role !== 'system')
        .map(m => ({
          role:    m.role === 'architect' ? 'assistant' : 'user',
          content: m.content,
        })),
      // Final instruction — replace the user's natural-language message with a direct JSON command
      {
        role: 'user',
        content: 'Generate the structured JSON proposal now based on everything discussed above. Respond with ONLY the JSON object.',
      },
    ];

    let rawProposalJson;
    try {
      rawProposalJson = await invokeLLMJsonChat(proposalMessages, 0.3);
    } catch (err) {
      console.error('[chatService] invokeLLMJsonChat failed, falling back to invokeLLMChat:', err.message);
      // Fallback: ask the chat model and manually parse
      try {
        const jsonResp = await invokeLLMChat(proposalMessages, DEFAULT_CHAT_MODEL, 0.3);
        // Strip any markdown fences the model might have added
        const stripped = jsonResp.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
        rawProposalJson = JSON.parse(stripped);
      } catch {
        rawProposalJson = {};
      }
    }

    const validationResult = validateAndNormalizeProposal(rawProposalJson, baseVersion);
    if (validationResult.success) {
      proposal = validationResult.data;
      status = 'ready_for_review';
      architectResponse = `I've prepared a structured architecture proposal for you.\n\n**Summary:** ${proposal.summary}\n\n**Executable:** ${proposal.executable ? 'Yes — this can be activated in the current runtime.' : 'No — contains capabilities not yet available in this runtime.'}\n\n${proposal.unsupported_capabilities.length > 0 ? `**Unsupported capabilities:** ${proposal.unsupported_capabilities.join(', ')}` : ''}`;
    } else {
      // Validation failed — fall back to clarification with error note
      console.error('[chatService] Proposal validation failed:', JSON.stringify(validationResult.error).slice(0, 200));
      architectResponse = `I attempted to generate a proposal, but it didn't pass validation. Let me ask a couple of clarifying questions to improve it.\n\nWhat is the primary goal you're trying to achieve with these workflow changes?`;
      status = 'clarifying';
    }
  } else {
    // Conversational clarification turn
    architectResponse = await invokeLLMChat(llmMessages, DEFAULT_CHAT_MODEL, 0.5);
    status = 'clarifying';

    // Check if the Architect signaled it's ready for proposal
    if (architectResponse.includes('I have enough information to propose')) {
      status = 'ready_for_review';
    }
  }

  return {
    message:     architectResponse,
    proposal,
    turn_count:  architectTurns + 1,
    status,
  };
}
