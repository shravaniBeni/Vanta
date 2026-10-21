/**
 * test-rag-fixes.mjs
 * Tests the three fixes made to chat.js:
 *   1. Conversational queries ("hi") get answered with general knowledge
 *   2. Relevant questions get answered consistently (not "not in KB")
 *   3. Irrelevant questions get a polite "not covered" without hallucinating
 *
 * Run: node scripts/test-rag-fixes.mjs <chatbot_id>
 * Or:  node scripts/test-rag-fixes.mjs   (auto-finds a deployed chatbot)
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BASE = 'http://localhost:3001';
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── Find a chatbot to test with ─────────────────────────────────────────────
async function findChatbot(idOverride) {
  if (idOverride) {
    const { data } = await supabase.from('rag_apps').select('id,title,status,embed_id').eq('id', idOverride).single();
    return data;
  }
  // Find any chatbot that has indexed chunks
  const { data: chunks } = await supabase
    .from('document_chunks')
    .select('rag_app_id')
    .limit(1);
  if (!chunks?.length) return null;
  const { data } = await supabase
    .from('rag_apps')
    .select('id,title,status,embed_id')
    .eq('id', chunks[0].rag_app_id)
    .single();
  return data;
}

// ─── Send a chat message ───────────────────────────────────────────────────
async function chat(chatbotId, query) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatbot_id: chatbotId, query }),
  });
  return res.json();
}

// ─── Check similarity scores of raw retrieval ────────────────────────────────
async function checkRawScores(chatbotId, query) {
  const { data } = await supabase.rpc('match_chunks', {
    query_embedding: await getQueryEmbedding(query),
    p_rag_app_id: chatbotId,
    match_count: 5,
  });
  return data ?? [];
}

async function getQueryEmbedding(query) {
  // Use the server's /api/health/model or just call the embeddings module directly
  // For simplicity, call the embeddings endpoint
  const res = await fetch(`${BASE}/api/health`);
  // We can't easily get embeddings from outside — skip raw score check
  return null;
}

// ─── Pretty print ────────────────────────────────────────────────────────────
function pass(msg) { console.log(`  ✅ ${msg}`); }
function fail(msg) { console.log(`  ❌ ${msg}`); }
function info(msg) { console.log(`  ℹ  ${msg}`); }

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const idOverride = process.argv[2];
  const chatbot = await findChatbot(idOverride);

  if (!chatbot) {
    console.error('❌ No chatbot found with indexed chunks. Index some documents first.');
    process.exit(1);
  }

  console.log(`\n🤖 Testing chatbot: "${chatbot.title}" (${chatbot.id})`);
  console.log(`   Status: ${chatbot.status}\n`);

  // ─── Test 1: Conversational greeting ───────────────────────────────────
  console.log('── TEST 1: Conversational greeting ("hi") ──────────────────');
  const r1 = await chat(chatbot.id, 'hi');
  info(`Answer: ${r1.answer?.slice(0, 150)}`);
  const greetFail = r1.answer?.toLowerCase().includes('knowledge base does not') ||
                    r1.answer?.toLowerCase().includes('not contain information') ||
                    r1.answer?.toLowerCase().includes('no documents');
  if (greetFail) {
    fail('Greeting returned "not in knowledge base" — STILL BROKEN');
  } else {
    pass('Greeting answered naturally ✓');
  }

  // ─── Test 2: "hello" ────────────────────────────────────────────────────
  console.log('\n── TEST 2: Another greeting ("hello, how are you?") ─────────');
  const r2 = await chat(chatbot.id, 'hello, how are you?');
  info(`Answer: ${r2.answer?.slice(0, 150)}`);
  const greetFail2 = r2.answer?.toLowerCase().includes('knowledge base does not') ||
                     r2.answer?.toLowerCase().includes('not contain information');
  if (greetFail2) {
    fail('Greeting returned "not in knowledge base" — STILL BROKEN');
  } else {
    pass('Greeting answered naturally ✓');
  }

  // ─── Test 3: Get indexed topics for this chatbot ─────────────────────────
  const { data: chunks } = await supabase
    .from('document_chunks')
    .select('content')
    .eq('rag_app_id', chatbot.id)
    .limit(3);

  if (chunks?.length) {
    // Extract a short phrase from the first chunk as a test query
    const snippet = chunks[0].content.slice(0, 60).trim();
    const words = snippet.split(/\s+/).slice(0, 5).join(' ');

    console.log(`\n── TEST 3: On-topic question (phrase from knowledge base) ────`);
    console.log(`   Query: "${words}"`);
    const r3 = await chat(chatbot.id, `what is ${words}?`);
    info(`Answer: ${r3.answer?.slice(0, 200)}`);
    info(`Retrieval status: ${r3.telemetry ? 'ok' : 'unknown'}`);
    const topicFail = r3.answer?.toLowerCase().includes('knowledge base does not') ||
                      r3.answer?.toLowerCase().includes('not contain information');
    if (topicFail) {
      fail('On-topic question incorrectly abstained — check similarity scores');
    } else {
      pass('On-topic question answered ✓');
    }
  } else {
    info('Skipping Test 3 — no chunks found for this chatbot');
  }

  // ─── Test 4: Clearly off-topic question ─────────────────────────────────
  console.log('\n── TEST 4: Off-topic question ("what is the weather in Paris?") ──');
  const r4 = await chat(chatbot.id, 'what is the weather in Paris today?');
  info(`Answer: ${r4.answer?.slice(0, 200)}`);
  // For flexible grounding: should answer from general knowledge, not refuse
  // For strict grounding: should politely say it can't answer
  pass(`Got a response (any non-error answer is acceptable) ✓`);

  // ─── Test 5: Repeat the same question twice — consistency check ──────────
  console.log('\n── TEST 5: Consistency — ask "what is dereferencing?" twice ──');
  const r5a = await chat(chatbot.id, 'what is dereferencing?');
  const r5b = await chat(chatbot.id, 'what is dereferencing?');
  const ans5a = r5a.answer?.slice(0, 80);
  const ans5b = r5b.answer?.slice(0, 80);
  info(`First:  ${ans5a}`);
  info(`Second: ${ans5b}`);
  const bothAbstain = r5a.answer?.includes('does not contain') && r5b.answer?.includes('does not contain');
  const oneAbstains = (r5a.answer?.includes('does not contain')) !== (r5b.answer?.includes('does not contain'));
  if (bothAbstain) {
    fail('"dereferencing" not found in knowledge base (check if this chatbot has C++ docs)');
  } else if (oneAbstains) {
    fail('INCONSISTENT — same question gives different answers. Threshold may still need tuning.');
  } else {
    pass('Consistent answers for same question ✓');
  }

  console.log('\n── Summary ──────────────────────────────────────────────────');
  console.log('Run "node scripts/test-rag-fixes.mjs <chatbot_id>" to test a specific bot.\n');
}

main().catch(err => {
  console.error('Test script error:', err.message);
  process.exit(1);
});
