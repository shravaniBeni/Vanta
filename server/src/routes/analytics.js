/**
 * server/src/routes/analytics.js
 *
 * Phase 10C: Analytics API routes for chatbot owners.
 *
 * ALL routes require authentication.
 * All analytics are scoped to the authenticated user's chatbots only.
 *
 * GET  /api/analytics/:chatbotId/summary     — aggregated metrics
 * GET  /api/analytics/:chatbotId/topics      — top topics
 * GET  /api/analytics/:chatbotId/trend       — daily question counts
 * POST /api/analytics/:chatbotId/insights    — LLM-generated insights
 * GET  /api/analytics/:chatbotId/settings    — analytics settings
 * PUT  /api/analytics/:chatbotId/settings    — update analytics settings
 * POST /api/analytics/feedback               — submit feedback (public)
 * POST /api/analytics/session                — create/resume session (public)
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import supabase from '../supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { sessionRateLimit, feedbackRateLimit } from '../middleware/rateLimit.js';
import {
  getAnalyticsSummary,
  getTopTopics,
  getDailyTrend,
  generateInsights,
  getAnalyticsSettings,
  saveAnalyticsSettings,
  getOrCreateSession,
  recordFeedbackAsync,
} from '../analyticsService.js';
import { getOwnedRagApp } from '../helpers.js';

const router = Router();

// ─── Date range helper ────────────────────────────────────────────────────────

function parseDateRange(query) {
  const now = new Date();
  const days = parseInt(query.days || '30', 10);
  const to   = query.to   ? new Date(query.to)   : now;
  const from = query.from ? new Date(query.from)  : new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  // Validate
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    throw Object.assign(new Error('Invalid date range'), { status: 400 });
  }
  if (to < from) {
    throw Object.assign(new Error('"to" must be after "from"'), { status: 400 });
  }
  // Max range: 365 days
  const rangeDays = (to - from) / (1000 * 60 * 60 * 24);
  if (rangeDays > 365) {
    throw Object.assign(new Error('Date range cannot exceed 365 days'), { status: 400 });
  }
  return { from, to };
}

// ─── GET /api/analytics/:chatbotId/summary ────────────────────────────────────

router.get('/:chatbotId/summary', requireAuth, async (req, res) => {
  try {
    const range   = parseDateRange(req.query);
    const summary = await getAnalyticsSummary(req.params.chatbotId, req.user.id, range);
    res.json({ summary, range: { from: range.from.toISOString(), to: range.to.toISOString() } });
  } catch (err) {
    const status = err.status || 500;
    console.error('[analytics/summary]', err.message);
    res.status(status).json({ error: err.message });
  }
});

// ─── GET /api/analytics/:chatbotId/topics ─────────────────────────────────────

router.get('/:chatbotId/topics', requireAuth, async (req, res) => {
  try {
    const range  = parseDateRange(req.query);
    const limit  = Math.min(parseInt(req.query.limit || '10', 10), 50);
    const topics = await getTopTopics(req.params.chatbotId, req.user.id, { ...range, limit });
    res.json({ topics, range: { from: range.from.toISOString(), to: range.to.toISOString() } });
  } catch (err) {
    const status = err.status || 500;
    console.error('[analytics/topics]', err.message);
    res.status(status).json({ error: err.message });
  }
});

// ─── GET /api/analytics/:chatbotId/trend ──────────────────────────────────────

router.get('/:chatbotId/trend', requireAuth, async (req, res) => {
  try {
    const range = parseDateRange(req.query);
    const trend = await getDailyTrend(req.params.chatbotId, req.user.id, range);
    res.json({ trend, range: { from: range.from.toISOString(), to: range.to.toISOString() } });
  } catch (err) {
    const status = err.status || 500;
    console.error('[analytics/trend]', err.message);
    res.status(status).json({ error: err.message });
  }
});

// ─── POST /api/analytics/:chatbotId/insights ──────────────────────────────────

router.post('/:chatbotId/insights', requireAuth, async (req, res) => {
  try {
    const range = parseDateRange(req.query);

    // Verify ownership + load chatbot title
    const ragApp = await getOwnedRagApp(req.params.chatbotId, req.user.id);
    if (!ragApp) return res.status(404).json({ error: 'Chatbot not found' });

    const [summary, topTopics] = await Promise.all([
      getAnalyticsSummary(req.params.chatbotId, req.user.id, range),
      getTopTopics(req.params.chatbotId, req.user.id, { ...range, limit: 10 }),
    ]);

    const insights = await generateInsights({
      summary,
      topTopics,
      chatbotTitle: ragApp.title,
    });

    res.json({ insights, generated_at: new Date().toISOString() });
  } catch (err) {
    const status = err.status || 500;
    console.error('[analytics/insights]', err.message);
    res.status(status).json({ error: err.message });
  }
});

// ─── GET /api/analytics/:chatbotId/settings ───────────────────────────────────

router.get('/:chatbotId/settings', requireAuth, async (req, res) => {
  try {
    // Verify ownership
    const ragApp = await getOwnedRagApp(req.params.chatbotId, req.user.id);
    if (!ragApp) return res.status(404).json({ error: 'Chatbot not found' });

    const settings = await getAnalyticsSettings(req.params.chatbotId);
    res.json(settings);
  } catch (err) {
    console.error('[analytics/settings GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/analytics/:chatbotId/settings ───────────────────────────────────

router.put('/:chatbotId/settings', requireAuth, async (req, res) => {
  try {
    // Verify ownership
    const ragApp = await getOwnedRagApp(req.params.chatbotId, req.user.id);
    if (!ragApp) return res.status(404).json({ error: 'Chatbot not found' });

    const updated = await saveAnalyticsSettings(req.params.chatbotId, req.user.id, req.body);
    res.json(updated);
  } catch (err) {
    console.error('[analytics/settings PUT]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/analytics/feedback ─────────────────────────────────────────────
// Public: any visitor can submit feedback for their own interaction.
// Requires session_token for ownership verification (scoped to chatbot).

router.post('/feedback', feedbackRateLimit, async (req, res) => {
  const { session_token, interaction_event_id, feedback_value, chatbot_id, embed_id } = req.body;

  if (!session_token || interaction_event_id === undefined || feedback_value === undefined) {
    return res.status(400).json({ error: 'session_token, interaction_event_id, and feedback_value are required' });
  }
  if (typeof feedback_value !== 'boolean') {
    return res.status(400).json({ error: 'feedback_value must be true or false' });
  }

  try {
    // Resolve chatbot
    let ragAppId;
    if (chatbot_id) {
      ragAppId = chatbot_id;
    } else if (embed_id) {
      const { data } = await supabase
        .from('rag_apps')
        .select('id')
        .eq('embed_id', embed_id)
        .single();
      if (!data) return res.status(404).json({ error: 'Chatbot not found' });
      ragAppId = data.id;
    } else {
      return res.status(400).json({ error: 'chatbot_id or embed_id required' });
    }

    // Verify session ownership (token + chatbot must match)
    const { data: session } = await supabase
      .from('visitor_sessions')
      .select('id, rag_app_id')
      .eq('session_token', session_token)
      .eq('rag_app_id', ragAppId)
      .single();

    if (!session) {
      return res.status(403).json({ error: 'Invalid session for this chatbot' });
    }

    // Verify the interaction_event belongs to this session
    const { data: event } = await supabase
      .from('interaction_events')
      .select('id, session_id, rag_app_id')
      .eq('id', interaction_event_id)
      .eq('session_id', session.id)
      .eq('rag_app_id', ragAppId)
      .single();

    if (!event) {
      return res.status(403).json({ error: 'Interaction not found for this session' });
    }

    // Record feedback (upsert — one per interaction)
    const { error } = await supabase
      .from('feedback_events')
      .upsert({
        id:                    uuidv4(),
        rag_app_id:            ragAppId,
        session_id:            session.id,
        interaction_event_id:  interaction_event_id,
        feedback_value,
      }, { onConflict: 'interaction_event_id', ignoreDuplicates: false });

    if (error && error.code !== '23505') {
      throw new Error(error.message);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[analytics/feedback]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/analytics/session ──────────────────────────────────────────────
// Public: create or resume a visitor session.
// Called by the chat client before sending the first message (optional).

router.post('/session', sessionRateLimit, async (req, res) => {
  const { chatbot_id, embed_id, session_token } = req.body;

  try {
    let ragAppId;
    if (chatbot_id) {
      ragAppId = chatbot_id;
    } else if (embed_id) {
      const { data } = await supabase
        .from('rag_apps')
        .select('id, status')
        .eq('embed_id', embed_id)
        .eq('status', 'deployed')
        .single();
      if (!data) return res.status(404).json({ error: 'Chatbot not found' });
      ragAppId = data.id;
    } else {
      return res.status(400).json({ error: 'chatbot_id or embed_id required' });
    }

    const { session, isNew } = await getOrCreateSession(ragAppId, session_token || null);

    res.json({
      session_token: session.session_token,
      session_id:    session.id,
      is_new:        isNew,
      expires_at:    session.expires_at,
    });
  } catch (err) {
    console.error('[analytics/session]', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
