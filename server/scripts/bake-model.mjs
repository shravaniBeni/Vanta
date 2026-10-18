/**
 * server/scripts/bake-model.mjs
 *
 * Downloads Xenova/bge-small-en-v1.5 ONNX weights into the model cache
 * directory during `docker build`. This makes the final container image
 * self-contained — no outbound HuggingFace traffic is needed at runtime.
 *
 * Run: node scripts/bake-model.mjs
 * Env: TRANSFORMERS_CACHE — target cache directory (default: ./data/model-cache)
 *
 * Exit codes:
 *   0 — model downloaded and verified successfully
 *   1 — download or verification failed (Docker build will fail)
 */

import { mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CACHE_DIR  = process.env.TRANSFORMERS_CACHE
  || path.resolve(__dirname, '../data/model-cache');
const MODEL_ID   = 'Xenova/bge-small-en-v1.5';
const EXPECTED_DIM = 384;

console.log('[bake-model] Starting model bake...');
console.log('[bake-model] Cache directory:', CACHE_DIR);
console.log('[bake-model] Model:', MODEL_ID);

// Ensure cache directory exists
mkdirSync(CACHE_DIR, { recursive: true });

const t0 = Date.now();

let embed;
try {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = CACHE_DIR;

  console.log('[bake-model] Downloading model weights (this takes 15-60s on first run)...');
  embed = await pipeline('feature-extraction', MODEL_ID, { dtype: 'fp32' });
  console.log(`[bake-model] Model loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} catch (err) {
  console.error('[bake-model] FATAL: Model download failed:', err.message);
  process.exit(1);
}

// Verify the model produces correct output
console.log('[bake-model] Verifying model output...');

try {
  const testText = 'Verification test sentence for bge-small-en-v1.5';
  const output = await embed(testText, { pooling: 'mean', normalize: true });
  const vec = Array.from(output.data ?? output);

  if (vec.length !== EXPECTED_DIM) {
    console.error(`[bake-model] FATAL: Wrong dimension: got ${vec.length}, expected ${EXPECTED_DIM}`);
    process.exit(1);
  }

  const allFinite = vec.every(v => isFinite(v));
  if (!allFinite) {
    console.error('[bake-model] FATAL: Embedding contains non-finite values');
    process.exit(1);
  }

  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (Math.abs(norm - 1.0) > 0.001) {
    console.error(`[bake-model] FATAL: Vector not normalized: norm=${norm.toFixed(6)}`);
    process.exit(1);
  }

  console.log('[bake-model] ✓ Dimension: 384');
  console.log('[bake-model] ✓ All values finite');
  console.log('[bake-model] ✓ L2 normalized (norm =', norm.toFixed(6) + ')');
  console.log(`[bake-model] ✓ Model bake complete in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} catch (err) {
  console.error('[bake-model] FATAL: Verification failed:', err.message);
  process.exit(1);
}

// Log cache size for image build diagnostics
try {
  const { readdirSync, statSync } = await import('fs');
  let totalBytes = 0;
  function walk(dir) {
    for (const f of readdirSync(dir)) {
      const full = path.join(dir, f);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else totalBytes += st.size;
    }
  }
  walk(CACHE_DIR);
  console.log(`[bake-model] Cache size: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
} catch { /* non-fatal */ }

process.exit(0);
