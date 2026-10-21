/**
 * server/src/analyticsService.js
 *
 * Phase 10C: Analytics and session memory service.
 *
 * Responsibilities:
 *   - Create / resume visitor sessions (scoped per chatbot)
 *   - Load recent messages + rolling memory summary for context
 *   - Update rolling memory summary (summarize old messages)
 *   - Record interaction events (privacy-conscious, no raw text by default)
 *   - Aggregate topic counts
 *   - Return analytics summaries for the owner dashboard
 *
 * PRIVACY DEFAULTS:
 *   - raw_question is NOT stored unless diagnostic_logging = true
 *   - No persistent visitor identity (visitor_fingerprint is NULL unless enabled)
 *   - Session tokens are opaque UUIDs; not treated as auth credentials
 *
 * ERROR HANDLING:
 *   - Analytics failures are non-fatal — they must NEVER break the RAG response
 *   - All public functions catch their own errors and log them
 *   - Memory failures fall back to empty context (safe degradation)
 */

import { v4 as uuidv4 } from 'uuid';
import supabase from './supabase.js';
import { invokeLLM } from './openai.js';

// ─── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_SESSION_EXPIRY_DAYS   = 30;
const DEFAULT_RETENTION_DAYS        = 90;
const DEFAULT_MEMORY_TOKEN_THRESHOLD = 2000; // rough token budget before summarization
const DEFAULT_RECENT_MESSAGES       = 6;     // messages kept verbatim after summarization
const CHARS_PER_TOKEN_ESTIMATE      = 4;     // rough estimate for token counting

// ─── Session Management ────────────────────────────────────────────────────────

/**
 * Create a new visitor session for a chatbot.
 * Returns the session object including session_token (returned to client).
 *
 * @param {string} ragAppId
 * @param {{ expiryDays?: number }} options
 * @returns {Promise<object>} session row
 */
export async function createVisitorSession(ragAppId, { expiryDays = DEFAULT_SESSION_EXPIRY_DAYS } = {}) {
  const sessionToken = uuidv4();
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('visitor_sessions')
    .insert({
      id:             uuidv4(),
      rag_app_id:     ragAppId,
      session_token:  sessionToken,
      expires_at:     expiresAt,
      session_status: 'active',
    })
    .select()
    .single();

  if (error) throw new Error(`[analyticsService] Failed to create session: ${error.message}`);
  return data;
}

/**
 * Resume a visitor session by session_token.
 * Validates that the session belongs to the correct chatbot.
 * Returns null if the token is invalid, expired, or belongs to a different chatbot.
 *
 * @param {string} sessionToken
 * @param {string} ragAppId
 * @returns {Promise<object|null>}
 */
export async function resumeVisitorSession(sessionToken, ragAppId) {
  if (!sessionToken) return null;

  const { data, error } = await supabase
    .from('visitor_sessions')
    .select('*')
    .eq('session_token', sessionToken)
    .eq('rag_app_id', ragAppId)
    .eq('session_status', 'active')
    .single();

  if (error || !data) return null;

  // Check expiry
  if (new Date(data.expires_at) < new Date()) {
    // Mark expired
    await supabase
      .from('visitor_sessions')
      .update({ session_status: 'expired' })
      .eq('id', data.id);
    return null;
  }

  // Touch last_activity_at (fire-and-forget)
  supabase
    .from('visitor_sessions')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(() => {})
    .catch(() => {});

  return data;
}

/**
 * Get or create a visitor session.
 * If session_token is provided and valid, resumes that session.
 * Otherwise creates a new session.
 *
 * @param {string} ragAppId
 * @param {string|null} sessionToken — client-supplied token (may be null/undefined)
 * @returns {Promise<{ session: object, isNew: boolean }>}
 */
export async function getOrCreateSession(ragAppId, sessionToken) {
  if (sessionToken) {
    const existing = await resumeVisitorSession(sessionToken, ragAppId);
    if (existing) return { session: existing, isNew: false };
  }
  const session = await createVisitorSession(ragAppId);
  return { session, isNew: true };
}

// ─── Session Memory ────────────────────────────────────────────────────────────

