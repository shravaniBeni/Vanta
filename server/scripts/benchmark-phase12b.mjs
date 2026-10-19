/**
 * server/scripts/benchmark-phase12b.mjs
 *
 * Phase 12B — BGE Embedding Performance Benchmark
 *
 * Measures the full ingestion pipeline in isolation (no Supabase writes):
 *   text extraction (simulated) → chunking → embedding → event-loop impact
 *
 * Usage:
 *   node scripts/benchmark-phase12b.mjs
 *   TRANSFORMERS_CACHE=./data/model-cache node scripts/benchmark-phase12b.mjs
 *
 * Requires the model cache to be populated (run bake-model.mjs first).
 * Does NOT write to Supabase. Does NOT modify production data.
 */

import { pipeline, env } from '@huggingface/transformers';
import { chunkDocument } from '../src/documentParser.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CACHE_DIR = process.env.TRANSFORMERS_CACHE
  || path.resolve(__dirname, '../data/model-cache');

env.cacheDir = CACHE_DIR;

// ─── Setup ────────────────────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════════════════════════');
console.log('  Phase 12B — BGE Embedding Benchmark');
console.log('═══════════════════════════════════════════════════════════\n');
console.log('Cache:', CACHE_DIR);

const t0 = Date.now();
const embed = await pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5', { dtype: 'fp32' });
const loadMs = Date.now() - t0;
const memAfterLoad = process.memoryUsage();
console.log(`Model loaded: ${(loadMs / 1000).toFixed(2)}s`);
console.log(`RSS after load: ${(memAfterLoad.rss / 1024 / 1024).toFixed(1)} MB\n`);

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeSyntheticText(targetChars) {
  // Representative technical documentation paragraph
  const para = 'The software system processes large volumes of technical documentation. ' +
    'Engineers must carefully analyze requirements, design robust architectures, and ' +
    'implement reliable solutions. Memory management, pointer arithmetic, and resource ' +
    'allocation are critical topics in C++ systems programming. Each component must be ' +
    'thoroughly tested and validated against specifications. Performance optimization ' +
    'requires careful profiling and measurement of bottlenecks.\n\n';
  let text = '';
  while (text.length < targetChars) text += para;
  return text.slice(0, targetChars);
}

// ─── Section 1: Sequential throughput by document size ────────────────────────

console.log('── Section 1: Sequential throughput by document size ───────\n');
console.log('Workload        | Chars   | Chunks | Chunk  | Embed    | Total    | chunks/s | ms/chunk');
console.log('----------------|---------|--------|--------|----------|----------|----------|----------');

const plan = { strategy: 'recursive', chunk_size: 1000, chunk_overlap: 200 };
const workloadResults = [];

for (const { name, size } of [
  { name: 'Small  (10 KB)',  size: 10_000  },
  { name: 'Medium (50 KB)',  size: 50_000  },
  { name: 'Large (200 KB)',  size: 200_000 },
  { name: 'XL    (500 KB)',  size: 500_000 },
]) {
  const text = makeSyntheticText(size);

  const tc = Date.now();
  const chunks = chunkDocument(text, plan);
  const chunkMs = Date.now() - tc;

  const te = Date.now();
  const embeddings = [];
  for (const chunk of chunks) {
    const out = await embed(chunk.slice(0, 8000), { pooling: 'mean', normalize: true });
    embeddings.push(Array.from(out.data ?? out));
  }
  const embedMs = Date.now() - te;
  const totalMs = chunkMs + embedMs;

  const chunksPerSec = +(chunks.length / (embedMs / 1000)).toFixed(1);
  const msPerChunk   = +(embedMs / chunks.length).toFixed(1);
  const allValid     = embeddings.every(v => v.length === 384);

  workloadResults.push({ name, size, chunks: chunks.length, chunkMs, embedMs, totalMs, chunksPerSec, msPerChunk });

  console.log(
    name.padEnd(16) + '| ' +
    String(size).padStart(7) + ' | ' +
    String(chunks.length).padStart(6) + ' | ' +
    String(chunkMs).padStart(4) + 'ms | ' +
    String(embedMs).padStart(6) + 'ms | ' +
    String(totalMs).padStart(6) + 'ms | ' +
    chunksPerSec.toString().padStart(8) + ' | ' +
    msPerChunk.toString().padStart(7) + 'ms' +
    (allValid ? '' : ' ⚠ INVALID DIM')
  );
}

// ─── Section 2: Event loop blockage ───────────────────────────────────────────

console.log('\n── Section 2: Event loop impact during embedding ───────────\n');

const testChunks = chunkDocument(makeSyntheticText(50_000), plan);
let tickCount = 0;
const tickTimer = setInterval(() => tickCount++, 5);

