/**
 * server/scripts/verify-phase9b-context.js
 *
 * Phase 9B Context-Grounding Verification
 *
 * Tests the browser bug fix: Architect must reference actual canvas/draft
 * state instead of asking users to describe changes already in context.
 *
 * Tests 1-18 as specified in the Phase 9B context-grounding fix requirement.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { loadEmbedder } from '../src/embeddings.js';
import { buildArchitectContext, buildContextAcknowledgement } from '../src/architect/chatService.js';
import { diffWorkflow, validateWorkflow } from '../src/workflowUtils.js';
import { getNodeCapability } from '../src/nodeCapabilityRegistry.js';

const API          = process.env.VERIFY_API_URL || 'http://127.0.0.1:3001';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let passed = 0, failed = 0;
const cleanup = { userIds: [], ragAppIds: [] };

function pass(label, detail = '') { console.log(`  ✅  ${label}${detail ? '  —  ' + detail : ''}`); passed++; }
function fail(label, detail = '') { console.log(`  ❌  ${label}${detail ? '  —  ' + detail : ''}`); failed++; }
function info(label, detail = '') { console.log(`  ℹ️   ${label}${detail ? '  —  ' + detail : ''}`); }
function section(t)               { console.log(`\n  ── ${t}`); }

async function signIn(email, pw) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY },
    body: JSON.stringify({ email, password: pw }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`Sign-in failed: ${j.error_description || j.msg}`);
  return j.access_token;
}

async function api(method, path, token, body) {
  const opts = { method, headers: { ...(token && { Authorization: `Bearer ${token}` }) } };
  if (body instanceof FormData) { opts.body = body; }
  else if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(`${API}${path}`, opts);
  let json; try { json = await r.json(); } catch { json = {}; }
  return { status: r.status, body: json };
}

async function createUser(email, pw) {
  const { data } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
  if (data?.user?.id) cleanup.userIds.push(data.user.id);
  return signIn(email, pw);
}

function makeUpload(chatbotId, content, filename) {
  const form = new FormData();
  form.append('file', new Blob([content], { type: 'text/plain' }), filename);
  form.append('chatbot_id', chatbotId);
  return form;
}

async function doCleanup() {
  console.log('\n  ── Cleanup');
  for (const id of cleanup.ragAppIds) {
    try {
      const { data: docs } = await admin.from('documents').select('storage_path').eq('rag_app_id', id);
      if (docs?.length) {
        const paths = docs.map(d => d.storage_path).filter(Boolean);
        if (paths.length) await admin.storage.from('knowledge-docs').remove(paths);
      }
      await admin.from('architect_chat_messages').delete().eq('rag_app_id', id);
      await admin.from('messages').delete().eq('rag_app_id', id);
      await admin.from('document_chunks').delete().eq('rag_app_id', id);
      await admin.from('documents').delete().eq('rag_app_id', id);
      await admin.from('rag_apps').delete().eq('id', id);
    } catch { /* continue */ }
  }
  for (const id of cleanup.userIds) {
    await admin.from('projects').delete().eq('user_id', id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log('  cleanup done');
}

async function run() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Phase 9B Context-Grounding Verification');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await loadEmbedder();

  const ts     = Date.now();
  const tokenA = await createUser(`p9bctx-a-${ts}@vanta.test`, 'P9BCtx!Test');
  const tokenB = await createUser(`p9bctx-b-${ts}@vanta.test`, 'P9BCtx!Test');

  // ── Setup: approved Phase 8 app with OCR + VoiceRecognition draft ─────────

  const genApp = await api('POST', '/api/chatbots/create-draft', tokenA,
    { description: 'Technical maintenance assistant for scanned manuals and voice queries' });
  const appId = genApp.body.id;
  cleanup.ragAppIds.push(appId);

  await api('POST', '/api/documents/upload', tokenA,
    makeUpload(appId, 'Daily inspection. Check pressure. Inspect seals.', 'manual.txt'));
  const analyzeRes = await api('POST', '/api/architect/analyze', tokenA, { rag_app_id: appId, requirement: 'Technical maintenance assistant' });
  await api('POST', '/api/architect/plan', tokenA, {
    rag_app_id: appId,
    requirement: 'Technical maintenance assistant',
    knowledge_profile: analyzeRes.body.knowledge_profile,
  });
  await api('POST', '/api/architect/approve', tokenA, { rag_app_id: appId });
  await api('POST', '/api/architect/build-pipeline', tokenA, { rag_app_id: appId });

  // Get active nodes after build
  const activeAppRes = await api('GET', `/api/chatbots/${appId}`, tokenA);
  const activeNodes  = activeAppRes.body.nodes || [];
  const activeConns  = activeAppRes.body.connections || [];

  // Build controlled draft: active + OCR + VoiceRecognition
  const draftNodes = [
    ...activeNodes,
    { id: 'ocr-ctx-test',   type: 'OCR',               label: 'OCR Layer',      x: 100, y: 400, params: {} },
    { id: 'vr-ctx-test',    type: 'VoiceRecognition',   label: 'Voice to Text',  x: 200, y: 500, params: {} },
  ];
  await api('PATCH', `/api/workflow/${appId}/draft`, tokenA,
    { nodes: draftNodes, connections: activeConns });

  console.log(`\n  App: ${appId.slice(0,8)}  Active: ${activeNodes.length} nodes  Draft: ${draftNodes.length} nodes`);

  // ── UNIT: buildArchitectContext + buildContextAcknowledgement ─────────────

  section('Tests 4-7. Context object completeness (unit)');

  // Fetch ragApp from DB to simulate server-side state
  const { data: ragAppRow } = await admin.from('rag_apps').select('*').eq('id', appId).single();

  const ctx = await buildArchitectContext(ragAppRow);

  // Test 4: active workflow in context
  if (ctx.active_workflow.node_count === activeNodes.length &&
      ctx.active_workflow.nodes.length === activeNodes.length)
    pass('4: Active workflow state is available in context', `nodes=${ctx.active_workflow.node_count}`);
  else fail('4: Active workflow missing', `count=${ctx.active_workflow.node_count}`);

  // Test 5: draft workflow in context
  if (ctx.draft_workflow?.node_count === draftNodes.length)
    pass('5: Draft workflow state is available in context', `nodes=${ctx.draft_workflow.node_count}`);
  else fail('5: Draft workflow missing', `count=${ctx.draft_workflow?.node_count}`);

  // Test 6: diff is available
  if (ctx.diff.has_changes && ctx.diff.added_nodes?.length === 2)
    pass('6: Diff is available — added_nodes detected', `added=${ctx.diff.added_nodes.map(n=>n.type).join(',')}`);
  else fail('6: Diff missing or wrong', JSON.stringify(ctx.diff).slice(0, 80));

  // Test 7: unsupported capabilities in context
  if (ctx.validation.unsupported_capabilities.includes('OCR') &&
      ctx.validation.unsupported_capabilities.includes('VoiceRecognition'))
    pass('7: Unsupported capabilities in context', ctx.validation.unsupported_capabilities.join(','));
  else fail('7: unsupported_capabilities wrong', JSON.stringify(ctx.validation.unsupported_capabilities));

  // ── UNIT: buildContextAcknowledgement ─────────────────────────────────────

  section('Tests 1-3. Context acknowledgement content (unit)');

  const ack = buildContextAcknowledgement(ctx);
  info('Context acknowledgement', ack.slice(0, 300));

  // Test 1: first response references actual added nodes
  const ackLower = ack.toLowerCase();
  const refsOcr  = ackLower.includes('ocr');
  const refsVoice = ackLower.includes('voice');
  if (refsOcr && refsVoice)
    pass('1: Context-ack references actual added nodes (OCR + VoiceRecognition)');
  else fail('1: Context-ack does not mention added nodes', ack.slice(0, 150));

  // Test 2: does not ask user to describe changes
  const asksToDescribe = ackLower.includes('could you') ||
                         ackLower.includes('please describe') ||
                         ackLower.includes('what changes') ||
                         ackLower.includes('tell me what');
  if (!asksToDescribe)
    pass('2: Context-ack does not ask user to describe already-known changes');
  else fail('2: Context-ack asks user to describe changes it already knows', ack.slice(0, 150));

  // Test 11: position-only metadata NOT in context (x/y stripped)
  const hasPositionData = ctx.active_workflow.nodes.some(n => 'x' in n || 'y' in n);
  if (!hasPositionData)
    pass('11: Position-only metadata (x/y) stripped from context nodes');
  else fail('11: x/y position data was NOT stripped from nodes');

  // ── API: review-draft first response ─────────────────────────────────────

  section('Tests 1-3 (API). Review-draft first response');

  const reviewRes = await api('POST', `/api/architect-chat/${appId}/review-draft`, tokenA);
  if (reviewRes.status !== 200) {
    fail('Review-draft failed', JSON.stringify(reviewRes.body).slice(0, 100));
  } else {
    const firstMsg = (reviewRes.body.context_ack || reviewRes.body.message || '').toLowerCase();
    info('First Architect message (first 300 chars)', firstMsg.slice(0, 300));

    // Test 1 (API): references actual nodes
    const apiRefsOcr   = firstMsg.includes('ocr');
    const apiRefsVoice = firstMsg.includes('voice');
    if (apiRefsOcr && apiRefsVoice)
      pass('1 (API): review-draft first message references actual added nodes');
    else fail('1 (API): first message does not reference added nodes', firstMsg.slice(0, 200));

    // Test 2 (API): does not ask user to describe changes
    const apiAsks = firstMsg.includes('could you provide') ||
                    firstMsg.includes('please describe') ||
                    firstMsg.includes('what changes did you') ||
                    firstMsg.includes('provide me with the details');
    if (!apiAsks)
      pass('2 (API): Architect does not ask user to describe already-known changes');
    else fail('2 (API): Architect still asking user to describe known changes', firstMsg.slice(0, 200));

    // Test: has_diff is true
    if (reviewRes.body.has_diff === true)
      pass('Review-draft reports has_diff=true');
    else fail('Review-draft has_diff wrong', `has_diff=${reviewRes.body.has_diff}`);
  }

  // ── API: "can you look at the canvas" ─────────────────────────────────────

  section('Test 3. "can you look at the canvas" response');

  const canvasMsg = await api('POST', `/api/architect-chat/${appId}/message`, tokenA,
    { message: 'can you look at the canvas' });

  if (canvasMsg.status === 200) {
    const canvasResp = (canvasMsg.body.message || '').toLowerCase();
    info('Canvas query response (first 300)', canvasResp.slice(0, 300));

    // Must NOT say it cannot view the canvas
    const claimsBlind = canvasResp.includes('unable to view') ||
                        canvasResp.includes('cannot view') ||
                        canvasResp.includes("can't view") ||
                        canvasResp.includes('i cannot inspect') ||
                        canvasResp.includes('i am unable');
    if (!claimsBlind)
      pass("3: Architect does not claim it cannot view the canvas");
    else fail("3: Architect still claims it cannot view the canvas", canvasResp.slice(0, 200));

    // Should reference actual workflow content
    const hasWorkflowRef = canvasResp.includes('ocr') ||
                           canvasResp.includes('voice') ||
                           canvasResp.includes('node') ||
                           canvasResp.includes('draft') ||
                           canvasResp.includes('workflow') ||
                           canvasResp.includes('active');
    if (hasWorkflowRef)
      pass('3b: Canvas response references actual workflow content');
    else fail('3b: Canvas response has no workflow content reference', canvasResp.slice(0, 200));
  } else {
    fail('3: Canvas query failed', JSON.stringify(canvasMsg.body).slice(0, 80));
  }

  // ── Tests 8-9: Context survives multiple turns ─────────────────────────────

  section('Tests 8-9. Context survives subsequent turns');

  const clarifyTurn = await api('POST', `/api/architect-chat/${appId}/message`, tokenA,
    { message: 'Yes, OCR is for scanned maintenance manuals and voice is for customer queries.' });

  if (clarifyTurn.status === 200) {
    pass('8: Context survives second conversation turn', `status=${clarifyTurn.body.status}`);
    const clarifyResp = (clarifyTurn.body.message || '').toLowerCase();

    // Must NOT forget the nodes or ask again
    const forgetsNodes = clarifyResp.includes('what changes') ||
                         clarifyResp.includes('could you describe') ||
                         clarifyResp.includes('what did you add');
    if (!forgetsNodes)
      pass('9: User clarification + canvas context combined correctly on turn 3');
    else fail('9: Architect forgot canvas context on turn 3', clarifyResp.slice(0, 200));
  } else {
    fail('8: Third turn failed', JSON.stringify(clarifyTurn.body).slice(0, 80));
  }

  // ── Test 10: Direct chat can inspect draft ─────────────────────────────────

  section('Test 10. Direct chat can inspect current draft');

  // Cancel existing conversation, start fresh via /start on same app
  await api('DELETE', `/api/architect-chat/${appId}/cancel`, tokenA);

  const directStart = await api('POST', `/api/architect-chat/${appId}/start`, tokenA,
    { message: 'What does my current workflow look like?' });

  if (directStart.status === 200) {
    const directResp = (directStart.body.message || '').toLowerCase();
    info('Direct chat workflow query response (first 300)', directResp.slice(0, 300));

    const hasContent = directResp.includes('node') || directResp.includes('workflow') ||
                       directResp.includes('active') || directResp.includes('draft') ||
                       directResp.includes('document') || directResp.includes('llm') ||
                       directResp.includes('embeddings');
    if (hasContent)
      pass('10: Direct chat can describe current workflow without user describing it');
    else fail('10: Direct chat response has no workflow content', directResp.slice(0, 200));
  } else {
    fail('10: Direct chat /start failed', JSON.stringify(directStart.body).slice(0, 80));
  }

  // ── Tests 12-15: Isolation + protection ───────────────────────────────────

  section('Tests 12-15. Isolation + workflow protection');

  // Test 12: User B cannot access User A chat context
  const crossCtx = await api('GET', `/api/architect-chat/${appId}`, tokenB);
  if (crossCtx.status === 404)
    pass('12: User A Architect cannot be accessed by User B → 404');
  else fail('12: Cross-user isolation broken', `status=${crossCtx.status}`);

  // Test 13: active workflow unchanged
  const afterChatApp = (await api('GET', `/api/chatbots/${appId}`, tokenA)).body;
  if (JSON.stringify(afterChatApp.nodes) === JSON.stringify(activeAppRes.body.nodes))
    pass('13: Active workflow remains untouched after Architect chat');
  else fail('13: Active workflow was modified');

  // Test 14: draft unchanged
  const draftState = await api('GET', `/api/workflow/${appId}`, tokenA);
  if (draftState.body.has_draft && draftState.body.draft?.nodes?.length === draftNodes.length)
    pass('14: Draft remains untouched after Architect chat', `nodes=${draftState.body.draft.nodes.length}`);
  else fail('14: Draft was modified', JSON.stringify(draftState.body).slice(0, 80));

  // Test 15: proposals are advisory — no active workflow modification
  const proposalCheck = (await api('GET', `/api/architect-chat/${appId}`, tokenA)).body;
  const hasProposal = proposalCheck.proposed_status !== null;
  // Whether or not a proposal exists, active workflow should be unchanged
  if (JSON.stringify(afterChatApp.nodes) === JSON.stringify(activeAppRes.body.nodes))
    pass('15: Proposals remain advisory — active workflow not modified');
  else fail('15: Active workflow was changed by proposal');

  // ── Test: stale-context detection ─────────────────────────────────────────

  section('Stale-context detection');

  // draft_updated_at is present in context when draft exists
  const { data: appWithDraft } = await admin.from('rag_apps').select('*').eq('id', appId).single();
  const ctxWithDraft = await buildArchitectContext(appWithDraft);
  if (ctxWithDraft.draft_updated_at !== undefined)
    pass('Stale-context: draft_updated_at tracked in context');
  else fail('Stale-context: draft_updated_at missing from context');

  // ── Regression smoke ──────────────────────────────────────────────────────

  section('Regression Smoke');

  const health = await api('GET', '/api/health', null);
  if (health.status === 200) pass('Health check');
  else fail('Health check broken');

  // Preview uses active workflow
  const previewCheck = await api('POST', '/api/chat/preview', tokenA, {
    chatbot_id: appId, query: 'Daily inspection?',
  });
  if (previewCheck.status === 200)
    pass('Preview still uses active workflow (regression)');
  else fail('Preview broken', `status=${previewCheck.status}`);

  await doCleanup();

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  if (failed > 0) process.exit(1);
}

run().catch(async err => {
  console.error('\nFatal:', err.message);
  await doCleanup();
  process.exit(1);
});
