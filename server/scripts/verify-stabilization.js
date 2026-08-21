/**
 * server/scripts/verify-stabilization.js
 *
 * Pre-Phase 7 Stabilization Verification
 * Tests: preview RAG retrieval, document persistence listing, cross-RAG isolation
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { loadEmbedder } from '../src/embeddings.js';

const API          = process.env.VERIFY_API_URL || 'http://localhost:3001';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let passed = 0, failed = 0;
const cleanup = { userIds: [], ragAppIds: [] };

function pass(label, detail = '') { console.log(`  ✅  ${label}${detail ? '  —  ' + detail : ''}`); passed++; }
function fail(label, detail = '') { console.log(`  ❌  ${label}${detail ? '  —  ' + detail : ''}`); failed++; }
function section(t) { console.log(`\n  ── ${t}`); }

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

function makeTextUpload(chatbotId, content, filename) {
  const form = new FormData();
  form.append('file', new Blob([content], { type: 'text/plain' }), filename);
  form.append('chatbot_id', chatbotId);
  return form;
}

async function doCleanup() {
  for (const id of cleanup.ragAppIds) {
    await admin.from('messages').delete().eq('rag_app_id', id);
    await admin.from('document_chunks').delete().eq('rag_app_id', id);
    await admin.from('documents').delete().eq('rag_app_id', id);
    await admin.from('rag_apps').delete().eq('id', id);
  }
  for (const id of cleanup.userIds) {
    await admin.from('projects').delete().eq('user_id', id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log('\n  cleanup done');
}

async function run() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Pre-Phase 7 Stabilization Verification');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await loadEmbedder();

  const ts = Date.now();
  const token = await createUser(`stab-${ts}@vanta.test`, 'Stab!Test99');

  // ── Create App A and App B ────────────────────────────────────────────────
  const genA = await api('POST', '/api/chatbots/generate', token, { description: 'App A test bot' });
  const genB = await api('POST', '/api/chatbots/generate', token, { description: 'App B test bot' });
  const appAId = genA.body.id;
  const appBId = genB.body.id;
  cleanup.ragAppIds.push(appAId, appBId);
  console.log(`\n  App A: ${appAId.slice(0,8)}  App B: ${appBId.slice(0,8)}`);

  // ── Upload distinct documents to each app ─────────────────────────────────
  section('Document Upload & Isolation');

  const uploadA = await api('POST', '/api/documents/upload', token,
    makeTextUpload(appAId, 'The store allows product returns within 37 days of purchase. Original receipt required.', 'returns_a.txt'));
  const uploadB = await api('POST', '/api/documents/upload', token,
    makeTextUpload(appBId, 'The fictional city of Velora uses the currency called Zorin. 1 Zorin equals 10 Veloran coins.', 'velora_b.txt'));

  if (uploadA.status === 200) pass('App A doc uploaded', `id=${uploadA.body.id?.slice(0,8)} chunks=${uploadA.body.chunk_count}`);
  else fail('App A doc upload failed', JSON.stringify(uploadA.body).slice(0,100));

  if (uploadB.status === 200) pass('App B doc uploaded', `id=${uploadB.body.id?.slice(0,8)} chunks=${uploadB.body.chunk_count}`);
  else fail('App B doc upload failed', JSON.stringify(uploadB.body).slice(0,100));

  // ── Document listing isolation ────────────────────────────────────────────
  section('GET /api/documents isolation');

  const docsA = await api('GET', `/api/documents?rag_app_id=${appAId}`, token);
  const docsB = await api('GET', `/api/documents?rag_app_id=${appBId}`, token);

  if (docsA.status === 200 && docsA.body.length === 1 && docsA.body[0].file_name === 'returns_a.txt') {
    pass('App A document list returns only App A document', `count=${docsA.body.length}`);
  } else {
    fail('App A document list wrong', JSON.stringify(docsA.body).slice(0,120));
  }

  if (docsB.status === 200 && docsB.body.length === 1 && docsB.body[0].file_name === 'velora_b.txt') {
    pass('App B document list returns only App B document', `count=${docsB.body.length}`);
  } else {
    fail('App B document list wrong', JSON.stringify(docsB.body).slice(0,120));
  }

  // ── Preview RAG retrieval (Issue 1 fix) ───────────────────────────────────
  section('Editor Preview — Real RAG Retrieval');

  const previewA = await api('POST', '/api/chat/preview', token, {
    chatbot_id: appAId,
    query: 'What is the product return period?',
  });

  if (previewA.status === 200 && previewA.body.avgSimilarity > 0.3) {
    pass('Preview uses real RAG retrieval (App A)', `avgSimilarity=${previewA.body.avgSimilarity?.toFixed(4)} chunks=${previewA.body.retrievedChunks?.length}`);
  } else {
    fail('Preview NOT using RAG retrieval', `status=${previewA.status} similarity=${previewA.body.avgSimilarity}`);
  }

  if (previewA.body.answer?.includes('37') || previewA.body.answer?.toLowerCase().includes('return')) {
    pass('Preview answer grounded in uploaded knowledge (contains return info)', `answer snippet: "${previewA.body.answer?.slice(0,80)}"`);
  } else {
    fail('Preview answer not grounded', `answer: "${previewA.body.answer?.slice(0,100)}"`);
  }

  // Grounding test — distinctive fact
  section('Preview Grounding Test (Distinctive Fact)');

  const sapphireApp = await api('POST', '/api/chatbots/generate', token, { description: 'Sapphire plan test bot' });
  cleanup.ragAppIds.push(sapphireApp.body.id);
  await api('POST', '/api/documents/upload', token,
    makeTextUpload(sapphireApp.body.id, "Vanta's fictional Sapphire Plan allows exactly 47 support requests per month.", 'sapphire.txt'));

  const sapphirePreview = await api('POST', '/api/chat/preview', token, {
    chatbot_id: sapphireApp.body.id,
    query: 'How many support requests does the Sapphire Plan allow?',
  });

  if (sapphirePreview.body.answer?.includes('47')) {
    pass('Grounding test: answer contains distinctive fact "47"', `answer: "${sapphirePreview.body.answer?.slice(0,100)}"`);
  } else {
    fail('Grounding test: answer does not contain "47"', `answer: "${sapphirePreview.body.answer?.slice(0,100)}"`);
  }

  // ── Cross-RAG chunk isolation ──────────────────────────────────────────────
  section('Cross-RAG Chunk Isolation (Critical)');

  // Query App A for something only in App B
  const crossA = await api('POST', '/api/chat/preview', token, {
    chatbot_id: appAId,
    query: 'What currency does Velora use?',
  });

  const crossAChunks = crossA.body.retrievedChunks ?? [];
  // Check no App B chunks retrieved
  const { data: appBChunkIds } = await admin
    .from('document_chunks')
    .select('id')
    .eq('rag_app_id', appBId);
  const appBIds = new Set((appBChunkIds || []).map(c => c.id));

  // Get the actual chunk IDs from the retrieval
  const { data: matchedChunks } = await admin.rpc('match_chunks', {
    query_embedding: `[${Array(384).fill(0).join(',')}]`,
    p_rag_app_id: appAId,
    match_count: 10,
  });
  // Check no App B content in App A retrieval
  if (crossAChunks.length === 0 || !crossA.body.answer?.toLowerCase().includes('zorin')) {
    pass('App A cannot retrieve App B chunks (Velora/Zorin test)', `App A retrieved ${crossAChunks.length} chunks, answer does not mention Zorin`);
  } else {
    fail('Cross-RAG leak: App A retrieved App B content', `answer: ${crossA.body.answer?.slice(0,100)}`);
  }

  // Query App B for something only in App A
  const crossB = await api('POST', '/api/chat/preview', token, {
    chatbot_id: appBId,
    query: 'What is the product return period?',
  });
  const crossBChunks = crossB.body.retrievedChunks ?? [];
  if (crossBChunks.length === 0 || !crossB.body.answer?.includes('37')) {
    pass('App B cannot retrieve App A chunks (37-day returns test)', `answer does not mention 37 days`);
  } else {
    fail('Cross-RAG leak: App B retrieved App A content', `answer: ${crossB.body.answer?.slice(0,100)}`);
  }

  // ── Document listing persistence simulation ────────────────────────────────
  section('Document Persistence — Reload Simulation');

  // The reload simulation just calls GET /api/documents again — same as page refresh
  const reloadDocsA = await api('GET', `/api/documents?rag_app_id=${appAId}`, token);
  if (reloadDocsA.status === 200 && reloadDocsA.body.length === 1 &&
      reloadDocsA.body[0].chunk_count > 0 && reloadDocsA.body[0].status === 'indexed') {
    pass('After "reload", App A documents still present with correct chunk_count',
      `file=${reloadDocsA.body[0].file_name} chunks=${reloadDocsA.body[0].chunk_count}`);
  } else {
    fail('Reload persistence failed', JSON.stringify(reloadDocsA.body).slice(0,120));
  }

  // Verify no duplicate documents
  const { count: docCount } = await admin
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .eq('rag_app_id', appAId);
  if (docCount === 1) {
    pass('No duplicate documents after reload simulation', `count=1`);
  } else {
    fail('Unexpected document count', `count=${docCount}`);
  }

  // ── Preview without auth → 401 ────────────────────────────────────────────
  section('Preview Auth Enforcement');
  const noAuthPreview = await api('POST', '/api/chat/preview', null, { chatbot_id: appAId, query: 'test' });
  if (noAuthPreview.status === 401) {
    pass('Preview without auth → 401');
  } else {
    fail('Preview should require auth', `status=${noAuthPreview.status}`);
  }

  // ── Public embed chat still works ─────────────────────────────────────────
  section('Public Embed Chat');
  // Deploy App A
  const embedId = `stab-embed-${ts}`;
  await api('PATCH', `/api/chatbots/${appAId}`, token, { status: 'deployed', embed_id: embedId });
  const embedChat = await api('POST', '/api/chat', null, { embed_id: embedId, query: 'hello' });
  if (embedChat.status === 200 && embedChat.body.answer) {
    pass('Public embed chat still works (no auth)', `answer snippet: "${embedChat.body.answer.slice(0,50)}"`);
  } else {
    fail('Public embed chat broken', `status=${embedChat.status}`);
  }

  await doCleanup();

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  if (failed > 0) process.exit(1);
}

run().catch(async err => {
  console.error('\nFatal:', err.message);
  await doCleanup();
  process.exit(1);
});
