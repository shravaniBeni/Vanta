/**
 * server/src/routes/architectChat.js
 *
 * Phase 9B: Architect Chat API.
 *
 * All routes require authentication and verify RAG app ownership.
 * NEVER mutates active workflow, active architect_plan, or document_chunks.
 *
 * POST /api/architect-chat/:ragAppId/start        — start/resume conversation
 * POST /api/architect-chat/:ragAppId/message      — send a user message
 * POST /api/architect-chat/:ragAppId/review-draft — review current draft
 * GET  /api/architect-chat/:ragAppId              — load conversation + proposal
 * DELETE /api/architect-chat/:ragAppId/cancel     — cancel proposal (not draft)
 */

import { Router } from 'express';
import supabase from '../supabase.js';
import { getOwnedRagApp } from '../helpers.js';
import { getNodeCapability } from '../nodeCapabilityRegistry.js';
import {
  buildArchitectContext,
  buildContextAcknowledgement,
  saveMessage,
  loadConversation,
  clearConversation,
  processArchitectMessage,
} from '../architect/chatService.js';
import { validateAndNormalizeProposal } from '../architect/proposalSchema.js';
import { activateProposal } from '../architect/proposalActivator.js';

const router = Router();

// ─── GET /api/architect-chat/:ragAppId ────────────────────────────────────────
// Load conversation history + current proposal state.

router.get('/:ragAppId', async (req, res) => {
  try {
    const ragApp = await getOwnedRagApp(req.params.ragAppId, req.user.id);
    if (!ragApp) return res.status(404).json({ error: 'RAG app not found' });

    const baseVersion = ragApp.architect_version || 0;
    const history     = await loadConversation(req.user.id, req.params.ragAppId, baseVersion);

    // Return only user + architect messages (not system context messages)
    const visibleMessages = history.filter(m => m.role !== 'system');

    res.json({
      rag_app_id:             req.params.ragAppId,
      base_architect_version: baseVersion,
      messages:               visibleMessages,
      has_conversation:       visibleMessages.length > 0,
      proposed_status:        ragApp.proposed_architect_status || null,
      proposed_plan:          ragApp.proposed_architect_plan   || null,
    });
  } catch (err) {
    console.error('[architect-chat GET]', err.message);
    res.status(500).json({ error: 'Failed to load conversation' });
  }
});

// ─── POST /api/architect-chat/:ragAppId/start ─────────────────────────────────
// Start a new conversation (clears any existing for this version).
// Returns the Architect's opening context acknowledgement.

router.post('/:ragAppId/start', async (req, res) => {
  const { message } = req.body;

  try {
    const ragApp = await getOwnedRagApp(req.params.ragAppId, req.user.id);
    if (!ragApp) return res.status(404).json({ error: 'RAG app not found' });

    const baseVersion = ragApp.architect_version || 0;

    // Clear previous conversation for this version
    await clearConversation(req.user.id, req.params.ragAppId, baseVersion);

    // Clear any existing proposal
    await supabase.from('rag_apps').update({
      proposed_architect_plan:         null,
      proposed_architect_status:       null,
      proposed_architect_base_version: null,
      proposed_architect_created_at:   null,
    }).eq('id', req.params.ragAppId).eq('user_id', req.user.id);

    // Build context
    const ctx = await buildArchitectContext(ragApp);

    // Save the system context marker (not shown to user)
    await saveMessage(req.user.id, req.params.ragAppId, baseVersion, 'system',
      '[Context injected — not shown to user]', { context_snapshot: true });

    // Store the context-acknowledgement as the first architect turn.
    // Grounds subsequent LLM calls in actual canvas state.
    const contextAck = buildContextAcknowledgement(ctx);
    await saveMessage(req.user.id, req.params.ragAppId, baseVersion, 'architect',
      contextAck, { context_ack: true, auto_generated: true });

    // Store the opening user message
    const openingMsg = message?.trim() || 'Hello, please review my current workflow and help me improve it.';
    await saveMessage(req.user.id, req.params.ragAppId, baseVersion, 'user', openingMsg);

    // Load history so processArchitectMessage sees the context-ack
    const startHistory = await loadConversation(req.user.id, req.params.ragAppId, baseVersion);

    const result = await processArchitectMessage(
      req.user.id, ragApp, openingMsg, startHistory, ctx
    );

    // Save Architect response — proposal announcements are tagged so the UI
    // can suppress the bubble when the structured ProposalDisplay card is shown.
    const isProposalAnnouncement = result.status === 'ready_for_review' && result.proposal !== null;
    await saveMessage(req.user.id, req.params.ragAppId, baseVersion, 'architect',
      result.message, {
        status:                result.status,
        turn_count:            result.turn_count,
        is_proposal_announcement: isProposalAnnouncement,
      });

    // Persist proposal if produced
    if (result.proposal && result.status === 'ready_for_review') {
      await _persistProposal(req.params.ragAppId, req.user.id, result.proposal, baseVersion);
    }

    res.json({
      rag_app_id:    req.params.ragAppId,
      message:       result.message,
      status:        result.status,
      turn_count:    result.turn_count,
      proposal:      result.proposal || null,
    });
  } catch (err) {
    console.error('[architect-chat POST start]', err.message);
    res.status(500).json({ error: 'Failed to start conversation: ' + err.message });
  }
});

