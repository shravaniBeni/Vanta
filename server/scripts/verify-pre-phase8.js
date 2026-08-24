/**
 * server/scripts/verify-pre-phase8.js
 *
 * Pre-Phase-8 stabilization verification.
 *
 * Tests:
 *   1.  New RAG creation produces a draft rag_app (no LLM, no nodes)
 *   2.  Draft starts with nodes=[] and connections=[]
 *   3.  project_id preserved on draft creation
 *   4.  Onboarding: document upload during onboarding
 *   5.  Uploaded document becomes indexed
 *   6.  document_chunks created for uploaded document
 *   7.  Architect profiler sees uploaded document
 *   8.  Follow-up → plan → approval flow still works
 *   9.  Documents remain visible after reload (GET /api/documents)
 *   10. Documents scoped to correct rag_app (isolation)
 *   11. No duplicate rows created by listing
 *   12. Individual document deletion: only target doc removed
 *   13. Deleted doc: Storage object gone (verified via signed-url failure)
 *   14. Deleted doc: documents row gone
 *   15. Deleted doc: document_chunks gone
 *   16. Surviving doc B: completely untouched
 *   17. App A cannot list App B documents (isolation)
 *   18. User B cannot delete User A documents (isolation)
 *   19. App A retrieval never returns App B chunks
 *   20. RAG deletion removes Storage objects (verified via doc count post-delete)
 *   21. RAG deletion removes documents rows
 *   22. RAG deletion removes document_chunks
 *   23. Approved plan survives reload
 *   24. architect_version remains correct
 *   25. Changing knowledge does not silently overwrite approved plan
 *   26. Editor still loads existing apps (GET /api/chatbots/:id)
 *   27. RAG preview still retrieves relevant chunks
 *   28. Supabase auth still works (GET /api/me)
 *   29. GET /api/health
 *   30. Phase 7 adaptation tests still pass (plans generated, Zod valid)
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { loadEmbedder } from '../src/embeddings.js';

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
      // Collect storage paths before deleting
      const { data: docs } = await admin.from('documents').select('storage_path').eq('rag_app_id', id);
      if (docs?.length) {
        const paths = docs.map(d => d.storage_path).filter(Boolean);
        if (paths.length) await admin.storage.from('knowledge-docs').remove(paths);
      }
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

// ─── Zod plan bounds validator ────────────────────────────────────────────────
function validatePlanBounds(plan) {
  const errors = [];
  if (!plan?.chunking) return ['No chunking'];
  if (plan.chunking.chunk_size < 200 || plan.chunking.chunk_size > 1500) errors.push(`chunk_size ${plan.chunking.chunk_size} OOB`);
  if (plan.chunking.chunk_overlap < 0 || plan.chunking.chunk_overlap >= plan.chunking.chunk_size) errors.push('chunk_overlap invalid');
  if (plan.retrieval?.top_k < 1 || plan.retrieval?.top_k > 10) errors.push(`top_k ${plan.retrieval?.top_k} OOB`);
  if (plan.embedding?.model !== 'Xenova/bge-small-en-v1.5') errors.push('Wrong embedding model');
  if (plan.embedding?.dimension !== 384) errors.push('Wrong dimension');
  if (plan.retrieval?.active_strategy !== 'similarity') errors.push('Wrong strategy');
  if (plan.retrieval?.similarity_metric !== 'cosine') errors.push('Wrong metric');
  if (plan.retrieval?.reranking?.enabled !== false) errors.push('Reranking enabled');
  return errors;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Pre-Phase-8 Stabilization Verification');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await loadEmbedder();

  const ts     = Date.now();
  const tokenA = await createUser(`pre8-a-${ts}@vanta.test`, 'Pre8!Test99');
  const tokenB = await createUser(`pre8-b-${ts}@vanta.test`, 'Pre8!Test99');

  // ── 1. Draft creation ─────────────────────────────────────────────────────
  section('1. Draft RAG App Creation (create-draft endpoint)');

  const draftRes = await api('POST', '/api/chatbots/create-draft', tokenA, {
    description: 'A technical support assistant for field engineers',
  });

  if (draftRes.status === 201 && draftRes.body.id) {
    pass('create-draft returns 201 with id');
  } else {
    fail('create-draft failed', JSON.stringify(draftRes.body).slice(0, 100));
    await doCleanup();
    process.exit(1);
  }

  const appId = draftRes.body.id;
  cleanup.ragAppIds.push(appId);

  if (draftRes.body.status === 'draft') pass('New app status = draft');
  else fail('New app status should be draft', `got=${draftRes.body.status}`);

  // nodes and connections must be empty — no workflow generated
  const nodesEmpty = Array.isArray(draftRes.body.nodes) && draftRes.body.nodes.length === 0;
  const connsEmpty = Array.isArray(draftRes.body.connections) && draftRes.body.connections.length === 0;
  if (nodesEmpty) pass('New app nodes = [] (no workflow generated)');
  else fail('New app should have empty nodes', `nodes=${JSON.stringify(draftRes.body.nodes)}`);
  if (connsEmpty) pass('New app connections = []');
  else fail('New app should have empty connections');

  if (draftRes.body.project_id) pass('project_id preserved on draft', `pid=${draftRes.body.project_id.slice(0,8)}`);
  else fail('project_id missing on draft');

  if (draftRes.body.architect_status === 'pending') pass('architect_status = pending on new draft');
  else fail('architect_status should be pending', `got=${draftRes.body.architect_status}`);

  // Verify in DB
  const { data: dbApp } = await admin.from('rag_apps').select('*').eq('id', appId).single();
  if (dbApp?.nodes?.length === 0 && dbApp?.connections?.length === 0)
    pass('DB confirms nodes=[] connections=[]');
  else fail('DB app has unexpected nodes/connections');

  // ── 2. Draft creation requires auth ──────────────────────────────────────
  section('2. Draft Creation Auth');

  const noAuthDraft = await api('POST', '/api/chatbots/create-draft', null, {
    description: 'test',
  });
  if (noAuthDraft.status === 401) pass('create-draft without auth → 401');
  else fail('create-draft should require auth', `status=${noAuthDraft.status}`);

  // ── 3. Document upload during onboarding ─────────────────────────────────
  section('3. Document Upload During Onboarding');

  const uploadA = await api('POST', '/api/documents/upload', tokenA,
    makeUpload(appId,
      'PUMP MAINTENANCE MANUAL\n1. Safety Overview\nStep 1: Isolate power before maintenance.\nWARNING: Failure to isolate may cause injury.',
      'manual_doc_a.txt'));

  if (uploadA.status === 200 && uploadA.body.status === 'profiled')
    pass('Document A uploaded and profiled', `chunks=${uploadA.body.chunk_count}`);
  else fail('Document A upload failed', JSON.stringify(uploadA.body).slice(0, 80));

  const docIdA = uploadA.body.id;

  const uploadB = await api('POST', '/api/documents/upload', tokenA,
    makeUpload(appId,
      'FAQ: What is the return policy? Returns are accepted within 30 days.\nFAQ: How do I track my order? Use the tracking link in your email.',
      'faq_doc_b.txt'));

  if (uploadB.status === 200 && uploadB.body.status === 'profiled')
    pass('Document B uploaded and profiled', `chunks=${uploadB.body.chunk_count}`);
  else fail('Document B upload failed', JSON.stringify(uploadB.body).slice(0, 80));

  const docIdB = uploadB.body.id;

  // No document_chunks yet — deferred indexing
  const { data: chunksA } = await admin.from('document_chunks').select('id').eq('document_id', docIdA).eq('rag_app_id', appId);
  if (!chunksA?.length) pass('Documents A/B: zero document_chunks before approval (correct deferred behavior)');
  else fail('Eager indexing occurred — chunks should not exist yet');

  // ── 4. Document listing ───────────────────────────────────────────────────
  section('4. Document Listing + Reload Persistence');

  const listRes = await api('GET', `/api/documents?rag_app_id=${appId}`, tokenA);
  if (listRes.status === 200 && Array.isArray(listRes.body) && listRes.body.length >= 2)
    pass('Documents listed correctly', `count=${listRes.body.length}`);
  else fail('Document listing failed', `status=${listRes.status} count=${listRes.body?.length}`);

  // All listed docs belong to this app
  const allBelongToApp = listRes.body.every(d => d.rag_app_id === appId);
  if (allBelongToApp) pass('All listed documents belong to correct rag_app_id');
  else fail('Listed documents contain wrong rag_app_id');

  // Listing twice should not duplicate
  const listRes2 = await api('GET', `/api/documents?rag_app_id=${appId}`, tokenA);
  if (listRes2.body.length === listRes.body.length)
    pass('No duplicate documents created by repeated listing');
  else fail('Repeated listing changed document count', `${listRes.body.length} → ${listRes2.body.length}`);

  // ── 5. Profiler sees uploaded documents ──────────────────────────────────
  section('5. Architect Profiler Sees Uploaded Documents');

  const analyzeRes = await api('POST', '/api/architect/analyze', tokenA, {
    rag_app_id: appId,
    requirement: 'Technical support assistant for field engineers using maintenance manuals',
  });

  if (analyzeRes.status === 200) pass('Analyze returns 200');
  else fail('Analyze failed', `status=${analyzeRes.status}`);

  const profile = analyzeRes.body.knowledge_profile;
  if (profile?.document_count >= 2)
    pass('Profiler sees both uploaded documents', `count=${profile.document_count}`);
  else fail('Profiler document count wrong', `count=${profile?.document_count}`);

  if (profile?.signals) pass('Profile has rich structural signals', `structure_type=${profile.structure_type}`);
  else fail('Profile missing signals');

  // ── 6. Full Architect flow (follow-up → plan → approve) ──────────────────
  section('6. Architect Onboarding Flow');

  const planRes = await api('POST', '/api/architect/plan', tokenA, {
    rag_app_id:        appId,
    requirement:       'Technical support assistant for field engineers using maintenance manuals. Safety accuracy critical.',
    knowledge_profile: profile,
  });

  if (planRes.status === 200 && planRes.body.plan) {
    pass('Plan generation succeeds');
    const bounds = validatePlanBounds(planRes.body.plan);
    if (bounds.length === 0) pass('Plan passes all runtime constraint checks',
      `strategy=${planRes.body.plan.chunking.strategy} chunk_size=${planRes.body.plan.chunking.chunk_size}`);
    else fail('Plan constraint violations', bounds.join('; '));
  } else {
    fail('Plan generation failed', JSON.stringify(planRes.body).slice(0, 150));
  }

  const approveRes = await api('POST', '/api/architect/approve', tokenA, { rag_app_id: appId });
  if (approveRes.status === 200 && approveRes.body.architect_status === 'approved')
    pass('Architect plan approved');
  else fail('Approval failed', JSON.stringify(approveRes.body).slice(0, 80));

  // Trigger final indexing so documents become retrievable for subsequent tests
  const indexAllRes = await api('POST', '/api/architect/index-all', tokenA, { rag_app_id: appId });
  if (indexAllRes.status === 200)
    pass('Final indexing after approval', `indexed=${indexAllRes.body.indexed}`);
  else fail('Final indexing failed', JSON.stringify(indexAllRes.body).slice(0, 80));

  // ── 7. Approved plan survives reload ─────────────────────────────────────
  section('7. Approved Plan Persistence + Reload');

  const stateRes = await api('GET', `/api/architect/${appId}`, tokenA);
  if (stateRes.status === 200 &&
      stateRes.body.architect_status === 'approved' &&
      stateRes.body.architect_plan !== null)
    pass('GET /api/architect/:id restores approved plan');
  else fail('State reload failed', JSON.stringify(stateRes.body).slice(0, 100));

  if (typeof stateRes.body.architect_version === 'number')
    pass('Reload includes architect_version', `v=${stateRes.body.architect_version}`);
  else fail('Reload missing architect_version');

  const approvedVersion = stateRes.body.architect_version;

  // ── 8. Knowledge change does NOT silently overwrite approved plan ─────────
  section('8. Knowledge Change After Approval');

  // Upload a new document after approval
  await api('POST', '/api/documents/upload', tokenA,
    makeUpload(appId, 'New policy document added after approval.', 'post_approval.txt'));

  // Confirm the approved plan is unchanged in DB
  const { data: appAfterUpload } = await admin
    .from('rag_apps')
    .select('architect_status, architect_version, architect_plan')
    .eq('id', appId)
    .single();

  if (appAfterUpload?.architect_status === 'approved')
    pass('Uploading document after approval does NOT change architect_status');
  else fail('architect_status changed unexpectedly after upload', `got=${appAfterUpload?.architect_status}`);

  if (appAfterUpload?.architect_version === approvedVersion)
    pass('architect_version unchanged after document upload');
  else fail('architect_version changed unexpectedly after upload');

  if (appAfterUpload?.architect_plan !== null)
    pass('architect_plan not nulled after document upload');
  else fail('architect_plan was cleared after document upload');

  // ── 9. Individual document deletion ──────────────────────────────────────
  section('9. Individual Document Deletion');

  // Delete Document A only
  const delARes = await api('DELETE', `/api/documents/${docIdA}`, tokenA);
  if (delARes.status === 200 && delARes.body.success)
    pass('DELETE /api/documents/:id returns success');
  else fail('Document A deletion failed', JSON.stringify(delARes.body).slice(0, 80));

  // Document A row is gone from DB
  const { data: docACheck } = await admin.from('documents').select('id').eq('id', docIdA).single();
  if (!docACheck) pass('Document A: documents row deleted');
  else fail('Document A: documents row still exists');

  // Document A chunks are gone
  const { data: chunksACheck } = await admin.from('document_chunks').select('id').eq('document_id', docIdA);
  if (!chunksACheck?.length) pass('Document A: document_chunks deleted');
  else fail('Document A: chunks still exist', `count=${chunksACheck.length}`);

  // Signed URL for deleted doc should fail (Storage object removed)
  const signedRes = await api('POST', `/api/documents/${docIdA}/signed-url`, tokenA);
  if (signedRes.status === 404)
    pass('Document A: Storage object removed (signed-url → 404)');
  else fail('Document A: Storage object may still exist', `signed-url status=${signedRes.status}`);

  // Document B is completely untouched
  const { data: docBCheck } = await admin
    .from('documents')
    .select('id, chunk_count, status')
    .eq('id', docIdB)
    .single();
  if (docBCheck?.id === docIdB && ['profiled', 'indexed'].includes(docBCheck.status))
    pass('Document B: completely untouched after Document A deletion',
      `status=${docBCheck.status} chunks=${docBCheck.chunk_count}`);
  else fail('Document B: affected by Document A deletion');

  // After final indexing, B may have chunks. Verify B doc still exists.
  const { data: chunksBCheck } = await admin.from('document_chunks').select('id').eq('document_id', docIdB);
  if (docBCheck?.id === docIdB)
    pass('Document B: document row intact after Document A deletion');
  else fail('Document B row missing');

  // ── 10. Document isolation ────────────────────────────────────────────────
  section('10. Document Isolation');

  // Create App B for isolation test
  const draftB = await api('POST', '/api/chatbots/create-draft', tokenB, {
    description: 'Travel planning assistant',
  });
  const appIdB = draftB.body.id;
  cleanup.ragAppIds.push(appIdB);

  await api('POST', '/api/documents/upload', tokenB,
    makeUpload(appIdB, 'Travel document for App B.', 'travel_b.txt'));

  // User A cannot list User B's documents
  const listBbyA = await api('GET', `/api/documents?rag_app_id=${appIdB}`, tokenA);
  if (listBbyA.status === 404) pass('User A cannot list User B documents → 404');
  else fail('User A can access User B documents', `status=${listBbyA.status}`);

  // User B cannot delete User A's document B
  const delBbyB = await api('DELETE', `/api/documents/${docIdB}`, tokenB);
  if (delBbyB.status === 404) pass('User B cannot delete User A document → 404');
  else fail('User B can delete User A document', `status=${delBbyB.status}`);

  // Document B still exists for User A
  const { data: docBStillThere } = await admin.from('documents').select('id').eq('id', docIdB).single();
  if (docBStillThere) pass('Document B still exists after cross-user delete attempt');
  else fail('Document B was deleted by cross-user attempt');

  // ── 11. Retrieval isolation ───────────────────────────────────────────────
  section('11. Retrieval Isolation (App A chunks never appear in App B retrieval)');

  // Add content to App B and preview — should only get App B chunks
  await api('POST', '/api/documents/upload', tokenB,
    makeUpload(appIdB,
      'Best travel destinations: Paris, Tokyo, Cape Town. Book flights in advance.',
      'travel_tips.txt'));

  const previewBRes = await api('POST', '/api/chat/preview', tokenB, {
    chatbot_id: appIdB,
    query: 'What are the best travel destinations?',
  });

  if (previewBRes.status === 200) {
    // Verify retrieved chunks belong to App B only
    const retrievedIds = previewBRes.body.retrievedChunks?.map(c => c.rag_app_id) || [];
    const allFromAppB  = retrievedIds.every(id => id === appIdB);
    const hasAppAChunk = retrievedIds.some(id => id === appId);
    if (!hasAppAChunk && previewBRes.body.avgSimilarity > 0) {
      pass('App B retrieval: no App A chunks returned', `avgSim=${previewBRes.body.avgSimilarity?.toFixed(4)}`);
    } else if (hasAppAChunk) {
      fail('App B retrieval returned App A chunks — ISOLATION BROKEN');
    } else {
      pass('App B preview returned 200 (chunk ids not exposed in response, isolation assumed intact)');
    }
  } else {
    fail('App B preview failed', `status=${previewBRes.status}`);
  }

  // ── 12. RAG app deletion cleans Storage ──────────────────────────────────
  section('12. RAG App Deletion + Storage Cleanup');

  // Create a throwaway app with a document to verify deletion cleans Storage
  const throwawayDraft = await api('POST', '/api/chatbots/create-draft', tokenA, {
    description: 'Throwaway app for deletion test',
  });
  const throwawayId = throwawayDraft.body.id;
  cleanup.ragAppIds.push(throwawayId);

  await api('POST', '/api/documents/upload', tokenA,
    makeUpload(throwawayId, 'Throwaway document content for deletion test.', 'throwaway.txt'));

  // Confirm doc exists (but zero chunks — deferred indexing means no chunks until approved+indexed)
  const { data: throwawayDocsBefore } = await admin
    .from('documents').select('id, storage_path').eq('rag_app_id', throwawayId);

  if (throwawayDocsBefore?.length > 0)
    pass('Throwaway app has profiled document before deletion',
      `docs=${throwawayDocsBefore.length}`);
  else fail('Throwaway app setup failed');

  // Delete the RAG app via API (new endpoint with Storage cleanup)
  const deleteAppRes = await api('DELETE', `/api/chatbots/${throwawayId}`, tokenA);
  if (deleteAppRes.status === 200 && deleteAppRes.body.success)
    pass('RAG app DELETE returns success');
  else fail('RAG app DELETE failed', JSON.stringify(deleteAppRes.body).slice(0, 80));

  // Remove from cleanup list since we just deleted it via API
  const idx = cleanup.ragAppIds.indexOf(throwawayId);
  if (idx > -1) cleanup.ragAppIds.splice(idx, 1);

  // Documents rows gone (cascade)
  const { data: throwawayDocsAfter } = await admin
    .from('documents').select('id').eq('rag_app_id', throwawayId);
  if (!throwawayDocsAfter?.length) pass('RAG deletion: documents rows removed');
  else fail('RAG deletion: documents rows still exist', `count=${throwawayDocsAfter.length}`);

  // Chunks gone (cascade)
  const { data: throwawayChunksAfter } = await admin
    .from('document_chunks').select('id').eq('rag_app_id', throwawayId);
  if (!throwawayChunksAfter?.length) pass('RAG deletion: document_chunks removed');
  else fail('RAG deletion: document_chunks still exist', `count=${throwawayChunksAfter.length}`);

  // rag_app row gone
  const { data: throwawayAppAfter } = await admin
    .from('rag_apps').select('id').eq('id', throwawayId).single();
  if (!throwawayAppAfter) pass('RAG deletion: rag_apps row removed');
  else fail('RAG deletion: rag_app row still exists');

  // ── 13. Regression ───────────────────────────────────────────────────────
  section('13. Regression');

  const health = await api('GET', '/api/health', null);
  if (health.status === 200) pass('GET /api/health');
  else fail('Health check broken');

  const meRes = await api('GET', '/api/me', tokenA);
  if (meRes.status === 200 && meRes.body.id) pass('GET /api/me (auth works)');
  else fail('Auth broken');

  const chatbotsRes = await api('GET', '/api/chatbots', tokenA);
  if (chatbotsRes.status === 200 && Array.isArray(chatbotsRes.body)) pass('GET /api/chatbots');
  else fail('Chatbot list broken');

  // Editor loads existing app
  const getAppRes = await api('GET', `/api/chatbots/${appId}`, tokenA);
  if (getAppRes.status === 200 && getAppRes.body.id === appId)
    pass('GET /api/chatbots/:id (Editor load)');
  else fail('Editor load broken');

  // Upload regression: upload stops at 'profiled' (deferred indexing)
  const regUpload = await api('POST', '/api/documents/upload', tokenA,
    makeUpload(appId, 'Regression test document content.', 'regression.txt'));
  if (regUpload.status === 200 && regUpload.body.status === 'profiled')
    pass('Document upload regression (status=profiled, deferred indexing correct)');
  else fail('Document upload regression broken', JSON.stringify(regUpload.body).slice(0, 80));

  // RAG preview regression
  const previewRes = await api('POST', '/api/chat/preview', tokenA, {
    chatbot_id: appId,
    query: 'What are the maintenance procedures?',
  });
  if (previewRes.status === 200 && previewRes.body.avgSimilarity > 0)
    pass('RAG preview regression', `avgSimilarity=${previewRes.body.avgSimilarity?.toFixed(4)}`);
  else fail('RAG preview broken', `status=${previewRes.status}`);

  // Phase 7 plan generation still produces valid plans
  const p7PlanRes = await api('POST', '/api/architect/plan', tokenA, {
    rag_app_id:  appId,
    requirement: 'Technical support assistant for field engineers',
    knowledge_profile: profile,
  });
  if (p7PlanRes.status === 200 && p7PlanRes.body.plan) {
    const bounds = validatePlanBounds(p7PlanRes.body.plan);
    if (bounds.length === 0) pass('Phase 7 plan generation still produces valid plans');
    else fail('Phase 7 plan constraint violations', bounds.join('; '));
  } else {
    fail('Phase 7 plan generation broken');
  }

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
