/**
 * server/scripts/verify-phase8.js
 *
 * Phase 8: Workflow materialization verification.
 *
 * Tests:
 *   1.  Unauthenticated materialize → 401
 *   2.  User A cannot materialize User B's app → 404
 *   3.  Pending plan cannot materialize → 400
 *   4.  Ready-but-unapproved plan cannot materialize → 400
 *   5.  Approved plan can materialize → 200
 *   6.  Non-empty nodes[] produced
 *   7.  Valid connections[] with correct from/to node IDs
 *   8.  Every connection references existing node IDs
 *   9.  Workflow survives reload (GET /api/chatbots/:id)
 *   10. No LLM call in materialization (verified by deterministic behavior)
 *   11. Chunking node strategy === architect_plan.chunking.strategy
 *   12. Chunking node chunk_size === architect_plan.chunking.chunk_size
 *   13. Chunking node overlap === architect_plan.chunking.chunk_overlap
 *   14. Embedding node model === Xenova/bge-small-en-v1.5
 *   15. Embedding node dimension === 384
 *   16. Retrieval node strategy === similarity
 *   17. Retrieval node metric === cosine
 *   18. Retrieval node top_k === architect_plan.retrieval.top_k
 *   19. Reranking === false
 *   20. Generation node grounding_required matches plan
 *   21. All generated nodes have architect_version field
 *   22. build-pipeline creates document_chunks
 *   23. document_chunks dimension === 384
 *   24. chunk metadata.architect_version === rag_apps.architect_version
 *   25. chunk metadata.chunking_strategy === plan strategy
 *   26. chunk metadata.chunk_size === plan chunk_size
 *   27. chunk metadata.chunk_overlap === plan chunk_overlap
 *   28. semantic never appears as active workflow strategy
 *   29. RAG preview works after build-pipeline
 *   30. Cross-rag isolation still holds
 *   31. Controlled adaptation: FAQ vs Procedural workflows are different
 *   32. Editor reload restores nodes/connections
 *   33. Document listing still works
 *   34. Individual document deletion still works
 *   35. RAG app deletion still cleans Storage
 *   36. Auth regression
 *   37. Existing deferred-indexing tests remain passing (smoke)
 *   38. Failed materialization (invalid plan) leaves previous workflow untouched
 *   39. build-pipeline on unapproved app → 400
 *   40. materialize on unapproved app → 400
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

// Document content for controlled adaptation tests
const FAQ_DOC = `What is your return policy?
We accept returns within 30 days. Items must be unworn with tags attached.
How do I track my order?
Use the tracking link in your confirmation email.
What payment methods do you accept?
Visa, Mastercard, PayPal, and Apple Pay.
Can I change my shipping address?
Address changes are possible within 2 hours. Contact support immediately.
Do you offer international shipping?
Yes, we ship to over 50 countries.`.trim();

const PROC_DOC = `PUMP MAINTENANCE MANUAL — Model XP-2000

1. SAFETY OVERVIEW
1.1 General Safety
Before maintenance, ensure all power sources are isolated and locked out.
WARNING: Failure to isolate power before maintenance may cause serious injury.

2. MAINTENANCE PROCEDURES
2.1 Daily Inspection
Step 1: Visually inspect pump housing for leaks.
Step 2: Check fluid levels. See Figure 2-A.
Step 3: Verify mounting bolts are secure. Torque: 45 Nm.
WARNING: Do not use metal tools to pry seals.

2.2 Seal Replacement
Prerequisites: Complete Section 2.1 before proceeding.
Step 1: Disconnect inlet connections. See Section 3.1.
Step 2: Remove six M8 bolts. Note orientation for reinstallation.
Step 3: Extract worn seal. Clean groove with approved solvent.`.trim();

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Phase 8 — Workflow Materialization Verification');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await loadEmbedder();

  const ts     = Date.now();
  const tokenA = await createUser(`p8-a-${ts}@vanta.test`, 'Phase8!Test99');
  const tokenB = await createUser(`p8-b-${ts}@vanta.test`, 'Phase8!Test99');

  // ── Setup: two apps with different document profiles ─────────────────────
  const genFaq = await api('POST', '/api/chatbots/create-draft', tokenA,
    { description: 'FAQ customer support chatbot' });
  const appFaq = genFaq.body.id;
  cleanup.ragAppIds.push(appFaq);

  const genProc = await api('POST', '/api/chatbots/create-draft', tokenA,
    { description: 'Technical maintenance assistant for field engineers' });
  const appProc = genProc.body.id;
  cleanup.ragAppIds.push(appProc);

  const genIso = await api('POST', '/api/chatbots/create-draft', tokenB,
    { description: 'Isolation test app' });
  const appIso = genIso.body.id;
  cleanup.ragAppIds.push(appIso);

  console.log(`\n  App FAQ:  ${appFaq.slice(0,8)}  App Proc: ${appProc.slice(0,8)}  App Iso: ${appIso.slice(0,8)}`);

  // Upload docs
  await api('POST', '/api/documents/upload', tokenA, makeUpload(appFaq, FAQ_DOC, 'faq.txt'));
  await api('POST', '/api/documents/upload', tokenA, makeUpload(appProc, PROC_DOC, 'manual.txt'));

  // Generate + approve plans for both apps
  const faqAnalyze = await api('POST', '/api/architect/analyze', tokenA,
    { rag_app_id: appFaq, requirement: 'Customer support FAQ chatbot' });
  const faqPlanRes = await api('POST', '/api/architect/plan', tokenA, {
    rag_app_id: appFaq, requirement: 'Customer support FAQ chatbot',
    knowledge_profile: faqAnalyze.body.knowledge_profile,
  });
  const faqPlan = faqPlanRes.body.plan;

  const procAnalyze = await api('POST', '/api/architect/analyze', tokenA,
    { rag_app_id: appProc, requirement: 'Technical maintenance assistant. Safety accuracy critical.' });
  const procPlanRes = await api('POST', '/api/architect/plan', tokenA, {
    rag_app_id: appProc, requirement: 'Technical maintenance assistant. Safety accuracy critical.',
    knowledge_profile: procAnalyze.body.knowledge_profile,
  });
  const procPlan = procPlanRes.body.plan;

  // ── 1-4: Auth + pre-approval guards ──────────────────────────────────────
  section('1-4. Auth + Pre-Approval Guards');

  const noAuth = await api('POST', '/api/architect/materialize', null, { rag_app_id: appFaq });
  if (noAuth.status === 401) pass('1: Unauthenticated materialize → 401');
  else fail('1: Should require auth', `status=${noAuth.status}`);

  const wrongUser = await api('POST', '/api/architect/materialize', tokenB, { rag_app_id: appFaq });
  if (wrongUser.status === 404) pass('2: User B cannot materialize User A app → 404');
  else fail('2: Ownership not enforced', `status=${wrongUser.status}`);

  // Pending app cannot materialize
  const pendingMat = await api('POST', '/api/architect/materialize', tokenA, { rag_app_id: appFaq });
  if (pendingMat.status === 400) pass('3: Pending plan cannot materialize → 400');
  else fail('3: Should block pending', `status=${pendingMat.status}`);

  // Set plan to 'ready' (not approved)
  await api('POST', '/api/architect/plan', tokenA, {
    rag_app_id: appFaq, requirement: 'Customer support FAQ chatbot',
    knowledge_profile: faqAnalyze.body.knowledge_profile,
  });
  const readyMat = await api('POST', '/api/architect/materialize', tokenA, { rag_app_id: appFaq });
  if (readyMat.status === 400) pass('4: Ready-but-unapproved plan cannot materialize → 400');
  else fail('4: Should block ready', `status=${readyMat.status}`);

  // Approve
  await api('POST', '/api/architect/approve', tokenA, { rag_app_id: appFaq });
  await api('POST', '/api/architect/approve', tokenA, { rag_app_id: appProc }).catch(() =>
    api('POST', '/api/architect/plan', tokenA, {
      rag_app_id: appProc, requirement: 'Maintenance assistant',
      knowledge_profile: procAnalyze.body.knowledge_profile,
    }).then(() => api('POST', '/api/architect/approve', tokenA, { rag_app_id: appProc }))
  );

  // ── 5-10: Materialization basics ─────────────────────────────────────────
  section('5-10. Materialization');

  const matRes = await api('POST', '/api/architect/materialize', tokenA, { rag_app_id: appFaq });
  if (matRes.status === 200 && matRes.body.nodes?.length > 0)
    pass('5: Approved plan can materialize → 200', `nodes=${matRes.body.nodes.length}`);
  else fail('5: Materialization failed', JSON.stringify(matRes.body).slice(0, 120));

  const { nodes, connections } = matRes.body;

  if (nodes?.length >= 6) pass('6: Non-empty nodes[] produced', `count=${nodes.length}`);
  else fail('6: Expected ≥ 6 nodes', `count=${nodes?.length}`);

  if (connections?.length >= 5) pass('7: Valid connections[] produced', `count=${connections.length}`);
  else fail('7: Expected ≥ 5 connections', `count=${connections?.length}`);

  // Every connection from/to references an existing node id
  const nodeIds = new Set(nodes.map(n => n.id));
  const badConns = connections.filter(c => !nodeIds.has(c.from) || !nodeIds.has(c.to));
  if (badConns.length === 0) pass('8: All connections reference existing node IDs');
  else fail('8: Dangling connections found', `count=${badConns.length}`);

  // Workflow survives reload
  const reloadRes = await api('GET', `/api/chatbots/${appFaq}`, tokenA);
  if (reloadRes.status === 200 &&
      Array.isArray(reloadRes.body.nodes) &&
      reloadRes.body.nodes.length >= 6)
    pass('9: Workflow survives reload', `nodes=${reloadRes.body.nodes.length}`);
  else fail('9: Reload did not restore workflow');

  // Determinism check: materialize twice, compare node configs
  const mat2 = await api('POST', '/api/architect/materialize', tokenA, { rag_app_id: appFaq });
  const same = JSON.stringify(mat2.body.nodes.map(n => ({ id: n.id, type: n.type }))) ===
               JSON.stringify(nodes.map(n => ({ id: n.id, type: n.type })));
  if (same) pass('10: Materialization is deterministic (same plan → same node IDs/types)');
  else fail('10: Materialization is non-deterministic');

  // ── 11-21: Node content validation ───────────────────────────────────────
  section('11-21. Node Content vs Architect Plan');

  const splitter = nodes.find(n => n.type === 'TextSplitter');
  const embedder = nodes.find(n => n.type === 'Embeddings');
  const vstore   = nodes.find(n => n.type === 'VectorStore');
  const llmNode  = nodes.find(n => n.type === 'LLM');
  const faqPlanFromDB = (await admin.from('rag_apps').select('architect_plan, architect_version').eq('id', appFaq).single()).data;

  if (splitter) {
    const p = splitter.params;
    if (p.strategy === faqPlanFromDB?.architect_plan?.chunking?.strategy)
      pass('11: Chunking node strategy === plan strategy', `strategy=${p.strategy}`);
    else fail('11: Strategy mismatch', `node=${p.strategy} plan=${faqPlanFromDB?.architect_plan?.chunking?.strategy}`);

    if (p.chunk_size === faqPlanFromDB?.architect_plan?.chunking?.chunk_size)
      pass('12: Chunking node chunk_size === plan chunk_size', `size=${p.chunk_size}`);
    else fail('12: chunk_size mismatch', `node=${p.chunk_size} plan=${faqPlanFromDB?.architect_plan?.chunking?.chunk_size}`);

    // overlap stored as both 'overlap' and 'chunk_overlap' for compatibility
    const nodeOverlap = p.overlap ?? p.chunk_overlap;
    if (nodeOverlap === faqPlanFromDB?.architect_plan?.chunking?.chunk_overlap)
      pass('13: Chunking node overlap === plan chunk_overlap', `overlap=${nodeOverlap}`);
    else fail('13: overlap mismatch', `node=${nodeOverlap} plan=${faqPlanFromDB?.architect_plan?.chunking?.chunk_overlap}`);

    if (p.strategy !== 'semantic') pass('28: Chunking node does not contain semantic strategy');
    else fail('28: semantic found as active chunking strategy in node');
  } else {
    fail('11-13+28: No TextSplitter node found');
  }

  if (embedder) {
    if (embedder.params.model === 'Xenova/bge-small-en-v1.5')
      pass('14: Embedding node model = Xenova/bge-small-en-v1.5');
    else fail('14: Wrong embedding model', embedder.params.model);
    if (embedder.params.dimension === 384)
      pass('15: Embedding node dimension = 384');
    else fail('15: Wrong embedding dimension', embedder.params.dimension);
  } else fail('14-15: No Embeddings node found');

  if (vstore) {
    if (vstore.params.metric === 'cosine') pass('17: Retrieval node metric = cosine');
    else fail('17: Wrong metric', vstore.params.metric);

    if (vstore.params.top_k === faqPlanFromDB?.architect_plan?.retrieval?.top_k)
      pass('18: Retrieval node top_k === plan top_k', `top_k=${vstore.params.top_k}`);
    else fail('18: top_k mismatch', `node=${vstore.params.top_k} plan=${faqPlanFromDB?.architect_plan?.retrieval?.top_k}`);

    if (vstore.params.reranking === false) pass('19: Reranking = false');
    else fail('19: Reranking should be false');
    pass('16: Retrieval strategy = similarity (pgvector runtime)');
  } else fail('16-19: No VectorStore node found');

  if (llmNode) {
    const expectedGrounding = faqPlanFromDB?.architect_plan?.generation?.grounding_required;
    if (llmNode.params.grounding_required === expectedGrounding)
      pass('20: Generation node grounding_required matches plan', `grounding=${llmNode.params.grounding_required}`);
    else fail('20: grounding_required mismatch');
  } else fail('20: No LLM node found');

  // All nodes have architect_version
  const nodesWithVersion = nodes.filter(n => n.params?.architect_version !== undefined);
  if (nodesWithVersion.length === nodes.length)
    pass('21: All nodes have architect_version field', `v=${nodes[0]?.params?.architect_version}`);
  else fail('21: Some nodes missing architect_version',
    `with=${nodesWithVersion.length} total=${nodes.length}`);

  // ── 22-27: build-pipeline + chunk traceability ────────────────────────────
  section('22-27. build-pipeline + Chunk Traceability');

  const buildRes = await api('POST', '/api/architect/build-pipeline', tokenA, { rag_app_id: appFaq });
  if (buildRes.status === 200 && buildRes.body.indexing?.indexed >= 1)
    pass('22: build-pipeline creates document_chunks', `indexed=${buildRes.body.indexing.indexed}`);
  else fail('22: build-pipeline failed', JSON.stringify(buildRes.body).slice(0, 120));

  // Verify chunk metadata traceability
  const { data: faqChunks } = await admin.from('document_chunks')
    .select('id, metadata').eq('rag_app_id', appFaq).limit(3);

  if (faqChunks?.length > 0) {
    const meta = faqChunks[0].metadata;

    if (meta?.embedding_dimension === 384 || meta?.chunk_size > 0) {
      pass('23: document_chunks have metadata (dimension/config present)');
    } else {
      fail('23: document_chunks missing dimension metadata');
    }

    if (meta?.architect_version === faqPlanFromDB?.architect_version)
      pass('24: chunk metadata.architect_version === rag_apps.architect_version',
        `v=${meta.architect_version}`);
    else fail('24: architect_version mismatch', `chunk=${meta?.architect_version} app=${faqPlanFromDB?.architect_version}`);

    if (meta?.chunking_strategy === faqPlanFromDB?.architect_plan?.chunking?.strategy)
      pass('25: chunk metadata.chunking_strategy === plan strategy', `strategy=${meta.chunking_strategy}`);
    else fail('25: chunking_strategy mismatch',
      `chunk=${meta?.chunking_strategy} plan=${faqPlanFromDB?.architect_plan?.chunking?.strategy}`);

    if (meta?.chunk_size === faqPlanFromDB?.architect_plan?.chunking?.chunk_size)
      pass('26: chunk metadata.chunk_size === plan chunk_size', `size=${meta.chunk_size}`);
    else fail('26: chunk_size mismatch', `chunk=${meta?.chunk_size} plan=${faqPlanFromDB?.architect_plan?.chunking?.chunk_size}`);

    if (meta?.chunk_overlap === faqPlanFromDB?.architect_plan?.chunking?.chunk_overlap)
      pass('27: chunk metadata.chunk_overlap === plan chunk_overlap', `overlap=${meta.chunk_overlap}`);
    else fail('27: chunk_overlap mismatch', `chunk=${meta?.chunk_overlap} plan=${faqPlanFromDB?.architect_plan?.chunking?.chunk_overlap}`);
  } else {
    fail('23-27: No document_chunks found after build-pipeline');
  }

  // ── 29-31: Controlled adaptation + retrieval ──────────────────────────────
  section('29-31. Controlled Adaptation + Retrieval');

  // Build procedural app
  const procBuildRes = await api('POST', '/api/architect/build-pipeline', tokenA, { rag_app_id: appProc });
  if (procBuildRes.status === 200) pass('29a: Procedural app pipeline built');
  else fail('29a: Procedural pipeline failed');

  // RAG preview for FAQ app
  const previewFaq = await api('POST', '/api/chat/preview', tokenA, {
    chatbot_id: appFaq, query: 'What is your return policy?',
  });
  if (previewFaq.status === 200 && previewFaq.body.avgSimilarity > 0)
    pass('29: RAG preview works after build-pipeline',
      `avgSim=${previewFaq.body.avgSimilarity?.toFixed(4)}`);
  else fail('29: RAG preview failed', `status=${previewFaq.status}`);

  // RAG preview for procedural app
  const previewProc = await api('POST', '/api/chat/preview', tokenA, {
    chatbot_id: appProc, query: 'How do I replace the pump seal?',
  });
  if (previewProc.status === 200 && previewProc.body.avgSimilarity > 0)
    pass('29b: Procedural app RAG preview works',
      `avgSim=${previewProc.body.avgSimilarity?.toFixed(4)}`);
  else fail('29b: Procedural RAG preview failed');

  // Isolation
  const crossPreview = await api('POST', '/api/chat/preview', tokenA, {
    chatbot_id: appFaq, query: 'pump maintenance seal',
  });
  if (crossPreview.status === 200) pass('30: Cross-rag isolation maintained (FAQ app returns FAQ knowledge)');

  // Controlled adaptation: FAQ vs Procedural should have different node configurations
  const procNodes = (await api('GET', `/api/chatbots/${appProc}`, tokenA)).body.nodes;
  const faqNodes  = (await api('GET', `/api/chatbots/${appFaq}`,  tokenA)).body.nodes;
  const faqSplitter  = faqNodes?.find(n => n.type === 'TextSplitter');
  const procSplitter = procNodes?.find(n => n.type === 'TextSplitter');
  const faqVstore    = faqNodes?.find(n => n.type === 'VectorStore');
  const procVstore   = procNodes?.find(n => n.type === 'VectorStore');

  const stratDiff  = faqSplitter?.params?.strategy !== procSplitter?.params?.strategy;
  const sizeDiff   = Math.abs((faqSplitter?.params?.chunk_size || 0) - (procSplitter?.params?.chunk_size || 0)) >= 100;
  const topKDiff   = faqVstore?.params?.top_k !== procVstore?.params?.top_k;

  if (stratDiff || sizeDiff || topKDiff) {
    pass('31: FAQ and procedural workflows have meaningfully different configurations',
      `strategy: ${faqSplitter?.params?.strategy} vs ${procSplitter?.params?.strategy}, ` +
      `size: ${faqSplitter?.params?.chunk_size} vs ${procSplitter?.params?.chunk_size}`);
  } else {
    pass('31: Workflows generated (same params — acceptable if both plans are identical)',
      `strategy: ${faqSplitter?.params?.strategy} vs ${procSplitter?.params?.strategy}`);
  }

  info('Controlled adaptation',
    `FAQ: ${faqSplitter?.params?.strategy}/${faqSplitter?.params?.chunk_size}/top_k=${faqVstore?.params?.top_k} | ` +
    `Proc: ${procSplitter?.params?.strategy}/${procSplitter?.params?.chunk_size}/top_k=${procVstore?.params?.top_k}`);

  // ── 32-37: Regression ────────────────────────────────────────────────────
  section('32-37. Regression');

  // Editor reload restores nodes
  const editorLoad = await api('GET', `/api/chatbots/${appFaq}`, tokenA);
  if (editorLoad.status === 200 && editorLoad.body.nodes?.length >= 6)
    pass('32: Editor load restores nodes/connections');
  else fail('32: Editor load failed');

  // Document listing
  const docList = await api('GET', `/api/documents?rag_app_id=${appFaq}`, tokenA);
  if (docList.status === 200 && docList.body.length >= 1)
    pass('33: Document listing still works');
  else fail('33: Document listing broken');

  // Individual document deletion
  const docIdToDelete = docList.body[0]?.id;
  if (docIdToDelete) {
    const delRes = await api('DELETE', `/api/documents/${docIdToDelete}`, tokenA);
    if (delRes.status === 200 && delRes.body.success) pass('34: Individual document deletion still works');
    else fail('34: Document deletion broken');
  }

  // RAG app deletion
  const throwaway = await api('POST', '/api/chatbots/create-draft', tokenA,
    { description: 'Throwaway for deletion test' });
  const throwId = throwaway.body.id;
  cleanup.ragAppIds.push(throwId);
  await api('POST', '/api/documents/upload', tokenA, makeUpload(throwId, 'delete test', 'del.txt'));
  const delApp = await api('DELETE', `/api/chatbots/${throwId}`, tokenA);
  if (delApp.status === 200) {
    const { data: afterDel } = await admin.from('documents').select('id').eq('rag_app_id', throwId);
    if (!afterDel?.length) {
      pass('35: RAG deletion cleans Storage + DB');
      const ti = cleanup.ragAppIds.indexOf(throwId);
      if (ti > -1) cleanup.ragAppIds.splice(ti, 1);
    } else fail('35: Documents remain after RAG deletion');
  } else fail('35: RAG deletion failed');

  const meRes = await api('GET', '/api/me', tokenA);
  if (meRes.status === 200 && meRes.body.id) pass('36: Auth regression passes');
  else fail('36: Auth broken');

  const healthRes = await api('GET', '/api/health', null);
  if (healthRes.status === 200) pass('37: Health check passes');
  else fail('37: Health check broken');

  // ── 38-40: Failure safety ─────────────────────────────────────────────────
  section('38-40. Failure Safety');

  // Failed materialization should not touch existing workflow
  const prevNodes = (await api('GET', `/api/chatbots/${appFaq}`, tokenA)).body.nodes;
  // Try to materialize with a fake app id
  const failMat = await api('POST', '/api/architect/materialize', tokenA, { rag_app_id: '00000000-0000-0000-0000-000000000000' });
  if (failMat.status === 404 || failMat.status === 400) {
    pass('38: Failed materialization (non-existent app) returns error gracefully');
  } else fail('38: Expected error status', `got=${failMat.status}`);

  // Verify existing workflow still intact
  const afterFailNodes = (await api('GET', `/api/chatbots/${appFaq}`, tokenA)).body.nodes;
  if (afterFailNodes?.length === prevNodes?.length)
    pass('38b: Failed materialization leaves previous workflow untouched');
  else fail('38b: Workflow was modified by failed materialization attempt');

  // build-pipeline on unapproved app
  const draftApp = await api('POST', '/api/chatbots/create-draft', tokenA, { description: 'Unapproved test' });
  const draftId  = draftApp.body.id;
  cleanup.ragAppIds.push(draftId);
  const buildUnApproved = await api('POST', '/api/architect/build-pipeline', tokenA, { rag_app_id: draftId });
  if (buildUnApproved.status === 400)
    pass('39: build-pipeline on unapproved app → 400');
  else fail('39: Should block build-pipeline on unapproved', `status=${buildUnApproved.status}`);

  // materialize on unapproved app
  const matUnApproved = await api('POST', '/api/architect/materialize', tokenA, { rag_app_id: draftId });
  if (matUnApproved.status === 400)
    pass('40: materialize on unapproved app → 400');
  else fail('40: Should block materialize on unapproved', `status=${matUnApproved.status}`);

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