// ─── POST /api/architect-chat/:ragAppId/message ───────────────────────────────
// Send a user message and get the next Architect response.

router.post('/:ragAppId/message', async (req, res) => {
  const { message } = req.body;
  if (!message?.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    const ragApp = await getOwnedRagApp(req.params.ragAppId, req.user.id);
    if (!ragApp) return res.status(404).json({ error: 'RAG app not found' });

    const baseVersion = ragApp.architect_version || 0;
    const history     = await loadConversation(req.user.id, req.params.ragAppId, baseVersion);

    if (history.length === 0) {
      return res.status(400).json({
        error: 'No active conversation. Use /start to begin a conversation first.',
      });
    }

    // Build context (re-read ragApp so draft changes are reflected)
    const ctx = await buildArchitectContext(ragApp);

    // Save user message
    await saveMessage(req.user.id, req.params.ragAppId, baseVersion, 'user', message.trim());

    const result = await processArchitectMessage(
      req.user.id, ragApp, message.trim(), history, ctx
    );

    // Save Architect response
    const isProposalAnnouncement = result.status === 'ready_for_review' && result.proposal !== null;
    await saveMessage(req.user.id, req.params.ragAppId, baseVersion, 'architect',
      result.message, {
        status:                   result.status,
        turn_count:               result.turn_count,
        is_proposal_announcement: isProposalAnnouncement,
      });

    // Persist proposal if produced
    if (result.proposal && result.status === 'ready_for_review') {
      await _persistProposal(req.params.ragAppId, req.user.id, result.proposal, baseVersion);
    }

    res.json({
      rag_app_id:    req.params.ragAppId,
      message:       result.message,
      status:        result.status,
      turn_count:    result.turn_count,
      proposal:      result.proposal || null,
    });
  } catch (err) {
    console.error('[architect-chat POST message]', err.message);
    res.status(500).json({ error: 'Failed to process message: ' + err.message });
  }
});

// ─── POST /api/architect-chat/:ragAppId/review-draft ──────────────────────────
// PATH A: User has a saved draft and wants the Architect to review it.
// Starts/resumes a conversation with the draft diff as the opening context.

