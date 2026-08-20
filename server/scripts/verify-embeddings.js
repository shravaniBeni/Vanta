/**
 * server/scripts/verify-embeddings.js
 *
 * Phase 2 verification script for the local embedding infrastructure.
 * Runs all 7 required tests and reports results.
 *
 * Usage:
 *   node scripts/verify-embeddings.js
 *
 * Requires TRANSFORMERS_CACHE to be set in .env (or defaults to HF cache).
 * First run will download the model if not already cached.
 */

import 'dotenv/config';
import { loadEmbedder, embedText, embedQuery, isEmbedderReady } from '../src/embeddings.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function l2norm(vec) {
  return Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
}

let passed = 0;
let failed = 0;

function pass(label, detail = '') {
  console.log(`  ✅ PASS  ${label}${detail ? '  — ' + detail : ''}`);
  passed++;
}

function fail(label, detail = '') {
  console.log(`  ❌ FAIL  ${label}${detail ? '  — ' + detail : ''}`);
  failed++;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Phase 2 — Embedding Verification Suite');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // ── Test 1: Model initialization ──────────────────────────────────────────

  process.stdout.write('  Test 1  Model initialization... ');
  const t0 = Date.now();
  try {
    await loadEmbedder();
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    if (isEmbedderReady()) {
      pass('loadEmbedder() succeeded', `${elapsed}s`);
    } else {
      fail('loadEmbedder() returned but isEmbedderReady() is false');
    }
  } catch (err) {
    fail('loadEmbedder() threw', err.message);
  }

  // ── Test 2: Correct dimension ──────────────────────────────────────────────

  process.stdout.write('  Test 2  Correct dimension... ');
  try {
    const vec = await embedText('hello world');
    if (Array.isArray(vec) && vec.length === 384) {
      pass(`embedText() returns array of length ${vec.length}`);
    } else {
      fail('Wrong dimension or type', `got ${Array.isArray(vec) ? vec.length : typeof vec}`);
    }
  } catch (err) {
    fail('embedText() threw', err.message);
  }

  // ── Test 3: Normalization ──────────────────────────────────────────────────

  process.stdout.write('  Test 3  L2 normalization... ');
  try {
    const vec = await embedText('normalization test sentence');
    const norm = l2norm(vec);
    const tolerance = 1e-4;
    if (Math.abs(norm - 1.0) < tolerance) {
      pass(`L2 norm ≈ 1.0`, `actual: ${norm.toFixed(6)}`);
    } else {
      fail(`L2 norm not ~1.0`, `actual: ${norm.toFixed(6)}, diff: ${Math.abs(norm - 1.0).toFixed(6)}`);
    }
  } catch (err) {
    fail('normalization check threw', err.message);
  }

  // ── Test 4: Semantic similarity sanity check ───────────────────────────────

  process.stdout.write('  Test 4  Semantic similarity... ');
  try {
    const [vecA, vecB, vecC] = await Promise.all([
      embedText('How can I return an item I purchased?'),
      embedText('What is the product return policy?'),
      embedText('The weather is sunny today.'),
    ]);

    const simAB = cosineSim(vecA, vecB);
    const simAC = cosineSim(vecA, vecC);

    if (simAB > simAC) {
      pass(
        'similarity(return_A, return_B) > similarity(return_A, weather_C)',
        `sim(A,B)=${simAB.toFixed(4)}  sim(A,C)=${simAC.toFixed(4)}`
      );
    } else {
      fail(
        'Semantic similarity ordering violated',
        `sim(A,B)=${simAB.toFixed(4)} should be > sim(A,C)=${simAC.toFixed(4)}`
      );
    }
  } catch (err) {
    fail('semantic similarity test threw', err.message);
  }

  // ── Test 5: Query embedding dimension ─────────────────────────────────────

  process.stdout.write('  Test 5  Query embedding dimension... ');
  try {
    const vec = await embedQuery('return policy');
    if (Array.isArray(vec) && vec.length === 384) {
      pass(`embedQuery() returns array of length ${vec.length}`);
    } else {
      fail('Wrong dimension or type', `got ${Array.isArray(vec) ? vec.length : typeof vec}`);
    }
  } catch (err) {
    fail('embedQuery() threw', err.message);
  }

  // ── Test 6: Invalid input throws ──────────────────────────────────────────

  process.stdout.write('  Test 6  Invalid input rejection... ');
  let emptyThrew = false;
  let nullThrew = false;
  try { await embedText(''); } catch { emptyThrew = true; }
  try { await embedText(null); } catch { nullThrew = true; }

  if (emptyThrew && nullThrew) {
    pass('Empty string and null both throw clear errors');
  } else {
    fail(
      'Invalid input not rejected',
      `empty=${emptyThrew}, null=${nullThrew}`
    );
  }

  // ── Test 7: Single model instance (no reload) ─────────────────────────────

  process.stdout.write('  Test 7  Single model instance reuse... ');
  try {
    const t1 = Date.now();
    await loadEmbedder(); // second call — should be instant no-op
    const elapsed = Date.now() - t1;

    if (elapsed < 100) {
      pass(`Repeated loadEmbedder() is a no-op`, `${elapsed}ms`);
    } else {
      fail(
        'Repeated loadEmbedder() took too long — may be reloading model',
        `${elapsed}ms`
      );
    }
  } catch (err) {
    fail('Repeated loadEmbedder() threw', err.message);
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('\n[verify-embeddings] Unexpected error:', err.message);
  process.exit(1);
});
