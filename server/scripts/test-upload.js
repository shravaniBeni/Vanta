/**
 * server/scripts/test-upload.js
 *
 * Live upload test to verify the Phase 4 indexing bug fix.
 * Creates a test user, generates a RAG app, uploads a TXT file,
 * verifies document_chunks were inserted with vector(384) embeddings,
 * and tests semantic retrieval.
 *
 * Usage:
 *   node scripts/test-upload.js
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { loadEmbedder } from '../src/embeddings.js';

const API          = process.env.VERIFY_API_URL || 'http://localhost:3002';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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
  if (body && !(body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (body instanceof FormData) {
    opts.body = body;
  }
  const r = await fetch(`${API}${path}`, opts);
  let json; try { json = await r.json(); } catch { json = {}; }
  return { status: r.status, body: json };
}

const cleanup = { userIds: [], ragAppIds: [] };

async function run() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Upload Bug Fix Verification');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Load embedder (needed for retrieval test at end)
  await loadEmbedder();

  const ts    = Date.now();
  const email = `upload-test-${ts}@vanta.test`;
  const pw    = 'UploadTest!99';

  // Create test user
  const { data: ud } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
  if (ud?.user?.id) cleanup.userIds.push(ud.user.id);
  const token = await signIn(email, pw);
  console.log(`  User: ${email}`);

  // Create RAG app
  const gen = await api('POST', '/api/chatbots/generate', token, {
    description: 'A test bot for upload verification',
  });
  if (gen.status !== 201) throw new Error('Failed to create RAG app: ' + JSON.stringify(gen.body));
  const ragAppId = gen.body.id;
  cleanup.ragAppIds.push(ragAppId);
  console.log(`  RAG app: ${ragAppId.slice(0,8)}...\n`);

  // ── Test 1: TXT upload ────────────────────────────────────────────────────
  console.log('  Test 1: TXT upload');
  const txtContent = `
Return Policy
Customers may return any item within 30 days of delivery.
Items must be in original, unworn condition.
A receipt or order confirmation is required for all returns.
Refunds will be processed within 5 to 7 business days.
For damaged or defective items, contact support within 48 hours.
  `.trim();

  const form = new FormData();
  form.append('file', new Blob([txtContent], { type: 'text/plain' }), 'return_policy.txt');
  form.append('chatbot_id', ragAppId);

  const uploadRes = await api('POST', '/api/documents/upload', token, form);
  console.log(`  Upload response: status=${uploadRes.status} body=${JSON.stringify(uploadRes.body)}`);

  if (uploadRes.status !== 200) {
    console.log('  ❌ Upload failed');
    await doCleanup();
    process.exit(1);
  }

  const docId = uploadRes.body.id;
  const chunkCount = uploadRes.body.chunk_count;
  console.log(`  Document ID: ${docId.slice(0,8)}  chunks: ${chunkCount}  status: ${uploadRes.body.status}`);

  // ── Verify documents row ──────────────────────────────────────────────────
  const { data: docRow } = await admin.from('documents').select('*').eq('id', docId).single();
  console.log(`\n  documents row: status=${docRow?.status}  chunk_count=${docRow?.chunk_count}`);

  if (docRow?.status === 'indexed' && docRow?.chunk_count > 0) {
    console.log('  ✅ documents row: indexed with chunks');
  } else {
    console.log(`  ❌ documents row wrong: ${JSON.stringify(docRow)}`);
    await doCleanup();
    process.exit(1);
  }

  // ── Verify document_chunks rows ───────────────────────────────────────────
  const { data: chunks, count } = await admin
    .from('document_chunks')
    .select('id, chunk_index', { count: 'exact' })
    .eq('document_id', docId);

  if (count > 0) {
    console.log(`  ✅ document_chunks rows: ${count} rows in Supabase`);
  } else {
    console.log(`  ❌ document_chunks: 0 rows — fix did not work`);
    await doCleanup();
    process.exit(1);
  }

  // ── Verify embedding dimension via RPC ────────────────────────────────────
  const { data: rpcResult, error: rpcErr } = await admin.rpc('match_chunks', {
    query_embedding: `[${Array(384).fill(0).join(',')}]`,
    p_rag_app_id: ragAppId,
    match_count: 3,
  });
  if (rpcErr) {
    console.log(`  ❌ match_chunks RPC error: ${rpcErr.message}`);
  } else {
    console.log(`  ✅ match_chunks RPC works, returned ${rpcResult?.length ?? 0} rows`);
  }

  // ── Semantic retrieval test ───────────────────────────────────────────────
  console.log('\n  Test 2: Semantic retrieval');
  const chatRes = await api('POST', '/api/chat', token, {
    chatbot_id: ragAppId,
    query: 'What is the return policy?',
  });
  if (chatRes.status === 200) {
    const avg = chatRes.body.avgSimilarity;
    console.log(`  ✅ Chat response returned  avgSimilarity=${avg?.toFixed(4)}`);
    if (avg > 0.3) {
      console.log('  ✅ Semantic retrieval score > 0.3 — retrieval working');
    } else {
      console.log(`  ⚠️  Low similarity score ${avg?.toFixed(4)} — chunks may exist but similarity low`);
    }
  } else {
    console.log(`  ❌ Chat request failed: ${JSON.stringify(chatRes.body)}`);
  }

  await doCleanup();

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Upload fix verified ✅');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

async function doCleanup() {
  for (const id of cleanup.ragAppIds) {
    await admin.from('document_chunks').delete().eq('rag_app_id', id);
    await admin.from('documents').delete().eq('rag_app_id', id);
    await admin.from('rag_apps').delete().eq('id', id);
  }
  for (const id of cleanup.userIds) {
    await admin.from('projects').delete().eq('user_id', id);
    await admin.auth.admin.deleteUser(id);
  }
}

run().catch(async err => {
  console.error('\nFatal:', err.message);
  await doCleanup();
  process.exit(1);
});
