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
import {
  buildArchitectContext,
  saveMessage,
  loadConversation,
  clearConversation,
  processArchitectMessage,
} from '../architect/chatService.js';

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

    // Save the system context as a system message (not shown to user)
    await saveMessage(req.user.id, req.params.ragAppId, baseVersion, 'system',
      '[Context injected — not shown to user]', { context_snapshot: true });

    // Process the opening user message (or provide an opener if none)
    const openingMsg = message?.trim() || 'Hello, please review my current workflow and help me improve it.';
    await saveMessage(req.user.id, req.params.ragAppId, baseVersion, 'user', openingMsg);

    const result = await processArchitectMessage(
      req.user.id, ragApp, openingMsg, [], ctx
    );

    // Save Architect response
    await saveMessage(req.user.id, req.params.ragAppId, baseVersion, 'architect',
      result.message, { status: result.status, turn_count: result.turn_count });

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
    await saveMessage(req.user.id, req.params.ragAppId, baseVersion, 'architect',
      result.message, { status: result.status, turn_count: result.turn_count });

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

    // Generate the Architect's opening review message
    const reviewPrompt = `I'd like you to review my draft workflow changes and help me refine the architecture.`;
    await saveMessage(req.user.id, req.params.ragAppId, baseVersion, 'user', reviewPrompt);

    const result = await processArchitectMessage(
      req.user.id, ragApp, reviewPrompt, [], ctx
    );

    await saveMessage(req.user.id, req.params.ragAppId, baseVersion, 'architect',
      result.message, { status: result.status, turn_count: result.turn_count, review_draft: true });

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
    });
  } catch (err) {
    console.error('[architect-chat POST review-draft]', err.message);
    res.status(500).json({ error: 'Failed to review draft: ' + err.message });
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