router.post('/:ragAppId/review-draft', async (req, res) => {
  try {
    const ragApp = await getOwnedRagApp(req.params.ragAppId, req.user.id);
    if (!ragApp) return res.status(404).json({ error: 'RAG app not found' });

    const baseVersion = ragApp.architect_version || 0;

    // Build context — includes draft + diff automatically
    const ctx = await buildArchitectContext(ragApp);

    if (!ctx.draft_workflow) {
      // No draft — Architect notes the current active workflow
      const msg = "I don't see any draft workflow changes to review. Tell me what you'd like to change about the current workflow, or drag nodes onto the canvas and save a draft first.";
      return res.json({
        rag_app_id: req.params.ragAppId,
        message:    msg,
        status:     'clarifying',
        has_diff:   false,
      });
    }

    // Clear previous conversation + proposal for fresh review
    await clearConversation(req.user.id, req.params.ragAppId, baseVersion);
    await supabase.from('rag_apps').update({
      proposed_architect_plan:         null,
      proposed_architect_status:       null,
      proposed_architect_base_version: null,
      proposed_architect_created_at:   null,
    }).eq('id', req.params.ragAppId).eq('user_id', req.user.id);

    // Save system context
    await saveMessage(req.user.id, req.params.ragAppId, baseVersion, 'system',
      '[Context injected — draft review]', { context_snapshot: true, review_draft: true });

    // Store the context-acknowledgement as the first architect turn in DB.
    // This grounds the conversation in the actual detected changes so that
    // when the user sends their first real message, the LLM has already
    // acknowledged what it sees on the canvas.
    const contextAck = buildContextAcknowledgement(ctx);
    await saveMessage(req.user.id, req.params.ragAppId, baseVersion, 'architect',
      contextAck, { context_ack: true, auto_generated: true });

    // The user's opening message for the review session
    const reviewPrompt = `I'd like you to review my draft workflow changes and help me refine the architecture.`;
    await saveMessage(req.user.id, req.params.ragAppId, baseVersion, 'user', reviewPrompt);

    // Load the stored messages so processArchitectMessage sees the context-ack
    // in history and doesn't regenerate it redundantly
    const reviewHistory = await loadConversation(req.user.id, req.params.ragAppId, baseVersion);

    const result = await processArchitectMessage(
      req.user.id, ragApp, reviewPrompt, reviewHistory, ctx
    );

    const isProposalAnnouncement = result.status === 'ready_for_review' && result.proposal !== null;
    await saveMessage(req.user.id, req.params.ragAppId, baseVersion, 'architect',
      result.message, {
        status:                   result.status,
        turn_count:               result.turn_count,
        review_draft:             true,
        is_proposal_announcement: isProposalAnnouncement,
      });

    if (result.proposal && result.status === 'ready_for_review') {
      await _persistProposal(req.params.ragAppId, req.user.id, result.proposal, baseVersion);
    }

    res.json({
      rag_app_id:    req.params.ragAppId,
      message:       result.message,
      status:        result.status,
      turn_count:    result.turn_count,
      proposal:      result.proposal || null,
      has_diff:      ctx.diff?.has_changes || false,
      validation:    ctx.validation,
      context_ack:   contextAck,  // first visible Architect message (canvas summary)
    });
  } catch (err) {
    console.error('[architect-chat POST review-draft]', err.message);
    res.status(500).json({ error: 'Failed to review draft: ' + err.message });
  }
});

// ─── POST /api/architect-chat/:ragAppId/approve-proposal ─────────────────────
// Phase 9C: Approve and activate a ready_for_review proposal.
//
// Guard conditions (all checked server-side — never trust stored executable):
//   1. Authentication + ownership
//   2. proposed_status === 'ready_for_review'
//   3. proposed_architect_plan exists
//   4. proposed_architect_base_version === current architect_version (staleness)
//   5. Zod re-validation of stored proposal
//   6. Re-check capability support from live registry (don't trust stored executable)
//
// If any unsupported capabilities detected → return blocked, do NOT activate.
// If executable → build candidate, validate, analyze impact, activate.

