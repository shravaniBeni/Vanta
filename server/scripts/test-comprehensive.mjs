/**
 * test-comprehensive.mjs
 * Comprehensive behavior test for the C++ Tutor chatbot.
 * Tests: greetings, on-topic, off-topic, edge cases, follow-ups, mixed.
 *
 * Run: node scripts/test-comprehensive.mjs
 */

import 'dotenv/config';

const BASE       = 'http://localhost:3001';
const CHATBOT_ID = '5e484b09-d9ac-425c-ac3b-95b6209e99f0';

let passed = 0, failed = 0, warned = 0;

// ─── helpers ─────────────────────────────────────────────────────────────────

async function chat(query, sessionToken = undefined) {
  const body = { chatbot_id: CHATBOT_ID, query };
  if (sessionToken) body.session_token = sessionToken;
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

function ok(label, answer) {
  console.log(`  ✅ PASS  ${label}`);
  console.log(`         → "${answer?.slice(0, 100).replace(/\n/g, ' ')}..."`);
  passed++;
}

function fail(label, answer, reason) {
  console.log(`  ❌ FAIL  ${label}`);
  console.log(`         → "${answer?.slice(0, 100).replace(/\n/g, ' ')}..."`);
  console.log(`         ⚠  ${reason}`);
  failed++;
}

function warn(label, answer, reason) {
  console.log(`  ⚠️  WARN  ${label}`);
  console.log(`         → "${answer?.slice(0, 100).replace(/\n/g, ' ')}..."`);
  console.log(`         ℹ  ${reason}`);
  warned++;
}

function section(title) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

function isAbstain(answer) {
  return answer?.includes('does not contain information about this topic') ||
         answer?.includes('knowledge base does not');
}

function isError(answer) {
  return !answer || answer === 'undefined' || answer.includes('encountered an error generating');
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🧪 Comprehensive RAG behavior test — C++ Tutor`);
  console.log(`   chatbot_id: ${CHATBOT_ID}\n`);

  // ═══════════════════════════════════════════════════════
  // GROUP 1: Greetings & small talk
  // ═══════════════════════════════════════════════════════
  section('GROUP 1 — Greetings & small talk (should answer naturally, NOT abstain)');

  const greetings = [
    'hi',
    'hello',
    'hey there',
    'hello, how are you?',
    'good morning',
    'what can you do?',
    'who are you?',
    'thanks',
    'ok',
  ];

  for (const q of greetings) {
    const r = await chat(q);
    if (isError(r.answer))       fail(`"${q}"`, r.answer, 'Got an error response');
    else if (isAbstain(r.answer)) fail(`"${q}"`, r.answer, 'Should NOT abstain on greeting');
    else                          ok(`"${q}"`, r.answer);
  }

  // ═══════════════════════════════════════════════════════
  // GROUP 2: Core C++ concepts (should be in the KB)
  // ═══════════════════════════════════════════════════════
  section('GROUP 2 — Core C++ concepts (should answer from knowledge base)');

  const cppTopics = [
    'what is dereferencing?',
    'what is a pointer in C++?',
    'what is polymorphism?',
    'explain inheritance in C++',
    'what are the 4 pillars of OOP?',
    'what is encapsulation?',
    'what is a class in C++?',
    'how does memory management work in C++?',
    'what is a dangling pointer?',
    'explain virtual functions',
  ];

  for (const q of cppTopics) {
    const r = await chat(q);
    if (isError(r.answer))        fail(`"${q}"`, r.answer, 'Got an error response');
    else if (isAbstain(r.answer)) fail(`"${q}"`, r.answer, 'Should answer — topic is in the KB');
    else                          ok(`"${q}"`, r.answer);
  }

  // ═══════════════════════════════════════════════════════
  // GROUP 3: Off-topic questions (should politely decline, NOT hallucinate)
  // ═══════════════════════════════════════════════════════
  section('GROUP 3 — Off-topic (should politely decline or use general knowledge)');

  const offTopics = [
    { q: 'what is the weather in Mumbai?',    shouldAbstain: true  },
    { q: 'who is the president of the USA?',  shouldAbstain: true  },
    { q: 'write me a poem about the ocean',   shouldAbstain: false }, // flexible
    { q: 'what is 2 + 2?',                    shouldAbstain: false }, // basic math
  ];

  for (const { q, shouldAbstain } of offTopics) {
    const r = await chat(q);
    if (isError(r.answer)) {
      fail(`"${q}"`, r.answer, 'Got an error response');
    } else if (shouldAbstain && !isAbstain(r.answer)) {
      warn(`"${q}"`, r.answer, 'Expected polite refusal but got an answer (may be acceptable)');
    } else if (!shouldAbstain && isAbstain(r.answer)) {
      warn(`"${q}"`, r.answer, 'Could use general knowledge here but chose to abstain');
    } else {
      ok(`"${q}"`, r.answer);
    }
  }

  // ═══════════════════════════════════════════════════════
  // GROUP 4: Consistency — same question asked 3 times
  // ═══════════════════════════════════════════════════════
  section('GROUP 4 — Consistency (same question 3×, all should give same type of answer)');

  const consistencyQ = 'what is a pointer?';
  const results = [];
  for (let i = 0; i < 3; i++) {
    const r = await chat(consistencyQ);
    results.push(r.answer);
  }

  const abstainCounts = results.filter(isAbstain).length;
  const errorCounts   = results.filter(isError).length;

  console.log(`  Query: "${consistencyQ}" (asked 3×)`);
  results.forEach((a, i) => console.log(`  Run ${i+1}: "${a?.slice(0, 80).replace(/\n/g,' ')}..."`));

  if (errorCounts > 0) {
    fail('Consistency check', results[0], `${errorCounts}/3 runs errored`);
  } else if (abstainCounts === 3) {
    fail('Consistency check', results[0], 'All 3 runs abstained — topic may not be in KB');
  } else if (abstainCounts > 0) {
    fail('Consistency check', results[0], `INCONSISTENT: ${abstainCounts}/3 runs abstained`);
  } else {
    ok(`Consistent: 0/3 abstained, all answered`, results[0]);
  }

  // ═══════════════════════════════════════════════════════
  // GROUP 5: Multi-turn conversation (session memory)
  // ═══════════════════════════════════════════════════════
  section('GROUP 5 — Multi-turn conversation (session memory)');

  const r_turn1 = await chat('explain what a pointer is in C++');
  const token = r_turn1.session_token;
  console.log(`  Turn 1: "${r_turn1.answer?.slice(0,80).replace(/\n/g,' ')}..."`);
  console.log(`  session_token received: ${token ? '✓' : '✗'}`);

  const r_turn2 = await chat('can you give me a code example for that?', token);
  console.log(`  Turn 2: "${r_turn2.answer?.slice(0,100).replace(/\n/g,' ')}..."`);

  const r_turn3 = await chat('what mistakes should I avoid with it?', token);
  console.log(`  Turn 3: "${r_turn3.answer?.slice(0,100).replace(/\n/g,' ')}..."`);

  if (!token) {
    fail('Multi-turn', r_turn1.answer, 'No session_token returned — memory disabled');
  } else if (isAbstain(r_turn2.answer)) {
    fail('Multi-turn Turn 2', r_turn2.answer, 'Follow-up "give me a code example" abstained');
  } else if (isAbstain(r_turn3.answer)) {
    warn('Multi-turn Turn 3', r_turn3.answer, '"what mistakes" may lack context without memory');
  } else {
    ok('Multi-turn: all 3 turns answered correctly', r_turn1.answer);
  }

  // ═══════════════════════════════════════════════════════
  // GROUP 6: Ambiguous / short questions
  // ═══════════════════════════════════════════════════════
  section('GROUP 6 — Ambiguous & short questions (should try to answer, not crash)');

  const ambiguous = [
    'pointers',
    'oop',
    'tell me more',
    'explain it simply',
    'give an example',
  ];

  for (const q of ambiguous) {
    const r = await chat(q);
    if (isError(r.answer)) {
      fail(`"${q}"`, r.answer, 'Error on short/ambiguous query');
    } else {
      ok(`"${q}" — got a response`, r.answer);
    }
  }

  // ═══════════════════════════════════════════════════════
  // GROUP 7: Edge cases
  // ═══════════════════════════════════════════════════════
  section('GROUP 7 — Edge cases');

  const edgeCases = [
    { q: 'WHAT IS A POINTER?',    label: 'All-caps question' },
    { q: '   what is encapsulation?   ', label: 'Extra whitespace' },
    { q: 'what is c++?',          label: 'Meta question about the language itself' },
    { q: 'what is the difference between C and C++?', label: 'Comparison question' },
  ];

  for (const { q, label } of edgeCases) {
    const r = await chat(q);
    if (isError(r.answer))        fail(label, r.answer, 'Error');
    else if (isAbstain(r.answer)) warn(label, r.answer, 'Abstained (may or may not be in KB)');
    else                          ok(label, r.answer);
  }

  // ═══════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  RESULTS: ${passed} passed  |  ${warned} warnings  |  ${failed} failed`);
  console.log('═'.repeat(60));

  if (failed > 0) {
    console.log('\n  ❌ Some tests failed — review above for details.');
    process.exit(1);
  } else if (warned > 0) {
    console.log('\n  ⚠️  All tests passed with some warnings (acceptable behavior).');
  } else {
    console.log('\n  ✅ All tests passed!');
  }
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
