/**
 * server/src/architect/chatService.js
 *
 * Phase 9B (context-grounding fix): Architect Chat service.
 *
 * ROOT CAUSE OF BROWSER BUG (fixed here):
 *   The original buildSystemMessage() dumped workflow state as raw JSON blobs
 *   (JSON.stringify arrays of node strings). The LLM could not extract structured
 *   meaning from those blobs, so it asked the user to describe changes it already
 *   had access to.
 *
 *   Additionally, review-draft passed an empty history and a generic user prompt,
 *   so the first LLM turn had no grounding signal to reference.
 *
 * FIX:
 *   1. buildSystemMessage() renders workflow state in human-readable prose:
 *      node-by-node, diff-by-diff, named capability statuses.
 *   2. A synthetic pre-turn assistant message ("context acknowledgement") is
 *      injected as the first assistant turn in review-draft, grounding the
 *      conversation in the actual detected changes before the user speaks.
 *   3. System prompt explicitly instructs the LLM that it has full canvas
 *      access and must NEVER ask users to describe changes already in context.
 *   4. draft_updated_at is tracked for stale-context detection.
 *
 * INVARIANTS (unchanged):
 *   - NEVER modifies active nodes/connections
 *   - NEVER modifies approved architect_plan
 *   - NEVER modifies document_chunks
 *   - NEVER activates proposed architecture
 *   - Produces advisory text + structured proposal ONLY
 */

import supabase from '../supabase.js';
import { invokeLLMChat, invokeLLMJsonChat, DEFAULT_CHAT_MODEL } from '../openai.js';
import { diffWorkflow, validateWorkflow } from '../workflowUtils.js';
import { getAllCapabilities } from '../nodeCapabilityRegistry.js';
import { validateAndNormalizeProposal } from './proposalSchema.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_CLARIFICATION_TURNS = 5;

// ─── System prompt ────────────────────────────────────────────────────────────
// CRITICAL: instructs the LLM it has full canvas access and must use it.

const ARCHITECT_SYSTEM_PROMPT = `You are the Vanta AI RAG Architect, an expert workflow advisor embedded in the Vanta platform.

You have COMPLETE STRUCTURED ACCESS to the user's canvas state:
- Active workflow (nodes and connections currently running in production)
- Draft workflow (pending changes the user has made on the canvas)
- Structured diff between active and draft (added/removed/changed nodes and connections)
- Validation result (structurally_valid, executable, unsupported_capabilities)
- Full capability registry with runtime_status for every node type
- Approved architect plan (chunking, retrieval, generation config)
- Knowledge profile from profiling
- Document metadata

MANDATORY RULES:
1. You MUST reference the structured workflow context provided. Do not ask users to describe canvas changes you can already read from the diff and draft workflow sections below.
2. NEVER say "I cannot view the canvas." You have full structured workflow access. If the user asks you to "look at the canvas", summarize what you see from the structured data.
3. NEVER claim an unsupported capability is executable. If runtime_status is 'unavailable' or 'experimental', state that clearly.
4. NEVER modify active nodes, connections, active architect_plan, or document_chunks.
5. Ask clarifying questions ONLY for information genuinely absent from context (e.g. user intent, business purpose). Max ${MAX_CLARIFICATION_TURNS} total clarification turns.
6. Do NOT ask questions already answered by the diff, validation, or conversation history.
7. When you have enough information, transition to a structured proposal.
8. Be honest about limitations. Preserve user intent even for unavailable capabilities.
9. Keep responses concise and conversational. No markdown headers in chat messages.

When producing the final proposal, respond with ONLY the JSON format specified below.
Signal you are ready to propose by including: "I have enough information to propose an updated architecture."`;

// ─── Context builder ──────────────────────────────────────────────────────────

/**
 * Build structured context for the Architect LLM.
 * x/y positions are stripped — they are visual-only UI noise.
 * All workflow state is resolved here once and reused for both the
 * system message and the context-acknowledgement turn.
 */