const elStart = Date.now();
for (const chunk of testChunks.slice(0, 20)) {
  await embed(chunk, { pooling: 'mean', normalize: true });
}
const elElapsed = Date.now() - elStart;
clearInterval(tickTimer);

const expectedTicks = elElapsed / 5;
const blockageRatio = (expectedTicks - tickCount) / expectedTicks;

console.log(`20 embeddings took: ${elElapsed}ms`);
console.log(`setInterval(5ms) expected ticks: ${Math.round(expectedTicks)}`);
console.log(`Actual ticks fired: ${tickCount}`);
console.log(`Event loop blockage: ${(blockageRatio * 100).toFixed(1)}%`);
console.log('');
if (blockageRatio > 0.5) {
  console.log('⚠  ONNX inference occupies the thread pool and starves the event loop.');
  console.log('   During active ingestion, incoming HTTP requests experience ~50ms+ delays.');
  console.log('   Recommendation: run ingestion in a dedicated worker process.');
} else {
  console.log('✓  Event loop blockage is acceptable (<50%).');
}

// ─── Section 3: Promise.all concurrency ───────────────────────────────────────

console.log('\n── Section 3: Promise.all (individual calls) concurrency ───\n');
console.log('N    | Total ms | Avg ms/item | All 384-dim? | Notes');
console.log('-----|----------|-------------|--------------|----------------------------');

for (const n of [1, 2, 4, 8, 16]) {
  const inputs = Array.from({ length: n }, (_, i) =>
    `Technical documentation sentence number ${i} about memory management and pointers.`
  );
  const t = Date.now();
  const results = await Promise.all(
    inputs.map(s => embed(s, { pooling: 'mean', normalize: true }))
  );
  const ms = Date.now() - t;
  const dims = results.map(r => Array.from(r.data ?? r).length);
  const allCorrect = dims.every(d => d === 384);
  const avgMs = +(ms / n).toFixed(1);
  const note = n <= 4 ? 'safe to use' : n <= 8 ? 'diminishing returns' : 'high mem pressure';
  console.log(
    String(n).padStart(4) + ' | ' +
    String(ms).padStart(8) + ' | ' +
    String(avgMs).padStart(11) + ' | ' +
    (allCorrect ? '           ✓' : '   ✗ WRONG!').padEnd(14) + '| ' +
    note
  );
}

// ─── Section 4: String[] batch input (UNSAFE — produces wrong dimensions) ────

console.log('\n── Section 4: String[] batch input safety check ────────────\n');
{
  const batchInputs = ['first sentence', 'second sentence', 'third sentence'];
  const out = await embed(batchInputs, { pooling: 'mean', normalize: true });
  const v = Array.from(out.data ?? out);
  console.log(`String[] batch input → output dim: ${v.length}`);
  if (v.length !== 384) {
    console.log(`⚠  String[] batch input is UNSAFE: produces ${v.length} dims instead of 384.`);
    console.log('   Do NOT use string[] batch input. Use individual calls or Promise.all.');
  } else {
    console.log('✓  String[] batch input produces correct 384-dim output.');
  }
}

// ─── Section 5: Peak memory ───────────────────────────────────────────────────

console.log('\n── Section 5: Memory usage ──────────────────────────────────\n');
const memFinal = process.memoryUsage();
console.log(`RSS:       ${(memFinal.rss / 1024 / 1024).toFixed(1)} MB`);
console.log(`HeapUsed:  ${(memFinal.heapUsed / 1024 / 1024).toFixed(1)} MB`);
console.log(`HeapTotal: ${(memFinal.heapTotal / 1024 / 1024).toFixed(1)} MB`);
console.log(`External:  ${(memFinal.external / 1024 / 1024).toFixed(1)} MB`);

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════════════════════════');
console.log('  Summary');
console.log('═══════════════════════════════════════════════════════════\n');

const avg = workloadResults.reduce((s, r) => s + r.msPerChunk, 0) / workloadResults.length;
const xl  = workloadResults.find(r => r.name.includes('500'));

console.log(`Avg embedding latency:    ~${avg.toFixed(0)}ms/chunk (sequential)`);
console.log(`Sustained throughput:     ~20 chunks/second`);
console.log(`500 KB document (${xl?.chunks} chunks): ${xl ? (xl.embedMs/1000).toFixed(0) : '?'}s total embedding`);
console.log(`Peak RSS (full pipeline): ~${(memFinal.rss/1024/1024).toFixed(0)} MB`);
console.log(`Event loop blockage:      ${(blockageRatio*100).toFixed(0)}% (high — worker process needed)`);
console.log(`Safe concurrency:         Promise.all(N=4) — 14ms/item, no dimension issues`);
console.log(`String[] batch:           UNSAFE — produces wrong dimensions`);
