/**
 * server/scripts/verify-phase5.js
 *
 * Phase 5 verification — message migration, SQLite removal, full stack check.
 *
 * Usage:
 *   node scripts/verify-phase5.js
 *
 * Requires the server running on VERIFY_API_URL (default http://localhost:3002).
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const API          = process.env.VERIFY_API_URL || 'http://localhost:3002';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let passed = 0;
let failed = 0;
const cleanup = { userIds: [], ragAppIds: [], docIds: [] };

function pass(label, detail = '') {
  console.log(`  ✅  ${label}${detail ? '  —  ' + detail : ''}`);
  passed++;
}
function fail(label, detail = '') {
  console.log(`  ❌  ${label}${detail ? '  —  ' + detail : ''}`);
  failed++;
}
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

async function api(method, urlPath, token, body) {
  const opts = { method, headers: { ...(token && { Authorization: `Bearer ${token}` }) } };
  if (body && !(body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (body instanceof FormData) {
    opts.body = body;
  }
  const r = await fetch(`${API}${urlPath}`, opts);
  let json; try { json = await r.json(); } catch { json = {}; }
  return { status: r.status, body: json };
}

async function createUser(email, pw) {
  const { data } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
  if (data?.user?.id) cleanup.userIds.push(data.user.id);
  return signIn(email, pw);
}

async function runCleanup() {
  console.log('\n  ── Cleanup');
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
  console.log('  cleanup done');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Phase 5 — Messages + SQLite Removal');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const ts    = Date.now();
  const emailA = `p5-a-${ts}@vanta.test`;
  const emailB = `p5-b-${ts}@vanta.test`;
  const pw     = 'Phase5Test!99';

  let tokenA, tokenB;
  try {
    tokenA = await createUser(emailA, pw);
    tokenB = await createUser(emailB, pw);
  } catch (err) {
    console.error('FATAL: Could not create test users:', err.message);
    process.exit(1);
  }

  // Create RAG app for User A
  const gen = await api('POST', '/api/chatbots/generate', tokenA, {
    description: 'A support bot for phase 5 message testing',
  });
  if (gen.status !== 201) {
    console.error('FATAL: Could not generate test app:', JSON.stringify(gen.body));
    process.exit(1);
  }
  const ragAppId = gen.body.id;
  cleanup.ragAppIds.push(ragAppId);
  console.log(`\n  RAG app: ${ragAppId.slice(0, 8)}... (User A)`);

  // ── SQLite removal ─────────────────────────────────────────────────────────
  section('SQLite removal');

  // V1 — db.js file does not exist
  try {
    await import('../src/db.js');
    fail('db.js still importable — was not deleted');
  } catch (err) {
    if (err.message.includes('Cannot find') || err.message.includes('ERR_MODULE_NOT_FOUND') || err.message.includes('does not exist')) {
      pass('db.js deleted — cannot be imported');
    } else {
      fail('Unexpected error importing db.js', err.message);
    }
  }

  // V2 — @libsql/client not in package.json
  const { default: pkg } = await import('../package.json', { with: { type: 'json' } });
  if (!pkg.dependencies['@libsql/client']) {
    pass('@libsql/client removed from dependencies');
  } else {
    fail('@libsql/client still in dependencies');
  }

  // V3 — no source file imports db.js or libsql
  const { readdirSync, readFileSync, statSync } = await import('fs');
  const { join } = await import('path');
  const { fileURLToPath } = await import('url');

  function findInDir(dir, pattern, results = []) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        findInDir(full, pattern, results);
      } else if (full.endsWith('.js')) {
        const content = readFileSync(full, 'utf-8');
        for (const line of content.split('\n')) {
          if (!line.trim().startsWith('//') && !line.trim().startsWith('*') && pattern.test(line)) {
            results.push(`${full}: ${line.trim()}`);
          }
        }
      }
    }
    return results;
  }

  const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
  const liveRefs = findInDir(srcDir, /db\.js|libsql/);
  if (liveRefs.length === 0) {
    pass('No live imports of db.js or @libsql/client in server/src/');
  } else {
    fail('Found db.js/libsql references in server/src/', liveRefs.slice(0, 3).join('; '));
  }

  // V4 — server health works (no SQLite startup)
  const health = await api('GET', '/api/health', null);
  if (health.status === 200 && health.body.status === 'ok') {
    pass('GET /api/health → 200 (server started without SQLite)');
  } else {
    fail('GET /api/health failed', JSON.stringify(health.body));
  }

  // ── Authenticated chat — message persistence ───────────────────────────────
  section('Authenticated chat → Supabase messages');

  const sessionId = `test-session-${ts}`;
  const chatRes = await api('POST', '/api/chat', tokenA, {
    chatbot_id: ragAppId,
    query:      'What is the return policy?',
    session_id: sessionId,
  });

  let chatAnswer;
  if (chatRes.status === 200 && chatRes.body.answer) {
    chatAnswer = chatRes.body.answer;
    pass('Authenticated chat returns answer', `session_id=${chatRes.body.session_id}`);
  } else {
    fail('Authenticated chat failed', JSON.stringify(chatRes.body).slice(0, 120));
  }

  // V5 — user message in Supabase
  const { data: userMsgs } = await admin
    .from('messages')
    .select('*')
    .eq('rag_app_id', ragAppId)
    .eq('session_id', sessionId)
    .eq('role', 'user');
  if (userMsgs?.length === 1 && userMsgs[0].content === 'What is the return policy?') {
    pass('User message inserted into Supabase messages table', `id=${userMsgs[0].id.slice(0,8)}`);
  } else {
    fail('User message not found in Supabase', `count=${userMsgs?.length}`);
  }

  // V6 — assistant message in Supabase
  const { data: asstMsgs } = await admin
    .from('messages')
    .select('*')
    .eq('rag_app_id', ragAppId)
    .eq('session_id', sessionId)
    .eq('role', 'assistant');
  if (asstMsgs?.length === 1 && asstMsgs[0].content?.length > 0) {
    pass('Assistant message inserted into Supabase', `confidence=${asstMsgs[0].confidence?.toFixed(4) ?? 'null'}`);
  } else {
    fail('Assistant message not found in Supabase', `count=${asstMsgs?.length}`);
  }

  // V7 — both messages share session_id
  const allMsgs = [...(userMsgs || []), ...(asstMsgs || [])];
  const allShareSession = allMsgs.every(m => m.session_id === sessionId);
  if (allShareSession && allMsgs.length === 2) {
    pass('User and assistant messages share the same session_id');
  } else {
    fail('session_id mismatch or wrong message count', `count=${allMsgs.length}`);
  }

  // V8 — assistant message has confidence stored
  if (asstMsgs?.[0]?.confidence !== undefined) {
    pass('Assistant message stores confidence', `value=${asstMsgs[0].confidence?.toFixed(4)}`);
  } else {
    fail('Assistant message missing confidence field');
  }

  // ── GET /api/messages ownership ────────────────────────────────────────────
  section('Message access control');

  // V9 — owner can read messages
  const msgList = await api('GET', `/api/messages?chatbot_id=${ragAppId}`, tokenA);
  if (msgList.status === 200 && Array.isArray(msgList.body) && msgList.body.length >= 2) {
    pass('Owner can GET message history', `count=${msgList.body.length}`);
  } else {
    fail('Owner cannot GET message history', `status=${msgList.status} count=${msgList.body?.length}`);
  }

  // V10 — User B cannot read User A's messages
  const msgListB = await api('GET', `/api/messages?chatbot_id=${ragAppId}`, tokenB);
  if (msgListB.status === 404) {
    pass('User B cannot access User A message history → 404');
  } else {
    fail('User B accessed User A messages', `status=${msgListB.status}`);
  }

  // V11 — session_id filter works
  const filteredMsgs = await api('GET', `/api/messages?chatbot_id=${ragAppId}&session_id=${sessionId}`, tokenA);
  if (filteredMsgs.status === 200 && filteredMsgs.body.length === 2) {
    pass('session_id filter returns correct messages', `count=${filteredMsgs.body.length}`);
  } else {
    fail('session_id filter wrong', `status=${filteredMsgs.status} count=${filteredMsgs.body?.length}`);
  }

  // ── Public embed chat ──────────────────────────────────────────────────────
  section('Public embed chat');

  // Deploy the app first
  const embedId = `test-embed-p5-${ts}`;
  await api('PATCH', `/api/chatbots/${ragAppId}`, tokenA, {
    status:   'deployed',
    embed_id: embedId,
  });

  // V12 — public embed chat works without JWT
  const pubChat = await api('POST', '/api/chat', null, {
    embed_id:   embedId,
    query:      'What can you help me with?',
    session_id: `pub-session-${ts}`,
  });
  if (pubChat.status === 200 && pubChat.body.answer) {
    pass('Public embed chat (no JWT) → 200 with answer');
  } else {
    fail('Public embed chat failed', JSON.stringify(pubChat.body).slice(0, 120));
  }

  // V13 — public embed messages have user_id = NULL
  const { data: pubMsgs } = await admin
    .from('messages')
    .select('user_id, role')
    .eq('rag_app_id', ragAppId)
    .eq('session_id', `pub-session-${ts}`);
  if (pubMsgs?.length === 2 && pubMsgs.every(m => m.user_id === null)) {
    pass('Public embed messages have user_id = NULL');
  } else {
    fail('Public embed message user_id incorrect',
      JSON.stringify(pubMsgs?.map(m => ({ role: m.role, user_id: m.user_id }))));
  }

  // ── Draft app blocked ──────────────────────────────────────────────────────
  section('Draft app access control');

  // Create a second draft app (not deployed)
  const draftGen = await api('POST', '/api/chatbots/generate', tokenA, {
    description: 'Draft bot — should not be publicly accessible',
  });
  if (draftGen.status === 201) {
    cleanup.ragAppIds.push(draftGen.body.id);
    const draftEmbedId = `draft-embed-${ts}`;
    await api('PATCH', `/api/chatbots/${draftGen.body.id}`, tokenA, { embed_id: draftEmbedId });

    // V14 — embed chat blocked for draft app
    const draftChat = await api('POST', '/api/chat', null, {
      embed_id: draftEmbedId,
      query:    'hello',
    });
    if (draftChat.status === 404 || draftChat.status === 403) {
      pass('Draft app public chat blocked', `status=${draftChat.status}`);
    } else {
      fail('Draft app chat should be blocked', `status=${draftChat.status}`);
    }
  }

  // V15 — invalid embed_id blocked
  const badEmbed = await api('POST', '/api/chat', null, {
    embed_id: 'nonexistent-embed-id-xyz',
    query:    'hello',
  });
  if (badEmbed.status === 404) {
    pass('Invalid embed_id → 404');
  } else {
    fail('Invalid embed_id should return 404', `status=${badEmbed.status}`);
  }

  // ── Existing flows preserved ───────────────────────────────────────────────
  section('Existing flows preserved');

  // V16 — pgvector retrieval still works
  const retrieve = await api('POST', '/api/chat', tokenA, {
    chatbot_id: ragAppId,
    query:      'test retrieval query',
  });
  if (retrieve.status === 200 && 'avgSimilarity' in retrieve.body) {
    pass('pgvector retrieval path still works', `avgSimilarity=${retrieve.body.avgSimilarity?.toFixed(4)}`);
  } else {
    fail('pgvector retrieval broken', `status=${retrieve.status}`);
  }

  // V17 — chatbot generation still works
  const gen2 = await api('POST', '/api/chatbots/generate', tokenA, {
    description: 'A quick test bot',
  });
  if (gen2.status === 201 && gen2.body.id) {
    cleanup.ragAppIds.push(gen2.body.id);
    pass('Chatbot generation still works', `id=${gen2.body.id.slice(0,8)}`);
  } else {
    fail('Chatbot generation broken', JSON.stringify(gen2.body).slice(0, 100));
  }

  // V18 — document upload still works
  const form = new FormData();
  form.append('file', new Blob(['Phase 5 test document content'], { type: 'text/plain' }), 'phase5.txt');
  form.append('chatbot_id', ragAppId);
  const uploadRes = await api('POST', '/api/documents/upload', tokenA, form);
  if (uploadRes.status === 200 && uploadRes.body.status === 'indexed') {
    if (uploadRes.body.id) cleanup.docIds.push(uploadRes.body.id);
    pass('Document upload/indexing still works', `chunks=${uploadRes.body.chunk_count}`);
  } else {
    fail('Document upload broken', JSON.stringify(uploadRes.body).slice(0, 100));
  }

  // ── Cleanup + Summary ──────────────────────────────────────────────────────
  await runCleanup();

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('\n[verify-phase5] Fatal:', err.message);
  process.exit(1);
});