export async function buildArchitectContext(ragApp) {
  const activeNodes = (ragApp.nodes || []).map(stripPosition);
  const activeConns = ragApp.connections || [];
  const draftNodes  = ragApp.draft_nodes ? ragApp.draft_nodes.map(stripPosition) : null;
  const draftConns  = ragApp.draft_connections || null;

  // Diff (null if no draft)
  const diff = draftNodes !== null
    ? diffWorkflow(
        { nodes: activeNodes, connections: activeConns },
        { nodes: draftNodes,  connections: draftConns || [] }
      )
    : null;

  // Validate draft (or active if no draft)
  const validation = validateWorkflow(
    draftNodes  ?? activeNodes,
    draftConns  ?? activeConns
  );

  // Compact capability registry
  const registry = getAllCapabilities().map(cap => ({
    type:                       cap.type,
    label:                      cap.label,
    runtime_status:             cap.runtime_status,
    input_types:                cap.input_types,
    output_types:               cap.output_types,
    affects_ingestion:          cap.affects_ingestion,
    affects_query_runtime:      cap.affects_query_runtime,
    requires_reindex_on_change: cap.requires_reindex_on_change,
    description:                cap.description,
  }));

  // Document metadata (non-fatal)
  let documents = [];
  try {
    const { data: docs } = await supabase
      .from('documents')
      .select('id, file_name, mime_type, status, chunk_count')
      .eq('rag_app_id', ragApp.id)
      .in('status', ['profiled', 'indexed']);
    documents = docs || [];
  } catch { /* non-fatal */ }

  const knowledgeProfile = ragApp.architect_plan?.knowledge_profile ?? null;

  const ctx = {
    rag_app_id:              ragApp.id,
    rag_app_title:           ragApp.title,
    rag_app_description:     ragApp.description,
    base_architect_version:  ragApp.architect_version || 0,
    architect_status:        ragApp.architect_status,
    approved_plan_summary:   ragApp.architect_plan?.summary   ?? null,
    approved_plan_chunking:  ragApp.architect_plan?.chunking  ?? null,
    approved_plan_retrieval: ragApp.architect_plan?.retrieval ?? null,
    approved_plan_generation:ragApp.architect_plan?.generation?? null,
    draft_updated_at:        ragApp.draft_updated_at ?? null,
    active_workflow: {
      node_count:  activeNodes.length,
      nodes:       activeNodes,
      connections: activeConns,
    },
    draft_workflow: draftNodes !== null ? {
      node_count:  draftNodes.length,
      nodes:       draftNodes,
      connections: draftConns || [],
    } : null,
    diff: diff?.has_changes ? {
      has_changes:         true,
      added_nodes:         diff.added_nodes.map(n => ({ id: n.id, type: n.type, label: n.label })),
      removed_nodes:       diff.removed_nodes.map(n => ({ id: n.id, type: n.type, label: n.label })),
      changed_nodes:       diff.changed_nodes,
      added_connections:   diff.added_connections,
      removed_connections: diff.removed_connections,
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

  // ── Debug log (non-sensitive summary only) ───────────────────────────────
  console.log('[Architect ctx]', {
    active_node_count:        ctx.active_workflow.node_count,
    draft_node_count:         ctx.draft_workflow?.node_count ?? 0,
    has_diff:                 ctx.diff.has_changes,
    added_node_types:         ctx.diff.added_nodes?.map(n => n.type) ?? [],
    removed_node_types:       ctx.diff.removed_nodes?.map(n => n.type) ?? [],
    changed_connection_count: (ctx.diff.added_connections?.length ?? 0) +
                              (ctx.diff.removed_connections?.length ?? 0),
    unsupported_capabilities: ctx.validation.unsupported_capabilities,
    architect_version:        ctx.base_architect_version,
    draft_updated_at:         ctx.draft_updated_at,
  });

  return ctx;
}

function stripPosition(node) {
  const { x, y, ...rest } = node;
  return rest;
}

// ─── System message (human-readable prose, not JSON blobs) ────────────────────

/**
 * Build the system message injected as the first message in every LLM call.
 *
 * KEY CHANGE from original: workflow state is rendered as human-readable prose
 * so the LLM actually understands what the canvas contains, rather than trying
 * to parse raw JSON.stringify() blobs.
 */
function buildSystemMessage(ctx) {
  // ── Active workflow section ──────────────────────────────────────────────
  const activeNodeList = ctx.active_workflow.nodes
    .map(n => `  - ${n.label || n.type} [${n.type}] (id: ${n.id})`)
    .join('\n') || '  (none)';

  const activeConnList = ctx.active_workflow.connections.length > 0
    ? ctx.active_workflow.connections
        .map(c => `  - ${c.from} → ${c.to}`)
        .join('\n')
    : '  (none)';

  // ── Draft workflow section ───────────────────────────────────────────────
  let draftSection = 'No draft workflow — canvas matches active workflow.';
  if (ctx.draft_workflow) {
    const draftNodeList = ctx.draft_workflow.nodes
      .map(n => `  - ${n.label || n.type} [${n.type}] (id: ${n.id})`)
      .join('\n') || '  (none)';
    const draftConnList = ctx.draft_workflow.connections.length > 0
      ? ctx.draft_workflow.connections
          .map(c => `  - ${c.from} → ${c.to}`)
          .join('\n')
      : '  (none)';
    draftSection = `Draft workflow: ${ctx.draft_workflow.node_count} nodes
${draftNodeList}
Connections:
${draftConnList}`;
  }

  // ── Diff section (plain English) ─────────────────────────────────────────
  let diffSection = 'No changes between active and draft.';
  if (ctx.diff.has_changes) {
    const parts = [];
    if (ctx.diff.added_nodes?.length > 0) {
      parts.push('ADDED nodes:\n' + ctx.diff.added_nodes
        .map(n => `  + ${n.label || n.type} [${n.type}]`)
        .join('\n'));
    }
    if (ctx.diff.removed_nodes?.length > 0) {
      parts.push('REMOVED nodes:\n' + ctx.diff.removed_nodes
        .map(n => `  - ${n.label || n.type} [${n.type}]`)
        .join('\n'));
    }
    if (ctx.diff.changed_nodes?.length > 0) {
      parts.push('CHANGED nodes:\n' + ctx.diff.changed_nodes
        .map(n => `  ~ ${n.type} (id: ${n.id}): ${JSON.stringify(n.changed_params)}`)
        .join('\n'));
    }
    if (ctx.diff.added_connections?.length > 0) {
      parts.push('ADDED connections:\n' + ctx.diff.added_connections
        .map(c => `  + ${c.from} → ${c.to}`)
        .join('\n'));
    }
    if (ctx.diff.removed_connections?.length > 0) {
      parts.push('REMOVED connections:\n' + ctx.diff.removed_connections
        .map(c => `  - ${c.from} → ${c.to}`)
        .join('\n'));
    }
    diffSection = parts.join('\n\n');
  }

  // ── Validation section ────────────────────────────────────────────────────
  const unsupportedList = ctx.validation.unsupported_capabilities.length > 0
    ? ctx.validation.unsupported_capabilities
        .map(type => {
          const cap = ctx.capability_registry.find(c => c.type === type);
          return `  - ${type}: ${cap?.runtime_status ?? 'unknown'} — ${cap?.description ?? ''}`;
        })
        .join('\n')
    : '  (none — all nodes are executable)';

  const warningList = ctx.validation.warnings.length > 0
    ? ctx.validation.warnings.map(w => `  ⚠ ${w}`).join('\n')
    : '  (none)';

  // ── Capability registry — only show non-supported or explicitly mentioned ─
  const relevantCaps = ctx.capability_registry.filter(
    c => c.runtime_status !== 'supported' ||
         ctx.validation.unsupported_capabilities.includes(c.type)
  );
  const capSection = relevantCaps.length > 0
    ? relevantCaps.map(c => `  ${c.type} [${c.runtime_status}]: ${c.description}`).join('\n')
    : '  (all nodes in workflow are supported)';

  const supportedTypes = ctx.capability_registry
    .filter(c => c.runtime_status === 'supported')
    .map(c => c.type)
    .join(', ');

  // ── Approved plan section ─────────────────────────────────────────────────
  const planSection = ctx.approved_plan_summary
    ? `Summary: ${ctx.approved_plan_summary}
  Chunking: ${JSON.stringify(ctx.approved_plan_chunking)}
  Retrieval: ${JSON.stringify(ctx.approved_plan_retrieval)}
  Generation: ${JSON.stringify(ctx.approved_plan_generation)}`
    : 'No approved architect plan yet.';

  // ── Document section ──────────────────────────────────────────────────────
  const docSection = ctx.documents.length > 0
    ? ctx.documents.map(d => `  - ${d.file_name} (${d.status}, ${d.chunk_count ?? 0} chunks)`).join('\n')
    : '  (no indexed documents)';

  // ── Stale-draft warning ───────────────────────────────────────────────────
  const staleNote = ctx.draft_updated_at
    ? `Draft last saved: ${ctx.draft_updated_at}`
    : '';

  return `${ARCHITECT_SYSTEM_PROMPT}

════════════════════════════════════════════════════
CANVAS STATE — This is your authoritative view of the user's workflow.
You have full access to this information. Do NOT ask users to repeat it.
════════════════════════════════════════════════════

RAG App: "${ctx.rag_app_title}"
Description: ${ctx.rag_app_description || 'Not provided'}
Architect version: v${ctx.base_architect_version} (${ctx.architect_status})
${staleNote}

── ACTIVE WORKFLOW (${ctx.active_workflow.node_count} nodes — running in production) ──
${activeNodeList}
Connections:
${activeConnList}

── DRAFT WORKFLOW ──
${draftSection}

── DIFF: WHAT CHANGED (active → draft) ──
${diffSection}

── VALIDATION ──
structurally_valid: ${ctx.validation.structurally_valid}
executable:         ${ctx.validation.executable}
Unsupported capabilities (in draft, not executable in current runtime):
${unsupportedList}
Warnings:
${warningList}

── CAPABILITY REGISTRY (non-supported entries) ──
${capSection}
Supported types: ${supportedTypes}

── APPROVED ARCHITECT PLAN ──
${planSection}

── DOCUMENTS ──
${docSection}

── KNOWLEDGE PROFILE ──
${ctx.knowledge_profile ? JSON.stringify(ctx.knowledge_profile, null, 2) : 'Not available'}

════════════════════════════════════════════════════
YOUR TASK:
Based on the canvas state above, understand the user's intent.
If a draft exists with detected changes, REFERENCE THOSE CHANGES directly in your first response.
Do NOT ask the user what they changed — you already know from the diff above.
Ask clarifying questions only for genuinely unknown intent (e.g. business purpose, priority).
Max ${MAX_CLARIFICATION_TURNS} clarification turns total, then produce a structured JSON proposal.

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

STRICT RULE FOR future_recommendations:
Only include a capability in future_recommendations if it meets at least one of these criteria:
  1. The user explicitly requested or discussed it in this conversation.
  2. It is a direct technical prerequisite for a capability the user requested
     (e.g. a document image preprocessor is a prerequisite for OCR).
  3. It is strongly justified by the current knowledge profile or document types
     (e.g. documents are scanned images → OCR is relevant; documents are text → OCR is NOT relevant).
Do NOT suggest capabilities merely because they exist in the registry.
Do NOT suggest VoiceRecognition, WebCrawler, Translator, or any other unrelated capability
unless the user explicitly asked for it or the knowledge profile clearly demands it.
When in doubt, use an empty array: "future_recommendations": []

For conversational turns, respond with plain text only.
Signal readiness with: "I have enough information to propose an updated architecture."
════════════════════════════════════════════════════`;
}

// ─── Context acknowledgement turn ────────────────────────────────────────────

/**
 * Build a synthetic first assistant message that proactively acknowledges
 * the detected canvas state. This is injected as the first 'assistant' turn
 * in review-draft conversations so the LLM starts grounded in the actual diff
 * rather than asking what changed.
 *
 * This message is NOT stored in DB (it's generated from ctx on each request)
 * but IS injected into the LLM messages array before the user's first message.
 *
 * For direct chat (no diff), it describes the active workflow state.
 */
export function buildContextAcknowledgement(ctx) {
  if (ctx.diff?.has_changes) {
    // Review-draft path: describe what changed
    const added = ctx.diff.added_nodes?.map(n => n.label || n.type) ?? [];
    const removed = ctx.diff.removed_nodes?.map(n => n.label || n.type) ?? [];
    const changedConns = (ctx.diff.added_connections?.length ?? 0) +
                        (ctx.diff.removed_connections?.length ?? 0);
    const unsupported = ctx.validation.unsupported_capabilities;

    let msg = `I've reviewed your draft. Here's what I see:`;

    if (added.length > 0) {
      msg += `\n\nAdded nodes: ${added.join(', ')}.`;
    }
    if (removed.length > 0) {
      msg += `\nRemoved nodes: ${removed.join(', ')}.`;
    }
    if (changedConns > 0) {
      msg += `\nConnection changes: ${ctx.diff.added_connections?.length ?? 0} added, ${ctx.diff.removed_connections?.length ?? 0} removed.`;
    }

    if (unsupported.length > 0) {
      msg += `\n\nNote: ${unsupported.join(' and ')} ${unsupported.length === 1 ? 'is' : 'are'} not currently available in the Vanta runtime — ${unsupported.length === 1 ? 'it' : 'they'} cannot be part of an active production workflow in this version.`;
    }

    if (ctx.validation.executable) {
      msg += `\n\nThe draft workflow is fully executable with the current runtime.`;
    } else if (unsupported.length > 0) {
      msg += `\n\nThe draft is structurally valid (I understand what you're trying to build) but not yet executable because of the unsupported capabilities above.`;
    }

    return msg;
  }

  // Direct chat path: describe active workflow
  const activeTypes = ctx.active_workflow.nodes.map(n => n.label || n.type);
  let msg = `I can see your current workflow: ${activeTypes.join(' → ')}.`;

  if (ctx.draft_workflow) {
    msg += ` You also have a draft with ${ctx.draft_workflow.node_count} nodes (no semantic changes from active detected).`;
  } else {
    msg += ` No draft changes are saved yet.`;
  }

  return msg;
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

// ─── Discussed capability extractor ──────────────────────────────────────────

/**
 * Extract capability type names that were explicitly discussed in the conversation.
 * Used to ground future_recommendations filtering.
 *
 * Sources (in priority order):
 *   1. Unsupported capabilities already in the draft (from ctx.validation)
 *   2. Added nodes in the diff (user explicitly put them in the draft)
 *   3. Capability type names mentioned by name in user messages
 */
function _extractDiscussedCapabilities(history, currentUserMessage, ctx) {
  const discussed = new Set();

  // From draft diff — user explicitly added these
  if (ctx.diff?.added_nodes) {
    for (const n of ctx.diff.added_nodes) discussed.add(n.type);
  }

  // From validation — unsupported types in current draft
  for (const t of (ctx.validation?.unsupported_capabilities || [])) {
    discussed.add(t);
  }

  // From conversation text — scan user messages for registry type names
  const allCapabilityTypes = getAllCapabilities().map(c => c.type.toLowerCase());
  const allMessages = [
    ...history.filter(m => m.role === 'user').map(m => m.content.toLowerCase()),
    currentUserMessage.toLowerCase(),
  ];

  for (const msg of allMessages) {
    for (const cap of getAllCapabilities()) {
      // Match by type name or label (case-insensitive)
      if (
        msg.includes(cap.type.toLowerCase()) ||
        msg.includes(cap.label.toLowerCase())
      ) {
        discussed.add(cap.type);
      }
    }
  }

  return [...discussed];
}

// ─── Main chat function ───────────────────────────────────────────────────────

/**
 * Process a user message and return the Architect's response.
 *
 * Context injection strategy (KEY CHANGE):
 *   Every LLM call receives:
 *     [0] system: full canvas state as human-readable prose (buildSystemMessage)
 *     [1] assistant: context-acknowledgement turn (buildContextAcknowledgement)
 *         — synthetic, not stored in DB, always regenerated from ctx
 *         — grounds the LLM in actual diff/state before any user message
 *     [2..n] conversation history (user + architect turns from DB)
 *     [n+1] user: current message
 *
 *   This ensures the LLM always knows what's on the canvas even if the user's
 *   first message is "can you look at the canvas?" or similar.
 *
 * @param {string} userId
 * @param {object} ragApp
 * @param {string} userMessage
 * @param {object[]} history — DB messages (includes system rows, filtered out below)
 * @param {object} ctx — pre-built context from buildArchitectContext()
 * @returns {Promise<{message, proposal, turn_count, status}>}
 */
export async function processArchitectMessage(userId, ragApp, userMessage, history, ctx) {
  const baseVersion    = ragApp.architect_version || 0;
  const architectTurns = countArchitectTurns(history);

  // Build the system message (human-readable canvas prose)
  const systemContent = buildSystemMessage(ctx);

  // Build the context-acknowledgement synthetic assistant turn
  // This is injected BEFORE conversation history so the LLM opens from
  // a grounded position regardless of what the user says first.
  const contextAck = buildContextAcknowledgement(ctx);

  // Assemble the full LLM messages array:
  //   system → context-ack (assistant) → history → user message
  const llmMessages = [
    { role: 'system',    content: systemContent },
    { role: 'assistant', content: contextAck },
    // DB history: skip system rows (those were context-snapshot markers)
    ...history
      .filter(m => m.role !== 'system')
      .map(m => ({
        role:    m.role === 'architect' ? 'assistant' : 'user',
        content: m.content,
      })),
    { role: 'user', content: userMessage },
  ];

  // Force proposal if clarification limit reached
  const forceProposal = architectTurns >= MAX_CLARIFICATION_TURNS;
  if (forceProposal) {
    llmMessages[llmMessages.length - 1].content +=
      '\n\n[System: You have reached the maximum clarification turns. You must now produce the structured JSON proposal.]';
  }

  // Detect proposal request
  const lastUserMsg = userMessage.toLowerCase();
  const proposalTriggers = [
    'ready for proposal', 'generate proposal', 'generate the proposal',
    'make a proposal', 'create the proposal', 'proposal now',
    'produce the proposal', 'propose', "that's all", "that is all",
    'proceed', 'go ahead', 'yes, both', 'yes to both',
  ];
  const userRequestsProposal   = proposalTriggers.some(t => lastUserMsg.includes(t));
  const historyIndicatesReady  = history.some(
    m => m.role === 'architect' && m.content.includes('I have enough information to propose')
  );
  const shouldGenerateProposal = forceProposal || userRequestsProposal || historyIndicatesReady;

  let architectResponse;
  let proposal = null;
  let status   = 'clarifying';

  if (shouldGenerateProposal) {
    // Proposal generation — uses full conversation + context via invokeLLMJsonChat
    const proposalSystemMsg = `${systemContent}

IMPORTANT: Your ENTIRE response must be ONLY the JSON proposal object matching the schema above.
Do NOT include any conversational text, markdown fences, or explanation outside the JSON object.`;

    const proposalMessages = [
      { role: 'system',    content: proposalSystemMsg },
      { role: 'assistant', content: contextAck },
      ...history
        .filter(m => m.role !== 'system')
        .map(m => ({
          role:    m.role === 'architect' ? 'assistant' : 'user',
          content: m.content,
        })),
      {
        role: 'user',
        content: 'Generate the structured JSON proposal now based on everything discussed above. Respond with ONLY the JSON object.',
      },
    ];

    let rawProposalJson;
    try {
      rawProposalJson = await invokeLLMJsonChat(proposalMessages, 0.3);
    } catch (err) {
      console.error('[chatService] invokeLLMJsonChat failed, falling back:', err.message);
      try {
        const jsonResp = await invokeLLMChat(proposalMessages, DEFAULT_CHAT_MODEL, 0.3);
        const stripped = jsonResp.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
        rawProposalJson = JSON.parse(stripped);
      } catch {
        rawProposalJson = {};
      }
    }

    // Extract capability types mentioned in the conversation to ground
    // future_recommendations — prevents the LLM from hallucinating unrelated suggestions
    const discussedCapabilities = _extractDiscussedCapabilities(history, userMessage, ctx);

    const validationResult = validateAndNormalizeProposal(rawProposalJson, baseVersion, discussedCapabilities);
    if (validationResult.success) {
      proposal  = validationResult.data;
      status    = 'ready_for_review';
      // Short transition line — the ProposalDisplay card is the authoritative UI.
      // Marked with a metadata tag so the frontend can suppress it when the card is present.
      architectResponse = `Proposal ready. See the architecture proposal below.`;
    } else {
      console.error('[chatService] Proposal validation failed:', JSON.stringify(validationResult.error).slice(0, 200));
      architectResponse =
        `I attempted to generate a proposal, but it didn't pass validation. ` +
        `What is the primary goal you're trying to achieve with these workflow changes?`;
      status = 'clarifying';
    }
  } else {
    // Conversational turn
    architectResponse = await invokeLLMChat(llmMessages, DEFAULT_CHAT_MODEL, 0.5);
    status = 'clarifying';

    if (architectResponse.includes('I have enough information to propose')) {
      status = 'ready_for_review';
    }
  }

  return {
    message:    architectResponse,
    proposal,
    turn_count: architectTurns + 1,
    status,
  };
}