/**
 * Load conversation context for a session.
 * Returns:
 *   - summary: the rolling memory summary (or null)
 *   - recentMessages: the N most recent messages (already in the DB)
 *
 * Context reconstruction:
 *   [summary of older conversation]
 *   [recent messages verbatim]
 *
 * @param {string} sessionId — visitor_sessions.id (UUID, not token)
 * @param {number} recentCount
 * @returns {Promise<{ summary: string|null, recentMessages: Array }>}
 */
export async function loadSessionContext(sessionId, recentCount = DEFAULT_RECENT_MESSAGES) {
  try {
    // 1. Load session (for memory_summary)
    const { data: session, error: sessErr } = await supabase
      .from('visitor_sessions')
      .select('memory_summary, memory_version, summarized_through_message_id')
      .eq('id', sessionId)
      .single();

    if (sessErr || !session) return { summary: null, recentMessages: [] };

    // 2. Load recent messages from the messages table (scoped by session_id from messages)
    // We use the existing messages table's session_id field.
    // The visitor_sessions.session_token corresponds to messages.session_id.
    // We need to join on the token, which means we must load the token first.
    const { data: sessionFull } = await supabase
      .from('visitor_sessions')
      .select('session_token')
      .eq('id', sessionId)
      .single();

    if (!sessionFull?.session_token) return { summary: session.memory_summary, recentMessages: [] };

    const { data: messages, error: msgErr } = await supabase
      .from('messages')
      .select('id, role, content, created_at')
      .eq('session_id', sessionFull.session_token)
      .order('created_at', { ascending: false })
      .limit(recentCount * 2); // get pairs

    if (msgErr || !messages) return { summary: session.memory_summary, recentMessages: [] };

    // Reverse to chronological order
    const recentMessages = (messages || []).reverse();

    return {
      summary: session.memory_summary || null,
      recentMessages,
    };
  } catch (err) {
    console.warn('[analyticsService] loadSessionContext error (non-fatal):', err.message);
    return { summary: null, recentMessages: [] };
  }
}

/**
 * Build the conversation history string to inject into the RAG prompt.
 * Combines summary + recent messages into a compact context block.
 *
 * @param {{ summary: string|null, recentMessages: Array }} context
 * @returns {string} — empty string if no prior context
 */
export function buildConversationContext({ summary, recentMessages }) {
  const parts = [];

  if (summary) {
    parts.push(`[Earlier conversation summary]\n${summary}`);
  }

  if (recentMessages.length > 0) {
    const recentText = recentMessages
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');
    if (summary) {
      parts.push(`[Recent messages]\n${recentText}`);
    } else {
      parts.push(recentText);
    }
  }

  return parts.join('\n\n');
}

/**
 * Check if the session needs summarization and trigger it asynchronously.
 * Called fire-and-forget after each message — does not block the response.
 *
 * @param {string} sessionId — visitor_sessions.id
 * @param {string} sessionToken — for messages lookup
 * @param {number} tokenThreshold
 * @param {number} recentCount
 */
export function maybeSummarizeAsync(sessionId, sessionToken, tokenThreshold = DEFAULT_MEMORY_TOKEN_THRESHOLD, recentCount = DEFAULT_RECENT_MESSAGES) {
  // Fire and forget — analytics failure must never break the RAG response
  _summarizeIfNeeded(sessionId, sessionToken, tokenThreshold, recentCount)
    .catch(err => console.warn('[analyticsService] summarization error (non-fatal):', err.message));
}

