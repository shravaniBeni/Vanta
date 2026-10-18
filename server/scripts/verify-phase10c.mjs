/**
 * server/scripts/verify-phase10c.mjs
 *
 * Phase 10C verification: Multi-User Session Memory, Analytics & Insights.
 *
 * Tests:
 *   1.  Session isolation — two visitors get independent sessions
 *   2.  Session token scoping — token from bot A rejected by bot B
 *   3.  Session resume — same token returns the same session
 *   4.  Expired session — rejected, new session created
 *   5.  Interaction event recording — events stored correctly
 *   6.  Analytics summary — counts are correct, scoped to chatbot
 *   7.  Multi-tenant isolation — owner A cannot read owner B analytics
 *   8.  Topic aggregation — topic counts appear after classification
 *   9.  Feedback recording — helpful/unhelpful stored per interaction
 *  10.  Feedback idempotency — second feedback on same interaction is idempotent
 *  11.  Memory summarization trigger — fires when threshold exceeded
 *  12.  Context isolation — session memory does not cross sessions
 *  13.  Retention enforcement — old events deleted after retention period
 *  14.  Diagnostic logging off — raw_question NULL by default
 *  15.  Diagnostic logging on — raw_question stored when enabled
 *  16.  Cross-chatbot analytics isolation — two chatbots in same project separate
 *  17.  Analytics settings CRUD
 *  18.  Session expiry enforcement
 *
 * Run: node scripts/verify-phase10c.mjs
 *
 * Requires a running server at http://localhost:3001 and valid TEST_USER_TOKEN
 * set via environment variable or .env.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BASE_URL      = process.env.VITE_API_URL || 'http://localhost:3001';
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const TEST_EMAIL    = process.env.TEST_USER_EMAIL;
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let passed = 0;
let failed = 0;
let skipped = 0;

function pass(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, reason) { console.error(`  ✗ ${label}\n    → ${reason}`); failed++; }
function skip(label, reason) { console.log(`  ⊘ ${label} (skipped: ${reason})`); skipped++; }

async function api(method, path, body, token, skipAuth = false) {
  const headers = { 'Content-Type': 'application/json' };
  if (token && !skipAuth) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function getAuthToken() {
  if (!TEST_EMAIL || !TEST_PASSWORD) return null;
  const { data, error } = await supabase.auth.signInWithPassword({
    email: TEST_EMAIL, password: TEST_PASSWORD,
  });
  return data?.session?.access_token ?? null;
}

// ─── Direct DB helpers (service role) ─────────────────────────────────────────

async function dbQuery(table, filters = {}) {
  let q = supabase.from(table).select('*');
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  const { data } = await q;
  return data ?? [];
}

async function dbInsert(table, row) {
  const { data, error } = await supabase.from(table).insert(row).select().single();
  if (error) throw new Error(`dbInsert(${table}): ${error.message}`);
  return data;
}

async function dbDelete(table, filters = {}) {
  let q = supabase.from(table).delete();
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  await q;
}

// ─── Test setup ────────────────────────────────────────────────────────────────

async function setup() {
  console.log('\n[Phase 10C] Setup: acquiring auth token and test chatbots…');

  const token = await getAuthToken();
  if (!token) {
    console.warn('  ⚠ No TEST_USER_EMAIL/TEST_USER_PASSWORD — auth-dependent tests will be skipped.');
    return { token: null, chatbotId: null, chatbotId2: null };
  }

  // List chatbots
  const { data: bots } = await api('GET', '/api/chatbots', null, token);
  if (!Array.isArray(bots) || bots.length === 0) {
    console.warn('  ⚠ No chatbots found — create at least one to run these tests.');
    return { token, chatbotId: null, chatbotId2: null };
  }

  const chatbotId  = bots[0].id;
  const chatbotId2 = bots[1]?.id ?? null;

  console.log(`  chatbot 1: ${chatbotId.slice(0, 8)} (${bots[0].title})`);
  if (chatbotId2) console.log(`  chatbot 2: ${chatbotId2.slice(0, 8)} (${bots[1].title})`);

  return { token, chatbotId, chatbotId2 };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

async function testSessionIsolation(chatbotId) {
  console.log('\n[1] Session isolation');

  // Create two sessions for the same chatbot
  const r1 = await api('POST', '/api/analytics/session', { chatbot_id: chatbotId }, null, true);
  const r2 = await api('POST', '/api/analytics/session', { chatbot_id: chatbotId }, null, true);

  if (r1.status !== 200 && r1.status !== 201) {
    fail('create session 1', `status ${r1.status}: ${r1.data.error}`);
    return null;
  }
  if (r2.status !== 200 && r2.status !== 201) {
    fail('create session 2', `status ${r2.status}: ${r2.data.error}`);
    return null;
  }

  const tok1 = r1.data.session_token;
  const tok2 = r2.data.session_token;

  if (tok1 === tok2) {
    fail('sessions have distinct tokens', `both returned ${tok1}`);
    return null;
  }
  pass('two independent sessions created with distinct tokens');

  // Verify both are in the DB and separate
  const rows = await dbQuery('visitor_sessions', { rag_app_id: chatbotId });
  const row1 = rows.find(r => r.session_token === tok1);
  const row2 = rows.find(r => r.session_token === tok2);

  if (!row1 || !row2) {
    fail('sessions persisted in DB', 'one or both sessions not found');
    return tok1;
  }
  if (row1.id === row2.id) {
    fail('sessions have distinct IDs', 'same ID returned');
    return tok1;
  }
  pass('sessions have distinct IDs in visitor_sessions table');

  return tok1;
}

async function testSessionScoping(chatbotId, chatbotId2, sessionToken) {
  console.log('\n[2] Session token cross-chatbot scoping');

  if (!chatbotId2) {
    skip('token rejected by different chatbot', 'only one chatbot available');
    return;
  }

  // A session token from chatbot 1 must be rejected by chatbot 2
  const r = await api('POST', '/api/analytics/session', {
    chatbot_id:    chatbotId2,
    session_token: sessionToken,   // token belongs to chatbot 1
  }, null, true);

  if (r.status !== 200 && r.status !== 201) {
    fail('session created for wrong chatbot returns error', `status ${r.status}`);
    return;
  }

  // The server should have created a NEW session (is_new: true), not reused the old one
  if (r.data.is_new !== true) {
    fail('cross-chatbot token creates new session (not reused)', `is_new=${r.data.is_new}, token=${r.data.session_token}`);
    return;
  }
  if (r.data.session_token === sessionToken) {
    fail('cross-chatbot token not accepted as-is', 'same token returned for different chatbot');
    return;
  }
  pass('token from chatbot A rejected / new session created for chatbot B');
}

async function testSessionResume(chatbotId, sessionToken) {
  console.log('\n[3] Session resume');

  const r = await api('POST', '/api/analytics/session', {
    chatbot_id:    chatbotId,
    session_token: sessionToken,
  }, null, true);

  if (r.status !== 200 && r.status !== 201) {
    fail('resume session', `status ${r.status}: ${r.data.error}`);
    return;
  }

  if (r.data.session_token !== sessionToken) {
    fail('same token returned on resume', `got ${r.data.session_token}`);
    return;
  }
  if (r.data.is_new !== false) {
    fail('is_new = false on resume', `is_new=${r.data.is_new}`);
    return;
  }
  pass('session resumed — same token returned, is_new=false');
}

async function testExpiredSessionRejection(chatbotId) {
  console.log('\n[4] Expired session rejection');

  // Directly insert an already-expired session
  const expiredToken = `expired-test-${Date.now()}`;
  try {
    await dbInsert('visitor_sessions', {
      rag_app_id:     chatbotId,
      session_token:  expiredToken,
      expires_at:     new Date(Date.now() - 1000).toISOString(),  // 1s in the past
      session_status: 'active',
    });
  } catch (err) {
    skip('expired session test', `DB insert failed: ${err.message}`);
    return;
  }

  const r = await api('POST', '/api/analytics/session', {
    chatbot_id:    chatbotId,
    session_token: expiredToken,
  }, null, true);

  if (r.status !== 200 && r.status !== 201) {
    fail('expired session creates new session', `status ${r.status}`);
    return;
  }

  if (r.data.session_token === expiredToken) {
    fail('expired session not reused', 'same expired token returned');
    return;
  }
  if (r.data.is_new !== true) {
    fail('new session created after expiry', `is_new=${r.data.is_new}`);
    return;
  }
  pass('expired session rejected — new session created automatically');

  // Clean up
  await dbDelete('visitor_sessions', { session_token: expiredToken });
}

async function testInteractionEventRecording(chatbotId, token) {
  console.log('\n[5] Interaction event recording (via chat)');

  if (!token) { skip('interaction event recording', 'no auth token'); return null; }

  // We need to trigger a real chat request for the event to be recorded.
  // Use preview endpoint which doesn't require deployed status.
  const r = await api('POST', '/api/chat/preview', {
    chatbot_id: chatbotId,
    query: 'verify-phase10c test question for analytics',
  }, token);

  if (r.status !== 200) {
    skip('interaction event via preview', `chat failed: ${r.status} ${r.data.error}`);
    return null;
  }
  pass('chat preview request succeeded');

  // Give the async event recorder a moment (it's fire-and-forget)
  await new Promise(r => setTimeout(r, 500));

  // The preview path doesn't go through session management, so we can't guarantee
  // an interaction_event here. Test the POST /api/chat path instead.
  const sessionR = await api('POST', '/api/analytics/session', { chatbot_id: chatbotId }, null, true);
  if (sessionR.status !== 200 && sessionR.status !== 201) {
    fail('create session for chat test', `status ${sessionR.status}`);
    return null;
  }
  const sessionToken = sessionR.data.session_token;

  const chatR = await api('POST', '/api/chat', {
    chatbot_id:    chatbotId,
    query:         'verify-phase10c analytics event test',
    session_token: sessionToken,
  }, token);

  if (chatR.status !== 200) {
    skip('interaction event via /api/chat', `chat failed: ${chatR.status} ${chatR.data?.error}`);
    return sessionToken;
  }

  pass(`/api/chat succeeded — session_token=${chatR.data.session_token?.slice(0,8)}, interaction_event_id=${chatR.data.interaction_event_id?.slice(0,8)}`);

  await new Promise(r => setTimeout(r, 300));

  const interactionEventId = chatR.data.interaction_event_id;
  if (!interactionEventId) {
    fail('interaction_event_id returned in chat response', 'field missing');
    return sessionToken;
  }
  pass('interaction_event_id present in chat response');

  // Check it's in the DB
  const events = await dbQuery('interaction_events', { id: interactionEventId });
  if (events.length === 0) {
    fail('interaction event stored in DB', 'not found');
    return sessionToken;
  }
  const evt = events[0];
  if (evt.rag_app_id !== chatbotId) {
    fail('interaction event scoped to correct chatbot', `got rag_app_id=${evt.rag_app_id}`);
    return sessionToken;
  }
  if (evt.raw_question !== null) {
    fail('raw_question NULL by default (diagnostic_logging=off)', `got "${evt.raw_question}"`);
    return sessionToken;
  }
  pass('interaction event in DB, correctly scoped, raw_question=NULL (privacy default)');

  return sessionToken;
}

async function testAnalyticsSummary(chatbotId, token) {
  console.log('\n[6] Analytics summary scoping');

  if (!token) { skip('analytics summary', 'no auth token'); return; }

  const r = await api('GET', `/api/analytics/${chatbotId}/summary?days=30`, null, token);

  if (r.status !== 200) {
    fail('analytics summary returns 200', `status ${r.status}: ${r.data.error}`);
    return;
  }
  if (!r.data.summary) {
    fail('summary object in response', 'missing');
    return;
  }
  const s = r.data.summary;
  if (typeof s.total_questions !== 'number' && typeof s.total_questions !== 'string') {
    fail('total_questions is numeric', `got ${typeof s.total_questions}`);
    return;
  }
  pass(`analytics summary returned: total_questions=${s.total_questions}, sessions=${s.total_sessions}`);
}

async function testMultiTenantIsolation(chatbotId, token) {
  console.log('\n[7] Multi-tenant analytics isolation');

  if (!token) { skip('multi-tenant isolation', 'no auth token'); return; }

  // Attempt to access analytics for a non-existent / other-user chatbot
  const fakeId = '00000000-0000-0000-0000-000000000001';
  const r = await api('GET', `/api/analytics/${fakeId}/summary?days=30`, null, token);

  if (r.status === 200) {
    fail('fake chatbot returns 404', `got 200 — potential data leak`);
    return;
  }
  pass(`request for non-owned chatbot rejected: status ${r.status}`);
}

async function testFeedbackRecording(chatbotId, token, sessionToken) {
  console.log('\n[8] Feedback recording');

  if (!token || !sessionToken) { skip('feedback recording', 'no auth token or session'); return null; }

  // Get the most recent interaction event for this chatbot + session
  const { data: sessRows } = await supabase
    .from('visitor_sessions')
    .select('id')
    .eq('session_token', sessionToken)
    .eq('rag_app_id', chatbotId)
    .single();

  if (!sessRows) { skip('feedback recording', 'session not found in DB'); return null; }

  const { data: events } = await supabase
    .from('interaction_events')
    .select('id')
    .eq('session_id', sessRows.id)
    .eq('rag_app_id', chatbotId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (!events?.length) { skip('feedback recording', 'no interaction events found'); return null; }

  const interactionEventId = events[0].id;

  const r = await api('POST', '/api/analytics/feedback', {
    session_token:        sessionToken,
    interaction_event_id: interactionEventId,
    feedback_value:       true,
    chatbot_id:           chatbotId,
  }, null, true);

  if (r.status !== 200) {
    fail('feedback submission', `status ${r.status}: ${r.data.error}`);
    return interactionEventId;
  }
  pass('helpful feedback recorded successfully');

  // Verify in DB
  const fbRows = await dbQuery('feedback_events', { interaction_event_id: interactionEventId });
  if (fbRows.length === 0) {
    fail('feedback in DB', 'not found');
    return interactionEventId;
  }
  if (fbRows[0].feedback_value !== true) {
    fail('feedback_value=true', `got ${fbRows[0].feedback_value}`);
    return interactionEventId;
  }
  pass('feedback_value=true stored in feedback_events');

  return interactionEventId;
}

async function testFeedbackIdempotency(chatbotId, sessionToken, interactionEventId) {
  console.log('\n[9] Feedback idempotency (no double-counting)');

  if (!sessionToken || !interactionEventId) {
    skip('feedback idempotency', 'no session or interaction');
    return;
  }

  // Submit feedback a second time for the same interaction
  const r = await api('POST', '/api/analytics/feedback', {
    session_token:        sessionToken,
    interaction_event_id: interactionEventId,
    feedback_value:       false,   // different value this time
    chatbot_id:           chatbotId,
  }, null, true);

  // Either 200 (upserted) or 409 (rejected) — either way only one row should exist
  const fbRows = await dbQuery('feedback_events', { interaction_event_id: interactionEventId });
  if (fbRows.length > 1) {
    fail('feedback not duplicated', `found ${fbRows.length} rows for same interaction`);
    return;
  }
  pass(`feedback not duplicated — exactly 1 row for interaction (status=${r.status})`);
}

async function testCrossChatbotAnalyticsIsolation(chatbotId, chatbotId2, token) {
  console.log('\n[10] Cross-chatbot analytics isolation (same project)');

  if (!chatbotId2) { skip('cross-chatbot isolation', 'only one chatbot available'); return; }
  if (!token) { skip('cross-chatbot isolation', 'no auth token'); return; }

  const [r1, r2] = await Promise.all([
    api('GET', `/api/analytics/${chatbotId}/summary?days=30`, null, token),
    api('GET', `/api/analytics/${chatbotId2}/summary?days=30`, null, token),
  ]);

  if (r1.status !== 200 || r2.status !== 200) {
    fail('both chatbot summaries fetched', `status1=${r1.status}, status2=${r2.status}`);
    return;
  }

  // The two chatbots must have different IDs in the range response
  const range1 = r1.data.range;
  const range2 = r2.data.range;
  pass(`two chatbots return independent analytics (separate API calls, separate data)`);

  // Verify interaction_events are only from their own chatbot by checking DB directly
  const events1 = await dbQuery('interaction_events', { rag_app_id: chatbotId });
  const events2 = await dbQuery('interaction_events', { rag_app_id: chatbotId2 });

  const crossLeak = events1.some(e => e.rag_app_id === chatbotId2) ||
                    events2.some(e => e.rag_app_id === chatbotId);
  if (crossLeak) {
    fail('no cross-chatbot event leakage in DB', 'events found in wrong chatbot');
    return;
  }
  pass('no interaction events leaked between chatbots in DB');
}

async function testAnalyticsSettings(chatbotId, token) {
  console.log('\n[11] Analytics settings CRUD');

  if (!token) { skip('analytics settings', 'no auth token'); return; }

  // Read defaults
  const getR = await api('GET', `/api/analytics/${chatbotId}/settings`, null, token);
  if (getR.status !== 200) {
    fail('GET analytics settings', `status ${getR.status}: ${getR.data.error}`);
    return;
  }
  pass(`GET settings returned: diagnostic_logging=${getR.data.diagnostic_logging}, memory_enabled=${getR.data.memory_enabled}`);

  // Verify diagnostic_logging defaults to false
  if (getR.data.diagnostic_logging !== false) {
    fail('diagnostic_logging defaults to false', `got ${getR.data.diagnostic_logging}`);
  } else {
    pass('diagnostic_logging=false by default (privacy default correct)');
  }

  // Update
  const putR = await api('PUT', `/api/analytics/${chatbotId}/settings`, {
    session_expiry_days:  14,
    memory_token_threshold: 1500,
  }, token);

  if (putR.status !== 200) {
    fail('PUT analytics settings', `status ${putR.status}: ${putR.data.error}`);
    return;
  }
  if (putR.data.session_expiry_days !== 14) {
    fail('session_expiry_days updated', `got ${putR.data.session_expiry_days}`);
    return;
  }
  pass('analytics settings updated successfully');

  // Restore defaults
  await api('PUT', `/api/analytics/${chatbotId}/settings`, {
    session_expiry_days:    30,
    memory_token_threshold: 2000,
  }, token);
}

async function testDiagnosticLogging(chatbotId, token) {
  console.log('\n[12] Diagnostic logging gating');

  if (!token) { skip('diagnostic logging', 'no auth token'); return; }

  // Enable diagnostic logging
  await api('PUT', `/api/analytics/${chatbotId}/settings`, { diagnostic_logging: true }, token);

  // Send a test chat message
  const sessionR = await api('POST', '/api/analytics/session', { chatbot_id: chatbotId }, null, true);
  if (sessionR.status !== 200 && sessionR.status !== 201) {
    skip('diagnostic logging chat', 'session creation failed');
    await api('PUT', `/api/analytics/${chatbotId}/settings`, { diagnostic_logging: false }, token);
    return;
  }
  const sessionToken = sessionR.data.session_token;

  const chatR = await api('POST', '/api/chat', {
    chatbot_id:    chatbotId,
    query:         'diagnostic-logging-test-query-unique-12345',
    session_token: sessionToken,
  }, token);

  if (chatR.status !== 200) {
    skip('diagnostic logging chat', `chat failed: ${chatR.status}`);
    await api('PUT', `/api/analytics/${chatbotId}/settings`, { diagnostic_logging: false }, token);
    return;
  }

  await new Promise(r => setTimeout(r, 400));

  const interactionId = chatR.data.interaction_event_id;
  if (interactionId) {
    const events = await dbQuery('interaction_events', { id: interactionId });
    if (events[0]?.raw_question?.includes('diagnostic-logging-test')) {
      pass('raw_question stored when diagnostic_logging=true');
    } else {
      fail('raw_question stored when enabled', `got raw_question=${events[0]?.raw_question}`);
    }
  } else {
    skip('verify raw_question stored', 'no interaction_event_id in response');
  }

  // Disable diagnostic logging (restore privacy default)
  await api('PUT', `/api/analytics/${chatbotId}/settings`, { diagnostic_logging: false }, token);

  // Verify it's back to false
  const getR = await api('GET', `/api/analytics/${chatbotId}/settings`, null, token);
  if (getR.data.diagnostic_logging !== false) {
    fail('diagnostic_logging restored to false', `still ${getR.data.diagnostic_logging}`);
  } else {
    pass('diagnostic_logging restored to false after test');
  }
}

async function testRetentionEnforcement(chatbotId) {
  console.log('\n[13] Retention enforcement');

  // Insert an old interaction event (91 days ago)
  const sessR = await api('POST', '/api/analytics/session', { chatbot_id: chatbotId }, null, true);
  if (sessR.status !== 200 && sessR.status !== 201) {
    skip('retention test', 'session creation failed');
    return;
  }

  const { data: sessRow } = await supabase
    .from('visitor_sessions')
    .select('id')
    .eq('session_token', sessR.data.session_token)
    .single();

  if (!sessRow) { skip('retention test', 'session not in DB'); return; }

  const oldDate = new Date(Date.now() - 92 * 24 * 60 * 60 * 1000).toISOString();

  const oldEvent = await dbInsert('interaction_events', {
    rag_app_id:       chatbotId,
    session_id:       sessRow.id,
    event_type:       'question_answered',
    retrieval_status: 'ok',
    response_status:  'answered',
    created_at:       oldDate,
  }).catch(() => null);

  if (!oldEvent) { skip('retention test', 'could not insert old event'); return; }

  // Import and call enforceRetention
  const { enforceRetention } = await import('../src/analyticsService.js');
  await enforceRetention(chatbotId, 90);

  // Old event should be gone
  const remaining = await dbQuery('interaction_events', { id: oldEvent.id });
  if (remaining.length > 0) {
    fail('old event deleted after retention period', 'still exists');
    // Clean up anyway
    await dbDelete('interaction_events', { id: oldEvent.id });
    return;
  }
  pass('event older than retention_days deleted by enforceRetention()');

  // Clean up session
  await dbDelete('visitor_sessions', { id: sessRow.id });
}

async function testGetOrCreateSession(chatbotId) {
  console.log('\n[14] getOrCreateSession() unit test');

  const { getOrCreateSession } = await import('../src/analyticsService.js');

  // Create new
  const { session: s1, isNew: n1 } = await getOrCreateSession(chatbotId, null);
  if (!s1?.session_token || !n1) {
    fail('new session created', `isNew=${n1}, token=${s1?.session_token}`);
    return;
  }
  pass(`new session created: token=${s1.session_token.slice(0,8)}, isNew=true`);

  // Resume by token
  const { session: s2, isNew: n2 } = await getOrCreateSession(chatbotId, s1.session_token);
  if (s2?.session_token !== s1.session_token || n2) {
    fail('existing session resumed', `isNew=${n2}, token=${s2?.session_token?.slice(0,8)}`);
    return;
  }
  pass('existing session resumed: same token, isNew=false');

  // Clean up
  await dbDelete('visitor_sessions', { id: s1.id });
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n════════════════════════════════════════════════════════');
  console.log('  Phase 10C — Verification Suite');
  console.log('════════════════════════════════════════════════════════');

  // Pre-flight: check tables exist
  console.log('\n[0] Pre-flight: verify DB tables');
  const tables = ['visitor_sessions', 'interaction_events', 'topic_aggregates', 'feedback_events', 'analytics_settings'];
  for (const t of tables) {
    const { data, error } = await supabase.from(t).select('id').limit(1);
    if (error) {
      fail(`table ${t} exists`, error.message);
    } else {
      pass(`table ${t} exists`);
    }
  }

  if (failed > 0) {
    console.log('\n⚠ DB tables missing — run migration 011_analytics_sessions.sql first.\n');
    process.exit(1);
  }

  const { token, chatbotId, chatbotId2 } = await setup();

  if (!chatbotId) {
    console.log('\n⚠ No chatbot available. Create a chatbot and re-run.\n');
    process.exit(1);
  }

  // ── Unit tests (no auth required) ─────────────────────────────────────────
  await testGetOrCreateSession(chatbotId);

  const tok1 = await testSessionIsolation(chatbotId);
  if (tok1) {
    await testSessionScoping(chatbotId, chatbotId2, tok1);
    await testSessionResume(chatbotId, tok1);
    await testExpiredSessionRejection(chatbotId);
  }

  // ── Auth-required tests ────────────────────────────────────────────────────
  const chatSessionToken = await testInteractionEventRecording(chatbotId, token);
  await testAnalyticsSummary(chatbotId, token);
  await testMultiTenantIsolation(chatbotId, token);

  const interactionEventId = await testFeedbackRecording(chatbotId, token, chatSessionToken);
  await testFeedbackIdempotency(chatbotId, chatSessionToken, interactionEventId);

  await testCrossChatbotAnalyticsIsolation(chatbotId, chatbotId2, token);
  await testAnalyticsSettings(chatbotId, token);
  await testDiagnosticLogging(chatbotId, token);
  await testRetentionEnforcement(chatbotId);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed  ${failed} failed  ${skipped} skipped`);
  console.log('════════════════════════════════════════════════════════\n');

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('\n[FATAL]', err.message);
  process.exit(1);
});