router.post('/:ragAppId/approve-proposal', async (req, res) => {
  try {
    const ragApp = await getOwnedRagApp(req.params.ragAppId, req.user.id);
    if (!ragApp) return res.status(404).json({ error: 'RAG app not found' });

    // ── Guard 1: Must have a proposal ────────────────────────────────────────
    if (!ragApp.proposed_architect_plan) {
      return res.status(400).json({
        error: 'No proposal found. Generate a proposal through Architect Chat first.',
      });
    }

    // ── Guard 2: Must be ready_for_review ─────────────────────────────────────
    if (ragApp.proposed_architect_status !== 'ready_for_review') {
      return res.status(400).json({
        error: `Proposal is not in a reviewable state. Current status: ${ragApp.proposed_architect_status}`,
        proposed_status: ragApp.proposed_architect_status,
      });
    }

    // ── Guard 3: Staleness check ──────────────────────────────────────────────
    // The proposal was generated against a specific architect_version.
    // If the active plan version has changed since then, the proposal is stale.
    const proposalBaseVersion = ragApp.proposed_architect_base_version ?? -1;
    const currentVersion      = ragApp.architect_version || 0;

    if (proposalBaseVersion !== currentVersion) {
      return res.status(409).json({
        error: `Proposal is stale. It was generated for architect version ${proposalBaseVersion} ` +
               `but the current version is ${currentVersion}. ` +
               `Please start a new Architect conversation to generate a fresh proposal.`,
        proposed_base_version: proposalBaseVersion,
        current_version:       currentVersion,
        stale: true,
      });
    }

    // ── Guard 4: Re-validate proposal with Zod ────────────────────────────────
    // Never trust the stored blob — always re-validate before activation.
    const revalidated = validateAndNormalizeProposal(
      JSON.parse(JSON.stringify(ragApp.proposed_architect_plan)),
      currentVersion
    );

    if (!revalidated.success) {
      return res.status(422).json({
        error: 'Stored proposal failed re-validation. Please generate a new proposal.',
        details: revalidated.error,
      });
    }

    const proposal = revalidated.data;

    // ── Guard 5: Re-check capability support from live registry ───────────────
    // Never trust proposal.executable — always recompute from current registry.
    const recomputedUnsupported = (proposal.unsupported_capabilities || []).filter(type => {
      const cap = getNodeCapability(type);
      return !cap || cap.runtime_status !== 'supported';
    });

    // Also check requested_capabilities
    const requestedUnsupported = (proposal.requested_capabilities || [])
      .filter(rc => {
        const cap = getNodeCapability(rc.type);
        return !cap || cap.runtime_status !== 'supported';
      })
      .map(rc => rc.type);

    const allUnsupported = [...new Set([...recomputedUnsupported, ...requestedUnsupported])];

    if (allUnsupported.length > 0) {
      return res.status(200).json({
        approved:               false,
        executable:             false,
        activation_blocked:     true,
        unsupported_capabilities: allUnsupported,
        message: `Cannot activate this proposal because the following capabilities are not supported by the current runtime: ${allUnsupported.join(', ')}. The proposal remains saved for future review.`,
        proposed_status:        'ready_for_review',
      });
    }

    // ── Activate ───────────────────────────────────────────────────────────────
    const result = await activateProposal(
      req.params.ragAppId,
      req.user.id,
      ragApp,
      proposal
    );

    res.json({
      approved:          true,
      activated:         true,
      rag_app_id:        req.params.ragAppId,
      architect_version: result.architect_version,
      nodes:             result.nodes,
      connections:       result.connections,
      impact:            result.impact,
      reindexed:         result.reindexed,
      indexing_result:   result.indexing_result,
      proposed_status:   'activated',
    });
  } catch (err) {
    console.error('[architect-chat POST approve-proposal]', err.message);

    // Return structured error for known failure modes
    if (err.code === 'INVALID_CANDIDATE') {
      return res.status(422).json({
        error:          'Candidate workflow failed validation',
        details:        err.validation?.errors,
        proposed_status: 'activation_error',
      });
    }
    if (err.code === 'NOT_EXECUTABLE') {
      return res.status(422).json({
        error:          'Candidate workflow is not executable',
        details:        err.validation?.unsupported_capabilities,
        proposed_status: 'activation_error',
      });
    }
    if (err.code === 'BLOCKED_UNSUPPORTED') {
      return res.status(422).json({
        activation_blocked: true,
        error:              err.message,
        impact:             err.impact,
        proposed_status:    'activation_error',
      });
    }

    res.status(500).json({
      error: 'Proposal activation failed: ' + err.message,
      proposed_status: 'activation_error',
    });
  }
});

// ─── DELETE /api/architect-chat/:ragAppId/cancel ──────────────────────────────
// Cancel the current proposal and clear conversation.
// Does NOT discard the user's draft.

router.delete('/:ragAppId/cancel', async (req, res) => {
  try {
    const ragApp = await getOwnedRagApp(req.params.ragAppId, req.user.id);
    if (!ragApp) return res.status(404).json({ error: 'RAG app not found' });

    const baseVersion = ragApp.architect_version || 0;

    // Mark proposal as cancelled (preserve for audit, don't delete)
    if (ragApp.proposed_architect_status) {
      await supabase.from('rag_apps').update({
        proposed_architect_status: 'cancelled',
      }).eq('id', req.params.ragAppId).eq('user_id', req.user.id);
    }

    // Clear conversation messages
    await clearConversation(req.user.id, req.params.ragAppId, baseVersion);

    res.json({
      rag_app_id:   req.params.ragAppId,
      cancelled:    true,
      // Draft is NOT cleared — user keeps their draft changes
      draft_preserved: true,
    });
  } catch (err) {
    console.error('[architect-chat DELETE cancel]', err.message);
    res.status(500).json({ error: 'Failed to cancel: ' + err.message });
  }
});

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function _persistProposal(ragAppId, userId, proposal, baseVersion) {
  const { error } = await supabase.from('rag_apps').update({
    proposed_architect_plan:         proposal,
    proposed_architect_status:       'ready_for_review',
    proposed_architect_base_version: baseVersion,
    proposed_architect_created_at:   new Date().toISOString(),
  }).eq('id', ragAppId).eq('user_id', userId);

  if (error) {
    console.error('[architectChat] Failed to persist proposal:', error.message);
  }
}

export default router;