async function _summarizeIfNeeded(sessionId, sessionToken, tokenThreshold, recentCount) {
  // Load all messages for this session
  const { data: messages, error } = await supabase
    .from('messages')
    .select('id, role, content, created_at')
    .eq('session_id', sessionToken)
    .order('created_at', { ascending: true });

  if (error || !messages || messages.length <= recentCount * 2) {
    return; // Not enough messages to summarize
  }

  // Estimate total tokens
  const totalChars = messages.reduce((s, m) => s + m.content.length, 0);
  const estimatedTokens = Math.ceil(totalChars / CHARS_PER_TOKEN_ESTIMATE);

  if (estimatedTokens <= tokenThreshold) {
    return; // Under threshold — no summarization needed
  }

  // Load current session state
  const { data: session } = await supabase
    .from('visitor_sessions')
    .select('memory_summary, memory_version, summarized_through_message_id')
    .eq('id', sessionId)
    .single();

  if (!session) return;

  // Find the messages to summarize (everything except the last recentCount * 2 messages)
  const messagesToSummarize = messages.slice(0, messages.length - recentCount * 2);
  const lastMessageToSummarize = messagesToSummarize[messagesToSummarize.length - 1];

  if (!lastMessageToSummarize) return;

  // Don't re-summarize if we already summarized up to this message
  if (session.summarized_through_message_id === lastMessageToSummarize.id) {
    return;
  }

  // Build the text to summarize
  const prevSummary = session.memory_summary
    ? `Previous summary:\n${session.memory_summary}\n\n`
    : '';

  const conversationText = messagesToSummarize
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  const summarizePrompt = `${prevSummary}Conversation to summarize:
${conversationText}

Write a concise summary of this conversation that preserves:
- The main topics discussed
- Any unresolved questions
- Key facts established
- The user's current task or goal

Do not include personal information. Keep the summary under 200 words.
Summary:`;

  let newSummary;
  try {
    newSummary = await invokeLLM(summarizePrompt, null, 0.3);
  } catch (llmErr) {
    console.warn('[analyticsService] summarization LLM failed (non-fatal):', llmErr.message);
    return; // Fail safe: keep existing summary, don't corrupt state
  }

  if (!newSummary || newSummary.trim().length === 0) return;

  // Atomic update — increment version to detect concurrent updates
  const { error: updateErr } = await supabase
    .from('visitor_sessions')
    .update({
      memory_summary:                 newSummary.trim(),
      memory_version:                 (session.memory_version || 0) + 1,
      memory_token_count:             Math.ceil(newSummary.length / CHARS_PER_TOKEN_ESTIMATE),
      summarized_through_message_id:  lastMessageToSummarize.id,
    })
    .eq('id', sessionId)
    .eq('memory_version', session.memory_version); // optimistic concurrency check

  if (updateErr) {
    console.warn('[analyticsService] summary update failed (non-fatal):', updateErr.message);
  } else {
    console.log(`[analyticsService] Session ${sessionId.slice(0,8)} summarized v${(session.memory_version||0)+1} (${messagesToSummarize.length} msgs → ${Math.ceil(newSummary.length/CHARS_PER_TOKEN_ESTIMATE)} tokens)`);
  }
}

// ─── Interaction Events ────────────────────────────────────────────────────────

/**
 * Record an interaction event (fire-and-forget).
 * Analytics failures must never block the RAG response.
 *
 * @param {{
 *   ragAppId: string,
 *   sessionId: string,          — visitor_sessions.id
 *   eventType: string,
 *   retrievalStatus: string,
 *   retrievalChunkCount: number,
 *   avgSimilarityScore: number|null,
 *   responseStatus: string,
 *   abstained: boolean,
 *   latencyMs: number|null,
 *   inputTokens: number|null,
 *   outputTokens: number|null,
 *   architectVersion: number|null,
 *   rawQuestion: string|null,    — only populated when diagnostic_logging = true
 *   idempotencyKey: string|null,
 * }} event
 */
export function recordInteractionAsync(event) {
  _recordInteraction(event)
    .catch(err => console.warn('[analyticsService] recordInteraction error (non-fatal):', err.message));
}

async function _recordInteraction(event) {
  const { error } = await supabase
    .from('interaction_events')
    .insert({
      id:                    uuidv4(),
      rag_app_id:            event.ragAppId,
      session_id:            event.sessionId,
      event_type:            event.eventType || 'question_answered',
      retrieval_status:      event.retrievalStatus || 'ok',
      retrieval_chunk_count: event.retrievalChunkCount || 0,
      avg_similarity_score:  event.avgSimilarityScore ?? null,
      response_status:       event.responseStatus || 'answered',
      abstained:             event.abstained || false,
      latency_ms:            event.latencyMs ?? null,
      input_tokens:          event.inputTokens ?? null,
      output_tokens:         event.outputTokens ?? null,
      architect_version:     event.architectVersion ?? null,
      raw_question:          event.rawQuestion ?? null,
      idempotency_key:       event.idempotencyKey ?? null,
    });

  if (error) {
    // Swallow duplicate key errors (idempotency) silently
    if (error.code === '23505') return; // unique_violation
    throw new Error(`[analyticsService] insert interaction_event: ${error.message}`);
  }
}

