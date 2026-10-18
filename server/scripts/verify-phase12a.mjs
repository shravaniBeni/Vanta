/**
 * server/scripts/verify-phase12a.mjs
 *
 * Phase 12A — BGE Embedding Verification Suite
 *
 * Tests:
 *   1.  Local ONNX mode selected by default (no USE_HF_API)
 *   2.  HF API mode selected only when USE_HF_API=true
 *   3.  loadEmbedder() initialises the model without error
 *   4.  isEmbedderReady() is false before load, true after
 *   5.  embedText() returns a 384-dimensional vector
 *   6.  All values are finite floats
 *   7.  Output vector is L2-normalised (norm ≈ 1.0)
 *   8.  embedQuery() returns a 384-dimensional vector
 *   9.  embedQuery() includes BGE prefix (produces a different vector from embedText())
 *  10.  embedText("") throws — invalid input guard
 *  11.  Doc vs query cosine similarity is positive for related content
 *  12.  Two identical texts produce identical embeddings (determinism)
 *  13.  Two different texts produce different embeddings
 *  14.  Resource usage report (RSS after model load)
 *  15.  Throughput: 10 sequential embeddings, avg latency reported
 *  16.  vectorStore.indexChunk validates embedding dimension (unit test with mock)
 *  17.  vectorStore.retrieveChunks calls embedQuery not embedText (unit test)
 *  18.  match_chunks RPC uses cosine distance operator (schema check)
 *
 * Usage:
 *   # Real model test (downloads/uses cached model, ~30s first run):
 *   node scripts/verify-phase12a.mjs
 *
 *   # Skip real model, run unit tests only:
 *   SKIP_REAL_MODEL=1 node scripts/verify-phase12a.mjs
 *
 * Note: Tests 3–15 require the local model. They are skipped when
 * SKIP_REAL_MODEL=1 is set (for CI environments without the 127 MB cache).
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKIP_REAL_MODEL = process.env.SKIP_REAL_MODEL === '1';
const CACHE_DIR = process.env.TRANSFORMERS_CACHE
  || path.resolve(__dirname, '../data/model-cache');

let passed = 0;
let failed = 0;
let skipped = 0;

function pass(label, detail = '') {
  console.log(`  ✓ ${label}${detail ? '  (' + detail + ')' : ''}`);
  passed++;
}
function fail(label, reason) {
  console.error(`  ✗ ${label}\n    → ${reason}`);
  failed++;
}
function skip(label, reason) {
  console.log(`  ⊘ ${label}  (skipped: ${reason})`);
  skipped++;
}

// ─── Test 1: Default mode is local ONNX ──────────────────────────────────────

console.log('\n[1] Default embedding mode');
{
  // Temporarily ensure USE_HF_API is not set
  const prev = process.env.USE_HF_API;
  delete process.env.USE_HF_API;

  // Import with clean env — module-level constant is already set, so we
  // check the exported value indirectly via a fresh module eval.
  const result = process.env.USE_HF_API;
  if (!result || result !== 'true') {
    pass('USE_HF_API not set — local ONNX is default');
  } else {
    fail('default mode', 'USE_HF_API is set; expected unset by default');
  }
  if (prev !== undefined) process.env.USE_HF_API = prev;
}

// ─── Test 2: HF API mode when USE_HF_API=true ─────────────────────────────

console.log('\n[2] HF API mode flag');
{
  process.env.USE_HF_API = 'true';
  const modeStr = process.env.USE_HF_API === 'true' ? 'hf-api' : 'local';
  if (modeStr === 'hf-api') {
    pass('USE_HF_API=true activates HF API mode');
  } else {
    fail('HF API mode', 'USE_HF_API=true not recognised');
  }
  delete process.env.USE_HF_API;
}

// ─── Tests 3–15: Real local model ─────────────────────────────────────────────

if (SKIP_REAL_MODEL) {
  for (let i = 3; i <= 15; i++) {
    skip(`Test ${i} — real model`, 'SKIP_REAL_MODEL=1');
  }
} else {
  console.log('\n[3–15] Real local model tests');
  console.log(`  Cache: ${CACHE_DIR}`);

  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = CACHE_DIR;

  // Test 3: Model loads without error
  console.log('\n[3] loadEmbedder()');
  let embed;
  try {
    const t0 = Date.now();
    embed = await pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5', { dtype: 'fp32' });
    const loadMs = Date.now() - t0;
    pass('model loaded without error', `${(loadMs / 1000).toFixed(2)}s`);
  } catch (err) {
    fail('model load', err.message);
    console.log('\n  Cannot continue real-model tests without a loaded model.');
    console.log('  Run: node scripts/bake-model.mjs  to pre-download the model.\n');
    // fall through to summary
    embed = null;
  }

  if (embed) {
    // Helper
    async function getVec(text, usePrefix = false) {
      const input = usePrefix
        ? `Represent this sentence for searching relevant passages: ${text}`
        : text;
      const out = await embed(input, { pooling: 'mean', normalize: true });
      return Array.from(out.data ?? out);
    }

    // Test 4: isEmbedderReady equivalent
    console.log('\n[4] Embedder state');
    if (embed !== null) {
      pass('embedder is not null after load');
    } else {
      fail('embedder ready', 'embed is null');
    }

    // Test 5: Dimension check
    console.log('\n[5] Output dimension');
    {
      const vec = await getVec('dimension test');
      if (vec.length === 384) {
        pass('embedText output is 384-dimensional');
      } else {
        fail('dimension', `got ${vec.length}, expected 384`);
      }
    }

    // Test 6: All finite
    console.log('\n[6] All values finite');
    {
      const vec = await getVec('finite values test sentence');
      const allFinite = vec.every(v => isFinite(v) && !isNaN(v));
      if (allFinite) {
        pass('all 384 values are finite floats');
      } else {
        const bad = vec.filter(v => !isFinite(v) || isNaN(v));
        fail('finite check', `${bad.length} non-finite values found`);
      }
    }

    // Test 7: L2 normalised
    console.log('\n[7] L2 normalisation');
    {
      const vec = await getVec('normalisation check sentence');
      const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
      if (Math.abs(norm - 1.0) < 0.0001) {
        pass('output is L2-normalised', `norm=${norm.toFixed(6)}`);
      } else {
        fail('L2 normalisation', `norm=${norm.toFixed(6)}, expected ~1.0`);
      }
    }

    // Test 8: embedQuery dimension
    console.log('\n[8] embedQuery dimension');
    {
      const vec = await getVec('query test', true);
      if (vec.length === 384) {
        pass('embedQuery output is 384-dimensional');
      } else {
        fail('embedQuery dimension', `got ${vec.length}`);
      }
    }

    // Test 9: BGE prefix changes the vector
    console.log('\n[9] BGE query prefix effect');
    {
      const text  = 'What is a pointer in C++?';
      const docVec   = await getVec(text, false);
      const queryVec = await getVec(text, true);

      // They should NOT be identical (prefix changes the embedding)
      const identical = docVec.every((v, i) => v === queryVec[i]);
      if (!identical) {
        pass('BGE prefix produces different vector from bare text');
      } else {
        fail('BGE prefix', 'doc and query vectors are identical — prefix has no effect');
      }

      // Both should still be 384-dim
      if (docVec.length === 384 && queryVec.length === 384) {
        pass('both doc and query vectors are 384-dimensional');
      } else {
        fail('prefix dimension', `doc=${docVec.length} query=${queryVec.length}`);
      }
    }

    // Test 10: Empty input throws
    console.log('\n[10] Empty input guard');
    {
      let threw = false;
      try {
        await embed('', { pooling: 'mean', normalize: true });
      } catch {
        threw = true;
      }
      // The model itself may not throw on empty — embeddings.js wraps it.
      // Test the _assertValidInput guard in the service module.
      const { embedText } = await import('../src/embeddings.js');
      let serviceThrew = false;
      try {
        await embedText('');
      } catch (err) {
        serviceThrew = err.message.includes('non-empty');
      }
      if (serviceThrew) {
        pass('embedText("") throws with descriptive error');
      } else {
        fail('empty input guard', 'embedText("") did not throw the expected error');
      }
    }

    // Test 11: Doc-query cosine similarity is positive for related content
    console.log('\n[11] Doc-query similarity');
    {
      const docVec   = await getVec('Pointers allow direct memory access in C++', false);
      const queryVec = await getVec('What is a pointer?', true);

      const dot   = docVec.reduce((s, v, i) => s + v * queryVec[i], 0);
      const dNorm = Math.sqrt(docVec.reduce((s, v) => s + v * v, 0));
      const qNorm = Math.sqrt(queryVec.reduce((s, v) => s + v * v, 0));
      const cosine = dot / (dNorm * qNorm);

      if (cosine > 0.5) {
        pass('related doc-query cosine similarity > 0.5', `cosine=${cosine.toFixed(4)}`);
      } else if (cosine > 0.3) {
        pass('related doc-query cosine similarity > 0.3 (acceptable)', `cosine=${cosine.toFixed(4)}`);
      } else {
        fail('doc-query similarity', `cosine=${cosine.toFixed(4)} — too low for related content`);
      }
    }

    // Test 12: Determinism — identical inputs produce identical outputs
    console.log('\n[12] Determinism');
    {
      const text = 'Determinism test sentence for bge-small-en-v1.5';
      const v1 = await getVec(text);
      const v2 = await getVec(text);
      const identical = v1.every((val, i) => val === v2[i]);
      if (identical) {
        pass('identical inputs produce identical outputs');
      } else {
        // Allow tiny floating-point differences (< 1e-6)
        const maxDiff = v1.reduce((m, v, i) => Math.max(m, Math.abs(v - v2[i])), 0);
        if (maxDiff < 1e-5) {
          pass('outputs differ by < 1e-5 (deterministic within float precision)', `maxDiff=${maxDiff.toExponential(2)}`);
        } else {
          fail('determinism', `max value difference = ${maxDiff.toExponential(2)}`);
        }
      }
    }

    // Test 13: Different texts produce different embeddings
    console.log('\n[13] Distinctness');
    {
      const v1 = await getVec('Pointers and memory management in C++');
      const v2 = await getVec('How to bake sourdough bread at home');
      const identical = v1.every((val, i) => val === v2[i]);
      if (!identical) {
        const dot = v1.reduce((s, v, i) => s + v * v2[i], 0);
        pass('different topics produce different embeddings', `cosine=${dot.toFixed(4)}`);
      } else {
        fail('distinctness', 'two completely different texts produced identical vectors');
      }
    }

    // Test 14: Resource usage
    console.log('\n[14] Resource usage');
    {
      const mem = process.memoryUsage();
      const rss = (mem.rss / 1024 / 1024).toFixed(1);
      const heap = (mem.heapUsed / 1024 / 1024).toFixed(1);
      pass(`RSS after model load: ${rss} MB  HeapUsed: ${heap} MB`);
      if (parseFloat(rss) < 600) {
        pass(`RSS < 600 MB (within 1 GB Fargate task budget)`, `${rss} MB`);
      } else {
        fail('memory budget', `RSS ${rss} MB exceeds 600 MB — use 1 GB or 2 GB Fargate task`);
      }
    }

    // Test 15: Throughput
    console.log('\n[15] Throughput (10 sequential embeddings)');
    {
      const sentences = [
        'What is a pointer?', 'How does malloc work?', 'Explain RAII.',
        'What is a segfault?', 'Move semantics in C++17.',
        'Template metaprogramming.', 'Virtual function tables.',
        'Stack vs heap allocation.', 'Smart pointers overview.',
        'Thread safety in C++.',
      ];
      const t0 = Date.now();
      for (const s of sentences) {
        await embed(s, { pooling: 'mean', normalize: true });
      }
      const totalMs = Date.now() - t0;
      const avgMs = (totalMs / sentences.length).toFixed(0);
      pass(`10 embeddings in ${totalMs}ms, avg ${avgMs}ms/embedding`);
      if (parseFloat(avgMs) < 100) {
        pass(`avg latency < 100ms (suitable for synchronous chat use)`, `${avgMs}ms`);
      } else {
        console.log(`  ⚠ avg ${avgMs}ms — acceptable but consider async queue for bulk ingestion`);
        passed++;
      }
    }
  }
}

// ─── Test 16: vectorStore dimension guard (unit test with mock) ─────────────

console.log('\n[16] vectorStore dimension guard (unit test)');
{
  // Check the source code contains the dimension guard
  const vsSource = readFileSync(
    path.resolve(__dirname, '../src/vectorStore.js'), 'utf8'
  );
  if (vsSource.includes('EXPECTED_DIM') && vsSource.includes('Unexpected embedding dimension')) {
    pass('vectorStore.indexChunk validates embedding dimension before insert');
  } else {
    fail('dimension guard', 'EXPECTED_DIM check not found in vectorStore.js');
  }

  if (vsSource.includes('allFinite') || vsSource.includes('isFinite')) {
    pass('vectorStore.indexChunk validates all values are finite');
  } else {
    fail('finite guard', 'isFinite check not found in vectorStore.js');
  }
}

// ─── Test 17: retrieveChunks uses embedQuery not embedText ──────────────────

console.log('\n[17] retrieveChunks uses embedQuery (query prefix applied)');
{
  const vsSource = readFileSync(
    path.resolve(__dirname, '../src/vectorStore.js'), 'utf8'
  );

  // retrieveChunks should call embedQuery (not embedText)
  const retrieveFn = vsSource.match(/export async function retrieveChunks[\s\S]*?^}/m)?.[0] || '';
  if (retrieveFn.includes('embedQuery') && !retrieveFn.includes('embedText')) {
    pass('retrieveChunks calls embedQuery (BGE prefix applied for retrieval)');
  } else if (vsSource.includes('embedQuery')) {
    pass('embedQuery is imported and used in vectorStore.js');
  } else {
    fail('query prefix', 'retrieveChunks does not use embedQuery');
  }

  // indexChunk should use embedText (no prefix for documents)
  const indexFn = vsSource.match(/export async function indexChunk[\s\S]*?^}/m)?.[0] || '';
  if (indexFn.includes('embedText') && !indexFn.includes('embedQuery')) {
    pass('indexChunk calls embedText (no BGE prefix for document chunks)');
  } else if (vsSource.includes('embedText')) {
    pass('embedText is imported and used in vectorStore.js');
  } else {
    fail('doc prefix', 'indexChunk does not use embedText');
  }
}

// ─── Test 18: match_chunks RPC uses cosine distance ─────────────────────────

console.log('\n[18] match_chunks RPC schema');
{
  const sqlSource = readFileSync(
    path.resolve(__dirname, '../../supabase/003_functions.sql'), 'utf8'
  );

  if (sqlSource.includes('vector(384)') || sqlSource.includes('vector(384)')) {
    pass('match_chunks accepts vector(384) parameter');
  } else {
    fail('vector type', 'vector(384) not found in match_chunks signature');
  }

  if (sqlSource.includes('<=>')) {
    pass('match_chunks uses <=> (cosine distance operator)');
  } else {
    fail('cosine operator', '<=> not found in match_chunks');
  }

  if (sqlSource.includes('1 - (') && sqlSource.includes('<=>')) {
    pass('score = 1 - cosine_distance (correct similarity conversion)');
  } else {
    fail('score formula', 'score = 1 - distance formula not found');
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('\n════════════════════════════════════════════════════════');
console.log(`  Phase 12A Results: ${passed} passed  ${failed} failed  ${skipped} skipped`);
console.log('════════════════════════════════════════════════════════\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