/**
 * Record user feedback for an interaction (fire-and-forget).
 *
 * @param {{
 *   ragAppId: string,
 *   sessionId: string,
 *   interactionEventId: string,
 *   feedbackValue: boolean,  — true = helpful, false = unhelpful
 * }} feedback
 */
export function recordFeedbackAsync(feedback) {
  _recordFeedback(feedback)
    .catch(err => console.warn('[analyticsService] recordFeedback error (non-fatal):', err.message));
}

async function _recordFeedback({ ragAppId, sessionId, interactionEventId, feedbackValue }) {
  const { error } = await supabase
    .from('feedback_events')
    .insert({
      id:                    uuidv4(),
      rag_app_id:            ragAppId,
      session_id:            sessionId,
      interaction_event_id:  interactionEventId,
      feedback_value:        feedbackValue,
    })
    .on('conflict', 'interaction_event_id', 'do nothing'); // one feedback per interaction

  if (error && error.code !== '23505') {
    throw new Error(`[analyticsService] insert feedback: ${error.message}`);
  }
}

// ─── Topic Classification ──────────────────────────────────────────────────────

/**
 * Classify a question into a topic category.
 * Runs asynchronously — does not block the RAG response.
 * Updates the interaction_event row with the classified topic.
 *
 * Uses a lightweight prompt — avoids full LLM cost for every message.
 *
 * @param {string} interactionEventId
 * @param {string} question
 * @param {string} chatbotDescription — helps ground the classifier
 */
export function classifyTopicAsync(interactionEventId, question, chatbotDescription = '') {
  _classifyTopic(interactionEventId, question, chatbotDescription)
    .catch(err => console.warn('[analyticsService] classifyTopic error (non-fatal):', err.message));
}

async function _classifyTopic(interactionEventId, question, chatbotDescription) {
  // Ultra-compact LLM classification — minimizes token usage (~60 input + ~20 output)
  const ctx = chatbotDescription ? ` Context: ${chatbotDescription.slice(0, 80)}.` : '';
  const prompt = `Classify this question into a topic.${ctx}
Q: "${question.slice(0, 150)}"
Return ONLY JSON: {"category":"slug_30chars","label":"Human Label 40chars","confidence":0.9}
Use category "general" if unclear.`;

  let classification;
  try {
    const { invokeLLMJson } = await import('./openai.js');
    classification = await invokeLLMJson(prompt);
  } catch (err) {
    console.warn('[analyticsService] topic classification failed (non-fatal):', err.message?.slice(0, 80));
    return;
  }

  if (!classification?.category) return;

  await supabase
    .from('interaction_events')
    .update({
      topic_category:   classification.category.toLowerCase().replace(/\s+/g, '_').slice(0, 60),
      topic_label:      (classification.label || classification.category).slice(0, 80),
      topic_confidence: classification.confidence ?? null,
    })
    .eq('id', interactionEventId);
}

// ─── Analytics Queries ─────────────────────────────────────────────────────────

/**
 * Get analytics summary for a chatbot over a date range.
 * Only callable by the chatbot owner — ragAppId + userId must match.
 *
 * @param {string} ragAppId
 * @param {string} userId   — verified chatbot owner
 * @param {{ from: Date, to: Date }} range
 * @returns {Promise<object>}
 */
export async function getAnalyticsSummary(ragAppId, userId, { from, to }) {
  // Verify ownership
  const { data: app } = await supabase
    .from('rag_apps')
    .select('id, title')
    .eq('id', ragAppId)
    .eq('user_id', userId)
    .single();

  if (!app) throw Object.assign(new Error('Chatbot not found'), { status: 404 });

  const fromIso = from.toISOString();
  const toIso   = to.toISOString();

  // Use SQL function for summary
  const { data: summary, error: sumErr } = await supabase
    .rpc('get_analytics_summary', {
      p_rag_app_id: ragAppId,
      p_from:       fromIso,
      p_to:         toIso,
    });

  if (sumErr) {
    console.error('[analyticsService] get_analytics_summary RPC error:', sumErr.message);
    // Fall back to manual query
    return await _getAnalyticsSummaryFallback(ragAppId, fromIso, toIso);
  }

  return summary?.[0] ?? _emptyAnalyticsSummary();
}

async function _getAnalyticsSummaryFallback(ragAppId, fromIso, toIso) {
  const { data: events } = await supabase
    .from('interaction_events')
    .select('response_status, abstained, retrieval_status, latency_ms, avg_similarity_score, session_id')
    .eq('rag_app_id', ragAppId)
    .eq('event_type', 'question_answered')
    .gte('created_at', fromIso)
    .lte('created_at', toIso);

  const { data: feedback } = await supabase
    .from('feedback_events')
    .select('feedback_value')
    .eq('rag_app_id', ragAppId)
    .gte('created_at', fromIso)
    .lte('created_at', toIso);

  const evts = events || [];
  const fbk  = feedback || [];

  const sessions = new Set(evts.map(e => e.session_id));
  const latencies = evts.map(e => e.latency_ms).filter(Boolean);
  const similarities = evts.map(e => e.avg_similarity_score).filter(v => v != null);

  return {
    total_questions:      evts.length,
    answered_count:       evts.filter(e => e.response_status === 'answered').length,
    abstained_count:      evts.filter(e => e.abstained).length,
    failed_count:         evts.filter(e => e.response_status === 'failed').length,
    retrieval_ok_count:   evts.filter(e => e.retrieval_status === 'ok').length,
    retrieval_fail_count: evts.filter(e => ['no_results','error','low_confidence'].includes(e.retrieval_status)).length,
    avg_latency_ms:       latencies.length ? Math.round(latencies.reduce((s,v) => s+v, 0) / latencies.length) : null,
    total_sessions:       sessions.size,
    helpful_count:        fbk.filter(f => f.feedback_value === true).length,
    unhelpful_count:      fbk.filter(f => f.feedback_value === false).length,
    avg_similarity:       similarities.length ? +(similarities.reduce((s,v) => s+v, 0) / similarities.length).toFixed(4) : null,
  };
}

function _emptyAnalyticsSummary() {
  return {
    total_questions: 0, answered_count: 0, abstained_count: 0,
    failed_count: 0, retrieval_ok_count: 0, retrieval_fail_count: 0,
    avg_latency_ms: null, total_sessions: 0,
    helpful_count: 0, unhelpful_count: 0, avg_similarity: null,
  };
}

/**
 * Get top topics for a chatbot over a date range.
 *
 * @param {string} ragAppId
 * @param {string} userId
 * @param {{ from: Date, to: Date, limit?: number }} options
 */
export async function getTopTopics(ragAppId, userId, { from, to, limit = 10 }) {
  // Verify ownership
  const { data: app } = await supabase
    .from('rag_apps')
    .select('id')
    .eq('id', ragAppId)
    .eq('user_id', userId)
    .single();

  if (!app) throw Object.assign(new Error('Chatbot not found'), { status: 404 });

  const { data: events, error } = await supabase
    .from('interaction_events')
    .select('topic_category, topic_label, response_status, abstained, retrieval_status')
    .eq('rag_app_id', ragAppId)
    .eq('event_type', 'question_answered')
    .gte('created_at', from.toISOString())
    .lte('created_at', to.toISOString())
    .not('topic_category', 'is', null);

  if (error) {
    console.error('[analyticsService] getTopTopics error:', error.message);
    return [];
  }

  // Aggregate by topic_category
  const topicMap = {};
  for (const evt of (events || [])) {
    const key = evt.topic_category;
    if (!key) continue;
    if (!topicMap[key]) {
      topicMap[key] = {
        category:      key,
        label:         evt.topic_label || key,
        count:         0,
        answered:      0,
        abstained:     0,
        retrieval_fail: 0,
      };
    }
    topicMap[key].count++;
    if (evt.response_status === 'answered') topicMap[key].answered++;
    if (evt.abstained) topicMap[key].abstained++;
    if (['no_results','error','low_confidence'].includes(evt.retrieval_status)) {
      topicMap[key].retrieval_fail++;
    }
  }

  const total = (events || []).length;

  return Object.values(topicMap)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map(t => ({
      ...t,
      percentage: total > 0 ? +(t.count / total * 100).toFixed(1) : 0,
    }));
}

/**
 * Get daily question counts for trend chart.
 *
 * @param {string} ragAppId
 * @param {string} userId
 * @param {{ from: Date, to: Date }} range
 * @returns {Promise<Array<{ date: string, count: number, answered: number, failed: number }>>}
 */
export async function getDailyTrend(ragAppId, userId, { from, to }) {
  const { data: app } = await supabase
    .from('rag_apps')
    .select('id')
    .eq('id', ragAppId)
    .eq('user_id', userId)
    .single();

  if (!app) throw Object.assign(new Error('Chatbot not found'), { status: 404 });

  const { data: events, error } = await supabase
    .from('interaction_events')
    .select('created_at, response_status, abstained')
    .eq('rag_app_id', ragAppId)
    .eq('event_type', 'question_answered')
    .gte('created_at', from.toISOString())
    .lte('created_at', to.toISOString())
    .order('created_at', { ascending: true });

  if (error) return [];

  // Bucket by UTC date
  const buckets = {};
  for (const evt of (events || [])) {
    const date = evt.created_at.slice(0, 10); // YYYY-MM-DD
    if (!buckets[date]) buckets[date] = { date, count: 0, answered: 0, failed: 0, abstained: 0 };
    buckets[date].count++;
    if (evt.response_status === 'answered') buckets[date].answered++;
    if (evt.response_status === 'failed')   buckets[date].failed++;
    if (evt.abstained)                      buckets[date].abstained++;
  }

  return Object.values(buckets).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Get analytics settings for a chatbot (or defaults if not configured).
 *
 * @param {string} ragAppId
 * @returns {Promise<object>}
 */
export async function getAnalyticsSettings(ragAppId) {
  const { data } = await supabase
    .from('analytics_settings')
    .select('*')
    .eq('rag_app_id', ragAppId)
    .single();

  return data ?? {
    rag_app_id:              ragAppId,
    diagnostic_logging:      false,
    session_expiry_days:     DEFAULT_SESSION_EXPIRY_DAYS,
    data_retention_days:     DEFAULT_RETENTION_DAYS,
    memory_enabled:          true,
    memory_token_threshold:  DEFAULT_MEMORY_TOKEN_THRESHOLD,
    memory_recent_messages:  DEFAULT_RECENT_MESSAGES,
  };
}

/**
 * Save analytics settings for a chatbot.
 * Only callable by the chatbot owner.
 *
 * @param {string} ragAppId
 * @param {string} userId
 * @param {object} settings
 */
export async function saveAnalyticsSettings(ragAppId, userId, settings) {
  const allowed = [
    'diagnostic_logging', 'session_expiry_days', 'data_retention_days',
    'memory_enabled', 'memory_token_threshold', 'memory_recent_messages',
  ];
  const filtered = {};
  for (const k of allowed) {
    if (settings[k] !== undefined) filtered[k] = settings[k];
  }

  const { data, error } = await supabase
    .from('analytics_settings')
    .upsert({
      rag_app_id:  ragAppId,
      user_id:     userId,
      ...filtered,
      updated_at:  new Date().toISOString(),
    }, { onConflict: 'rag_app_id' })
    .select()
    .single();

  if (error) throw new Error(`[analyticsService] saveAnalyticsSettings: ${error.message}`);
  return data;
}

/**
 * Generate insight text from analytics data using LLM.
 * Returns safe, privacy-conscious recommendations.
 * Falls back to empty array on any LLM failure.
 *
 * @param {{ summary: object, topTopics: Array, chatbotTitle: string }} data
 * @returns {Promise<string[]>}
 */
export async function generateInsights({ summary, topTopics, chatbotTitle }) {
  if (!summary || summary.total_questions < 5) {
    return ['Not enough data yet to generate insights. Keep chatting!'];
  }

  const abstentionRate = summary.total_questions > 0
    ? ((summary.abstained_count / summary.total_questions) * 100).toFixed(0)
    : 0;
  const retrievalFailRate = summary.total_questions > 0
    ? ((summary.retrieval_fail_count / summary.total_questions) * 100).toFixed(0)
    : 0;
  const helpfulRate = (summary.helpful_count + summary.unhelpful_count) > 0
    ? ((summary.helpful_count / (summary.helpful_count + summary.unhelpful_count)) * 100).toFixed(0)
    : null;

  const topTopicLines = topTopics.slice(0, 5)
    .map(t => `- ${t.label}: ${t.count} questions (${t.percentage}%)${t.abstained > 0 ? ` — ${t.abstained} unanswered` : ''}`)
    .join('\n');

  const prompt = `You are analyzing chatbot usage analytics for "${chatbotTitle}".

Statistics (last period):
- Total questions: ${summary.total_questions}
- Answered: ${summary.answered_count}
- Abstained (no answer): ${summary.abstained_count} (${abstentionRate}%)
- Retrieval failures: ${summary.retrieval_fail_count} (${retrievalFailRate}%)
${helpfulRate !== null ? `- User satisfaction: ${helpfulRate}% helpful\n` : ''}\
- Active sessions: ${summary.total_sessions}

Top topics:
${topTopicLines || 'No topics classified yet.'}

Generate 3–5 short, actionable, privacy-conscious insights for the chatbot owner.
Requirements:
- Each insight is 1–2 sentences
- Do NOT reproduce any user questions verbatim
- Focus on patterns, gaps, and improvements
- Be specific to the data, not generic
- If abstention rate > 20%, suggest knowledge base improvements
- If retrieval failures are high, suggest adding more documents
- Highlight the most frequently discussed topic
- Note any topics with high unanswered rate

Return a JSON array of strings: ["insight 1", "insight 2", ...]`;

  try {
    const { invokeLLMJson } = await import('./openai.js');
    const result = await invokeLLMJson(prompt);
    if (Array.isArray(result)) return result.slice(0, 5);
    if (Array.isArray(result?.insights)) return result.insights.slice(0, 5);
    return [];
  } catch (err) {
    console.warn('[analyticsService] generateInsights LLM error (non-fatal):', err.message);
    // Return data-driven insights without LLM
    const insights = [];
    if (summary.total_questions > 0) {
      if (topTopics.length > 0) {
        insights.push(`"${topTopics[0].label}" is the most discussed topic with ${topTopics[0].count} questions (${topTopics[0].percentage}% of all questions).`);
      }
      if (Number(abstentionRate) > 20) {
        insights.push(`${abstentionRate}% of questions could not be answered. Consider adding more documents to your knowledge base.`);
      }
      if (Number(retrievalFailRate) > 15) {
        insights.push(`${retrievalFailRate}% of retrievals found no relevant content. Expanding your knowledge base may help.`);
      }
      if (helpfulRate !== null && Number(helpfulRate) < 70) {
        insights.push(`User satisfaction is ${helpfulRate}%. Review the most common topics for improvement opportunities.`);
      }
    }
    return insights.length > 0 ? insights : ['Keep growing your knowledge base to improve answer coverage.'];
  }
}

/**
 * Enforce data retention: delete interaction_events older than retention period.
 * Called periodically (e.g., daily). Non-fatal.
 *
 * @param {string} ragAppId
 * @param {number} retentionDays
 */
export async function enforceRetention(ragAppId, retentionDays = DEFAULT_RETENTION_DAYS) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from('interaction_events')
    .delete()
    .eq('rag_app_id', ragAppId)
    .lt('created_at', cutoff);

  if (error) {
    console.warn('[analyticsService] enforceRetention error (non-fatal):', error.message);
  }
}
